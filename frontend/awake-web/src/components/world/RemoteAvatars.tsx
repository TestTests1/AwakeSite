import { useCallback, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Avatar, useAvatarSource, type AvatarSample } from './Avatar'
import { shortestAngle, type RemotePlayer } from './useWorldSession'

/** На сколько блоков подпись висит над головой. */
const LABEL_HEIGHT = 2.4

/**
 * Остальные игроки на карте.
 *
 * Каждый рисуется своей копией модели: их единицы, а не тысячи, и разделять
 * между ними скелет всё равно нельзя — позы разные.
 */
export function RemoteAvatars({ players }: { players: RemotePlayer[] }) {
  const source = useAvatarSource()
  if (!source) return null

  return (
    <>
      {players.map((player) => (
        <RemoteAvatar key={player.id} source={source} player={player} />
      ))}
    </>
  )
}

function RemoteAvatar({
  source,
  player,
}: {
  source: NonNullable<ReturnType<typeof useAvatarSource>>
  player: RemotePlayer
}) {
  /**
   * Положение между двумя последними пакетами.
   *
   * Пакеты приходят около двенадцати раз в секунду, кадров же шестьдесят и
   * больше. Без этого чужие фигуры телепортировались бы рывками. Отрезок
   * проходится ровно за измеренный промежуток между пакетами, поэтому при
   * просадке сети движение замедляется, но не дёргается.
   */
  const sample = useCallback(
    (out: AvatarSample) => {
      const elapsed = performance.now() / 1000 - player.receivedAt
      const t = THREE.MathUtils.clamp(elapsed / player.interval, 0, 1)
      out.position.lerpVectors(player.from, player.to, t)
      out.yaw = player.fromYaw + shortestAngle(player.fromYaw, player.toYaw) * t
      out.speed = player.speed
    },
    [player],
  )

  return (
    <>
      <Avatar source={source} sample={sample} />
      <NameTag player={player} sample={sample} />
    </>
  )
}

/**
 * Подпись над головой: без неё в общем мире не разобрать, кто есть кто.
 *
 * Группа двигается в кадре, а не пропсом: позиция игрока меняется на месте, и
 * React о таких правках не знает — подпись осталась бы там, где игрок появился.
 */
function NameTag({
  player,
  sample,
}: {
  player: RemotePlayer
  sample: (out: AvatarSample) => void
}) {
  const anchor = useRef<THREE.Group>(null)
  const out = useRef<AvatarSample>({ position: new THREE.Vector3(), yaw: 0, speed: 0 })

  useFrame(() => {
    if (!anchor.current) return
    sample(out.current)
    anchor.current.position.set(
      out.current.position.x,
      out.current.position.y + LABEL_HEIGHT,
      out.current.position.z,
    )
  })

  return (
    <group ref={anchor}>
      <Html
        center
        // под захватом курсора любой перехват событий мешает управлению
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[10, 0]}
      >
        <div className="whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          {player.username}
        </div>
      </Html>
    </group>
  )
}
