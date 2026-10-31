import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useEscape } from './useEscape'
import { useClickAway } from './useClickAway'

const ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)'

/** Arrow keys (and Home, End) move between a menu's items. They stop at the ends rather than wrap:
 * one press too many past the top shouldn't land on Delete. */
export function moveFocus(e: React.KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)]
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'ArrowDown' || e.key === 'ArrowRight'
  const prev = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
  const to = next ? Math.min(at + 1, items.length - 1) : prev ? Math.max(at - 1, 0) : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1
  if (to < 0 || !items.length) return
  e.preventDefault()
  e.stopPropagation()
  items[to].focus()
}

/** Set by a menu so another menu can open it (the toolbar's More menu opens Link, Assign and Time). */
export type MenuOpener = React.MutableRefObject<((el: HTMLElement, keyboard: boolean) => void) | null>

/** Puts the keyboard on a menu's first item. */
export function focusFirst(menu: HTMLElement | null) {
  menu?.querySelector<HTMLElement>(ITEMS)?.focus()
}

/**
 * A small pop-up menu under a toolbar button: opens and closes from the button, closes on Esc,
 * and when opened from the keyboard puts focus on its first item (arrows then move through it).
 */
export function useButtonMenu() {
  const [at, setAt] = useState<{ x: number; y: number; keyboard: boolean } | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const close = useCallback(() => {
    setAt((was) => {
      // Opened from the keyboard: the keyboard goes back to the button, not off to the page.
      if (was?.keyboard) queueMicrotask(() => trigger.current?.isConnected && trigger.current.focus())
      return null
    })
  }, [])
  useEscape(close, !!at)
  // A press anywhere else closes it; its own button toggles it.
  useClickAway(menu, close, () => trigger.current, !!at)
  useEffect(() => {
    if (at?.keyboard) focusFirst(menu.current)
  }, [at])
  /** Opens it under another element (a button in another menu that leads here). */
  const openFrom = useCallback((el: HTMLElement, keyboard: boolean) => {
    const r = el.getBoundingClientRect()
    trigger.current = el
    setAt({ x: r.left + r.width / 2, y: r.bottom + 8, keyboard })
  }, [])
  const toggle = (e: React.MouseEvent<HTMLElement>) => {
    // The toolbar scrolls sideways on small screens, so the menu lives outside it.
    if (at) return setAt(null)
    openFrom(e.currentTarget, e.detail === 0)
  }
  return { at, close, toggle, openFrom, menuProps: { ref: menu, onKeyDown: moveFocus } }
}
