import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { MapModel } from './MapModel'
import { RenderStats, RenderStatsOverlay, type RenderReport } from './RenderStats'

/**
 * Промежуточная версия для замера: свободная орбитальная камера, без физики и
 * персонажа. Модели лежат в реальных мировых координатах локации (например,
 * X ~3840, Z ~-2072 у «Хвойного»), поэтому камеру нельзя оставлять в начале
 * координат — она смотрела бы в пустоту за километры от карты.
 */
export function WorldScene({ scene, onClose }: { scene: THREE.Group; onClose?: () => void }) {
  const { t } = useTranslation()
  const [report, setReport] = useState<RenderReport | null>(null)

  const view = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const span = Math.max(size.x, size.y, size.z)
    return {
      center: center.toArray() as [number, number, number],
      position: [center.x, center.y + span * 0.6, center.z + span * 0.9] as [number, number, number],
      far: span * 10,
      size,
    }
  }, [scene])

  return (
    <div className="fixed inset-0 z-30 bg-black">
      <Canvas camera={{ fov: 60, near: 0.5, far: view.far, position: view.position }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[1, 2, 1]} intensity={1.4} />
        <MapModel scene={scene} />
        <OrbitControls target={view.center} makeDefault />
        <RenderStats onReport={setReport} />
      </Canvas>

      <RenderStatsOverlay report={report} />

      <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground">
        {t('world.orbitHint')}
        <div className="mt-1 font-mono">
          {Math.round(view.size.x)} × {Math.round(view.size.y)} × {Math.round(view.size.z)}
        </div>
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-secondary"
        >
          {t('world.close')}
        </button>
      )}
    </div>
  )
}
