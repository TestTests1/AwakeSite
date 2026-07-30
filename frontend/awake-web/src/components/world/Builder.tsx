import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { TerrainCollider } from '@/lib/collision'
import {
  PROP_KINDS,
  propKind,
  rotatedHalfExtents,
  type PlacedProp,
  type PropKind,
} from '@/lib/props'
import { usePropColliders, usePropModels } from './usePropModels'

/** Дальше этого ставить нельзя: прицел уже не показывает, куда попадёт. */
const REACH = 14
/** Шаг сетки — половина блока, чтобы заграждения вставали вплотную. */
const GRID = 0.5
const ROTATION_STEP = Math.PI / 8

const DOWN = new THREE.Vector3(0, -1, 0)

export interface BuilderProps {
  scene: THREE.Group
  placed: PlacedProp[]
  kindIndex: number
  onPlace: (prop: PlacedProp) => void
  onRemove: (id: string) => void
  onRotate: (delta: number) => void
  rotation: number
}

const snap = (value: number) => Math.round(value / GRID) * GRID

/** Насколько рельеф может выпирать внутрь заграждения, прежде чем считать место занятым. */
const TERRAIN_TOLERANCE = 0.35

/** Пересекаются ли два заграждения. Сравниваются описанные коробки. */
function overlaps(
  kind: PropKind,
  position: THREE.Vector3,
  rotation: number,
  other: PlacedProp,
): boolean {
  const otherKind = propKind(other.kind)
  if (!otherKind) return false

  const [ax, az] = rotatedHalfExtents(kind, rotation)
  const [bx, bz] = rotatedHalfExtents(otherKind, other.rotation)

  if (Math.abs(position.x - other.position[0]) >= ax + bx) return false
  if (Math.abs(position.z - other.position[2]) >= az + bz) return false
  // по высоте коробки идут от земли вверх
  if (position.y >= other.position[1] + otherKind.size[1]) return false
  if (other.position[1] >= position.y + kind.size[1]) return false
  return true
}

/**
 * Влезает ли заграждение сюда: не в рельеф и не в чужое заграждение.
 *
 * Рельеф проверяем лучами вниз по углам и центру основания. Если под каким-то
 * углом земля заметно выше основания, заграждение наполовину ушло бы в склон —
 * ровно то, что просили не допускать. Если земли под углом нет вовсе, оно
 * висело бы краем в воздухе, это тоже отказ.
 */
function fits(
  collider: TerrainCollider,
  kind: PropKind,
  position: THREE.Vector3,
  rotation: number,
  placed: PlacedProp[],
): boolean {
  for (const other of placed) {
    if (overlaps(kind, position, rotation, other)) return false
  }

  const [hx, hz] = rotatedHalfExtents(kind, rotation)
  const probe = new THREE.Vector3()
  const reach = kind.size[1] + 4

  for (const [dx, dz] of [[0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]] as const) {
    // отступаем внутрь: ровно по углу луч цепляет соседний склон
    probe.set(position.x + dx * 0.9, position.y + kind.size[1], position.z + dz * 0.9)
    const distance = collider.cast(probe, DOWN, reach)
    if (distance === null) return false

    const ground = probe.y - distance
    if (ground > position.y + TERRAIN_TOLERANCE) return false
    if (ground < position.y - kind.size[1]) return false
  }

  return true
}


/**
 * Поставленные заграждения. Отдельно от Builder, потому что видеть их надо
 * всегда, а не только пока включён режим строительства.
 */
export function PlacedProps({ placed }: { placed: PlacedProp[] }) {
  const models = usePropModels()
  return (
    <>
      {placed.map((prop) => {
        const source = models.get(prop.kind)
        return source ? <PlacedModel key={prop.id} source={source} prop={prop} /> : null
      })}
    </>
  )
}

/**
 * Режим строительства: ставит заграждения по прицелу и показывает призрак
 * будущей постановки.
 *
 * Луч идёт от камеры вперёд по тому же коллайдеру, что и у персонажа — деревья
 * столкновений уже построены вокруг игрока, так что отдельной подготовки не
 * нужно. Место посадки досчитывается лучом вниз: так заграждение встаёт на
 * землю, а не висит там, куда пришёлся взгляд.
 */
export function Builder({
  scene,
  placed,
  kindIndex,
  onPlace,
  onRemove,
  onRotate,
  rotation,
}: BuilderProps) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const collider = useMemo(() => new TerrainCollider(scene), [scene])

  const models = usePropModels()
  // прицел должен упираться в уже поставленное, а не смотреть сквозь него
  const propColliders = usePropColliders(placed, models)
  useEffect(() => {
    collider.setDynamic(propColliders)
  }, [collider, propColliders])

  const ghost = useRef<THREE.Group>(null)
  const aim = useRef<THREE.Vector3 | null>(null)
  const blocked = useRef(false)
  const direction = useRef(new THREE.Vector3())
  const probe = useRef(new THREE.Vector3())

  const kind = PROP_KINDS[kindIndex]

  useFrame(() => {
    camera.getWorldDirection(direction.current)
    const distance = collider.cast(camera.position, direction.current, REACH)
    if (distance === null) {
      aim.current = null
      if (ghost.current) ghost.current.visible = false
      return
    }

    const x = snap(camera.position.x + direction.current.x * distance)
    const z = snap(camera.position.z + direction.current.z * distance)
    const hitY = camera.position.y + direction.current.y * distance

    // земля точно под выбранной клеткой, а не в точке попадания луча
    probe.current.set(x, hitY + 2, z)
    const toGround = collider.cast(probe.current, DOWN, 6)
    const y = toGround === null ? hitY : probe.current.y - toGround

    aim.current = new THREE.Vector3(x, y, z)
    blocked.current = !fits(collider, kind, aim.current, rotation, placed)

    if (ghost.current) {
      ghost.current.visible = true
      ghost.current.position.copy(aim.current)
      ghost.current.rotation.y = rotation
      ghost.current.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const material = object.material as THREE.MeshLambertMaterial
          material.color.setHex(blocked.current ? 0xd94b4b : kind.color)
        }
      })
    }
  })

  const place = useCallback(() => {
    if (!aim.current || blocked.current) return
    onPlace({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind: kind.id,
      position: [aim.current.x, aim.current.y, aim.current.z],
      rotation,
    })
  }, [kind.id, onPlace, rotation])

  const removeNearest = useCallback(() => {
    if (!aim.current) return
    let bestId: string | null = null
    let bestDistance = 3
    for (const prop of placed) {
      const distance = aim.current.distanceTo(
        new THREE.Vector3(prop.position[0], prop.position[1], prop.position[2]),
      )
      if (distance < bestDistance) {
        bestDistance = distance
        bestId = prop.id
      }
    }
    if (bestId) onRemove(bestId)
  }, [placed, onRemove])

  useEffect(() => {
    const element = gl.domElement

    function onMouseDown(event: MouseEvent) {
      if (event.button === 0) place()
      if (event.button === 2) removeNearest()
    }
    function onKey(event: KeyboardEvent) {
      if (event.repeat) return
      if (event.code === 'KeyR') onRotate(event.shiftKey ? -ROTATION_STEP : ROTATION_STEP)
    }
    // правая кнопка под захватом курсора всё равно шлёт contextmenu
    function onContextMenu(event: Event) {
      event.preventDefault()
    }

    element.addEventListener('mousedown', onMouseDown)
    element.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKey)
    return () => {
      element.removeEventListener('mousedown', onMouseDown)
      element.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKey)
    }
  }, [gl, place, removeNearest, onRotate])

  const ghostModel = useMemo(() => {
    const source = models.get(kind.id)
    if (!source) return null
    const copy = source.clone(true)
    copy.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const material = (object.material as THREE.MeshLambertMaterial).clone()
      material.transparent = true
      material.opacity = 0.45
      material.depthWrite = false
      object.material = material
    })
    return copy
  }, [models, kind.id])

  return ghostModel ? (
    <group ref={ghost}>
      <primitive object={ghostModel} />
    </group>
  ) : null
}

/** Каждая поставленная штука — своя копия модели: их десятки, не тысячи. */
function PlacedModel({ source, prop }: { source: THREE.Group; prop: PlacedProp }) {
  const model = useMemo(() => source.clone(true), [source])
  return (
    <primitive
      object={model}
      position={prop.position}
      rotation={[0, prop.rotation, 0]}
    />
  )
}
