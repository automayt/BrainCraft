/** Flowchart building: placing symbols and growing the flow one connected step at a time. */

import { addItem, connect, getItem, hiddenIds, newItem } from './board'
import { type Rect, type Vec, expand, intersects } from './geom'
import { type Board, type FlowShape, type Id, type Item, flowShapeInfo } from './types'

export type FlowDir = 'up' | 'down' | 'left' | 'right'

const STEP: Record<FlowDir, Vec> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

/** Gap between a shape and the next step added beside it. */
export const FLOW_GAP = 70

export function flowItem(shape: FlowShape, at: Vec, size?: { w: number; h: number }): Omit<Item, 'id'> {
  const info = flowShapeInfo(shape)
  const w = size?.w ?? info.w
  const h = size?.h ?? info.h
  return newItem('flow', { x: at.x - w / 2, y: at.y - h / 2, w, h }, { shape, color: info.color })
}

/** The shape a new step after `shape` gets: branches and ends lead into ordinary steps. */
export function nextShape(shape: FlowShape | undefined): FlowShape {
  return !shape || shape === 'decision' || shape === 'terminator' ? 'process' : shape
}

/** The direction the flow runs through `id`, judged from its incoming links (default: down). */
export function flowDirection(b: Board, id: Id): FlowDir {
  const node = getItem(b, id)
  const incoming = b.connectors.filter((c) => c.to === id).map((c) => getItem(b, c.from))
  const from = incoming.find(Boolean)
  if (!node || !from) return 'down'
  const dx = node.x + node.w / 2 - (from.x + from.w / 2)
  const dy = node.y + node.h / 2 - (from.y + from.h / 2)
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'down' : 'up'
  return dx >= 0 ? 'right' : 'left'
}

/**
 * Where a new `w`×`h` step beside `from` in `dir` should go: one gap away,
 * centred on it, sliding sideways past anything already in the way.
 */
export function placeNext(b: Board, from: Item, dir: FlowDir, w: number, h: number): Rect {
  const d = STEP[dir]
  const cx = from.x + from.w / 2 + d.x * (from.w / 2 + FLOW_GAP + w / 2)
  const cy = from.y + from.h / 2 + d.y * (from.h / 2 + FLOW_GAP + h / 2)
  const hidden = hiddenIds(b)
  const obstacles = b.items.filter((i) => i.id !== from.id && i.kind !== 'frame' && !hidden.has(i.id))
  // Slide perpendicular to the flow: right of a vertical flow, below a horizontal one.
  const slide = d.x === 0 ? { x: w + 50, y: 0 } : { x: 0, y: h + 50 }
  let r: Rect = { x: cx - w / 2, y: cy - h / 2, w, h }
  for (let k = 0; k < 20 && obstacles.some((o) => intersects(expand(r, 12), o)); k++) {
    r = { ...r, x: r.x + slide.x, y: r.y + slide.y }
  }
  return r
}

/** Adds a connected next step beside `fromId`. Returns the new shape's id. */
export function addStep(b: Board, fromId: Id, dir: FlowDir, shape?: FlowShape): [Board, Id | null] {
  const from = getItem(b, fromId)
  if (!from) return [b, null]
  const s = shape ?? nextShape(from.shape)
  const info = flowShapeInfo(s)
  // Keep the size of a matching neighbour so chains of steps line up.
  const size = from.kind === 'flow' && from.shape === s ? { w: from.w, h: from.h } : { w: info.w, h: info.h }
  const r = placeNext(b, from, dir, size.w, size.h)
  let id: Id
  ;[b, id] = addItem(b, flowItem(s, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, size))
  ;[b] = connect(b, fromId, id, { style: 'elbow' })
  return [b, id]
}

/** What usually follows each symbol, most likely first. */
const USUAL_NEXT: Record<FlowShape, FlowShape[]> = {
  terminator: ['process', 'data', 'decision', 'subroutine', 'document', 'database', 'terminator'],
  process: ['process', 'decision', 'terminator', 'data', 'subroutine', 'document', 'database'],
  decision: ['process', 'decision', 'terminator', 'subroutine', 'data', 'document', 'database'],
  data: ['process', 'decision', 'database', 'document', 'terminator', 'subroutine', 'data'],
  document: ['process', 'decision', 'terminator', 'data', 'database', 'subroutine', 'document'],
  database: ['process', 'data', 'decision', 'document', 'terminator', 'subroutine', 'database'],
  subroutine: ['process', 'decision', 'terminator', 'subroutine', 'data', 'document', 'database'],
}

/**
 * Shapes to offer after `from`: those this board already uses most after the
 * same kind of shape come first, then the usual flowchart conventions.
 */
export function recommendShapes(b: Board, from: FlowShape | undefined): FlowShape[] {
  const source = from ?? 'process'
  const counts = new Map<FlowShape, number>()
  for (const c of b.connectors) {
    const a = getItem(b, c.from)
    const z = getItem(b, c.to)
    if (a?.kind === 'flow' && z?.kind === 'flow' && (a.shape ?? 'process') === source) {
      const s = z.shape ?? 'process'
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
  }
  const usual = USUAL_NEXT[source]
  return [...usual].sort((a, z) => (counts.get(z) ?? 0) - (counts.get(a) ?? 0) || usual.indexOf(a) - usual.indexOf(z))
}

/** Adds a `shape` step centred on `at`, linked from `fromId`. */
export function addStepAt(b: Board, fromId: Id, shape: FlowShape, at: Vec): [Board, Id] {
  let id: Id
  ;[b, id] = addItem(b, flowItem(shape, at))
  ;[b] = connect(b, fromId, id, { style: 'elbow' })
  return [b, id]
}

/** A free side of a flowchart shape that a shape being placed or dragged snaps to. */
export interface Magnet {
  /** The shape it snaps beside. */
  target: Id
  dir: FlowDir
  /** Where the snapping shape's centre goes. */
  at: Vec
}

/**
 * The flowchart shape a `size` shape centred near `c` should snap beside: the side whose
 * one-gap-away slot is nearest, if it's within `reach`. Shapes in `exclude` are ignored.
 */
export function findMagnet(b: Board, c: Vec, size: { w: number; h: number }, exclude: ReadonlySet<Id>, reach: number): Magnet | null {
  const hidden = hiddenIds(b)
  let best: (Magnet & { d: number }) | null = null
  for (const t of b.items) {
    if (t.kind !== 'flow' || exclude.has(t.id) || hidden.has(t.id)) continue
    for (const dir of ['right', 'down', 'left', 'up'] as FlowDir[]) {
      const s = STEP[dir]
      const at = {
        x: t.x + t.w / 2 + s.x * (t.w / 2 + FLOW_GAP + size.w / 2),
        y: t.y + t.h / 2 + s.y * (t.h / 2 + FLOW_GAP + size.h / 2),
      }
      const d = Math.hypot(at.x - c.x, at.y - c.y)
      if (d > reach || (best && d >= best.d)) continue
      // Not onto a slot something else already fills.
      const slot: Rect = { x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h }
      const taken = b.items.some((o) => o.id !== t.id && !exclude.has(o.id) && o.kind !== 'frame' && !hidden.has(o.id) && intersects(expand(slot, -4), o))
      if (!taken) best = { target: t.id, dir, at, d }
    }
  }
  return best && { target: best.target, dir: best.dir, at: best.at }
}

/** Whether a line already joins `a` and `z` (either way round). */
export const linked = (b: Board, a: Id, z: Id) => b.connectors.some((c) => (c.from === a && c.to === z) || (c.from === z && c.to === a))

/** Adds a `shape` at `at`, snapped and connected to a nearby shape when there's a magnet. */
export function dropShape(b: Board, shape: FlowShape, at: Vec, magnet: Magnet | null): [Board, Id] {
  let id: Id
  ;[b, id] = addItem(b, flowItem(shape, magnet?.at ?? at))
  if (magnet) [b] = connect(b, magnet.target, id, { style: 'elbow' })
  return [b, id]
}
