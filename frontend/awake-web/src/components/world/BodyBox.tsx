import { useEffect, useMemo, useState, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import body from '@/lib/playerBody.json'
import type { TerrainCollider } from '@/lib/collision'
import type { PlayerReport } from './RenderStats'

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Выше шести метров искать нечего: это уже не проход, а потолок ангара или
 * открытое небо. Короткий луч заодно дешевле — он отсекается коробкой куска.
 */
const CLEARANCE_FAR = 6

/**
 * Луч пускается не от самого пола, а на пять сантиметров выше. С уровня ног он
 * первым же попаданием находит пол, на котором стоит игрок, и просвет выходит
 * нулевым. Поднятие потом прибавляется обратно, чтобы число считалось от ног.
 */
const CLEARANCE_LIFT = 0.05

/** Как часто накладная надпись забирает свежий замер, миллисекунды. */
const OVERLAY_PERIOD = 200

/**
 * Коробка тела на экране.
 *
 * Ради неё всё и делалось: «пролезет ли между барикадами» должно быть видно
 * глазами, а не только ощущаться на ощупь. Монтируется только когда включена,
 * поэтому в обычной игре не стоит ничего.
 *
 * Коробка квадратная в плане и со взглядом не поворачивается — ровно та же,
 * по которой считаются столкновения. Показывать что-то другое значило бы
 * рисовать красивую неправду.
 *
 * Заодно меряет просвет над головой: без него шаг «снять высоту низкого
 * прохода с модели» из tools/character/README.md читался бы как «замерь
 * как-нибудь». Замер идёт здесь, в кадре, а показывает его BodyBoxOverlay —
 * внутри холста надписи рисовать нечем.
 */
export function BodyBox({
  playerRef,
  collider,
  onClearance,
}: {
  playerRef: RefObject<PlayerReport | null>
  collider: TerrainCollider
  /**
   * Отдаёт просвет над ногами в метрах либо null, если над головой пусто.
   * Через вызов, а не записью в чужой ref: писать в ref, пришедший пропом,
   * запрещает правило react-hooks/immutability.
   */
  onClearance: (metres: number | null) => void
}) {
  const scene = useThree((state) => state.scene)
  const helper = useMemo(
    () => new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x3ddc84)),
    [],
  )
  /** Начало луча переиспользуется: новый вектор каждый кадр — это мусор шестьдесят раз в секунду. */
  const origin = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    scene.add(helper)
    return () => {
      scene.remove(helper)
      helper.geometry.dispose()
      // у Box3Helper материал всегда один, но тип линии допускает и список
      const materials = Array.isArray(helper.material) ? helper.material : [helper.material]
      for (const material of materials) material.dispose()
    }
  }, [scene, helper])

  useFrame(() => {
    const player = playerRef.current
    if (!player) return
    const half = body.standing.width / 2
    const height = player.crouching
      ? (body.crouching.height ?? body.standing.height)
      : body.standing.height
    helper.box.min.set(player.position.x - half, player.position.y, player.position.z - half)
    helper.box.max.set(player.position.x + half, player.position.y + height, player.position.z + half)

    origin.set(player.position.x, player.position.y + CLEARANCE_LIFT, player.position.z)
    const hit = collider.cast(origin, UP, CLEARANCE_FAR)
    onClearance(hit === null ? null : hit + CLEARANCE_LIFT)
  })

  return null
}

/**
 * Надпись рядом с коробкой: высота прохода, в котором игрок стоит.
 *
 * Это и есть инструмент к замеру роста присевшего (tools/character/README.md):
 * высоту низкого лаза берут отсюда, а игра отвечает только «пролез / не
 * пролез». Рост стоя показан рядом как мерка, с которой сверяют глазами.
 *
 * Замер снимается опросом ref, а не приходит из кадра: перерисовка React
 * шестьдесят раз в секунду перерисовала бы вместе с надписью всю сцену. Тем же
 * способом живёт RenderStatsOverlay.
 *
 * Под открытым небом луч не находит ничего — тогда прочерк, а не ноль: «ноль»
 * означал бы, что игрок упёрся головой в перекрытие.
 */
export function BodyBoxOverlay({ clearance }: { clearance: RefObject<number | null> }) {
  const [value, setValue] = useState<number | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setValue(clearance.current), OVERLAY_PERIOD)
    return () => window.clearInterval(timer)
  }, [clearance])

  return (
    <div className="pointer-events-none absolute right-4 top-4 rounded-md border border-accent/40 bg-card/90 px-3 py-2 font-mono text-xs text-accent">
      <div>просвет над головой {value === null ? '—' : `${value.toFixed(2)} м`}</div>
      <div className="text-muted-foreground">
        рост стоя {body.standing.height.toFixed(2)} м · ширина{' '}
        {body.standing.width.toFixed(2)} м
      </div>
    </div>
  )
}
