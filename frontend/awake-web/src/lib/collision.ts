import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

// Через Object.assign, а не присваиванием по одному: в three-mesh-bvh 0.9 типы
// самих функций и типы, объявленные ими же на прототипе BufferGeometry,
// разошлись между собой, и прямое присваивание не проходит проверку.
Object.assign(THREE.BufferGeometry.prototype, { computeBoundsTree, disposeBoundsTree })
THREE.Mesh.prototype.raycast = acceleratedRaycast

/**
 * Луч по геометрии карты — на нём держится всё движение персонажа.
 *
 * Обычный Raycaster перебирает треугольники подряд, а их тут миллионы, так что
 * один луч съел бы кадр целиком. three-mesh-bvh строит по геометрии дерево, и
 * луч становится почти бесплатным.
 *
 * Дерево строится лениво и только рядом с игроком: на всю карту это гигабайт
 * памяти и десятки секунд ожидания, а нужно оно ровно там, куда мы стреляем.
 * Построенное остаётся в кэше, поэтому ходьба по уже посещённым местам ничего
 * не стоит.
 */
const DOWN = new THREE.Vector3(0, -1, 0)

export class TerrainCollider {
  private readonly parts: { mesh: THREE.Mesh; box: THREE.Box3 }[] = []
  /**
   * Поставленные заграждения. Отдельно от рельефа, потому что список меняется
   * на ходу, а деревья им можно строить сразу: моделей всего четыре типа, в них
   * сотни треугольников, и копии одного типа делят геометрию — значит и дерево.
   */
  private dynamic: { mesh: THREE.Mesh; box: THREE.Box3 }[] = []
  private readonly raycaster = new THREE.Raycaster()
  private readonly rayBox = new THREE.Box3()
  private readonly to = new THREE.Vector3()

  constructor(scene: THREE.Object3D) {
    scene.updateMatrixWorld(true)
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) return
      this.parts.push({ mesh: object, box: new THREE.Box3().setFromObject(object) })
    })
    this.raycaster.firstHitOnly = true
  }

  /**
   * Готовит деревья вокруг точки.
   *
   * Близость считается только по горизонтали, высота не участвует намеренно:
   * игрока интересует весь столб под ногами и над головой, а сам он почти
   * всегда выше или ниже коробки нужного куска — по трём осям такая проверка
   * не нашла бы ничего, и лучи уходили бы в пустоту.
   */
  prepare(point: THREE.Vector3, radius: number): void {
    for (const part of this.parts) {
      if (part.mesh.geometry.boundsTree) continue
      const { min, max } = part.box
      if (point.x < min.x - radius || point.x > max.x + radius) continue
      if (point.z < min.z - radius || point.z > max.z + radius) continue
      part.mesh.geometry.computeBoundsTree()
    }
  }

  /**
   * Подключает поставленные заграждения к столкновениям.
   *
   * Луч идёт по настоящей геометрии модели, а не по описанной коробке — у
   * баррикады с окном сквозь проём видно и пройти можно, ровно как в игре.
   */
  setDynamic(root: THREE.Object3D | null): void {
    this.dynamic = []
    if (!root) return

    root.updateMatrixWorld(true)
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) return
      if (!object.geometry.boundsTree) object.geometry.computeBoundsTree()
      this.dynamic.push({ mesh: object, box: new THREE.Box3().setFromObject(object) })
    })
  }

  /**
   * Высота поверхности в точке, либо null. Ищет сверху вниз по всей высоте
   * карты, поэтому годится и для поиска места появления.
   */
  groundAt(x: number, z: number, bounds: THREE.Box3): number | null {
    const from = new THREE.Vector3(x, bounds.max.y + 4, z)
    this.prepare(from, 1)
    const hit = this.cast(from, DOWN, bounds.max.y - bounds.min.y + 8)
    return hit === null ? null : from.y - hit
  }

  /**
   * Расстояние до ближайшего препятствия вдоль луча, либо null.
   * Считаются только куски с готовым деревом — иначе один непостроенный кусок
   * на миллион треугольников уронил бы частоту кадров в пол.
   */
  cast(origin: THREE.Vector3, direction: THREE.Vector3, far: number): number | null {
    this.to.copy(direction).multiplyScalar(far).add(origin)
    this.rayBox.makeEmpty().expandByPoint(origin).expandByPoint(this.to)

    this.raycaster.set(origin, direction)
    this.raycaster.far = far

    let nearest: number | null = null
    for (const part of this.parts) {
      if (!part.mesh.geometry.boundsTree) continue
      if (!part.box.intersectsBox(this.rayBox)) continue
      const hits = this.raycaster.intersectObject(part.mesh, false)
      if (hits.length > 0 && (nearest === null || hits[0].distance < nearest)) {
        nearest = hits[0].distance
      }
    }
    for (const part of this.dynamic) {
      if (!part.box.intersectsBox(this.rayBox)) continue
      const hits = this.raycaster.intersectObject(part.mesh, false)
      if (hits.length > 0 && (nearest === null || hits[0].distance < nearest)) {
        nearest = hits[0].distance
      }
    }
    return nearest
  }

  /**
   * Освобождает деревья, но не список кусков: React в строгом режиме монтирует
   * компонент дважды, и после первой размонтировки коллайдер обязан остаться
   * работоспособным — иначе на втором монтировании лучи не находят ничего и
   * персонаж проваливается сквозь карту. Деревья при следующем prepare
   * построятся заново.
   */
  dispose(): void {
    for (const part of this.parts) part.mesh.geometry.disposeBoundsTree?.()
  }
}
