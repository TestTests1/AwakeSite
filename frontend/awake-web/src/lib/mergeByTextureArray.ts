import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Схлопывает всю геометрию тайла в 2–3 меша с одним материалом на каждый.
 *
 * Узкое место рендера — не треугольники, а количество вызовов отрисовки: тайл
 * приходит из экспортёра как ~200 примитивов, у каждого свой материал со своей
 * текстурой блока, и каждый стоит отдельного вызова с перепривязкой текстуры.
 *
 * Все текстуры блоков имеют размер 256×256 — это позволяет сложить их слоями в
 * DataArrayTexture (массив текстур WebGL2) вместо атласа. Атлас потребовал бы
 * переупаковки UV, ломал бы те грани, что рассчитывают на повтор текстуры
 * (~1% UV выходит за [0..1]), и подтекал бы соседними клетками при фильтрации.
 * У массива каждый слой остаётся самостоятельной текстурой со своим повтором.
 *
 * Номер слоя едет в вершинном атрибуте, выборка подменяется в шейдере — всё
 * остальное (свет, вершинные цвета, alpha-test) работает штатно.
 */

/** Материалы разводятся по корзинам: смешивать их в один вызов нельзя. */
type Bucket = 'opaque' | 'cutout' | 'blend'

const LAYER_SIZE = 256

interface Piece {
  geometry: THREE.BufferGeometry
  bucket: Bucket
  alphaTest: number
}

function bucketOf(material: THREE.Material): Bucket {
  if (material.transparent) return 'blend'
  if (material.alphaTest > 0) return 'cutout'
  return 'opaque'
}

/**
 * Пиксели загруженной текстуры. GLTFLoader отдаёт ImageBitmap или <img> в
 * зависимости от того, что доступно в браузере, — оба рисуются на канву.
 */
function readPixels(image: CanvasImageSource, ctx: CanvasRenderingContext2D): Uint8ClampedArray {
  ctx.clearRect(0, 0, LAYER_SIZE, LAYER_SIZE)
  ctx.drawImage(image, 0, 0, LAYER_SIZE, LAYER_SIZE)
  return ctx.getImageData(0, 0, LAYER_SIZE, LAYER_SIZE).data
}

/**
 * Геометрия примитива в общем формате: мировые координаты, единый набор
 * атрибутов, номер слоя и вершинный цвет с уже вмешанным цветом материала.
 */
function normalizeGeometry(mesh: THREE.Mesh, material: THREE.Material, layer: number) {
  const source = mesh.geometry
  const count = source.getAttribute('position').count
  const geometry = new THREE.BufferGeometry()

  // Позиции квантованы в int16 с масштабом и сдвигом в узле сцены, поэтому
  // трансформация обязана быть применена до слияния — общего родителя у слитых
  // кусков уже не будет. Применять матрицу прямо к int16 нельзя: результат
  // записался бы обратно в целые, поэтому сначала разворачиваем во float.
  const src = source.getAttribute('position')
  const position = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    position[i * 3] = src.getX(i)
    position[i * 3 + 1] = src.getY(i)
    position[i * 3 + 2] = src.getZ(i)
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.applyMatrix4(mesh.matrixWorld)

  const uv = source.getAttribute('uv')
  geometry.setAttribute(
    'uv',
    uv
      ? new THREE.Float32BufferAttribute(
          Float32Array.from({ length: count * 2 }, (_, i) =>
            uv.getComponent(Math.floor(i / 2), i % 2),
          ),
          2,
        )
      : new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2),
  )

  // Цвет материала (baseColorFactor) и прозрачность после слияния взять
  // неоткуда — вмешиваем их в вершинный цвет
  const mat = material as THREE.MeshLambertMaterial
  const tint = mat.color ?? new THREE.Color(1, 1, 1)
  const alpha = mat.opacity ?? 1
  const vertexColor = source.getAttribute('color')
  const colors = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const r = vertexColor ? vertexColor.getX(i) : 1
    const g = vertexColor ? vertexColor.getY(i) : 1
    const b = vertexColor ? vertexColor.getZ(i) : 1
    const a = vertexColor && vertexColor.itemSize > 3 ? vertexColor.getW(i) : 1
    colors[i * 4] = r * tint.r
    colors[i * 4 + 1] = g * tint.g
    colors[i * 4 + 2] = b * tint.b
    colors[i * 4 + 3] = a * alpha
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))

  const layers = new Uint16Array(count).fill(layer)
  geometry.setAttribute('aLayer', new THREE.Uint16BufferAttribute(layers, 1))

  if (source.index) geometry.setIndex(source.index.clone())
  return geometry
}

function placeholder(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  texture.needsUpdate = true
  return texture
}

/**
 * Подменяет выборку из map на выборку из слоя массива текстур.
 *
 * НЕ РАБОТАЕТ: текстуры не доезжают до шейдера, геометрия рисуется почти
 * голым вершинным цветом. Включается галочкой на вкладке «Мир», по умолчанию
 * выключено. Не разобрано, главный подозреваемый — юниформа `mapArray`,
 * добавленная в onBeforeCompile: сэмплер остаётся привязан к нулевому
 * текстурному блоку, где лежит однопиксельная заглушка `map`.
 */
function patchShader(material: THREE.Material, textures: THREE.DataArrayTexture, bucket: Bucket) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.mapArray = { value: textures }

    shader.vertexShader = `attribute float aLayer;\nvarying float vLayer;\n${shader.vertexShader}`
      .replace('void main() {', 'void main() {\n\tvLayer = aLayer;')

    shader.fragmentShader = `precision highp sampler2DArray;\nuniform sampler2DArray mapArray;\nvarying float vLayer;\n${shader.fragmentShader}`
      .replace(
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
        'vec4 sampledDiffuseColor = texture( mapArray, vec3( vMapUv, vLayer ) );',
      )
  }
  // Ключ кэша программ обязан различать корзины: у alpha-test своя ветка
  // шейдера, и с общим ключом они получили бы одну программу на всех
  material.customProgramCacheKey = () => `texture-array:${bucket}`
}

export function mergeByTextureArray(scene: THREE.Group): THREE.Group {
  scene.updateMatrixWorld(true)

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = LAYER_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return scene

  const layerOf = new Map<THREE.Texture, number>()
  const pixels: Uint8ClampedArray[] = []
  const pieces: Piece[] = []
  const spent: THREE.MeshLambertMaterial[] = []

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.material) return
    const material = (Array.isArray(obj.material) ? obj.material[0] : obj.material) as
      THREE.MeshLambertMaterial
    const texture = material.map

    let layer = 0
    if (texture?.image) {
      const known = layerOf.get(texture)
      if (known !== undefined) {
        layer = known
      } else {
        layer = pixels.length
        pixels.push(readPixels(texture.image as CanvasImageSource, ctx))
        layerOf.set(texture, layer)
      }
    } else {
      // белый слой для материалов без текстуры — цвет придёт из вершинного
      layer = pixels.length
      pixels.push(new Uint8ClampedArray(LAYER_SIZE * LAYER_SIZE * 4).fill(255))
    }

    pieces.push({
      geometry: normalizeGeometry(obj, material, layer),
      bucket: bucketOf(material),
      alphaTest: material.alphaTest,
    })
    spent.push(material)
  })

  if (pieces.length === 0) return scene

  const data = new Uint8Array(LAYER_SIZE * LAYER_SIZE * 4 * pixels.length)
  pixels.forEach((layer, i) => data.set(layer, i * LAYER_SIZE * LAYER_SIZE * 4))

  const textures = new THREE.DataArrayTexture(data, LAYER_SIZE, LAYER_SIZE, pixels.length)
  // Блочные текстуры экспортируются без мипмапов и с ближайшим соседом —
  // сохраняем ровно это, иначе поедет пиксельный вид
  textures.magFilter = THREE.NearestFilter
  textures.minFilter = THREE.NearestFilter
  textures.wrapS = textures.wrapT = THREE.RepeatWrapping
  textures.colorSpace = THREE.SRGBColorSpace
  textures.needsUpdate = true

  const merged = new THREE.Group()
  merged.name = 'merged'
  // массив текстур висит только в униформе шейдера, обходом материалов его не
  // найти — оставляем ссылку, чтобы было что освобождать при закрытии карты
  merged.userData.textureArray = textures

  for (const bucket of ['opaque', 'cutout', 'blend'] as const) {
    const group = pieces.filter((p) => p.bucket === bucket)
    if (group.length === 0) continue

    const geometry = mergeGeometries(group.map((p) => p.geometry))
    if (!geometry) continue

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: bucket === 'blend',
      alphaTest: bucket === 'cutout' ? Math.max(...group.map((p) => p.alphaTest)) : 0,
      // экспортёр помечает двусторонними все материалы, и на части геометрии
      // это принципиально — обход вершин рассчитан на рисование с двух сторон
      side: THREE.DoubleSide,
      // нормалей в геометрии нет — освещение держится на плоском затенении
      flatShading: true,
      // map нужен только чтобы three объявил USE_MAP и vMapUv; сама выборка
      // подменена на массив текстур. Пиксель 1×1, а не пустая текстура —
      // иначе рендерер ругается на текстуру без данных
      map: placeholder(),
    })
    patchShader(material, textures, bucket)

    merged.add(new THREE.Mesh(geometry, material))
  }

  for (const piece of pieces) piece.geometry.dispose()
  for (const material of spent) {
    material.map?.dispose()
    material.dispose()
  }
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry?.dispose()
  })

  return merged
}
