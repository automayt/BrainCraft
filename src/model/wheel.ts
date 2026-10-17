/**
 * Spinner wheels: a card whose lines are the options. A spin is saved on the
 * card (when it started, where it lands), so everyone watching sees the same
 * wheel slow down on the same answer, and late arrivals see where it stopped.
 */

import { addItem, getItem, newItem, updateItem } from './board'
import { rectFromCenter, type Vec } from './geom'
import { FILLS, type Board, type Id, type Item } from './types'

/** How long a spin takes. */
export const SPIN_MS = 4200
export const MAX_OPTIONS = 24

export interface Spin {
  /** When it started (the spinner's clock). */
  at: number
  /** Wheel angle in degrees before and after the spin. */
  from: number
  to: number
  /** The option it lands on, and its words (the options may change later). */
  result: number
  label?: string
}

/** The wheel's options: the card's non-empty lines. */
export function wheelOptions(i: Item): string[] {
  return i.text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
    .slice(0, MAX_OPTIONS)
}

/** A new wheel card centred on `at`, with these options (or numbered placeholders). */
export function newWheel(b: Board, at: Vec, options: string[] = []): [Board, Id] {
  const lines = options.map((o) => o.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_OPTIONS)
  return addItem(
    b,
    newItem('comment', rectFromCenter(at, 320, 400), {
      text: (lines.length >= 2 ? lines : ['Option 1', 'Option 2', 'Option 3', 'Option 4']).join('\n'),
      color: '#ffe3b3',
      wheel: {},
      fontSize: 15,
      createdAt: Date.now(),
    }),
  )
}

/** Spins the wheel: picks an answer and saves where the wheel will stop. */
export function spinWheel(b: Board, id: Id, now = Date.now(), random = Math.random): Board {
  const i = getItem(b, id)
  if (!i?.wheel) return b
  const n = wheelOptions(i).length
  if (n < 2) return b
  const result = Math.floor(random() * n)
  const seg = 360 / n
  const from = i.wheel.spin?.to ?? 0
  // The pointer is at the top; land somewhere inside the chosen slice, not always its middle.
  const within = (0.15 + random() * 0.7) * seg
  const target = 360 - (result * seg + within)
  const turns = 5 + Math.floor(random() * 3)
  const to = from - (from % 360) + turns * 360 + target
  const label = wheelOptions(i)[result]
  return updateItem(b, id, (x) => ({ ...x, wheel: { ...x.wheel, spin: { at: now, from, to, result, label } } }))
}

const easeOut = (t: number) => 1 - (1 - t) ** 4

const seen = new Map<string, number>()

/**
 * When this browser counts a spin as starting: when it first saw a recent one
 * (so everyone watches the whole spin, whatever their clock says), or the
 * spin's own time for an old one (shown already stopped).
 */
export function spinStart(spin: Spin, now = Date.now()): number {
  const key = `${spin.at}:${spin.to}`
  let t = seen.get(key)
  if (t === undefined) {
    t = Math.abs(now - spin.at) < 30_000 ? Math.min(now, Math.max(spin.at, now - 250)) : spin.at
    if (seen.size > 200) seen.clear()
    seen.set(key, t)
  }
  return t
}

/** Where the wheel points at time `now`, and whether it has stopped. */
export function wheelAngle(spin: Spin | undefined, now = Date.now(), start = spin?.at ?? 0): { angle: number; done: boolean } {
  if (!spin) return { angle: 0, done: true }
  const t = Math.min(1, Math.max(0, (now - start) / SPIN_MS))
  return { angle: spin.from + (spin.to - spin.from) * easeOut(t), done: t >= 1 }
}

/** The colour of slice `k` of `n` (neighbours never match, nor do the first and last). */
export function sliceColor(k: number, n: number): string {
  const palette = FILLS.filter(([name]) => name !== 'White' && name !== 'Gray').map(([, hex]) => hex)
  const c = k % palette.length
  return k === n - 1 && c === 0 && n > 1 ? palette[(c + 1) % palette.length] : palette[c]
}
