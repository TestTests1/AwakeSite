import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

export interface RenderReport {
  fps: number
  triangles: number
  calls: number
  geometries: number
  textures: number
}

/**
 * Снимает показания рендерера раз в секунду. Нужен, чтобы решение про физику
 * принималось по замеру, а не на глаз: если карта уже не рисуется, городить
 * коллизии поверх неё смысла нет.
 */
export function RenderStats({ onReport }: { onReport: (r: RenderReport) => void }) {
  const { gl } = useThree()
  const frames = useRef(0)
  const since = useRef(performance.now())

  useFrame(() => {
    frames.current += 1
    const now = performance.now()
    const elapsed = now - since.current
    if (elapsed < 1000) return

    onReport({
      fps: Math.round((frames.current * 1000) / elapsed),
      triangles: gl.info.render.triangles,
      calls: gl.info.render.calls,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
    })
    frames.current = 0
    since.current = now
  })

  return null
}

export function RenderStatsOverlay({ report }: { report: RenderReport | null }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === 'F8') setVisible((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!visible || !report) return null

  const fmt = (n: number) => n.toLocaleString('ru-RU')

  return (
    <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-border bg-card/90 px-3 py-2 font-mono text-xs text-foreground">
      <div>FPS {report.fps}</div>
      <div>треугольников {fmt(report.triangles)}</div>
      <div>draw calls {fmt(report.calls)}</div>
      <div>геометрий {fmt(report.geometries)}</div>
      <div>текстур {fmt(report.textures)}</div>
      <div className="mt-1 text-muted-foreground">F8 — скрыть</div>
    </div>
  )
}
