import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { loadProp, PROP_KINDS, type PlacedProp } from '@/lib/props'

/** Модели заграждений. Кэш живёт в lib/props, так что загрузка одна на сеанс. */
export function usePropModels() {
  const [models, setModels] = useState<Map<string, THREE.Group>>(new Map())

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      PROP_KINDS.map(async (kind) => [kind.id, await loadProp(kind)] as const),
    ).then((pairs) => {
      if (!cancelled) setModels(new Map(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [])

  return models
}

/**
 * Невидимая копия расстановки для столкновений.
 *
 * Отдельно от того, что рисуется: коллайдеру нужен объект с посчитанными
 * мировыми матрицами, а не участник сцены. Копии делают THREE.Object3D.clone,
 * а он переиспользует геометрию по ссылке — значит дерево столкновений строится
 * один раз на тип заграждения, сколько бы их ни поставили.
 */
export function usePropColliders(placed: PlacedProp[], models: Map<string, THREE.Group>) {
  return useMemo(() => {
    if (placed.length === 0 || models.size === 0) return null

    const group = new THREE.Group()
    for (const prop of placed) {
      const source = models.get(prop.kind)
      if (!source) continue
      const copy = source.clone(true)
      copy.position.set(prop.position[0], prop.position[1], prop.position[2])
      copy.rotation.y = prop.rotation
      group.add(copy)
    }
    group.updateMatrixWorld(true)
    return group
  }, [placed, models])
}
