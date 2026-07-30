import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  instantiateAvatar,
  loadAvatar,
  RUN_REFERENCE_SPEED,
  type AvatarSource,
} from '@/lib/avatar'

/** Состояние, которое аватар забирает каждый кадр. */
export interface AvatarSample {
  /** Точка под ногами: у модели начало координат в ступнях. */
  position: THREE.Vector3
  yaw: number
  /** Горизонтальная скорость в блоках в секунду — по ней выбирается клип. */
  speed: number
}

/** Модель одна на вкладку, копии делаются из неё. */
export function useAvatarSource(): AvatarSource | null {
  const [source, setSource] = useState<AvatarSource | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadAvatar().then((loaded) => {
      if (!cancelled) setSource(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return source
}

/** Ниже этой скорости считаем, что игрок стоит. */
const MOVING_SPEED = 0.4
/** На этой скорости бег отыгрывается в полную силу. */
const FULL_RUN_SPEED = 2.5
/** За сколько секунд бег переходит в покой и обратно. */
const BLEND_SECONDS = 0.18

/**
 * Видимая фигура игрока.
 *
 * Состояние берётся функцией выборки, а не пропсами: позиции приходят с сервера
 * десяток раз в секунду, и гонять на каждый пакет перерисовку React означало бы
 * перестраивать сцену вместе со всей картой. Здесь же меняются только матрицы
 * объекта, а React участвует лишь при появлении и уходе игрока.
 */
export function Avatar({
  source,
  sample,
}: {
  source: AvatarSource
  sample: (out: AvatarSample) => void
}) {
  const model = useMemo(() => instantiateAvatar(source), [source])

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model])
  const actions = useMemo(() => {
    const find = (name: string) => source.clips.find((clip) => clip.name === name)
    const run = find('run')
    const idle = find('idle')
    return {
      run: run ? mixer.clipAction(run) : null,
      idle: idle ? mixer.clipAction(idle) : null,
    }
  }, [mixer, source])

  useEffect(() => {
    actions.run?.play()
    actions.idle?.play()
    // Только остановка. uncacheRoot здесь звать нельзя: в строгом режиме React
    // монтирует компонент дважды, очистка снесла бы внутреннее состояние
    // микшера, а объекты действий пережили бы её в useMemo — и повторный play
    // упал бы на уничтоженных привязках. Микшер уходит вместе с компонентом,
    // геометрия и материалы общие с исходником и их трогать нельзя.
    return () => {
      mixer.stopAllAction()
    }
  }, [actions, mixer])

  const out = useRef<AvatarSample>({ position: new THREE.Vector3(), yaw: 0, speed: 0 })
  const runWeight = useRef(0)

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1)
    sample(out.current)

    model.position.copy(out.current.position)
    model.rotation.y = out.current.yaw

    // вес бега подтягивается плавно, иначе на старте и остановке видно рывок
    const speed = out.current.speed
    const target = speed <= MOVING_SPEED
      ? 0
      : Math.min(1, (speed - MOVING_SPEED) / (FULL_RUN_SPEED - MOVING_SPEED))
    const step = delta / BLEND_SECONDS
    runWeight.current += THREE.MathUtils.clamp(target - runWeight.current, -step, step)

    if (actions.run) {
      actions.run.setEffectiveWeight(runWeight.current)
      // темп цикла привязан к скорости: иначе стопы разъезжаются с землёй
      actions.run.timeScale = THREE.MathUtils.clamp(speed / RUN_REFERENCE_SPEED, 0.55, 2)
    }
    actions.idle?.setEffectiveWeight(1 - runWeight.current)

    mixer.update(delta)
  })

  return <primitive object={model} />
}
