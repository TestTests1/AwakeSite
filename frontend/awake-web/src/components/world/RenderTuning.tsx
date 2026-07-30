import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

const DPR_STEPS = [0.5, 1, 1.5, 2]

/**
 * Два переключателя для поиска узкого места: разрешение холста (стоимость
 * заливки пикселей) и сложность материала (стоимость шейдера). Если fps растёт
 * от «1» — упираемся в пиксели, от «2» — в освещение, ни от чего — в геометрию.
 * Только для замеров, в бою не используется.
 */
export function RenderTuning({ scene }: { scene: THREE.Group }) {
  const setDpr = useThree((s) => s.setDpr)
  const gl = useThree((s) => s.gl)

  const dprStep = useRef(-1)
  // исходные материалы, чтобы вернуть сцену в нормальный вид без перезагрузки
  const originals = useRef(new Map<THREE.Mesh, THREE.Material | THREE.Material[]>())

  useEffect(() => {
    function toBasic(source: THREE.Material): THREE.Material {
      const src = source as THREE.MeshStandardMaterial
      return new THREE.MeshBasicMaterial({
        map: src.map,
        color: src.color,
        vertexColors: src.vertexColors,
        transparent: src.transparent,
        alphaTest: src.alphaTest,
        side: src.side,
      })
    }

    function restore() {
      for (const [mesh, material] of originals.current) {
        const swapped = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of swapped) m.dispose()
        mesh.material = material
      }
      originals.current.clear()
    }

    function toggleMaterials() {
      if (originals.current.size > 0) {
        restore()
        return
      }
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || !obj.material) return
        originals.current.set(obj, obj.material)
        obj.material = Array.isArray(obj.material)
          ? obj.material.map(toBasic)
          : toBasic(obj.material)
      })
    }

    function onKey(e: KeyboardEvent) {
      // Контрольный опыт: пустой кадр. Если fps не меняется и без модели,
      // потолок задаёт не сцена, а что-то снаружи — частота экрана, ограничитель
      // кадров или встроенное видео, и оптимизировать геометрию бессмысленно.
      if (e.code === 'Digit0') scene.visible = !scene.visible
      if (e.code === 'Digit1') {
        if (dprStep.current < 0) {
          // первое нажатие — встаём на ступень ниже текущей
          const current = gl.getPixelRatio()
          dprStep.current = Math.max(0, DPR_STEPS.findIndex((d) => d >= current))
        }
        dprStep.current = (dprStep.current + DPR_STEPS.length - 1) % DPR_STEPS.length
        setDpr(DPR_STEPS[dprStep.current])
      }
      if (e.code === 'Digit2') toggleMaterials()
      // отдельный A/B для отсечения задних граней: показывает, сколько дало
      // именно оно, без примеси от смены типа материала
      if (e.code === 'Digit3') {
        scene.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh) || !obj.material) return
          const list = Array.isArray(obj.material) ? obj.material : [obj.material]
          for (const m of list) {
            if (m.alphaTest > 0 || m.transparent) continue
            m.side = m.side === THREE.FrontSide ? THREE.DoubleSide : THREE.FrontSide
            m.needsUpdate = true
          }
        })
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      restore()
    }
  }, [scene, setDpr, gl])

  return null
}
