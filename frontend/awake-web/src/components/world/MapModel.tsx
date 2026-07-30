import * as THREE from 'three'

/**
 * Просто вывод геометрии. Столкновения физическим движком тут не считаются:
 * trimesh на 16–41 млн треугольников Rapier в браузере не построит. Персонаж
 * вместо этого стреляет лучами по той же геометрии — см. Player и
 * TerrainCollider.
 */
export function MapModel({ scene }: { scene: THREE.Group }) {
  return <primitive object={scene} />
}
