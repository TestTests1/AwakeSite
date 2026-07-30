/**
 * Отличает отрисовку на видеокарте от программной.
 *
 * Браузер с выключенным аппаратным ускорением не отказывается работать — он
 * молча считает всю графику процессором, и карта идёт в 5–15 раз медленнее
 * (замерено: 28 fps против 144 на одной и той же сцене и машине). Понять это
 * по картинке невозможно, поэтому спрашиваем напрямую.
 */

/**
 * Названия программных растеризаторов — запасной признак на случай, если
 * браузер проигнорирует failIfMajorPerformanceCaveat. SwiftShader — запасной
 * вариант Chrome, WARP и Basic Render Driver — системные растеризаторы
 * Windows, llvmpipe и softpipe — Linux.
 */
const SOFTWARE_MARKERS = [
  'swiftshader',
  'basic render driver',
  'llvmpipe',
  'softpipe',
  'warp',
  'software',
]

export interface RendererInfo {
  /** Строка адаптера или null, если браузер её скрывает (Firefox с защитой от слежки). */
  name: string | null
  software: boolean
  /**
   * Удалось ли вообще получить контекст. Наличие конструктора
   * WebGL2RenderingContext об этом не говорит: он есть и тогда, когда создать
   * контекст нельзя — например, при выключенном ускорении и запрещённом
   * программном растеризаторе.
   */
  available: boolean
}

function release(gl: WebGLRenderingContext | WebGL2RenderingContext | null) {
  // контекстов на вкладку немного, а нам они нужны на пару вызовов
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
}

export function detectRenderer(): RendererInfo {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  if (!gl) return { name: null, software: false, available: false }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const name = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
    : null
  release(gl)

  // Основной признак. Браузер обязан вернуть null, если для выдачи контекста
  // пришлось бы падать на программный растеризатор. Работает и там, где имя
  // адаптера скрыто — а его скрывают и Brave со своей защитой от слежки, и
  // сам Chrome при выключенном ускорении.
  const probe = document.createElement('canvas')
  const strict =
    probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ??
    probe.getContext('webgl', { failIfMajorPerformanceCaveat: true })
  release(strict)
  if (!strict) return { name, software: true, available: true }

  // Запасной признак на случай, если браузер проигнорировал строгий режим.
  const lower = name?.toLowerCase() ?? ''
  const marked = SOFTWARE_MARKERS.some((marker) => lower.includes(marker))

  return { name, software: marked, available: true }
}
