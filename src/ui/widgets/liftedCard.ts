/**
 * A card picked up off a Kanban: a copy of it that floats above the board under the pointer, held
 * where it was grabbed, a little bigger and tilting the way it's being moved, then glides into its
 * new place on release. The board is an SVG whose widgets are clipped to their boxes, so the copy
 * lives on the page itself, scaled to the board's zoom.
 */

/** Degrees of tilt for a horizontal speed in pixels per millisecond: leaning into the move, up to a point. */
export function tiltFor(speed: number): number {
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, speed * 9))
}

const MAX_TILT = 7
/** How much bigger a card is while held. */
const LIFT = 1.04
/** How long the card takes to settle into its place. */
const SETTLE_MS = 180

const still = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export interface Lifted {
  /** The pointer moved to (x, y) on screen. */
  move(x: number, y: number): void
  /** Glides into `to` (a place on screen, the card's size at this zoom), then goes; `done` runs once it has. */
  drop(to: DOMRect | null, done: () => void): void
}

/** Picks up `card`, grabbed at (x, y) on screen, on a board shown at `zoom`. */
export function lift(card: HTMLElement, x: number, y: number, zoom: number): Lifted {
  const box = card.getBoundingClientRect()
  // Where it was grabbed, in the card's own (unzoomed) pixels.
  const ox = (x - box.left) / zoom
  const oy = (y - box.top) / zoom
  const copy = card.cloneNode(true) as HTMLElement
  for (const el of copy.querySelectorAll('.card-more, .card-details')) el.remove()
  copy.removeAttribute('data-card')
  copy.removeAttribute('tabindex')
  copy.setAttribute('aria-hidden', 'true')
  copy.classList.remove('dragging')
  copy.classList.add('kanban-card-lifted')
  // The board's look, carried over (the copy isn't inside the board any more).
  const look = getComputedStyle(card)
  Object.assign(copy.style, {
    width: `${card.offsetWidth}px`,
    fontFamily: look.fontFamily,
    fontSize: look.fontSize,
    lineHeight: look.lineHeight,
    color: look.color,
    background: look.backgroundColor,
    borderColor: look.borderTopColor,
    borderLeftColor: look.borderLeftColor,
    transformOrigin: `${ox}px ${oy}px`,
  })
  document.body.append(copy)

  const calm = still()
  let px = x
  let py = y
  let tilt = 0
  let scale = zoom
  let frame = 0
  let landing = false
  // Recent pointer positions, for how fast it's moving.
  const trail: { x: number; t: number }[] = [{ x, t: performance.now() }]

  const place = () => {
    copy.style.transform = `translate(${px - ox}px, ${py - oy}px) rotate(${tilt.toFixed(2)}deg) scale(${scale})`
  }
  const tick = () => {
    const now = performance.now()
    while (trail.length > 1 && now - trail[0].t > 90) trail.shift()
    const first = trail[0]
    const last = trail[trail.length - 1]
    // Standing still, it straightens up.
    const speed = now - last.t > 60 || last.t === first.t ? 0 : (last.x - first.x) / (last.t - first.t)
    if (!calm) {
      tilt += (tiltFor(speed) - tilt) * 0.18
      scale += (zoom * LIFT - scale) * 0.3
    }
    place()
    frame = requestAnimationFrame(tick)
  }
  if (calm) scale = zoom * LIFT
  place()
  frame = requestAnimationFrame(tick)

  return {
    move(nx, ny) {
      if (landing) return
      px = nx
      py = ny
      trail.push({ x: nx, t: performance.now() })
      if (trail.length > 12) trail.shift()
    },
    drop(to, done) {
      if (landing) return
      landing = true
      cancelAnimationFrame(frame)
      const finish = () => {
        copy.remove()
        done()
      }
      if (!to || calm) return finish()
      // Its top-left onto the place's, upright and at the board's size.
      const tx = to.left - ox * (1 - zoom)
      const ty = to.top - oy * (1 - zoom)
      copy.classList.add('settling')
      copy.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow ${SETTLE_MS}ms`
      copy.style.transform = `translate(${tx}px, ${ty}px) rotate(0deg) scale(${zoom})`
      let over = false
      const end = () => {
        if (over) return
        over = true
        finish()
      }
      copy.addEventListener('transitionend', end, { once: true })
      // In case the transition never reports (a hidden tab).
      setTimeout(end, SETTLE_MS + 80)
    },
  }
}
