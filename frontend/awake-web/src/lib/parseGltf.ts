import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { mergeByTextureArray } from './mergeByTextureArray'
import { optimizeMaterials } from './optimizeMaterials'
import { improveTextureFiltering } from './textureFiltering'

/**
 * Модели локаций собраны с `gltf-transform optimize --compress meshopt`,
 * поэтому без MeshoptDecoder загрузчик падает на EXT_meshopt_compression.
 */
export function parseGltf(buffer: ArrayBuffer, merge = false): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.parse(
      buffer,
      '',
      (gltf) => {
        optimizeMaterials(gltf.scene)
        // после смены материалов: фильтрация читает alphaTest и transparent,
        // а их переносит на новые материалы именно optimizeMaterials
        improveTextureFiltering(gltf.scene)
        resolve(merge ? mergeByTextureArray(gltf.scene) : gltf.scene)
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    )
  })
}
