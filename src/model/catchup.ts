/**
 * "Since you were here": what changed on a board between the last time this person looked at
 * it and now — new, changed and removed objects, and new comments. Layout shuffles (a mind map
 * re-flowing, tiny nudges) don't count.
 */

import { getItem } from './board'
import { objectLabel } from './notes'
import type { Board, Id, Item } from './types'

export interface CatchUp {
  /** When they last looked. */
  since: number
  added: Id[]
  changed: Id[]
  /** Removed objects, as they were. */
  removed: Item[]
  /** New comments: on which object, how many. */
  comments: { id: Id; count: number }[]
}

/** Moves smaller than this (in board units) are tidying, not news. */
const MOVE = 60

const CONTENT_SKIP = new Set(['x', 'y', 'w', 'h', 'offset', 'notes', 'by'])

function contentChanged(a: Item, z: Item): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(z)])
  for (const k of keys) {
    if (CONTENT_SKIP.has(k)) continue
    if (JSON.stringify((a as unknown as Record<string, unknown>)[k]) !== JSON.stringify((z as unknown as Record<string, unknown>)[k])) return true
  }
  return false
}

function moved(a: Item, z: Item): boolean {
  // Mind-map ideas are placed by the layout: only their content counts.
  if (a.kind === 'mind') return false
  return Math.abs(a.x - z.x) > MOVE || Math.abs(a.y - z.y) > MOVE || Math.abs(a.w - z.w) > MOVE || Math.abs(a.h - z.h) > MOVE
}

export function catchUp(before: Board, now: Board, since: number): CatchUp | null {
  if (before === now || before.items === now.items) return null
  const added: Id[] = []
  const changed: Id[] = []
  const comments: { id: Id; count: number }[] = []
  for (const z of now.items) {
    const a = getItem(before, z.id)
    if (!a) {
      added.push(z.id)
      continue
    }
    if (a === z) continue
    if (contentChanged(a, z) || moved(a, z)) changed.push(z.id)
    const seen = new Set((a.notes ?? []).map((n) => n.id))
    const fresh = (z.notes ?? []).filter((n) => !seen.has(n.id)).length
    if (fresh) comments.push({ id: z.id, count: fresh })
  }
  const ids = new Set(now.items.map((i) => i.id))
  const removed = before.items.filter((i) => !ids.has(i.id))
  if (!added.length && !changed.length && !removed.length && !comments.length) return null
  return { since, added, changed, removed, comments }
}

/**
 * Signs `me` on the objects `after` adds or really changes compared with
 * `before` (not layout shuffles or new comments, which carry their own author).
 */
export function stampAuthors(before: Board, after: Board, me: string): Board {
  if (before === after || before.items === after.items || !me) return after
  const old = new Map(before.items.map((i) => [i.id, i]))
  let touched = false
  const items = after.items.map((z) => {
    const a = old.get(z.id)
    if (a === z || z.by === me) return z
    if (a && !contentChanged(a, z) && !moved(a, z)) return z
    touched = true
    return { ...z, by: me }
  })
  return touched ? { ...after, items } : after
}

/** Who made the changes in `c` (that we know of), in order of first appearance. */
export function catchUpPeople(c: CatchUp, now: Board): string[] {
  const names = new Set<string>()
  for (const id of [...c.added, ...c.changed]) {
    const by = getItem(now, id)?.by
    if (by) names.add(by)
  }
  for (const x of c.comments) {
    const i = getItem(now, x.id)
    for (const n of (i?.notes ?? []).slice(-x.count)) if (n.author) names.add(n.author)
  }
  return [...names]
}

/** "Sam", "Sam and Alex", "Sam, Alex and 2 others". */
export function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`
}

/** "3 new, 2 changed, 1 removed, 4 comments". */
export function catchUpSummary(c: CatchUp): string {
  const n = (count: number, word: string, plural = `${word}s`) => (count ? `${count} ${count === 1 ? word : plural}` : '')
  const comments = c.comments.reduce((a, x) => a + x.count, 0)
  return [n(c.added.length, 'new', 'new'), n(c.changed.length, 'changed', 'changed'), n(c.removed.length, 'removed', 'removed'), n(comments, 'comment')].filter(Boolean).join(' · ')
}

/** A plain list for the AI assistant to summarise. */
export function catchUpText(c: CatchUp, now: Board): string {
  const label = (id: Id) => {
    const i = getItem(now, id)
    return i ? `${objectLabel(i)} (${i.kind}, #${id}${i.by ? `, by ${i.by}` : ''})` : `#${id}`
  }
  const lines: string[] = []
  if (c.added.length) lines.push(`Added: ${c.added.map(label).join('; ')}`)
  if (c.changed.length) lines.push(`Changed: ${c.changed.map(label).join('; ')}`)
  if (c.removed.length) lines.push(`Removed: ${c.removed.map((i) => `${objectLabel(i)} (${i.kind})`).join('; ')}`)
  if (c.comments.length) lines.push(`New comments on: ${c.comments.map((x) => `${label(x.id)} ×${x.count}`).join('; ')}`)
  return lines.join('\n')
}
