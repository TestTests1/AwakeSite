import { useEffect, useRef } from 'react'

/**
 * Набор зажатых клавиш в ref, а не в state: опрашивается каждый кадр из
 * useFrame, и перерисовка React на каждое нажатие тут только мешала бы.
 */
export function useKeyboard() {
  const keys = useRef(new Set<string>())

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      keys.current.add(e.code)
    }
    function onKeyUp(e: KeyboardEvent) {
      keys.current.delete(e.code)
    }
    // Потеря фокуса не шлёт keyup — без этого клавиша "залипает" и персонаж
    // продолжает идти после переключения вкладки
    function onBlur() {
      keys.current.clear()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return keys.current
}
