import { useEffect, useRef, useState, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'

export interface RenderReport {
  fps: number
  /** Среднее и худшее время кадра — в миллисекундах видно то, чего не видно в fps. */
  frameMs: number
  worstMs: number
  triangles: number
  calls: number
  geometries: number
  textures: number
  /** Физический размер холста в пикселях — с ним растёт стоимость заливки. */
  width: number
  height: number
  dpr: number
  gpu: string
}

/**
 * Реальный видеоадаптер, на котором работает контекст. На ноутбуках браузер
 * нередко садится на встроенное видео, и тогда fps не зависит от геометрии —
 * без этой строки такое не отличить от тяжёлой сцены.
 */
function readGpu(gl: THREE.WebGLRenderer): string {
  const ctx = gl.getContext()
  const ext = ctx.getExtension('WEBGL_debug_renderer_info')
  if (!ext) return 'скрыт браузером'
  return String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL))
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
  const previous = useRef(performance.now())
  const worst = useRef(0)
  const gpu = useRef<string | null>(null)

  useFrame(() => {
    frames.current += 1
    const now = performance.now()
    worst.current = Math.max(worst.current, now - previous.current)
    previous.current = now

    const elapsed = now - since.current
    if (elapsed < 1000) return

    gpu.current ??= readGpu(gl)
    onReport({
      fps: Math.round((frames.current * 1000) / elapsed),
      frameMs: Math.round((elapsed / frames.current) * 10) / 10,
      worstMs: Math.round(worst.current * 10) / 10,
      triangles: gl.info.render.triangles,
      calls: gl.info.render.calls,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      width: gl.domElement.width,
      height: gl.domElement.height,
      dpr: gl.getPixelRatio(),
      gpu: gpu.current,
    })
    frames.current = 0
    worst.current = 0
    since.current = now
  })

  return null
}

export interface PlayerReport {
  position: THREE.Vector3
  grounded: boolean
  /** Куда развёрнута фигура — угол вокруг вертикали. */
  yaw: number
  /** Горизонтальная скорость в блоках в секунду. */
  speed: number
}

export function RenderStatsOverlay({
  report,
  playerRef,
}: {
  report: RenderReport | null
  /** Позиция читается из ref опросом: так перерисовывается только оверлей. */
  playerRef?: RefObject<PlayerReport | null>
}) {
  const [visible, setVisible] = useState(true)
  const [player, setPlayer] = useState<PlayerReport | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === 'F8') setVisible((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!playerRef) {
      setPlayer(null)
      return
    }
    // Персонаж пишет в один и тот же объект каждый кадр, поэтому снимаем копию:
    // setState с прежней ссылкой ничего не перерисует, и оверлей замер бы.
    const timer = window.setInterval(() => {
      const live = playerRef.current
      setPlayer(live && { ...live, position: live.position.clone() })
    }, 150)
    return () => window.clearInterval(timer)
  }, [playerRef])

  if (!visible || !report) return null

  const fmt = (n: number) => n.toLocaleString('ru-RU')
  const coord = (n: number) => n.toFixed(1).padStart(8)

  return (
    <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-border bg-card/90 px-3 py-2 font-mono text-xs text-foreground">
      <div>
        FPS {report.fps} · {report.frameMs} мс (худший {report.worstMs})
      </div>
      <div>треугольников {fmt(report.triangles)}</div>
      <div>draw calls {fmt(report.calls)}</div>
      <div>геометрий {fmt(report.geometries)}</div>
      <div>текстур {fmt(report.textures)}</div>
      <div className="mt-1">
        холст {fmt(report.width)}×{fmt(report.height)} (dpr {report.dpr})
      </div>
      <div className="max-w-[22rem] break-words">GPU {report.gpu}</div>
      {player && (
        // координаты игровые: модель экспортируется в мировых координатах
        // локации, так что их можно сверять с самой игрой
        <div className="mt-1 whitespace-pre">
          {`X ${coord(player.position.x)}\nY ${coord(player.position.y)}\nZ ${coord(player.position.z)}`}
          {player.grounded ? '' : '\n  в воздухе'}
        </div>
      )}
      <div className="mt-1 text-muted-foreground">
        F8 — скрыть · 0 — спрятать модель · 1 — dpr
        <br />2 — без света · 3 — задние грани · F — полёт
      </div>
    </div>
  )
}
