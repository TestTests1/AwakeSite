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

  return {
    get: (name) => byName.get(name),
    dispose: () => {
      for (const material of byName.values()) {
        const map = (material as THREE.MeshLambertMaterial).map
        map?.dispose()
        material.dispose()
      }
      byName.clear()
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
 * вида, по ней считаются столкновения. Такой меш получает серую заглушку.
 */
export async function loadChunk(url: string, materials: ChunkMaterials): Promise<THREE.Group> {
  const buffer = await fetchChunkFile(url)
  const scene = await parse(buffer)

  const fallback = new THREE.MeshLambertMaterial({ color: 0x898989 })
  let usedFallback = false

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.material) return
    const own = object.material as THREE.Material
    const shared = materials.get(own.name)
    if (shared) {
      object.material = shared
    } else {
      object.material = fallback
      usedFallback = true
    }
    own.dispose()
  })

  if (!usedFallback) fallback.dispose()
  return scene
}
