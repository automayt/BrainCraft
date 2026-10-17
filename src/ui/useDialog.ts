/** Keyboard behaviour for modal dialogs: focus moves in, Tab stays inside, and focus returns on close. */

import { type RefObject, useEffect } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialog(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const back = document.activeElement as HTMLElement | null
    // Something inside may have focused itself (autoFocus); otherwise the first field, else the dialog.
    if (!el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select') ?? el.querySelector<HTMLElement>(FOCUSABLE)
      if (first) first.focus({ preventScroll: true })
      else {
        el.tabIndex = -1
        el.focus({ preventScroll: true })
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      // Only the dialog on top keeps the keyboard.
      const top = [...document.querySelectorAll('[aria-modal="true"]')].at(-1)
      if (top && top !== el && !el.contains(top)) return
      const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
      if (!all.length) return
      const first = all[0]
      const last = all[all.length - 1]
      // A focused button that went away (Delete → "Delete forever") leaves focus on the page: bring it back in.
      if (!el.contains(document.activeElement)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    // On the document, not the dialog: Tab from the page body (after focus fell out) must land inside too.
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (back && document.contains(back)) back.focus({ preventScroll: true })
    }
  }, [ref])
}
