import { useEffect, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { loadChunk, loadChunkMaterials, type ChunkMaterials } from '@/lib/chunkMaterials'
import type { ChunkEntry, MapManifest } from '@/lib/mapManifest'
import type { PlayerReport } from './RenderStats'

/**
 * Дальность загрузки — как в самой игре, где прогрузка 100–120 метров, а блок
 * равен метру.
 */
const LOAD_RADIUS = 120
/**
 * Выбрасываем не на той же черте, а дальше. Без этого зазора игрок, шагающий
 * вдоль границы куска, гонял бы его туда-сюда каждым шагом.
 */
const KEEP_RADIUS = 160
/** Больше шести одновременных запросов браузер всё равно не пустит. */
const MAX_PARALLEL = 6
/** Пересчёт не каждый кадр, а когда игрок ушёл на полкуска. */
const RECHECK_DISTANCE = 32

/**
 * Задержки между попытками для сбойнувшего куска или файла материалов.
 * Первая — почти сразу: сбой мог быть случайным всплеском. Вторая — заметно
 * позже, чтобы не долбить тот же временный сбой ещё раз в те же секунды.
 * Итого три попытки за один заход куска в радиус загрузки: одна сразу и две
 * с нарастающей паузой.
 */
const RETRY_DELAYS = [1000, 4000]

/** Расстояние от точки до клетки по горизонтали; внутри клетки — ноль. */
function distanceToChunk(entry: ChunkEntry, size: number, x: number, z: number): number {
  const dx = Math.max(entry.x * size - x, 0, x - (entry.x + 1) * size)
  const dz = Math.max(entry.z * size - z, 0, z - (entry.z + 1) * size)
  return Math.hypot(dx, dz)
}

/**
 * Освобождает геометрию куска — и только её.
 *
 * Материалы и текстуры общие на всю карту: тронуть их здесь значит погасить
 * текстуры везде разом с первого же выгруженного куска. Вызывается из четырёх
 * мест (выгрузка по дальности, отмена после размонтирования, отмена ушедшего
 * из круга, уборка при выходе), и в каждом ошибиться одинаково легко — поэтому
 * одной функцией.
 */
function disposeChunkGeometry(chunk: THREE.Group): void {
  chunk.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose()
  })
}

export interface ChunkStream {
  /**
   * Материалы пришли и клетка под точкой появления хоть раз встала в сцену за
   * этот заход в мир. Флаг однонаправленный: если игрок потом отойдёт и клетка
   * спавна выгрузится по дальности, ready не гаснет обратно — иначе того, кто
   * уже играет, вернуло бы на экран загрузки на полпути.
   */
  ready: boolean
  /** Сколько кусков из нужных для входа (см. needed) сейчас в сцене. */
  loaded: number
  /** Кусков в радиусе загрузки от точки появления — то, ради чего считается loaded. */
  needed: number
  /** Кусков, у которых кончились попытки; ждут, когда игрок уйдёт за KEEP_RADIUS и вернётся. */
  failed: number
  /** Файл материалов не загрузился после всех попыток — сам прогресс дальше не сдвинется. */
  materialsFailed: boolean
  /**
   * Войти в мир нельзя: клетки под точкой появления нет в манифесте либо у неё
   * кончились попытки. Отдельно от failed: сбой дальней клетки на входе никого
   * не держит, она сама повторится, когда игрок к ней подойдёт, — а вот без
   * этой клетки ready не встанет никогда, и ждать её молча значит оставить
   * человека перед чёрным экраном без объяснений.
   */
  spawnFailed: boolean
}

/**
 * Держит в сцене только те куски, что рядом с игроком.
 *
 * Куски кладутся прямо в переданную группу, минуя React: их сотни, и
 * перерисовывать дерево компонентов на каждый пришедший кусок значило бы
 * ронять кадры ровно тогда, когда игрок идёт вперёд.
 */
export function useChunkStream({
  baseUrl,
  manifest,
  playerRef,
  group,
  onAdd,
  onRemove,
}: {
  baseUrl: string
  manifest: MapManifest
  playerRef: RefObject<PlayerReport | null>
  group: THREE.Group
  /**
   * Кусок встал в сцену: подключить к столкновениям. Не обязан быть
   * стабильным между рендерами — хук держит последнюю версию в ref, так что
   * инлайновая стрелочная функция на месте вызова не пересобирает поток.
   */
  onAdd?: (chunk: THREE.Group) => void
  /**
   * Кусок уходит из сцены: снять со столкновений до освобождения геометрии.
   * Та же оговорка про стабильность, что и у onAdd.
   */
  onRemove?: (chunk: THREE.Group) => void
}): ChunkStream {
  const [state, setState] = useState<ChunkStream>({
    ready: false,
    loaded: 0,
    needed: 0,
    failed: 0,
    materialsFailed: false,
    spawnFailed: false,
  })

  // Колбэки — в ref, а не в зависимостях следующего эффекта: на месте вызова
  // это обычно инлайновые стрелочные функции с новой идентичностью на каждый
  // рендер родителя. Слушай хук их напрямую через deps, поток кусков
  // пересоздавался бы вместе со всем накопленным состоянием на каждый такой
  // рендер, а не только когда меняются baseUrl/manifest/group/playerRef.
  const onAddRef = useRef(onAdd)
  const onRemoveRef = useRef(onRemove)
  useEffect(() => {
    onAddRef.current = onAdd
    onRemoveRef.current = onRemove
  })

  useEffect(() => {
    // Отмена — лексическая переменная именно этого запуска эффекта, а не
    // поле общего ref. В StrictMode React вызывает cleanup предыдущего
    // запуска и сам следующий запуск в одном коммите; будь флаг отмены общим
    // на весь хук, второй запуск обнулял бы его сразу после того, как первый
    // его выставил, — и промисы первого запуска, дорешившись позже, видели
    // бы себя неотменёнными и писали бы в состояние второго (в частности,
    // унесли бы материалы первого запуска в никуда, ни разу их не диспозив).
    // Поэтому ниже нет ни одного ref: все структуры этого захода — локальные
    // константы и let-переменные внутри замыкания, и два параллельных запуска
    // эффекта их просто не делят между собой.
    let stopped = false
    let materials: ChunkMaterials | null = null
    let materialsFailed = false
    let readyLatched = false

    const inScene = new Map<string, { entry: ChunkEntry; chunk: THREE.Group }>()
    const loading = new Set<string>()
    const retrying = new Set<string>()
    const failed = new Set<string>()
    const timers = new Set<number>()
    const lastAt = new THREE.Vector3(Infinity, 0, Infinity)

    const key = (entry: ChunkEntry) => `${entry.x}_${entry.z}`
    const chunkByKey = new Map(manifest.chunks.map((entry) => [key(entry), entry]))
    /** Куски, из которых складывается цель прогресса «дошли до входа в мир». */
    const spawnEntryIds = new Set(
      manifest.chunks
        .filter((entry) => distanceToChunk(entry, manifest.chunkSize, manifest.spawn[0], manifest.spawn[2]) <= LOAD_RADIUS)
        .map(key),
    )
    const spawnKey = `${Math.floor(manifest.spawn[0] / manifest.chunkSize)}_${Math.floor(manifest.spawn[2] / manifest.chunkSize)}`
    // клетки под точкой появления может не быть в манифесте вовсе — тогда
    // ждать её бессмысленно, и это надо сказать сразу, а не висеть на входе
    const spawnMissing = !chunkByKey.has(spawnKey)

    /** Где стоит игрок; до первого кадра — точка появления из манифеста. */
    const playerAt = () => playerRef.current?.position ?? {
      x: manifest.spawn[0],
      z: manifest.spawn[2],
    }

    /**
     * Готовность — это материалы и кусок под ногами, замеченные хоть раз.
     * loaded/needed считают один и тот же набор — куски вокруг точки
     * появления, — чтобы прогресс-бар не мог уйти за 100% или поехать назад
     * просто потому, что игрок отошёл от спавна в сторону.
     */
    const publish = () => {
      if (stopped) return
      if (!readyLatched && materials !== null && inScene.has(spawnKey)) readyLatched = true
      let loadedForEntry = 0
      for (const id of spawnEntryIds) if (inScene.has(id)) loadedForEntry++
      setState({
        ready: readyLatched,
        loaded: loadedForEntry,
        needed: spawnEntryIds.size,
        failed: failed.size,
        materialsFailed,
        spawnFailed: !readyLatched && (spawnMissing || failed.has(spawnKey)),
      })
    }

    const requestChunk = (entry: ChunkEntry, attempt: number, mats: ChunkMaterials) => {
      const id = key(entry)
      loading.add(id)

      void loadChunk(`${baseUrl}${entry.file}`, mats)
        .then((chunk) => {
          loading.delete(id)
          failed.delete(id)
          if (stopped) {
            disposeChunkGeometry(chunk)
            return
          }
          // пока качался, игрок мог уйти — тогда кусок уже не нужен
          const at = playerAt()
          if (distanceToChunk(entry, manifest.chunkSize, at.x, at.z) > KEEP_RADIUS) {
            disposeChunkGeometry(chunk)
          } else {
            group.add(chunk)
            inScene.set(id, { entry, chunk })
            onAddRef.current?.(chunk)
          }
          publish()
          pump()
        })
        .catch(() => {
          loading.delete(id)
          if (stopped) return
          if (attempt >= RETRY_DELAYS.length) {
            // попытки кончились: клетка остаётся без геометрии и без
            // столкновений, пока игрок не уйдёт за KEEP_RADIUS и не вернётся
            // — тогда запись снимется ниже, в pump(), и будет новая попытка
            failed.add(id)
            publish()
            pump()
            return
          }
          retrying.add(id)
          const delay = RETRY_DELAYS[attempt]
          const timer = window.setTimeout(() => {
            timers.delete(timer)
            retrying.delete(id)
            if (!stopped) requestChunk(entry, attempt + 1, mats)
          }, delay)
          timers.add(timer)
          // слот на MAX_PARALLEL освободился — пусть его займёт другой кусок,
          // пока этот ждёт своей отложенной попытки
          pump()
        })
    }

    const pump = () => {
      if (stopped || !materials) return
      const mats = materials
      const at = playerAt()

      // выгрузка: сначала освобождаем, потом грузим — так пик памяти ниже
      for (const [id, { entry, chunk }] of inScene) {
        if (distanceToChunk(entry, manifest.chunkSize, at.x, at.z) <= KEEP_RADIUS) continue
        onRemoveRef.current?.(chunk)
        group.remove(chunk)
        disposeChunkGeometry(chunk)
        inScene.delete(id)
      }

      // сбой не клеймит клетку навсегда: как только она вышла за KEEP_RADIUS,
      // запись снимается — по возвращении будет новая попытка с нуля
      for (const id of failed) {
        const entry = chunkByKey.get(id)
        if (entry && distanceToChunk(entry, manifest.chunkSize, at.x, at.z) > KEEP_RADIUS) failed.delete(id)
      }

      // сразу после выгрузки, а не после следующего пришедшего куска —
      // иначе loaded ещё секунду-две показывает уже выброшенные куски
      publish()

      const wanted = manifest.chunks
        .map((entry) => ({ entry, distance: distanceToChunk(entry, manifest.chunkSize, at.x, at.z) }))
        .filter(({ entry, distance }) => {
          const id = key(entry)
          return distance <= LOAD_RADIUS
            && !inScene.has(id)
            && !loading.has(id)
            && !retrying.has(id)
            && !failed.has(id)
        })
        .sort((a, b) => a.distance - b.distance)

      for (const { entry } of wanted) {
        if (loading.size >= MAX_PARALLEL) break
        requestChunk(entry, 0, mats)
      }
    }

    const requestMaterials = (attempt: number) => {
      void loadChunkMaterials(baseUrl)
        .then((loaded) => {
          if (stopped) {
            loaded.dispose()
            return
          }
          materials = loaded
          publish()
          pump()
        })
        .catch(() => {
          if (stopped) return
          if (attempt >= RETRY_DELAYS.length) {
            // без материалов кускам подставлять нечего — сообщаем об этом
            // явно, а не оставляем полоску прогресса висеть на нуле навсегда
            materialsFailed = true
            publish()
            return
          }
          const delay = RETRY_DELAYS[attempt]
          const timer = window.setTimeout(() => {
            timers.delete(timer)
            if (!stopped) requestMaterials(attempt + 1)
          }, delay)
          timers.add(timer)
        })
    }
    requestMaterials(0)

    // опрос вместо подписки: положение игрока лежит в ref и меняется каждый
    // кадр, а нам хватает четырёх проверок в секунду
    const recheckTimer = window.setInterval(() => {
      const at = playerAt()
      if (Math.hypot(at.x - lastAt.x, at.z - lastAt.z) < RECHECK_DISTANCE) return
      lastAt.set(at.x, 0, at.z)
      pump()
    }, 250)

    return () => {
      stopped = true
      window.clearInterval(recheckTimer)
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
      for (const { chunk } of inScene.values()) {
        onRemoveRef.current?.(chunk)
        group.remove(chunk)
        disposeChunkGeometry(chunk)
      }
      inScene.clear()
      materials?.dispose()
    }
  }, [baseUrl, manifest, group, playerRef])

  return state
}
