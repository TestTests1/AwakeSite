import * as THREE from 'three'

/**
 * Экспортёр помечает все материалы `doubleSided`, а glTF-загрузчик заводит под
 * них MeshStandardMaterial — вместе это и есть основная цена кадра, а вовсе не
 * число треугольников (замер: тайлы на 183 тыс и 506 тыс треугольников давали
 * одинаковый fps, а выключение света его поднимало).
 *
 * PBR-материал меняется на ламбертовский. Металличности и шероховатости в
 * исходных данных нет (metallicFactor выставлен у всех, карт нормалей и
 * отражений нет вовсе), поэтому весь расчёт PBR считает константы —
 * рассеянное освещение даёт ту же картинку заметно дешевле.
 *
 * Двусторонность материалов при этом сохраняется как есть. Отсечение задних
 * граней напрашивалось само, но на практике местами ломало отображение
 * текстур — часть геометрии экспортируется с обходом вершин, рассчитанным на
 * рисование с двух сторон. Разбираться с этим отдельно, здесь не трогаем.
 */
export function optimizeMaterials(scene: THREE.Group): void {
  const converted = new Map<THREE.Material, THREE.Material>()

  const convert = (source: THREE.Material): THREE.Material => {
    const cached = converted.get(source)
    if (cached) return cached

    const src = source as THREE.MeshStandardMaterial

    const target = new THREE.MeshLambertMaterial({
      map: src.map,
      color: src.color,
      vertexColors: src.vertexColors,
      transparent: src.transparent,
      opacity: src.opacity,
      alphaTest: src.alphaTest,
      side: src.side,
      // нормалей в геометрии нет вовсе, поэтому загрузчик включает плоское
      // затенение и three считает нормали производными в шейдере; потерять
      // этот флаг значит остаться без освещения совсем
      flatShading: src.flatShading,
      emissive: src.emissive,
      emissiveMap: src.emissiveMap,
      emissiveIntensity: src.emissiveIntensity,
      aoMap: src.aoMap,
    })
    target.name = src.name

    converted.set(source, target)
    source.dispose()
    return target
  }

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.material) return
    obj.material = Array.isArray(obj.material)
      ? obj.material.map(convert)
      : convert(obj.material)
  })
}
