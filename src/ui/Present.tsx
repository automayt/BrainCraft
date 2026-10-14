/** Presentation mode: the layer over the board, the controls and the laser pointer. */

import { useEffect, useRef, useState } from 'react'
import { useEditor } from './useEditor'

const IDLE_MS = 2200
const TRAIL_MS = 650

interface Dot {
  x: number
  y: number
  t: number
}

/** A red dot that follows the pointer, leaving a short fading trail. */
function Laser({ trail, at }: { trail: Dot[]; at: Dot | null }) {
  const now = performance.now()
  return (
    <svg className="laser" aria-hidden="true">
      {trail.slice(1).map((d, k) => {
        const prev = trail[k]
        const life = 1 - (now - d.t) / TRAIL_MS
        if (life <= 0) return null
        return <line key={k} x1={prev.x} y1={prev.y} x2={d.x} y2={d.y} strokeWidth={2 + 6 * life} opacity={life * 0.8} />
      })}
      {at && <circle cx={at.x} cy={at.y} r={7} />}
    </svg>
  )
}

export function Presenter() {
  const editor = useEditor()
  const p = editor.presenting
  const [idle, setIdle] = useState(false)
  const [, setFrame] = useState(0)
  const trail = useRef<Dot[]>([])
  const at = useRef<Dot | null>(null)
  const idleTimer = useRef<number | undefined>(undefined)
  const raf = useRef(0)

  // Hide the controls when the pointer rests.
  const wake = () => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS)
  }
  useEffect(() => {
    if (!p) return
    wake()
    return () => clearTimeout(idleTimer.current)
    // Only when presenting starts or stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!p])

  // Keep drawing while the laser trail fades.
  const animate = () => {
    cancelAnimationFrame(raf.current)
    const tick = () => {
      const now = performance.now()
      trail.current = trail.current.filter((d) => now - d.t < TRAIL_MS)
      setFrame((f) => f + 1)
      if (trail.current.length) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  if (!p) return null
  const slide = p.slides[p.index]
  const total = p.slides.length
  const local = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }
  }

  return (
    <div className={`presenter${idle ? ' idle' : ''}${p.laser ? ' laser-on' : ''}`}>
      <div
        className="present-layer"
        onPointerMove={(e) => {
          wake()
          if (!p.laser) return
          const d = local(e)
          at.current = d
          trail.current.push(d)
          animate()
        }}
        onPointerLeave={() => {
          at.current = null
          setFrame((f) => f + 1)
        }}
        onPointerDown={(e) => {
          wake()
          // Click to advance, like a slide deck; the laser is for pointing, so it doesn't advance.
          if (p.laser || e.button !== 0) return
          if (e.shiftKey) editor.goToSlide(p.index - 1)
          else editor.goToSlide(p.overview ? p.index : p.index + 1)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          editor.goToSlide(p.index - 1)
        }}
        onWheel={(e) => e.preventDefault()}
      >
        {p.laser && <Laser trail={trail.current} at={at.current} />}
      </div>

      {p.notes && (
        <aside className="present-notes island" aria-label="Speaker notes">
          <strong>{slide?.title}</strong>
          {slide?.notes.length ? (
            slide.notes.map((n, k) => <p key={k}>{n}</p>)
          ) : (
            <p className="muted">No notes. Comments on this frame show up here.</p>
          )}
        </aside>
      )}

      <nav className="present-bar island" aria-label="Presentation controls" onPointerMove={wake}>
        <button className="icon-btn" aria-label="Previous slide" disabled={p.index === 0 && !p.overview} onClick={() => editor.goToSlide(p.index - 1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="present-count" aria-live="polite">
          <strong>{p.overview ? 'Overview' : `${p.index + 1} / ${total}`}</strong>
          {!p.overview && slide && <span className="present-title">{slide.title}</span>}
        </span>
        <button className="icon-btn" aria-label="Next slide" disabled={p.index === total - 1 && !p.overview} onClick={() => editor.goToSlide(p.overview ? p.index : p.index + 1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <span className="divider" />
        <button className={`text-btn${p.laser ? ' on' : ''}`} aria-pressed={p.laser} onClick={() => editor.togglePresenting('laser')}>
          Laser <kbd>L</kbd>
        </button>
        <button className={`text-btn${p.notes ? ' on' : ''}`} aria-pressed={p.notes} onClick={() => editor.togglePresenting('notes')}>
          Notes <kbd>N</kbd>
        </button>
        <button className={`text-btn${p.overview ? ' on' : ''}`} aria-pressed={p.overview} onClick={() => editor.togglePresenting('overview')}>
          Overview <kbd>O</kbd>
        </button>
        <span className="divider" />
        <button className="text-btn" onClick={() => editor.stopPresenting()}>
          Exit <kbd>Esc</kbd>
        </button>
      </nav>
      <div className="present-progress" aria-hidden="true">
        <i style={{ width: `${((p.index + 1) / total) * 100}%` }} />
      </div>
    </div>
  )
}
