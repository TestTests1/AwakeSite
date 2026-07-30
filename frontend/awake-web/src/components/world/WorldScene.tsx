import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import type { MapLocation } from '@/api/maps'
import { loadAvatar } from '@/lib/avatar'
import { loadPlaced, PROP_KINDS, savePlaced, type PlacedProp } from '@/lib/props'
import { Avatar, useAvatarSource, type AvatarSample } from './Avatar'
import { Builder, PlacedProps } from './Builder'
import { LayoutPanel } from './LayoutPanel'
import { MapModel } from './MapModel'
import { Player } from './Player'
import { RemoteAvatars } from './RemoteAvatars'
import {
  RenderStats,
  RenderStatsOverlay,
  type PlayerReport,
  type RenderReport,
} from './RenderStats'
import { RenderTuning } from './RenderTuning'
import { useWorldSession } from './useWorldSession'

/**
 * Промежуточная версия для замера: свободная орбитальная камера, без физики и
 * персонажа. Модели лежат в реальных мировых координатах локации (например,
 * X ~3840, Z ~-2072 у «Хвойного»), поэтому камеру нельзя оставлять в начале
 * координат — она смотрела бы в пустоту за километры от карты.
 */
/**
 * Собственная фигура. Рисуется только когда камера отошла за спину — иначе она
 * закрывала бы весь экран изнутри.
 */
function LocalAvatar({ playerRef }: { playerRef: RefObject<PlayerReport | null> }) {
  const source = useAvatarSource()

  const sample = useCallback(
    (out: AvatarSample) => {
      const live = playerRef.current
      if (!live) return
      out.position.copy(live.position)
      out.yaw = live.yaw
      out.speed = live.speed
    },
    [playerRef],
  )

  return source ? <Avatar source={source} sample={sample} /> : null
}

export function WorldScene({
  scene,
  spawn,
  mapKey = 'default',
  location,
  onClose,
}: {
  scene: THREE.Group
  spawn?: [number, number, number]
  /** Ключ карты: к нему привязана черновая расстановка в браузере. */
  mapKey?: string
  /** Локация для общеклановых расстановок. У отдельных тайлов её нет. */
  location?: MapLocation
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const [report, setReport] = useState<RenderReport | null>(null)
  const [walking, setWalking] = useState(false)
  const [flying, setFlying] = useState(false)

  /**
   * Состояние персонажа идёт в ref, а не в состояние React: обновление по
   * шестьдесят раз в секунду перерисовывало бы всю сцену вместе с картой. Из
   * этого же ref читают собственный аватар и отправка позиции по сети.
   */
  const playerRef = useRef<PlayerReport | null>(null)

  /** Камера за спиной: только так видно собственную фигуру. */
  const [thirdPerson, setThirdPerson] = useState(false)
  const [building, setBuilding] = useState(false)
  const [kindIndex, setKindIndex] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [placed, setPlaced] = useState<PlacedProp[]>(() => loadPlaced(mapKey))

  useEffect(() => {
    savePlaced(mapKey, placed)
  }, [mapKey, placed])

  // Модель игрока тянем заранее, не дожидаясь, пока кто-то появится рядом:
  // иначе чужая фигура возникает с задержкой в секунды — разбор glb конкурирует
  // за поток с отрисовкой карты, а она тут в сотни мегабайт.
  useEffect(() => {
    void loadAvatar().catch(() => {
      // без модели мир остаётся проходимым, просто никого не видно
    })
  }, [])

  const addProp = useCallback((prop: PlacedProp) => {
    setPlaced((list) => [...list, prop])
  }, [])
  const removeProp = useCallback((id: string) => {
    setPlaced((list) => list.filter((prop) => prop.id !== id))
  }, [])
  const rotate = useCallback((delta: number) => {
    setRotation((value) => value + delta)
  }, [])

  /**
   * Своя расстановка для входа в общий мир.
   *
   * Эффект объявлен раньше сессии намеренно: эффекты срабатывают в порядке
   * объявления, и к моменту подключения в ref уже лежит актуальный список.
   */
  const placedRef = useRef(placed)
  useEffect(() => {
    placedRef.current = placed
  }, [placed])

  const stopWalking = useCallback(() => {
    setWalking(false)
    setFlying(false)
    setBuilding(false)
  }, [])

  // Совместное присутствие включается вместе с режимом ходьбы: до него у игрока
  // просто нет положения, и остальные видели бы его фигуру в начале координат.
  const { players, state: connection, place, remove } = useWorldSession(
    location,
    playerRef,
    walking,
    placedRef,
    {
      onSnapshot: setPlaced,
      onPlaced: addProp,
      onRemoved: removeProp,
    },
  )

  // Постановка и снос идут и в свою сцену, и остальным. Сервер рассылает только
  // другим, поэтому своё же действие обратно не прилетает и не задваивается.
  const placeProp = useCallback(
    (prop: PlacedProp) => {
      addProp(prop)
      place(prop)
    },
    [addProp, place],
  )
  const dropProp = useCallback(
    (id: string) => {
      removeProp(id)
      remove(id)
    },
    [removeProp, remove],
  )

  useEffect(() => {
    if (!walking) return
    function onKey(event: KeyboardEvent) {
      // event.repeat обязателен: с зажатой клавишей автоповтор шлёт десятки
      // нажатий в секунду, и режим начинает мигать между полётом и ходьбой —
      // персонаж при этом дёргается и уезжает сам по себе
      if (event.repeat) return
      if (event.code === 'KeyF') setFlying((value) => !value)
      if (event.code === 'KeyB') setBuilding((value) => !value)
      if (event.code === 'KeyV') setThirdPerson((value) => !value)
      // Esc заодно снимает захват курсора силами браузера, но выход из режима
      // решается здесь, а не по факту потери курсора
      if (event.code === 'Escape') stopWalking()
    }
    // колесо перебирает заграждения: цифровые клавиши заняты отладкой
    function onWheel(event: WheelEvent) {
      if (!building) return
      setKindIndex((index) => (index + (event.deltaY > 0 ? 1 : PROP_KINDS.length - 1)) % PROP_KINDS.length)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [walking, building, stopWalking])

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
    // data-mode нужен автотестам: по нему видно текущий режим, не разбирая текст
    <div className="fixed inset-0 z-30 bg-black" data-mode={!walking ? 'orbit' : flying ? 'fly' : 'walk'}>
      <Canvas camera={{ fov: 60, near: 0.5, far: view.far, position: view.position }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[1, 2, 1]} intensity={1.4} />
        <MapModel scene={scene} />
        <PlacedProps placed={placed} />
        <RemoteAvatars players={players} />
        {walking ? (
          <>
            <Player
              scene={scene}
              spawn={spawn}
              flying={flying}
              placed={placed}
              thirdPerson={thirdPerson}
              state={playerRef}
            />
            {thirdPerson && <LocalAvatar playerRef={playerRef} />}
            {building && (
              <Builder
                scene={scene}
                placed={placed}
                kindIndex={kindIndex}
                rotation={rotation}
                onPlace={placeProp}
                onRemove={dropProp}
                onRotate={rotate}
              />
            )}
          </>
        ) : (
          <OrbitControls target={view.center} makeDefault />
        )}
        <RenderStats onReport={setReport} />
        <RenderTuning scene={scene} />
      </Canvas>

      <RenderStatsOverlay report={report} playerRef={walking ? playerRef : undefined} />

      <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground">
        {!walking ? t('world.orbitHint') : flying ? t('world.flyHint') : t('world.walkHint')}
        <div className="mt-1 font-mono">
          {Math.round(view.size.x)} × {Math.round(view.size.y)} × {Math.round(view.size.z)}
        </div>
      </div>

      <div className="absolute right-4 top-4 flex gap-2">
        {/* Кнопки только вне режима ходьбы: под захватом курсора мышь
            принадлежит холсту, и кликнуть по ним всё равно нельзя — внутри
            режимы переключаются клавишей F, выход Esc. */}
        {!walking && (
          <>
            <button
              type="button"
              onClick={() => {
                setFlying(false)
                setWalking(true)
              }}
              className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent hover:bg-accent/20"
            >
              {t('world.walk')}
            </button>
            <button
              type="button"
              onClick={() => {
                setFlying(true)
                setWalking(true)
              }}
              className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-secondary"
            >
              {t('world.flyOn')}
            </button>
          </>
        )}
        {onClose && !walking && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-secondary"
          >
            {t('world.close')}
          </button>
        )}
      </div>

      {/* Прицел: без него в режиме ходьбы не понять, куда смотришь. В виде от
          третьего лица он не нужен — центр экрана там не совпадает с фигурой. */}
      {walking && !thirdPerson && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />
      )}

      {!walking && location && (
        <LayoutPanel location={location} placed={placed} onLoad={setPlaced} />
      )}

      {walking && location && (
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground">
          {connection === 'connecting' && t('world.party.connecting')}
          {connection === 'error' && t('world.party.error')}
          {connection === 'online' &&
            (players.length === 0
              ? t('world.party.alone')
              : t('world.party.others', { count: players.length }))}
        </div>
      )}

      {walking && building && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-2">
          <div className="flex gap-2">
            {PROP_KINDS.map((kind, index) => (
              <div
                key={kind.id}
                className={
                  index === kindIndex
                    ? 'rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-xs text-accent'
                    : 'rounded-md border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground'
                }
              >
                {kind.label}
              </div>
            ))}
          </div>
          <div className="rounded-md border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground">
            {t('world.buildHint', { count: placed.length })}
          </div>
        </div>
      )}
    </div>
  )
}
