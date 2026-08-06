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
  /** Пришли материалы и кусок под точкой появления: можно входить в мир. */
  ready: boolean
  loaded: number
  /** Сколько кусков нужно для готовности — для полоски прогресса. */
  needed: number
  failed: number
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
  /** Кусок встал в сцену: подключить к столкновениям. */
  onAdd?: (chunk: THREE.Group) => void
  /** Кусок уходит из сцены: снять со столкновений до освобождения геометрии. */
  onRemove?: (chunk: THREE.Group) => void
}): ChunkStream {
  const [state, setState] = useState<ChunkStream>({
    ready: false,
    loaded: 0,
    needed: 0,
    failed: 0,
  })

  // всё живое состояние — в ref: этот цикл крутится вне React
  const live = useRef({
    materials: null as ChunkMaterials | null,
    inScene: new Map<string, THREE.Group>(),
    loading: new Set<string>(),
    failed: new Map<string, number>(),
    lastAt: new THREE.Vector3(Infinity, 0, Infinity),
    stopped: false,
  })

  useEffect(() => {
    const self = live.current
    self.stopped = false

    const key = (entry: ChunkEntry) => `${entry.x}_${entry.z}`

    /** Где стоит игрок; до первого кадра — точка появления из манифеста. */
    const playerAt = () => playerRef.current?.position ?? {
      x: manifest.spawn[0],
      z: manifest.spawn[2],
    }

    const pump = () => {
      if (self.stopped || !self.materials) return
      const at = playerAt()

      // выгрузка: сначала освобождаем, потом грузим — так пик памяти ниже
      for (const [id, chunk] of self.inScene) {
        const [x, z] = id.split('_').map(Number)
        const entry = { x, z } as ChunkEntry
        if (distanceToChunk(entry, manifest.chunkSize, at.x, at.z) <= KEEP_RADIUS) continue

        onRemove?.(chunk)
        group.remove(chunk)
        disposeChunkGeometry(chunk)
        self.inScene.delete(id)
      }

      const wanted = manifest.chunks
        .map((entry) => ({ entry, distance: distanceToChunk(entry, manifest.chunkSize, at.x, at.z) }))
        .filter(({ entry, distance }) =>
          distance <= LOAD_RADIUS
          && !self.inScene.has(key(entry))
          && !self.loading.has(key(entry))
          && (self.failed.get(key(entry)) ?? 0) < 3)
        .sort((a, b) => a.distance - b.distance)

      for (const { entry } of wanted) {
        if (self.loading.size >= MAX_PARALLEL) break
        const id = key(entry)
        self.loading.add(id)

        void loadChunk(`${baseUrl}${entry.file}`, self.materials)
          .then((chunk) => {
            self.loading.delete(id)
            if (self.stopped) {
              disposeChunkGeometry(chunk)
              return
            }
            // пока качался, игрок мог уйти — тогда кусок уже не нужен
            const at2 = playerAt()
            if (distanceToChunk(entry, manifest.chunkSize, at2.x, at2.z) > KEEP_RADIUS) {
              disposeChunkGeometry(chunk)
              return
            }
            group.add(chunk)
            self.inScene.set(id, chunk)
            onAdd?.(chunk)
            publish()
            pump()
          })
          .catch(() => {
            self.loading.delete(id)
            self.failed.set(id, (self.failed.get(id) ?? 0) + 1)
            publish()
            pump()
          })
      }
    }

    /**
     * Готовность — это материалы и кусок под ногами. Ждать все ближние куски
     * незачем: остальное догрузится за туманом, пока игрок оглядывается.
     */
    const publish = () => {
      if (self.stopped) return
      const spawnKey = `${Math.floor(manifest.spawn[0] / manifest.chunkSize)}_${Math.floor(manifest.spawn[2] / manifest.chunkSize)}`
      const needed = manifest.chunks.filter((entry) =>
        distanceToChunk(entry, manifest.chunkSize, manifest.spawn[0], manifest.spawn[2]) <= LOAD_RADIUS,
      ).length
      setState({
        ready: self.materials !== null && self.inScene.has(spawnKey),
        loaded: self.inScene.size,
        needed,
        failed: self.failed.size,
      })
    }

    void loadChunkMaterials(baseUrl)
      .then((materials) => {
        if (self.stopped) {
          materials.dispose()
          return
        }
        self.materials = materials
        publish()
        pump()
      })
      .catch(() => publish())

    // опрос вместо подписки: положение игрока лежит в ref и меняется каждый
    // кадр, а нам хватает четырёх проверок в секунду
    const timer = window.setInterval(() => {
      const at = playerAt()
      if (Math.hypot(at.x - self.lastAt.x, at.z - self.lastAt.z) < RECHECK_DISTANCE) return
      self.lastAt.set(at.x, 0, at.z)
      pump()
    }, 250)

    return () => {
      self.stopped = true
      window.clearInterval(timer)
      for (const chunk of self.inScene.values()) {
        onRemove?.(chunk)
        group.remove(chunk)
        disposeChunkGeometry(chunk)
      }
      self.inScene.clear()
      self.loading.clear()
      self.failed.clear()
      self.materials?.dispose()
      self.materials = null
    }
  }, [baseUrl, manifest, group, playerRef, onAdd, onRemove])

  return state
}
