import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useKeyboard } from '@/hooks/useKeyboard'
import { facingAngle } from '@/lib/avatar'
import { TerrainCollider } from '@/lib/collision'
import type { PlacedProp } from '@/lib/props'
import type { PlayerReport } from './RenderStats'
import { usePointerLook } from './usePointerLook'
import { usePropColliders, usePropModels } from './usePropModels'

/** Всё в блоках игры: блок = 1 единица. */
const BODY_HEIGHT = 2 // персонаж занимает два блока по высоте
const EYE_HEIGHT = 1.8 // глаза почти у макушки, как в блочных играх
const STEP_UP = 1.05 // ступенька в один блок берётся ходьбой, как в игре
const WALK_SPEED = 6
const RUN_SPEED = 12
const FLY_SPEED = 18
const FLY_BOOST = 60
const GRAVITY = 26
const JUMP_SPEED = 8.5
const FALL_LIMIT = 60 // дальше вниз луч не пускаем, это уже свободное падение
const BODY_RADIUS = 0.35
/**
 * Высоты, на которых щупаем стены. Нижняя — выше ступеньки, иначе не зайти на
 * блок; верхняя — под макушкой, чтобы в проём высотой в один блок персонаж не
 * пролезал, ровно как в игре.
 */
const WALL_PROBES = [STEP_UP + 0.15, BODY_HEIGHT - 0.15]
/** Радиус, в котором держим построенные деревья столкновений. */
const PREPARE_RADIUS = 48

/** Насколько камера отходит назад в виде от третьего лица. */
const CAMERA_BACK = 5.5
/** Зазор до стены, чтобы камера не въезжала в неё вплотную. */
const CAMERA_MARGIN = 0.4
/** Ближе этого камера не подходит, иначе она оказывается внутри фигуры. */
const CAMERA_MIN = 1.2

const DOWN = new THREE.Vector3(0, -1, 0)
const UP = new THREE.Vector3(0, 1, 0)

export interface PlayerProps {
  scene: THREE.Group
  spawn?: [number, number, number]
  /** Свободный полёт сквозь геометрию: без гравитации и без столкновений. */
  flying?: boolean
  /** Поставленные заграждения: пешком через них не пройти. */
  placed?: PlacedProp[]
  /** Камера за спиной — тогда собственную фигуру видно. */
  thirdPerson?: boolean
  /**
   * Живое состояние персонажа, обновляется каждый кадр.
   *
   * Через ref, а не через состояние React: это читают оверлей, собственный
   * аватар и отправка позиции по сети, и каждый со своей частотой. Перерисовка
   * сцены по шестьдесят раз в секунду обошлась бы куда дороже, чем опрос.
   * Объект переиспользуется, поэтому потребитель обязан копировать то, что
   * собирается хранить.
   */
  state?: RefObject<PlayerReport | null>
}

/**
 * Ходьба от первого лица: гравитация, шаг на блок вверх, упор в стены.
 *
 * Полноценная физика тут не нужна и не потянет — коллайдер по геометрии карты
 * весит слишком много. Вместо тела в физическом мире стреляем лучами: один вниз
 * ищет опору, два вперёд упираются в стены. Для статичного ландшафта этого
 * достаточно, а стоит оно доли миллисекунды.
 */
export function Player({
  scene,
  spawn,
  flying = false,
  placed = [],
  thirdPerson = false,
  state,
}: PlayerProps) {
  const camera = useThree((state) => state.camera)
  const keys = useKeyboard()
  usePointerLook(true)

  const collider = useMemo(() => new TerrainCollider(scene), [scene])
  useEffect(() => () => collider.dispose(), [collider])

  // Заграждения подключаются к тем же лучам, что и рельеф, поэтому упор в них
  // получается по настоящей геометрии модели: сквозь проём баррикады с окном
  // проходишь, в саму баррикаду — нет.
  const models = usePropModels()
  const propColliders = usePropColliders(placed, models)
  useEffect(() => {
    collider.setDynamic(propColliders)
  }, [collider, propColliders])

  // ноги, а не глаза: с опорой удобнее считать именно от них
  const feet = useRef(new THREE.Vector3())
  const velocityY = useRef(0)
  const grounded = useRef(false)
  const started = useRef(false)

  const forward = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const step = useRef(new THREE.Vector3())
  const origin = useRef(new THREE.Vector3())
  const direction = useRef(new THREE.Vector3())
  const back = useRef(new THREE.Vector3())

  /** Позиция на прошлом кадре — из неё считаются скорость и разворот фигуры. */
  const previous = useRef(new THREE.Vector3())
  const yaw = useRef(0)

  const bounds = useMemo(() => new THREE.Box3().setFromObject(scene), [scene])

  const placeAtSpawn = useCallback(() => {
    const wantX = spawn ? spawn[0] : (bounds.min.x + bounds.max.x) / 2
    const wantZ = spawn ? spawn[2] : (bounds.min.z + bounds.max.z) / 2

    // Точка из экспортёра указывает на поверхность, но у отдельных тайлов её
    // нет, да и центр карты может прийтись на воду или провал. Поэтому ищем
    // опору по расходящейся спирали, а не только точно под собой.
    let found: THREE.Vector3 | null = null
    search: for (const radius of [0, 4, 12, 32, 64]) {
      for (let i = 0; i < (radius === 0 ? 1 : 8); i++) {
        const angle = (i / 8) * Math.PI * 2
        const x = wantX + Math.cos(angle) * radius
        const z = wantZ + Math.sin(angle) * radius
        const y = collider.groundAt(x, z, bounds)
        if (y !== null) {
          found = new THREE.Vector3(x, y + 0.05, z)
          break search
        }
      }
    }

    feet.current.copy(
      found ?? new THREE.Vector3(wantX, spawn ? spawn[1] : bounds.max.y + 2, wantZ),
    )
    collider.prepare(feet.current, PREPARE_RADIUS)
    velocityY.current = 0
    grounded.current = found !== null
    // иначе перенос на точку появления посчитается как перемещение за один
    // кадр, и скорость подскочит до сотен блоков в секунду
    previous.current.copy(feet.current)
    camera.position.set(feet.current.x, feet.current.y + EYE_HEIGHT, feet.current.z)
  }, [spawn, bounds, collider, camera])

  useEffect(() => {
    placeAtSpawn()
    started.current = true
  }, [placeAtSpawn])

  useFrame((_, rawDelta) => {
    if (!started.current) return
    // после переключения вкладки delta бывает в секунды — за такой шаг можно
    // проскочить сквозь стену
    const delta = Math.min(rawDelta, 0.05)
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight')

    /**
     * Общий хвост кадра: разворот фигуры, камера и публикация состояния.
     *
     * Фигура смотрит туда, куда движется, а на месте — туда, куда смотрит
     * камера. Если разворачивать её всегда по взгляду, то при ходьбе боком и
     * назад персонаж скользил бы вперёд лицом.
     */
    const finish = (isFlying: boolean) => {
      const dx = feet.current.x - previous.current.x
      const dz = feet.current.z - previous.current.z
      const moved = Math.hypot(dx, dz)
      const speed = delta > 0 ? moved / delta : 0
      if (moved > 1e-3) {
        yaw.current = facingAngle(dx, dz)
      } else {
        camera.getWorldDirection(forward.current)
        yaw.current = facingAngle(forward.current.x, forward.current.z)
      }
      previous.current.copy(feet.current)

      camera.position.set(feet.current.x, feet.current.y + EYE_HEIGHT, feet.current.z)
      if (thirdPerson) {
        // Камера отходит назад по взгляду и упирается в рельеф. В полёте деревья
        // столкновений не строятся, cast вернёт null — и упора не будет, что для
        // свободного полёта как раз правильно.
        camera.getWorldDirection(forward.current)
        back.current.copy(forward.current).negate()
        let distance = CAMERA_BACK
        const hit = collider.cast(camera.position, back.current, CAMERA_BACK + CAMERA_MARGIN)
        if (hit !== null) distance = Math.max(CAMERA_MIN, hit - CAMERA_MARGIN)
        camera.position.addScaledVector(back.current, distance)
      }

      if (state) {
        state.current ??= {
          position: new THREE.Vector3(),
          grounded: false,
          yaw: 0,
          speed: 0,
        }
        state.current.position.copy(feet.current)
        state.current.grounded = isFlying ? false : grounded.current
        state.current.yaw = yaw.current
        state.current.speed = speed
      }
    }

    if (flying) {
      // Полёт сквозь геометрию: ни гравитации, ни упоров, ни деревьев
      // столкновений — они тут не нужны и только тратили бы время на построение.
      camera.getWorldDirection(forward.current)
      right.current.crossVectors(forward.current, camera.up).normalize()

      step.current.set(0, 0, 0)
      if (keys.has('KeyW') || keys.has('ArrowUp')) step.current.add(forward.current)
      if (keys.has('KeyS') || keys.has('ArrowDown')) step.current.sub(forward.current)
      if (keys.has('KeyD') || keys.has('ArrowRight')) step.current.add(right.current)
      if (keys.has('KeyA') || keys.has('ArrowLeft')) step.current.sub(right.current)
      if (keys.has('Space')) step.current.y += 1
      if (keys.has('KeyC') || keys.has('ControlLeft')) step.current.y -= 1

      if (step.current.lengthSq() > 0) {
        step.current.normalize().multiplyScalar((boost ? FLY_BOOST : FLY_SPEED) * delta)
        feet.current.add(step.current)
      }
      velocityY.current = 0
      grounded.current = false
      finish(true)
      return
    }

    collider.prepare(feet.current, PREPARE_RADIUS)

    /** Двигает по одной оси и откатывает, если упёрлись — так выходит скольжение вдоль стены. */
    const moveAxis = (amount: number, axis: 'x' | 'z') => {
      if (amount === 0) return
      direction.current.set(
        axis === 'x' ? Math.sign(amount) : 0,
        0,
        axis === 'z' ? Math.sign(amount) : 0,
      )

      for (const height of WALL_PROBES) {
        origin.current.copy(feet.current).setY(feet.current.y + height)
        const hit = collider.cast(origin.current, direction.current, Math.abs(amount) + BODY_RADIUS)
        if (hit !== null) return
      }
      if (axis === 'x') feet.current.x += amount
      else feet.current.z += amount
    }

    // направление по взгляду, но строго горизонтально
    camera.getWorldDirection(forward.current)
    forward.current.y = 0
    if (forward.current.lengthSq() < 1e-6) forward.current.set(0, 0, -1)
    forward.current.normalize()
    right.current.crossVectors(forward.current, camera.up).normalize()

    step.current.set(0, 0, 0)
    if (keys.has('KeyW') || keys.has('ArrowUp')) step.current.add(forward.current)
    if (keys.has('KeyS') || keys.has('ArrowDown')) step.current.sub(forward.current)
    if (keys.has('KeyD') || keys.has('ArrowRight')) step.current.add(right.current)
    if (keys.has('KeyA') || keys.has('ArrowLeft')) step.current.sub(right.current)

    if (step.current.lengthSq() > 0) {
      step.current.normalize().multiplyScalar((boost ? RUN_SPEED : WALK_SPEED) * delta)
      moveAxis(step.current.x, 'x')
      moveAxis(step.current.z, 'z')
    }

    // вертикаль
    if (grounded.current && (keys.has('Space') || keys.has('KeyE'))) {
      velocityY.current = JUMP_SPEED
      grounded.current = false
    }
    velocityY.current -= GRAVITY * delta
    feet.current.y += velocityY.current * delta

    // упёрлись макушкой в потолок — гасим подъём, иначе персонаж въезжает
    // головой в блок над собой и зависает в нём
    if (velocityY.current > 0) {
      origin.current.copy(feet.current).setY(feet.current.y + BODY_HEIGHT - 0.1)
      const toCeiling = collider.cast(origin.current, UP, velocityY.current * delta + 0.15)
      if (toCeiling !== null) velocityY.current = 0
    }

    origin.current.copy(feet.current).setY(feet.current.y + STEP_UP)
    const toGround = collider.cast(origin.current, DOWN, STEP_UP + FALL_LIMIT)
    if (toGround !== null) {
      const groundY = origin.current.y - toGround
      if (feet.current.y <= groundY) {
        // сюда же попадает шаг на блок вверх: опора оказалась выше ног
        feet.current.y = groundY
        velocityY.current = 0
        grounded.current = true
      } else {
        grounded.current = false
      }
    } else {
      grounded.current = false
    }

    // провалился мимо карты — возвращаем на точку появления, иначе падение
    // бесконечно и выбраться из него нечем
    if (feet.current.y < bounds.min.y - 30) placeAtSpawn()

    finish(false)
  })

  return null
}
