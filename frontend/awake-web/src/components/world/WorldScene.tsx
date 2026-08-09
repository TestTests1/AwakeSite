import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import type { MapLocation } from '@/api/maps'
import { loadAvatar } from '@/lib/avatar'
import { TerrainCollider } from '@/lib/collision'
import type { MapManifest } from '@/lib/mapManifest'
import { loadSky } from '@/lib/sky'
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
import { useChunkStream } from './useChunkStream'
import { useWorldSession } from './useWorldSession'

/**
 * Небо ставится фоном сцены, а не отдельной моделью: фон рисуется без глубины
 * и не мешает ни отсечению, ни лучам столкновений.
 *
 * Грузится отдельно от карты и заметно раньше неё — двести с небольшим
 * килобайт против сотен мегабайт. Пока не приехало, фон остаётся чёрным.
 */
function SkyBox() {
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    let cancelled = false
    let texture: THREE.CubeTexture | null = null

    void loadSky()
      .then((loaded) => {
        if (cancelled) {
          loaded.dispose()
          return
        }
        texture = loaded
        scene.background = loaded
      })
      .catch(() => {
        // без неба мир остаётся проходимым, просто фон чёрный как раньше
      })

    return () => {
      cancelled = true
      scene.background = null
      texture?.dispose()
    }
  }, [scene])

  return null
}

/**
 * Получен ли захват курсора.
 *
 * Браузер не выдаёт его без явного жеста, а входим мы теперь сразу от первого
 * лица — без клика. Клавиши при этом работают, а мышь нет, и без подсказки это
 * выглядит поломкой. Захват восстанавливается кликом по холсту, этим занят
 * usePointerLook.
 */
function usePointerLocked(): boolean {
  const [locked, setLocked] = useState(() => document.pointerLockElement !== null)

  useEffect(() => {
    const update = () => setLocked(document.pointerLockElement !== null)
    document.addEventListener('pointerlockchange', update)
    return () => document.removeEventListener('pointerlockchange', update)
  }, [])

  return locked
}

/**
 * Туман прячет границу загруженного. Раньше он прятал край карты и потому
 * считался долями её размаха; теперь карта грузится кусками, и прятать надо
 * место, где куски кончаются, — а оно на одном и том же расстоянии на любой
 * карте.
 *
 * Цвет не подобран на глаз, а снят с самого скайбокса: среднее по полосе неба
 * над горизонтом на четырёх боковых гранях. Поэтому дальние блоки растворяются
 * ровно в тот тон, который за ними и нарисован. Сменится небо — пересчитать.
 *
 * Конец совпадает с дальностью загрузки из useChunkStream: отодвинуть его
 * дальше значит показать пустоту за последним куском.
 */
const FOG_COLOR = 0x8099ac
const FOG_START = 70
const FOG_END = 120

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
  baseUrl,
  manifest,
  mapKey = 'default',
  location,
  onClose,
}: {
  baseUrl: string
  manifest: MapManifest
  /** Ключ карты: к нему привязана черновая расстановка в браузере. */
  mapKey?: string
  /** Локация для общеклановых расстановок. У отдельных тайлов её нет. */
  location?: MapLocation
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const locked = usePointerLocked()
  const [report, setReport] = useState<RenderReport | null>(null)
  const [flying, setFlying] = useState(false)
  const [menu, setMenu] = useState(false)

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

  // Совместное присутствие теперь включено с самого начала: обзорного режима
  // без персонажа больше нет, а значит нет и момента, когда позиции ещё нет.
  const { players, state: connection, place, remove } = useWorldSession(
    location,
    playerRef,
    true,
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
    function onKey(event: KeyboardEvent) {
      // event.repeat обязателен: с зажатой клавишей автоповтор шлёт десятки
      // нажатий в секунду, и режим начинает мигать между полётом и ходьбой —
      // персонаж при этом дёргается и уезжает сам по себе
      if (event.repeat) return
      // Esc открывает и закрывает меню. Снятие захвата курсора при этом делает
      // сам браузер, независимо от нас, — поэтому здесь только переключение.
      if (event.code === 'Escape') setMenu((value) => !value)
      // при открытом меню игровые клавиши молчат: иначе набор в поле имени
      // расстановки переключал бы полёт и стройку. Сам персонаж (Player) и
      // поворот заграждения (Builder) гасят те же клавиши своим признаком
      // active — этот же return отвечает только за клавиши самого WorldScene.
      if (menu) return
      if (event.code === 'KeyF') setFlying((value) => !value)
      if (event.code === 'KeyB') setBuilding((value) => !value)
      if (event.code === 'KeyV') setThirdPerson((value) => !value)
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
  }, [building, menu])

  /**
   * Сцена, в которую управляющий кладёт куски. Создаётся один раз и живёт
   * дольше любого куска: поток кладёт в неё куски мимо React, а коллайдер
   * держит ссылку на тот же объект — пересоздай её при перерисовке, и они
   * начали бы работать с разными сценами.
   */
  const group = useMemo(() => new THREE.Group(), [])

  /**
   * Границы и размах берутся из манифеста, а не из сцены: сцена в начале пуста,
   * и замер вернул бы нулевую коробку.
   */
  const view = useMemo(() => {
    const min = new THREE.Vector3(...manifest.bounds.min)
    const max = new THREE.Vector3(...manifest.bounds.max)
    const bounds = new THREE.Box3(min, max)
    const size = max.clone().sub(min)
    return { bounds, size, far: Math.max(size.x, size.y, size.z) * 10 }
  }, [manifest])

  /**
   * Есть ли клетка над этими координатами в нарезке. Множество ключей строится
   * один раз: клеток сотни, а спрашивают каждый кадр.
   */
  const hasChunkAt = useMemo(() => {
    const keys = new Set(manifest.chunks.map((entry) => `${entry.x}_${entry.z}`))
    const size = manifest.chunkSize
    return (x: number, z: number) =>
      keys.has(`${Math.floor(x / size)}_${Math.floor(z / size)}`)
  }, [manifest])

  /**
   * Коллайдер живёт рядом со сценой, а не внутри Player: куски приходят и
   * уходят независимо от того, перерисовался ли Player.
   */
  const collider = useMemo(() => new TerrainCollider(), [])
  useEffect(() => () => collider.dispose(), [collider])

  const addChunk = useCallback((chunk: THREE.Group) => collider.addPart(chunk), [collider])
  const removeChunk = useCallback((chunk: THREE.Group) => collider.removePart(chunk), [collider])

  const stream = useChunkStream({
    baseUrl,
    manifest,
    playerRef,
    group,
    onAdd: addChunk,
    onRemove: removeChunk,
  })

  return (
    // data-mode нужен автотестам: по нему видно текущий режим, не разбирая текст
    <div className="fixed inset-0 z-30 bg-black" data-mode={menu ? 'menu' : flying ? 'fly' : 'walk'}>
      {/* Камера ставится сразу на точку появления: Player доведёт её до земли
          в своём эффекте, но до первого кадра эффекты не срабатывают, и с
          обзорной позиции мелькнул бы вид издалека. */}
      {/* Ближняя плоскость меньше половины ширины тела: иначе стена, к которой
          игрок подошёл вплотную, обрезается и сквозь неё видно насквозь.
          Дальняя плоскость при этом велика, но точности буфера глубины хватает:
          туман всё равно гасит картинку на 120 метрах. */}
      <Canvas camera={{ fov: 60, near: 0.1, far: view.far, position: manifest.spawn }}>
        <SkyBox />
        <fog attach="fog" args={[FOG_COLOR, FOG_START, FOG_END]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[1, 2, 1]} intensity={1.4} />
        <MapModel scene={group} />
        <PlacedProps placed={placed} />
        <RemoteAvatars players={players} />
        <Player
          scene={group}
          bounds={view.bounds}
          collider={collider}
          hasChunkAt={hasChunkAt}
          spawn={manifest.spawn}
          flying={flying}
          placed={placed}
          thirdPerson={thirdPerson}
          active={!menu}
          state={playerRef}
        />
        {thirdPerson && <LocalAvatar playerRef={playerRef} />}
        {building && (
          <Builder
            collider={collider}
            placed={placed}
            kindIndex={kindIndex}
            rotation={rotation}
            onPlace={placeProp}
            onRemove={dropProp}
            onRotate={rotate}
            active={!menu}
          />
        )}
        <RenderStats onReport={setReport} />
        <RenderTuning scene={group} />
      </Canvas>

      {/*
       * Заслонка держится, пока не встал материал и не встал кусок под ногами
       * (stream.ready). loaded/needed до этого момента считают куски вокруг
       * точки появления и годятся для полоски прогресса; после ready тот же
       * счёт идёт по кускам вокруг текущей позиции игрока и может падать почти
       * до нуля на бегу — поэтому здесь используется только !stream.ready, а
       * не составное условие с loaded/needed.
       *
       * Кусок под точкой появления восстанавливается только тем, что игрок
       * отходит дальше 160 м и возвращается, — а до stream.ready он вообще не
       * может ходить. Поэтому у безнадёжного случая свой вид: полоска, которая
       * больше никогда не сдвинется, убирается совсем, и вместо неё сказано,
       * что войти не получится.
       *
       * Выход из мира здесь свой, а не общий из меню паузы: заслонка
       * непрозрачна и лежит выше меню, так что до кнопки в меню отсюда не
       * дотянуться мышью. Без этой кнопки единственным способом уйти была бы
       * перезагрузка страницы — и на слабой машине, ради которой всё это
       * затевалось, ждать пришлось бы дольше всех.
       */}
      {!stream.ready && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black">
          {stream.materialsFailed || stream.spawnFailed ? (
            <p className="text-sm text-destructive">
              {stream.materialsFailed ? t('world.materialsFailed') : t('world.spawnFailed')}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t('world.streaming')}</p>
              <div className="h-2 w-64 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${Math.min(100, Math.round((stream.loaded / Math.max(stream.needed, 1)) * 100))}%` }}
                />
              </div>
            </>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-secondary"
            >
              {t('world.close')}
            </button>
          )}
        </div>
      )}

      {/* Сбой куска после входа виден только здесь. Молча он не отличим от
          края прогрузки: впереди туман, и непришедшая клетка выглядит ровно
          как та, до которой игрок ещё не дошёл. */}
      {stream.ready && stream.failed > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-md border border-destructive/40 bg-card/90 px-3 py-2 text-xs text-destructive">
          {t('world.chunkErrors', { count: stream.failed })}
        </div>
      )}

      <RenderStatsOverlay report={report} playerRef={playerRef} />

      <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground">
        {flying ? t('world.flyHint') : t('world.walkHint')}
        <div className="mt-1 font-mono">
          {Math.round(view.size.x)} × {Math.round(view.size.y)} × {Math.round(view.size.z)}
        </div>
      </div>

      {/* Прицел: без него не понять, куда смотришь. В виде от третьего лица он
          не нужен — центр экрана там не совпадает с фигурой. */}
      {!thirdPerson && !menu && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />
      )}

      {!locked && !menu && (
        <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 rounded-md border border-accent/40 bg-card/90 px-4 py-2 text-sm text-accent">
          {t('world.clickToLook')}
        </div>
      )}

      {menu && (
        <div className="absolute inset-0 z-40 flex items-start justify-center overflow-auto bg-black/70 p-6">
          <div className="w-full max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">{t('world.menu.title')}</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFlying((value) => !value)}
                  className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-secondary"
                >
                  {flying ? t('world.flyOff') : t('world.flyOn')}
                </button>
                <button
                  type="button"
                  onClick={() => setMenu(false)}
                  className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent hover:bg-accent/20"
                >
                  {t('world.menu.resume')}
                </button>
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-secondary"
                  >
                    {t('world.close')}
                  </button>
                )}
              </div>
            </div>
            {location && <LayoutPanel location={location} placed={placed} onLoad={setPlaced} />}
          </div>
        </div>
      )}

      {location && (
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground">
          {connection === 'connecting' && t('world.party.connecting')}
          {connection === 'error' && t('world.party.error')}
          {connection === 'online' &&
            (players.length === 0
              ? t('world.party.alone')
              : t('world.party.others', { count: players.length }))}
        </div>
      )}

      {building && (
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
