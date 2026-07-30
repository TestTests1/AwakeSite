import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import * as signalR from '@microsoft/signalr'
import * as THREE from 'three'
import type { MapLocation } from '@/api/maps'
import type { PlacedProp } from '@/lib/props'
import { useAuthStore } from '@/store/authStore'
import type { PlayerReport } from './RenderStats'

const HUB_URL = `${import.meta.env.VITE_API_URL ?? ''}/hubs/world`

/** Сколько раз в секунду уходит своё положение. */
const SEND_RATE = 12
/** Ниже этого сдвига пакет не отправляем — стоящий игрок молчит. */
const MOVE_EPSILON = 0.02
/** И этого поворота. */
const TURN_EPSILON = 0.02
/** Но не молчит дольше этого: пакет заодно подтверждает, что игрок жив. */
const KEEPALIVE_SECONDS = 1

interface WorldPlayerDto {
  id: string
  username: string
  x: number
  y: number
  z: number
  yaw: number
  speed: number
  flying: boolean
}

/**
 * Чужой игрок.
 *
 * Поля меняются на месте, а не пересоздаются: на них смотрит useFrame, и новый
 * объект на каждый пакет заставлял бы React перерисовывать сцену десяток раз в
 * секунду на каждого участника.
 */
export interface RemotePlayer {
  id: string
  username: string
  /** Откуда и куда идёт интерполяция между двумя последними пакетами. */
  from: THREE.Vector3
  to: THREE.Vector3
  fromYaw: number
  toYaw: number
  /** Время получения последнего пакета и промежуток до предыдущего, в секундах. */
  receivedAt: number
  interval: number
  speed: number
  flying: boolean
}

export type ConnectionState = 'offline' | 'connecting' | 'online' | 'error'

/** Заграждение в том виде, в каком его гоняет хаб. */
interface WorldPropDto {
  id: string
  kind: string
  x: number
  y: number
  z: number
  rotation: number
}

const toDto = (prop: PlacedProp): WorldPropDto => ({
  id: prop.id,
  kind: prop.kind,
  x: prop.position[0],
  y: prop.position[1],
  z: prop.position[2],
  rotation: prop.rotation,
})

const fromDto = (dto: WorldPropDto): PlacedProp => ({
  id: dto.id,
  kind: dto.kind,
  position: [dto.x, dto.y, dto.z],
  rotation: dto.rotation,
})

/** Что делать с расстановкой, приходящей от других. */
export interface WorldPropHandlers {
  /** Расстановка, сложившаяся на локации к моменту входа. */
  onSnapshot: (props: PlacedProp[]) => void
  onPlaced: (prop: PlacedProp) => void
  onRemoved: (id: string) => void
}

/** Кратчайшая разница между углами: через ±π иначе фигура разворачивается кругом. */
export function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

function makeRemote(dto: WorldPlayerDto): RemotePlayer {
  const point = new THREE.Vector3(dto.x, dto.y, dto.z)
  return {
    id: dto.id,
    username: dto.username,
    from: point.clone(),
    to: point,
    fromYaw: dto.yaw,
    toYaw: dto.yaw,
    receivedAt: performance.now() / 1000,
    interval: 1 / SEND_RATE,
    speed: dto.speed,
    flying: dto.flying,
  }
}

/**
 * Совместное присутствие на карте.
 *
 * Сервер только пересылает координаты, поэтому вся сглаживающая работа здесь:
 * пакеты приходят десяток раз в секунду, а рисуем мы шестьдесят, и без
 * интерполяции чужие фигуры двигались бы рывками.
 */
export function useWorldSession(
  location: MapLocation | undefined,
  self: RefObject<PlayerReport | null>,
  enabled: boolean,
  /** Своя расстановка на момент входа: если мы первые, она станет общей. */
  ownProps: RefObject<PlacedProp[]>,
  handlers: WorldPropHandlers,
) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const [players, setPlayers] = useState<RemotePlayer[]>([])
  // Стартовое значение — «подключаемся»: пока сессия выключена, наружу всё
  // равно отдаётся 'offline', а внутрь эффекта это писать нельзя, иначе выходит
  // лишний каскад перерисовок.
  const [state, setState] = useState<ConnectionState>('connecting')

  /** Живой список: в него пишут обработчики, из него собирается состояние React. */
  const known = useRef(new Map<string, RemotePlayer>())

  const active = Boolean(enabled && location && accessToken)

  /**
   * Обработчики держим в ref и обновляем при каждом проходе. Иначе новая ссылка
   * на колбэк попадала бы в зависимости эффекта и пересоздавала соединение —
   * игрок отваливался бы от мира на каждой постановке заграждения.
   */
  const events = useRef(handlers)
  useEffect(() => {
    events.current = handlers
  })

  /** Живое соединение: через него уходят постановки и сносы. */
  const hub = useRef<signalR.HubConnection | null>(null)

  useEffect(() => {
    if (!active || !location || !accessToken) return

    let stopped = false

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL, { accessTokenFactory: () => accessToken })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build()

    /** Пересобирает список для React — только когда состав игроков изменился. */
    const publish = () => setPlayers([...known.current.values()])

    const upsert = (dto: WorldPlayerDto) => {
      const existing = known.current.get(dto.id)
      if (!existing) {
        known.current.set(dto.id, makeRemote(dto))
        publish()
        return
      }

      const now = performance.now() / 1000
      // предыдущая цель становится началом отрезка, и на интервал между
      // пакетами фигура плавно проходит от неё к новой точке
      existing.from.copy(existing.to)
      existing.to.set(dto.x, dto.y, dto.z)
      existing.fromYaw = existing.toYaw
      existing.toYaw = dto.yaw
      existing.interval = THREE.MathUtils.clamp(now - existing.receivedAt, 0.05, 0.5)
      existing.receivedAt = now
      existing.speed = dto.speed
      existing.flying = dto.flying
    }

    connection.on('PlayerJoined', (dto: WorldPlayerDto) => {
      known.current.set(dto.id, makeRemote(dto))
      publish()
    })
    connection.on('PlayerMoved', upsert)
    connection.on('PlayerLeft', (id: string) => {
      if (known.current.delete(id)) publish()
    })
    connection.on('PropPlaced', (dto: WorldPropDto) => events.current.onPlaced(fromDto(dto)))
    connection.on('PropRemoved', (id: string) => events.current.onRemoved(id))

    /**
     * Вход: приносим свою расстановку и принимаем ту, что сложилась.
     *
     * Если на локации мы первые, общей становится наша; иначе сервер вернёт уже
     * сложившуюся, и мы принимаем её — то есть входим в чужой сеанс, а не
     * навязываем свой.
     */
    const join = () =>
      connection
        .invoke<{ players: WorldPlayerDto[]; props: WorldPropDto[] }>(
          'Join',
          location,
          (ownProps.current ?? []).map(toDto),
        )
        .then((snapshot) => {
          known.current = new Map(snapshot.players.map((dto) => [dto.id, makeRemote(dto)]))
          publish()
          events.current.onSnapshot(snapshot.props.map(fromDto))
          return snapshot
        })

    connection.onreconnected(() => {
      void join()
    })
    connection.onclose(() => {
      if (!stopped) setState('error')
    })

    hub.current = connection

    const ready = connection
      .start()
      .then(join)
      .then(() => {
        if (!stopped) setState('online')
      })
      .catch(() => {
        if (!stopped) setState('error')
      })

    // Отправка идёт по таймеру, а не из кадра: частота кадров плавает от 30 до
    // 144, и привязка к ней меняла бы нагрузку на сеть в пять раз.
    const lastSent = { x: 0, y: 0, z: 0, yaw: 0, at: 0 }
    const timer = window.setInterval(() => {
      const live = self.current
      if (!live || connection.state !== signalR.HubConnectionState.Connected) return

      const now = performance.now() / 1000
      const moved =
        Math.abs(live.position.x - lastSent.x) > MOVE_EPSILON ||
        Math.abs(live.position.y - lastSent.y) > MOVE_EPSILON ||
        Math.abs(live.position.z - lastSent.z) > MOVE_EPSILON
      const turned = Math.abs(shortestAngle(lastSent.yaw, live.yaw)) > TURN_EPSILON
      if (!moved && !turned && now - lastSent.at < KEEPALIVE_SECONDS) return

      lastSent.x = live.position.x
      lastSent.y = live.position.y
      lastSent.z = live.position.z
      lastSent.yaw = live.yaw
      lastSent.at = now

      void connection
        .invoke('Move', live.position.x, live.position.y, live.position.z, live.yaw, live.speed, !live.grounded)
        .catch(() => {
          // разрыв соединения обрабатывается onclose, отдельная реакция не нужна
        })
    }, 1000 / SEND_RATE)

    return () => {
      stopped = true
      hub.current = null
      window.clearInterval(timer)
      known.current.clear()
      setPlayers([])
      // следующее подключение должно начинаться заново с «подключаемся»
      setState('connecting')
      // Останавливаем только после того, как start договорится. Иначе выходит
      // «connection was stopped during negotiation» — в разработке строгий режим
      // React монтирует эффект дважды и ловит соединение ровно на согласовании.
      void ready.catch(() => {}).then(() => connection.stop())
    }
  }, [active, location, accessToken, self, ownProps])

  /** Разослать свою постановку. Молча ничего не делает, когда мы одни. */
  const place = useCallback((prop: PlacedProp) => {
    const connection = hub.current
    if (connection?.state !== signalR.HubConnectionState.Connected) return
    void connection.invoke('PlaceProp', toDto(prop)).catch(() => {})
  }, [])

  const remove = useCallback((id: string) => {
    const connection = hub.current
    if (connection?.state !== signalR.HubConnectionState.Connected) return
    void connection.invoke('RemoveProp', id).catch(() => {})
  }, [])

  // Пока сессия не нужна, отдаём пустой результат, а не гасим состояние в теле
  // эффекта: лишний проход перерисовки тут ни к чему.
  return active
    ? { players, state, place, remove }
    : { players: EMPTY, state: 'offline' as const, place, remove }
}

/** Общая пустая ссылка, чтобы отключённая сессия не порождала новый массив. */
const EMPTY: RemotePlayer[] = []
