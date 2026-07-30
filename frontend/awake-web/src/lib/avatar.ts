import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { optimizeMaterials } from './optimizeMaterials'
import { assetUrl } from './assets'

/**
 * Модель игрока.
 *
 * Сама модель вынута из ассетов ULTRAKILL, цикл бега сделан ключами по её
 * штатному скелету — скрипт лежит в tools/avatar/make_run.py и повторяет сборку
 * с нуля. В glb приходит скиннинг на 72 сустава, три примитива и одна анимация
 * длиной 0.833 с (два шага).
 */

/** Рост модели в её собственных единицах. */
const MODEL_HEIGHT = 4

/** Персонаж ростом в два блока, как и капсула, которой он управляет. */
export const AVATAR_SCALE = 2 / MODEL_HEIGHT

/**
 * Модель развёрнута лицом в +Z: в экспортированном glb носок стопы стоит на
 * z = +0.107, пятка на z = -0.250. У three.js «вперёд» это -Z, поэтому угол
 * поворота считается через atan2(x, z), а не через lookAt.
 */
export function facingAngle(dirX: number, dirZ: number): number {
  return Math.atan2(dirX, dirZ)
}

/** Длина цикла бега в секундах — по ней подбирается темп проигрывания. */
export const RUN_CLIP_SECONDS = 0.833

/**
 * Скорость, на которой цикл бега выглядит естественно. Ниже — замедляем
 * проигрывание, выше — ускоряем, чтобы стопы не разъезжались с землёй.
 */
export const RUN_REFERENCE_SPEED = 9

export interface AvatarSource {
  scene: THREE.Group
  clips: THREE.AnimationClip[]
}

const loader = new GLTFLoader()
let request: Promise<AvatarSource> | null = null

export function loadAvatar(): Promise<AvatarSource> {
  request ??= loader.loadAsync(assetUrl('/avatars/v1.glb')).then((gltf) => {
    // У двух материалов модели metallicFactor не задан, а по спецификации glTF
    // это единица. Полностью металлическая поверхность без карты окружения под
    // обычными источниками света выглядит почти чёрной — и персонаж выходил
    // силуэтом. Тот же перевод в рассеянное освещение, что и у карты, заодно
    // делает материалы дешевле.
    optimizeMaterials(gltf.scene)
    return { scene: gltf.scene, clips: gltf.animations }
  })
  return request
}

/**
 * Копия модели для одного игрока.
 *
 * Обычный Object3D.clone для скиннинга не годится: он копирует меши, но
 * оставляет их привязанными к костям оригинала, и все копии двигаются как
 * первая. SkeletonUtils.clone дублирует скелет и перепривязывает меши к нему.
 */
export function instantiateAvatar(source: AvatarSource): THREE.Group {
  const model = cloneSkinned(source.scene) as THREE.Group
  model.scale.setScalar(AVATAR_SCALE)
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) {
      // Границы считаются по позе покоя, а в беге конечности выходят за них —
      // без этого аватар мигает, когда его «отбраковывает» отсечение по камере.
      object.frustumCulled = false
    }
  })
  return model
}
