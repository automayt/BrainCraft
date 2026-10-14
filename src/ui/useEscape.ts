import { useEffect, useRef } from 'react'

/**
 * Calls `onEscape` when Escape is pressed. The listener is registered once, so
 * re-renders triggered by the same key press (e.g. the board deselecting)
 * can't swap it out mid-dispatch and swallow the key.
 */
export function useEscape(onEscape: () => void, active = true) {
  const ref = useRef(onEscape)
  ref.current = onEscape
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ref.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
