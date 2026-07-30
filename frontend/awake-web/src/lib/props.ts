import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Заграждения из клановых турниров.
 *
 * Модели вынуты из игровых ассетов
 * (modassets/assets/customitems/models/blocks/...), названия сверены со
 * строками go.clan.tournament_* из ru.lang игры. Габариты подтверждают
 * соответствие: листовая баррикада около двух блоков в высоту, военная — почти
 * вдвое шире, габион почти кубический.
 *
 * Текстуры в игре лежат отдельными файлами формата .ol и в модели не входят,
 * поэтому пока заливка цветом — для расстановки важна форма и размер.
 */
export interface PropKind {
  id: string
  label: string
  file: string
  color: number
  /** Габариты модели в блоках — по ним считаются столкновения при постановке. */
  size: [number, number, number]
}

export const PROP_KINDS: PropKind[] = [
  { id: 'barricade', label: 'Баррикада', file: 'barrikada', color: 0x9aa0a6, size: [1.63, 1.89, 0.92] },
  { id: 'army', label: 'Военная баррикада', file: 'barikada_army', color: 0x8d9b7a, size: [3.58, 2.13, 2.28] },
  { id: 'army_window', label: 'Военная баррикада с окном', file: 'barikada_army_2', color: 0x7f8f6c, size: [3.58, 2.13, 2.36] },
  { id: 'gabion', label: 'Габион', file: 'gabionfull_1', color: 0xb0a184, size: [1.57, 1.51, 1.57] },
]

export function propKind(id: string): PropKind | undefined {
  return PROP_KINDS.find((kind) => kind.id === id)
}

/**
 * Половины габаритов после поворота вокруг вертикали. Точный повёрнутый
 * прямоугольник заменяем описанным вокруг него — заграждения ставятся с шагом
 * в полблока, и небольшой запас тут только на пользу.
 */
export function rotatedHalfExtents(kind: PropKind, rotation: number): [number, number] {
  const cos = Math.abs(Math.cos(rotation))
  const sin = Math.abs(Math.sin(rotation))
  const hx = kind.size[0] / 2
  const hz = kind.size[2] / 2
  return [hx * cos + hz * sin, hx * sin + hz * cos]
}

/** Одна поставленная штука на карте. */
export interface PlacedProp {
  id: string
  kind: string
  position: [number, number, number]
  rotation: number
}

const loader = new GLTFLoader()
const cache = new Map<string, Promise<THREE.Group>>()

export function loadProp(kind: PropKind): Promise<THREE.Group> {
  const known = cache.get(kind.id)
  if (known) return known

  const request = loader.loadAsync(`/props/${kind.file}.glb`).then((gltf) => {
    const model = gltf.scene
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      // модели идут без текстур, зато с нормалями — обычного материала хватает
      object.material = new THREE.MeshLambertMaterial({ color: kind.color })
    })
    return model
  })

  cache.set(kind.id, request)
  return request
}

/**
 * Расстановка хранится в браузере и привязана к карте. Общий для клана
 * вариант — это уже серверное хранилище, отдельная задача.
 */
export function storageKey(map: string): string {
  return `awake.world.props.${map}`
}

export function loadPlaced(map: string): PlacedProp[] {
  try {
    const raw = localStorage.getItem(storageKey(map))
    return raw ? (JSON.parse(raw) as PlacedProp[]) : []
  } catch {
    return []
  }
}

export function savePlaced(map: string, props: PlacedProp[]): void {
  try {
    localStorage.setItem(storageKey(map), JSON.stringify(props))
  } catch {
    // приватный режим браузера может запрещать запись — расстановка просто
    // не переживёт перезагрузку, ронять из-за этого сцену незачем
  }
}
