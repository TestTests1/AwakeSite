import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

const SENSITIVITY = 0.002
/**
 * Порог на один скачок мыши. Браузер под захватом курсора изредка выдаёт
 * движение в сотни пикселей за одно событие — при переключении окон, на
 * границе экрана, после повторного захвата. Рукой так не двинешь, а персонажа
 * такое событие разворачивает рывком, поэтому подобные выбросы отбрасываем.
 */
const SPIKE = 180
const PITCH_LIMIT = Math.PI / 2 - 0.01

/**
 * Обзор мышью с захватом курсора.
 *
 * Своя реализация вместо PointerLockControls из drei по двум причинам: там
 * эффект подписки зависит от переданных колбэков и переподключается на каждой
 * их новой ссылке, и там нет отсечения скачков.
 */
export function usePointerLook(enabled: boolean) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    if (!enabled) return
    const element = gl.domElement
    const euler = new THREE.Euler(0, 0, 0, 'YXZ')
    euler.setFromQuaternion(camera.quaternion)

    function lock() {
      // до Chrome 113 метод ничего не возвращал, поэтому не цепляемся к промису
      try {
        void Promise.resolve(element.requestPointerLock()).catch(() => {})
      } catch {
        // захват может не выдаться без явного жеста — тогда сработает клик ниже
      }
    }

    function onMouseMove(event: MouseEvent) {
      if (document.pointerLockElement !== element) return
      if (Math.abs(event.movementX) > SPIKE || Math.abs(event.movementY) > SPIKE) return

      euler.y -= event.movementX * SENSITIVITY
      euler.x -= event.movementY * SENSITIVITY
      euler.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, euler.x))
      camera.quaternion.setFromEuler(euler)
    }

    // Потеря захвата НЕ выходит из режима ходьбы: браузер снимает его от чего
    // угодно — переключения окна, всплывающего запроса, собственных причуд, — и
    // раньше персонаж от этого просто выбрасывало обратно к орбитальной камере.
    // Курсор возвращается кликом по холсту, выход из режима — только по Esc.
    lock()
    element.addEventListener('click', lock)
    document.addEventListener('mousemove', onMouseMove)

    return () => {
      element.removeEventListener('click', lock)
      document.removeEventListener('mousemove', onMouseMove)
      if (document.pointerLockElement === element) document.exitPointerLock()
    }
  }, [enabled, camera, gl])
}
