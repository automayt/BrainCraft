import { useEffect, useRef } from 'react'

/**
 * Calls `onAway` when a press lands anywhere outside the open menu (`ref`): on the canvas, a
 * toolbar, another menu. It listens before anything else hears the press, so nothing that stops
 * it on the way (the canvas, the selection toolbar) keeps the menu open. A press on `keep()` (the
 * button that opened it, which closes it itself) doesn't count.
 */
export function useClickAway(ref: React.RefObject<HTMLElement | null>, onAway: () => void, keep?: () => Element | null | undefined, on = true) {
  const latest = useRef({ onAway, keep })
  latest.current = { onAway, keep }
  useEffect(() => {
    if (!on) return
    const press = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t || ref.current?.contains(t) || latest.current.keep?.()?.contains(t)) return
      latest.current.onAway()
    }
    document.addEventListener('pointerdown', press, true)
    return () => document.removeEventListener('pointerdown', press, true)
  }, [ref, on])
}
