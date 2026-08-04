import * as THREE from 'three'

/**
 * Небо локации — кубическая карта из самой игры, выгруженная
 * `tools/maps/export_sky.py`.
 *
 * Порядок имён обязателен и означает +X, −X, +Y, −Y, +Z, −Z: именно в таком
 * виде CubeTextureLoader раскладывает шесть картинок по граням. Перепутать их
 * местами — получить небо снизу и землю сбоку.
 */
const FACES = ['px.webp', 'nx.webp', 'py.webp', 'ny.webp', 'pz.webp', 'nz.webp']

export function loadSky(): Promise<THREE.CubeTexture> {
  return new Promise((resolve, reject) => {
    new THREE.CubeTextureLoader().setPath('/sky/').load(
      FACES,
      (texture) => {
        // без пометки картинки читаются как линейные и небо выцветает
        texture.colorSpace = THREE.SRGBColorSpace
        resolve(texture)
      },
      undefined,
      () => reject(new Error('не удалось загрузить небо')),
    )
  })
}
