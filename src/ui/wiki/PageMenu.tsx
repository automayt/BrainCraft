import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  run: () => void
  hint?: string
  danger?: boolean
}

/** A "⋯" button with a short menu: the page actions that don't need a button of their own. */
export function PageMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false)
  /** Which way the menu opens: towards the side of the screen with room for it. */
  const [rightwards, setRightwards] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  const onKey = (e: KeyboardEvent) => {
    const all = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus()
    } else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div className={`page-menu${rightwards ? ' opens-right' : ''}`} ref={box} onKeyDown={open ? onKey : undefined}>
      <button
        ref={button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => {
          const r = button.current?.getBoundingClientRect()
          setRightwards(!!r && r.right < 240)
          setOpen(!open)
        }}
      >
        ⋯
      </button>
      {open && (
        <ul role="menu" aria-label={label}>
          {items.map((x) => (
            <li key={x.label} role="none">
              <button
                role="menuitem"
                className={x.danger ? 'danger-quiet' : ''}
                title={x.hint}
                onClick={() => {
                  setOpen(false)
                  // Focus goes back to ⋯ first, so a dialog the item opens returns it there.
                  button.current?.focus()
                  x.run()
                }}
              >
                {x.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
