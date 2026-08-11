import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useKeyboard } from '@/hooks/useKeyboard'
import { facingAngle } from '@/lib/avatar'
import { TerrainCollider } from '@/lib/collision'
import body from '@/lib/playerBody.json'
import type { PlacedProp } from '@/lib/props'
import type { PlayerReport } from './RenderStats'
import { usePointerLook } from './usePointerLook'
import { usePropColliders, usePropModels } from './usePropModels'

// Всё в блоках игры: блок = 1 единица.
/** Сторона коробки тела в плане — по наибольшему размеру, см. комментарий ниже. */
const BODY_WIDTH = body.standing.width
const BODY_STAND = body.standing.height
const EYE_HEIGHT = body.standing.eye ?? BODY_STAND - 0.15
/**
 * Зазор снизу и сверху, чтобы пол, на котором игрок стоит, не считался
 * препятствием: коробка вплотную к опоре пересекалась бы с ней каждый кадр.
 */
const SKIN = 0.02

// Почему коробка квадратная в плане и почему она не крутится за взглядом.
//
// Размеры взяты из коробки попаданий самой игры: в плане тело не квадрат
// (0.8875 в ширину с руками против 0.3948 в глубину), но сторону берём по
// наибольшему из двух. Тело в просмотрщике не поворачивается вместе со
// взглядом нарочно: иначе одна и та же щель между заграждениями то пропускала
// бы, то нет — смотря боком человек идёт или лицом, — и ответ «пролезет ли»
// перестал бы быть ответом. Так устроены блочные игры, и так ответ остаётся
// строгим в одну сторону: если по квадрату прошло, то пройдёт при любом
// развороте.

const STEP_UP = 1.05 // ступенька в один блок берётся ходьбой, как в игре
const WALK_SPEED = 6
const RUN_SPEED = 12
const FLY_SPEED = 18
const FLY_BOOST = 60
const GRAVITY = 26
const JUMP_SPEED = 8.5
const FALL_LIMIT = 60 // дальше вниз луч не пускаем, это уже свободное падение
/** Радиус, в котором держим построенные деревья столкновений. */
const PREPARE_RADIUS = 48

/** Насколько камера отходит назад в виде от третьего лица. */
const CAMERA_BACK = 5.5
/** Зазор до стены, чтобы камера не въезжала в неё вплотную. */
const CAMERA_MARGIN = 0.4

const DOWN = new THREE.Vector3(0, -1, 0)
const UP = new THREE.Vector3(0, 1, 0)

export interface PlayerProps {
  scene: THREE.Group
  /**
   * Границы карты. Со стримингом сцена в начале пуста, и замерить её нечем:
   * Box3.setFromObject вернул бы пустую коробку, а по ней точка появления
   * оказалась бы в нуле координат, и персонаж полетел бы в пустоту.
   */
  bounds?: THREE.Box3
  spawn?: [number, number, number]
  /**
   * Общий коллайдер. Со стримингом он переживает перерисовки Player и знает про
   * куски, пришедшие, пока Player не перемонтировался.
   */
  collider?: TerrainCollider
  /**
   * Есть ли в нарезке клетка над этими координатами — то есть ждать ли здесь
   * пола вообще.
   *
   * Прямоугольник границ карты на этот вопрос не отвечает: сетка разрежённая,
   * и внутри границ «Низины» 86 клеток из 391 пустуют по построению. Без этой
   * проверки игрок, зашедший в такую дырку, замирал бы в воздухе навсегда —
   * снаружи это неотличимо от неприехавшего куска, но ждать там нечего.
   */
  hasChunkAt?: (x: number, z: number) => boolean
  /** Свободный полёт сквозь геометрию: без гравитации и без столкновений. */
  flying?: boolean
  /** Поставленные заграждения: пешком через них не пройти. */
  placed?: PlacedProp[]
  /** Камера за спиной — тогда собственную фигуру видно. */
  thirdPerson?: boolean
  /**
   * Персонаж принимает ввод: и мышь, и клавиатуру движения/прыжка.
   *
   * Выключается, когда поверх игры открыто меню — иначе клик по его кнопке
   * увёл бы курсор обратно в игру, а набор имени расстановки физическими
   * клавишами (WASD под любой раскладкой) двигал бы и разворачивал персонажа
   * прямо во время печати. Гравитация и падение при этом продолжают
   * работать — иначе персонаж завис бы в воздухе на глазах у остальных.
   */
  active?: boolean
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
 * весит слишком много. Вместо тела в физическом мире держим коробку размером с
 * игрока: вниз по-прежнему стреляем лучом за опорой, а горизонтальный шаг
 * проверяем пересечением этой коробки с геометрией. Лучей вперёд не хватало
 * ровно там, ради чего всё затевалось: между двумя заграждениями они
 * проскакивали в щель, в которую тело не пролезает.
 */
export function Player({
  scene,
  bounds: boundsProp,
  collider: colliderProp,
  hasChunkAt,
  spawn,
  flying = false,
  placed = [],
  thirdPerson = false,
  active = true,
  state,
}: PlayerProps) {
  const camera = useThree((state) => state.camera)
  const keys = useKeyboard()
  usePointerLook(active)

  const collider = useMemo(() => colliderProp ?? new TerrainCollider(scene), [colliderProp, scene])
  // свой коллайдер освобождаем, чужой — нет: им распоряжается тот, кто создал
  useEffect(() => () => { if (!colliderProp) collider.dispose() }, [collider, colliderProp])

  // Заграждения проверяются тем же коллайдером, что и рельеф, поэтому упор в
  // них получается по настоящей геометрии модели: сквозь проём баррикады с
  // окном проходишь, в саму баррикаду — нет.
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
  /** Высота до применения гравитации в этом кадре — к ней и откатываемся. */
  const beforeGravity = useRef(0)
  /** Текущая высота тела: меняется приседом (задача 6). */
  const bodyHeight = useRef(BODY_STAND)

  /** Коробка тела для проверок; переиспользуется, копий не плодим. */
  const probe = useRef(new THREE.Box3())

  /** Коробка тела с ногами в (x, y, z) заданной высоты. */
  const bodyAt = (x: number, y: number, z: number, height: number) => {
    const half = BODY_WIDTH / 2
    probe.current.min.set(x - half, y + SKIN, z - half)
    probe.current.max.set(x + half, y + height - SKIN, z + half)
    return probe.current
  }

  const forward = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const step = useRef(new THREE.Vector3())
  const origin = useRef(new THREE.Vector3())
  const back = useRef(new THREE.Vector3())

  /** Позиция на прошлом кадре — из неё считаются скорость и разворот фигуры. */
  const previous = useRef(new THREE.Vector3())
  const yaw = useRef(0)

  const bounds = useMemo(
    () => boundsProp ?? new THREE.Box3().setFromObject(scene),
    [boundsProp, scene],
  )

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
    // При открытом меню клавиши перемещения и прыжка не читаем: это физические
    // коды клавиш (event.code), и набор русского имени расстановки в поле
    // ввода нажимает ровно WASD, пробел и другие игровые клавиши.
    const boost = active && (keys.has('ShiftLeft') || keys.has('ShiftRight'))

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
        // Нижнего предела здесь быть не должно: он перебивал найденное
        // расстояние до стены и загонял камеру внутрь неё. Прижались спиной —
        // камера подъезжает вплотную к затылку, это правильное поведение, а не
        // повод её отпустить.
        if (hit !== null) distance = Math.max(0, hit - CAMERA_MARGIN)
        camera.position.addScaledVector(back.current, distance)
      }

      if (state) {
        state.current ??= {
          position: new THREE.Vector3(),
          grounded: false,
          yaw: 0,
          speed: 0,
          crouching: false,
        }
        state.current.position.copy(feet.current)
        state.current.grounded = isFlying ? false : grounded.current
        state.current.yaw = yaw.current
        state.current.speed = speed
        state.current.crouching = bodyHeight.current !== BODY_STAND
      }
    }

    if (flying) {
      // Полёт сквозь геометрию: ни гравитации, ни упоров, ни деревьев
      // столкновений — они тут не нужны и только тратили бы время на построение.
      camera.getWorldDirection(forward.current)
      right.current.crossVectors(forward.current, camera.up).normalize()

      step.current.set(0, 0, 0)
      if (active) {
        if (keys.has('KeyW') || keys.has('ArrowUp')) step.current.add(forward.current)
        if (keys.has('KeyS') || keys.has('ArrowDown')) step.current.sub(forward.current)
        if (keys.has('KeyD') || keys.has('ArrowRight')) step.current.add(right.current)
        if (keys.has('KeyA') || keys.has('ArrowLeft')) step.current.sub(right.current)
        if (keys.has('Space')) step.current.y += 1
        if (keys.has('KeyC') || keys.has('ControlLeft')) step.current.y -= 1
      }

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

    /**
     * Двигает по одной оси. Свободно — едем целиком; упёрлись — пробуем
     * переступить на блок вверх; не вышло — подъезжаем к стене вплотную
     * половинным делением.
     *
     * Раньше при любом попадании луча шаг по оси отменялся целиком, и игрок
     * замирал в полуметре от стены. Подъезд вплотную и есть то самое
     * скольжение вдоль стены: осевое разделение уже было, не хватало
     * остановки в точке касания.
     */
    const moveAxis = (amount: number, axis: 'x' | 'z') => {
      if (amount === 0) return
      const from = axis === 'x' ? feet.current.x : feet.current.z

      const freeAt = (value: number, y: number) => {
        const x = axis === 'x' ? value : feet.current.x
        const z = axis === 'z' ? value : feet.current.z
        return !collider.boxBlocked(bodyAt(x, y, z, bodyHeight.current))
      }
      const place = (value: number) => {
        if (axis === 'x') feet.current.x = value
        else feet.current.z = value
      }

      if (freeAt(from + amount, feet.current.y)) {
        place(from + amount)
        return
      }

      // Тело уже пересекается с геометрией — значит выбраться нечем: половинное
      // деление ниже начинается с нуля и при таком раскладе оставляет игрока на
      // месте по обеим осям, а прыжок с ростом в два блока не поднимает выше
      // стены. Остался бы только свободный полёт. Попасть сюда проще всего,
      // сойдя пешком с края уступа: пока тело падает первые два сантиметра,
      // шагом успеваешь отойти меньше, чем на полширины, и коробка защемляется
      // о стену, вдоль которой падаешь. Пропускаем шаг целиком: дать выйти
      // важнее, чем не пустить сквозь стену. Само движение в это состояние не
      // заводит — деление всегда оставляет игрока там, где коробка свободна.
      if (collider.boxBlocked(bodyAt(feet.current.x, feet.current.y, feet.current.z, bodyHeight.current))) {
        place(from + amount)
        return
      }

      // ступенька в блок: то же движение, но телом, поднятым на STEP_UP.
      // Высоту подхватит проверка опоры ниже по кадру — если ступеньки там на
      // самом деле нет, игрок просто упадёт обратно.
      if (grounded.current && freeAt(from + amount, feet.current.y + STEP_UP)) {
        place(from + amount)
        feet.current.y += STEP_UP
        // Опора снимается сразу: moveAxis вызывается дважды за кадр, по оси на
        // вызов, и без этого во внутреннем углу второй вызов переступил бы ещё
        // раз — игрок влезал бы по диагонали на стену в два блока.
        grounded.current = false
        return
      }

      // подъезд вплотную: пять делений дают точность около двух сантиметров
      // при самом быстром беге
      let free = 0
      let blocked = amount
      for (let i = 0; i < 5; i++) {
        const middle = (free + blocked) / 2
        if (freeAt(from + middle, feet.current.y)) free = middle
        else blocked = middle
      }
      place(from + free)
    }

    // направление по взгляду, но строго горизонтально
    camera.getWorldDirection(forward.current)
    forward.current.y = 0
    if (forward.current.lengthSq() < 1e-6) forward.current.set(0, 0, -1)
    forward.current.normalize()
    right.current.crossVectors(forward.current, camera.up).normalize()

    step.current.set(0, 0, 0)
    if (active) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) step.current.add(forward.current)
      if (keys.has('KeyS') || keys.has('ArrowDown')) step.current.sub(forward.current)
      if (keys.has('KeyD') || keys.has('ArrowRight')) step.current.add(right.current)
      if (keys.has('KeyA') || keys.has('ArrowLeft')) step.current.sub(right.current)
    }

    if (step.current.lengthSq() > 0) {
      step.current.normalize().multiplyScalar((boost ? RUN_SPEED : WALK_SPEED) * delta)
      moveAxis(step.current.x, 'x')
      moveAxis(step.current.z, 'z')
    }

    // вертикаль: прыжок — тоже ввод, гасим его вместе с шагом, а не саму
    // гравитацию ниже — иначе персонаж повис бы в воздухе при открытом меню
    if (active && grounded.current && (keys.has('Space') || keys.has('KeyE'))) {
      velocityY.current = JUMP_SPEED
      grounded.current = false
    }
    beforeGravity.current = feet.current.y
    velocityY.current -= GRAVITY * delta
    feet.current.y += velocityY.current * delta

    // упёрлись макушкой в потолок — гасим подъём, иначе персонаж въезжает
    // головой в блок над собой и зависает в нём
    if (velocityY.current > 0) {
      origin.current.copy(feet.current).setY(feet.current.y + bodyHeight.current - 0.1)
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
      // Опоры нет — но со стримингом это не всегда «пропасть», это может быть
      // и «кусок ещё не приехал». Раньше здесь отличали по высоте, но высота —
      // лишь косвенный признак: игрок, только что остановивший полёт над
      // настоящей открытой картой, тоже оказывается выше нижней границы карты
      // дальше, чем видит луч, и завис бы навсегда. Спрашиваем у коллайдера
      // напрямую, есть ли под ногами вообще какой-то кусок — это он знает
      // точно, а высота — нет.
      //
      // Пустой bounds (сцена ещё пуста, границы карты из манифеста не пришли)
      // — особый случай: не «пола нет», а «мы вообще ничего не знаем о карте».
      // Box3.setFromObject пустой сцены даёт min.y = +Infinity, и обе проверки
      // ниже на такой границе давали бы бессмысленный результат каждый кадр,
      // поэтому целиком их пропускаем, пока настоящие границы не пришли.
      if (!bounds.isEmpty()) {
        // Кусок под ногами есть, а опоры нет — значит внутри самой карты
        // настоящая открытая пустота, и падаем, как до этой задачи. Кусок
        // отсутствует, но и в нарезке его нет — там пола не будет никогда,
        // это не «не прилетело», а «здесь и нет ничего»: тоже падаем и
        // полагаемся на страховку ниже, а не замираем без единого способа из
        // этого выйти. Замираем только если клетка в нарезке есть, а кусок
        // правда ещё не прилетел.
        //
        // Спрашиваем именно нарезку, а не прямоугольник границ: сетка
        // разрежённая, и внутри границ полно клеток, которых не существует.
        // По прямоугольнику игрок замирал бы в воздухе над каждой такой
        // дыркой — навсегда, потому что высота при заморозке не падает и
        // страховка возврата на точку появления не срабатывает.
        const expected = hasChunkAt
          ? hasChunkAt(feet.current.x, feet.current.z)
          : feet.current.x >= bounds.min.x &&
            feet.current.x <= bounds.max.x &&
            feet.current.z >= bounds.min.z &&
            feet.current.z <= bounds.max.z

        if (expected && !collider.coversColumn(feet.current.x, feet.current.z)) {
          feet.current.y = beforeGravity.current
          velocityY.current = 0
        }
      }
    }

    // провалился мимо карты — возвращаем на точку появления, иначе падение
    // бесконечно и выбраться из него нечем. Пустой bounds пропускаем по той же
    // причине, что и выше: иначе min.y = +Infinity делает условие истинным
    // каждый кадр ещё до того, как границы карты вообще стали известны.
    if (!bounds.isEmpty() && feet.current.y < bounds.min.y - 30) placeAtSpawn()

    finish(false)
  })

  return null
}
