import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { fetchChunkFile } from '@/api/maps'
import { optimizeMaterials } from './optimizeMaterials'
import { improveTextureFiltering } from './textureFiltering'

/**
 * Материалы карты, общие для всех её кусков.
 *
 * Текстур на карту 200–400 штук и 14–29 МБ, а кусков — сотни. Класть текстуры в
 * каждый кусок значило бы повторить ту беду, из-за которой сумма тайлов больше
 * слитого файла. Поэтому они приезжают один раз отдельным файлом, а кусок несёт
 * материалы одними именами.
 */
export interface ChunkMaterials {
  get(name: string): THREE.Material | undefined
  /**
   * Заглушка для меша, чьего материала нет в общем наборе. Общая для всей
   * карты, как и все остальные материалы отсюда, — специально, чтобы у
   * выгрузки куска не было двух правил вместо одного. Смотри dispose().
   */
  getFallback(): THREE.Material
  dispose(): void
}

function parse(buffer: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.parse(
      buffer,
      '',
      (gltf) => resolve(gltf.scene),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    )
  })
}

/**
 * Освобождает материал вместе со всеми текстурами, которые на нём может нести
 * MeshLambertMaterial. optimizeMaterials переносит на него map, emissiveMap и
 * aoMap — сегодня на карте заняты не все три, но диспоуз обязан закрывать все
 * слоты, которые код выше готов заполнить, а не только те, что заполнены сейчас.
 */
function disposeMaterial(material: THREE.Material): void {
  const lambert = material as THREE.MeshLambertMaterial
  lambert.map?.dispose()
  lambert.emissiveMap?.dispose()
  lambert.aoMap?.dispose()
  material.dispose()
}

/**
 * Материалы в общем файле не висят ни на одном меше — геометрии там нет вовсе,
 * и обходом сцены их не найти. Поэтому забираем их из parser.json через
 * штатную загрузку материала по номеру.
 */
export async function loadChunkMaterials(baseUrl: string): Promise<ChunkMaterials> {
  const buffer = await fetchChunkFile(`${baseUrl}materials.glb`)

  const gltf = await new Promise<{ scene: THREE.Group; parser: import('three/examples/jsm/loaders/GLTFLoader.js').GLTFParser }>(
    (resolve, reject) => {
      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      loader.parse(buffer, '', (result) => resolve(result), (error) =>
        reject(error instanceof Error ? error : new Error(String(error))),
      )
    },
  )

  const definitions: { name?: string }[] = gltf.parser.json.materials ?? []
  const loaded = await Promise.all(definitions.map((_, index) => gltf.parser.getDependency('material', index)))

  // Держим их на временной сцене: optimizeMaterials и improveTextureFiltering
  // ходят обходом по мешам, а не по списку материалов.
  const holder = new THREE.Group()
  for (const material of loaded as THREE.Material[]) {
    holder.add(new THREE.Mesh(new THREE.BufferGeometry(), material))
  }
  optimizeMaterials(holder)
  improveTextureFiltering(holder)

  const byName = new Map<string, THREE.Material>()
  for (const child of holder.children) {
    if (!(child instanceof THREE.Mesh)) continue
    const material = child.material as THREE.Material
    byName.set(material.name, material)
    child.geometry.dispose()
  }

  // Заглушка тоже общая на карту: если завести её на каждый кусок отдельно,
  // выгрузка куска не сможет отличить её от разделяемых материалов — и либо
  // диспозит общее вместе с чужим (та самая беда disposeScene), либо не
  // диспозит ничего и копит по заглушке на каждый кусок с пропавшим
  // материалом за всю сессию. Здесь заглушка одна, и правило для выгрузки
  // куска становится единым: материалы куска не диспозятся никогда, только
  // его геометрия.
  const fallback = new THREE.MeshLambertMaterial({ color: 0x898989 })

  return {
    get: (name) => byName.get(name),
    getFallback: () => fallback,
    dispose: () => {
      for (const material of byName.values()) disposeMaterial(material)
      byName.clear()
      disposeMaterial(fallback)
    },
  }
}

/**
 * Разбирает кусок и подставляет ему общие материалы.
 *
 * Материалы внутри куска — пустышки с одним именем: ни текстуры, ни цвета. Их
 * надо освободить сразу после подмены, иначе на каждый загруженный кусок в
 * памяти остаётся сотня мёртвых материалов.
 *
 * Кусок, чьего материала нет в общем файле, не выбрасывается: геометрия важнее
 * вида, по ней считаются столкновения. Такой меш получает заглушку из
 * ChunkMaterials — она общая на карту, поэтому и здесь ничего не диспозится:
 * все материалы на возвращённой сцене чужие, выгрузка куска трогает только
 * геометрию.
 */
export async function loadChunk(url: string, materials: ChunkMaterials): Promise<THREE.Group> {
  const buffer = await fetchChunkFile(url)
  const scene = await parse(buffer)

  const resolve = (own: THREE.Material): THREE.Material => {
    const shared = materials.get(own.name)
    own.dispose()
    return shared ?? materials.getFallback()
  }

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.material) return
    object.material = Array.isArray(object.material)
      ? object.material.map(resolve)
      : resolve(object.material)
  })

  return scene
}
