import * as THREE from 'three'

/**
 * Пока без коллайдеров: геометрия карт — 16-41 млн треугольников, и trimesh
 * такого размера Rapier в браузере не строит. Способ коллизий выбирается
 * после замера производительности отрисовки (см. задачу про физику).
 */
export function MapModel({ scene }: { scene: THREE.Group }) {
  return <primitive object={scene} />
}
