/**
 * The hand-drawn look, as data: which objects can have it (`Item.sketch`), and the flowchart an
 * object belongs to (to sketch a whole flowchart in Excalidraw, or switch it all at once).
 */

import { getItem } from './board'
import type { Board, Id, Item, Kind } from './types'

/** Objects drawn by hand when marked: shapes and flowcharts get wobbly outlines, anything with words a handwriting face. */
export const SKETCH_KINDS: ReadonlySet<Kind> = new Set<Kind>(['rect', 'ellipse', 'flow', 'sticky', 'text', 'frame', 'mind', 'comment'])

export const canSketch = (kind: Kind) => SKETCH_KINDS.has(kind)

/** Draws these objects by hand (or not); the ones that can't be are left as they are. */
export function setSketch(b: Board, ids: Iterable<Id>, on: boolean): Board {
  const want = new Set(ids)
  let changed = false
  const items = b.items.map((i): Item => {
    if (!want.has(i.id) || !canSketch(i.kind) || !!i.sketch === on) return i
    changed = true
    if (on) return { ...i, sketch: true }
    const next = { ...i }
    delete next.sketch
    return next
  })
  return changed ? { ...b, items } : b
}

/** Every flowchart shape joined to `id` by lines (its whole flowchart), or nothing when it isn't one. */
export function flowComponent(b: Board, id: Id): Set<Id> {
  const start = getItem(b, id)
  const out = new Set<Id>()
  if (start?.kind !== 'flow') return out
  const flow = new Set(b.items.filter((i) => i.kind === 'flow').map((i) => i.id))
  const next = new Map<Id, Id[]>()
  for (const c of b.connectors) {
    if (!flow.has(c.from) || !flow.has(c.to)) continue
    next.set(c.from, [...(next.get(c.from) ?? []), c.to])
    next.set(c.to, [...(next.get(c.to) ?? []), c.from])
  }
  const todo = [id]
  while (todo.length) {
    const at = todo.pop()!
    if (out.has(at)) continue
    out.add(at)
    todo.push(...(next.get(at) ?? []))
  }
  return out
}
