/**
 * Pure operations on a {@link Board}. Every function returns a new board (or the
 * same object when nothing changed) and never mutates its input, so old boards
 * can be kept as undo snapshots.
 */

import {
  type Rect,
  type Vec,
  boundsOf,
  contains,
  containsRect,
  distToSegment,
  ellipseBorderPoint,
  ellipseContains,
  expand,
  rectBorderPoint,
  remap,
  unionAll,
} from './geom'
import { type Route, route } from './routes'
import { flowHit } from './shapes'
import {
  type Board,
  type Connector,
  type Dataset,
  type Id,
  type Item,
  type Kind,
  FORMAT_VERSION,
  INKS,
  defaultColor,
  defaultFontSize,
} from './types'

export function emptyBoard(title = 'Untitled board'): Board {
  return { version: FORMAT_VERSION, title, items: [], connectors: [], nextId: 1 }
}

export function newItem(kind: Kind, rect: Rect, extra: Partial<Item> = {}): Omit<Item, 'id'> {
  return {
    kind,
    ...rect,
    color: defaultColor(kind),
    text: '',
    fontSize: defaultFontSize(kind),
    ...extra,
  }
}

export function penItem(points: Vec[], color: string, strokeWidth: number): Omit<Item, 'id'> {
  const b = expand(boundsOf(points) ?? { x: 0, y: 0, w: 0, h: 0 }, strokeWidth / 2)
  return newItem('pen', b, { color, points, strokeWidth })
}

export function getItem(b: Board, id: Id): Item | undefined {
  return b.items.find((i) => i.id === id)
}

export function getConnector(b: Board, id: Id): Connector | undefined {
  return b.connectors.find((c) => c.id === id)
}

/** Adds an item on top of everything else. */
export function addItem(b: Board, item: Omit<Item, 'id'>): [Board, Id] {
  const id = b.nextId
  return [{ ...b, items: [...b.items, { ...item, id } as Item], nextId: id + 1 }, id]
}

/**
 * Links two distinct existing items. Returns the board unchanged (and no id) for
 * a self-loop, a missing endpoint or a duplicate.
 */
export function connect(
  b: Board,
  from: Id,
  to: Id,
  opts: Partial<Omit<Connector, 'id' | 'from' | 'to'>> = {},
): [Board, Id | null] {
  if (from === to || !getItem(b, from) || !getItem(b, to)) return [b, null]
  if (b.connectors.some((c) => c.from === from && c.to === to)) return [b, null]
  const id = b.nextId
  const c: Connector = { id, from, to, color: INKS[1][1], ...opts }
  return [{ ...b, connectors: [...b.connectors, c], nextId: id + 1 }, id]
}

/** Connector style for a new link: flowchart steps get right-angled lines. */
export function defaultStyleBetween(a: Item | undefined, z: Item | undefined): Connector['style'] {
  return a?.kind === 'flow' || z?.kind === 'flow' ? 'elbow' : undefined
}

/** Applies `f` to every item in `ids`. Returns `b` itself when nothing changed. */
export function updateItems(b: Board, ids: ReadonlySet<Id>, f: (i: Item) => Item): Board {
  let changed = false
  const items = b.items.map((i) => {
    if (!ids.has(i.id)) return i
    const next = f(i)
    if (next !== i) changed = true
    return next
  })
  return changed ? { ...b, items } : b
}

export function updateItem(b: Board, id: Id, f: (i: Item) => Item): Board {
  return updateItems(b, new Set([id]), f)
}

export function updateConnector(b: Board, id: Id, f: (c: Connector) => Connector): Board {
  return { ...b, connectors: b.connectors.map((c) => (c.id === id ? f(c) : c)) }
}

/** Removes items and connectors, plus any connector left dangling. */
export function remove(b: Board, items: ReadonlySet<Id>, connectors: ReadonlySet<Id> = new Set()): Board {
  if (items.size === 0 && connectors.size === 0) return b
  const next = {
    ...b,
    items: b.items.filter((i) => !items.has(i.id)),
    connectors: b.connectors.filter((c) => !connectors.has(c.id) && !items.has(c.from) && !items.has(c.to)),
  }
  // A dataset goes with its last view (undo brings both back).
  if (!next.datasets?.length) return next
  const used = new Set(next.items.flatMap((i) => (i.view ? [i.view.dataset] : [])))
  if (next.datasets.every((d) => used.has(d.id))) return next
  const datasets = next.datasets.filter((d) => used.has(d.id))
  if (datasets.length) return { ...next, datasets }
  delete next.datasets
  return next
}

export function translateItem(i: Item, dx: number, dy: number): Item {
  return {
    ...i,
    x: i.x + dx,
    y: i.y + dy,
    points: i.points?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  }
}

export function translate(b: Board, ids: ReadonlySet<Id>, dx: number, dy: number): Board {
  if (dx === 0 && dy === 0) return b
  return updateItems(b, ids, (i) => translateItem(i, dx, dy))
}

/** Moves and resizes an item, scaling a drawing's points with it. */
export function setRect(i: Item, r: Rect): Item {
  return { ...i, ...r, points: i.points?.map((p) => remap(p, i, r)) }
}

// ----- mind-map structure (the layout lives in mindmap.ts) -----------------------

export function childrenOf(b: Board, id: Id): Item[] {
  return b.items.filter((i) => i.kind === 'mind' && i.parent === id)
}

export function rootOf(b: Board, id: Id): Item | undefined {
  let node = getItem(b, id)
  const seen = new Set<Id>()
  while (node && node.parent !== undefined && !seen.has(node.id)) {
    seen.add(node.id)
    node = getItem(b, node.parent)
  }
  return node
}

/** `id` and all of its mind-map descendants. */
export function subtree(b: Board, id: Id): Set<Id> {
  const out = new Set<Id>([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const c of b.items) {
      if (c.kind === 'mind' && c.parent === cur && !out.has(c.id)) {
        out.add(c.id)
        stack.push(c.id)
      }
    }
  }
  return out
}

export function depthOf(b: Board, id: Id): number {
  let d = 0
  let node = getItem(b, id)
  while (node?.parent !== undefined && d < 1000) {
    d++
    node = getItem(b, node.parent)
  }
  return d
}

/** Mind-map nodes hidden because an ancestor is collapsed. */
export function hiddenIds(b: Board): Set<Id> {
  const hidden = new Set<Id>()
  for (const i of b.items) {
    if (i.kind === 'mind' && i.collapsed) {
      for (const d of subtree(b, i.id)) if (d !== i.id) hidden.add(d)
    }
  }
  return hidden
}

// ----- queries -------------------------------------------------------------------

/** The clickable title strip drawn above a frame. */
export function frameTitleRect(f: Item): Rect {
  const h = f.fontSize * 1.6
  return { x: f.x, y: f.y - h, w: f.w, h }
}

/** Whether the world point `p` hits `i`. `tol` is in world units. */
export function hitItem(i: Item, p: Vec, tol: number): boolean {
  switch (i.kind) {
    case 'ellipse':
      return ellipseContains(expand(i, tol), p)
    case 'pen': {
      const reach = (i.strokeWidth ?? 4) / 2 + tol
      if (!contains(expand(i, reach), p)) return false
      const pts = i.points ?? []
      if (pts.length === 1) return Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= reach
      for (let k = 1; k < pts.length; k++) if (distToSegment(p, pts[k - 1], pts[k]) <= reach) return true
      return false
    }
    case 'frame':
      return contains(expand(i, tol), p) || contains(frameTitleRect(i), p)
    case 'flow':
      return flowHit(i, p, tol)
    default:
      return contains(expand(i, tol), p)
  }
}

/** Where a connector aimed at `toward` attaches to `i`. */
export function anchorTowards(i: Item, toward: Vec): Vec {
  return i.kind === 'ellipse' ? ellipseBorderPoint(i, toward) : rectBorderPoint(i, toward)
}

export function connectorRoute(b: Board, c: Connector): Route | null {
  const a = getItem(b, c.from)
  const z = getItem(b, c.to)
  return a && z ? route(c, a, z) : null
}

export function connectorEndpoints(b: Board, c: Connector): [Vec, Vec] | null {
  const r = connectorRoute(b, c)
  return r ? [r.start, r.end] : null
}

function nearPolyline(p: Vec, points: Vec[], reach: number): boolean {
  for (let k = 1; k < points.length; k++) if (distToSegment(p, points[k - 1], points[k]) <= reach) return true
  return false
}

export type Hit = { type: 'item'; id: Id } | { type: 'connector'; id: Id }

/**
 * The topmost thing under `p`. Frames sit beneath everything else, so they are
 * only hit where nothing else is; nodes in collapsed branches are skipped.
 */
export function hitTest(b: Board, p: Vec, tol: number, hidden: ReadonlySet<Id> = hiddenIds(b)): Hit | null {
  for (let k = b.items.length - 1; k >= 0; k--) {
    const i = b.items[k]
    if (i.kind !== 'frame' && !hidden.has(i.id) && hitItem(i, p, tol)) return { type: 'item', id: i.id }
  }
  for (let k = b.connectors.length - 1; k >= 0; k--) {
    const c = b.connectors[k]
    if (hidden.has(c.from) || hidden.has(c.to)) continue
    const r = connectorRoute(b, c)
    if (r && nearPolyline(p, r.points, tol + 3)) return { type: 'connector', id: c.id }
  }
  for (let k = b.items.length - 1; k >= 0; k--) {
    const i = b.items[k]
    if (i.kind === 'frame' && hitItem(i, p, tol)) return { type: 'item', id: i.id }
  }
  return null
}

/** Visible items whose bounds lie entirely within `area`. */
export function itemsWithin(b: Board, area: Rect, hidden: ReadonlySet<Id> = hiddenIds(b)): Set<Id> {
  return new Set(b.items.filter((i) => !hidden.has(i.id) && containsRect(area, i)).map((i) => i.id))
}

export function itemBounds(i: Item): Rect {
  return i.kind === 'frame' ? unionAll([i, frameTitleRect(i)])! : i
}

/** Bounds of the given visible items, or of everything when `ids` is omitted. */
export function bounds(b: Board, ids?: ReadonlySet<Id>): Rect | null {
  const hidden = hiddenIds(b)
  return unionAll(b.items.filter((i) => !hidden.has(i.id) && (!ids || ids.has(i.id))).map(itemBounds))
}

/**
 * What actually moves when `ids` are dragged: frames carry everything inside
 * them, and any part of a mind map carries the whole map (its layout is
 * anchored to the root).
 */
export function movingSet(b: Board, ids: ReadonlySet<Id>): Set<Id> {
  const out = new Set(ids)
  for (const i of b.items) {
    if (i.kind === 'frame' && ids.has(i.id)) for (const id of itemsWithin(b, i, new Set())) out.add(id)
  }
  // A mind map moves whole when its central idea is moved; any other idea takes just its branch.
  for (const id of Array.from(out)) {
    const i = getItem(b, id)
    if (i?.kind === 'mind') for (const d of subtree(b, id)) out.add(d)
  }
  return out
}

/** Ideas that move by their offset (the layout places them): non-central ideas whose parent isn't moving too. */
export function offsetHeads(b: Board, ids: ReadonlySet<Id>): Set<Id> {
  return new Set(
    [...ids].filter((id) => {
      const i = getItem(b, id)
      return i?.kind === 'mind' && i.parent !== undefined && !ids.has(i.parent)
    }),
  )
}

/** Moves one object by (dx, dy): a mind-map idea through its offset, anything else directly. */
export function nudgeItem(i: Item, dx: number, dy: number): Item {
  if (i.kind === 'mind' && i.parent !== undefined) return { ...i, offset: { x: (i.offset?.x ?? 0) + dx, y: (i.offset?.y ?? 0) + dy } }
  return translateItem(i, dx, dy)
}

export type AlignHow = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

/** Lines up objects' edges or centres with the outermost one (or the shared centre). */
export function align(b: Board, ids: ReadonlySet<Id>, how: AlignHow): Board {
  const list = b.items.filter((i) => ids.has(i.id))
  const box = bounds(b, ids)
  if (list.length < 2 || !box) return b
  const target = (i: Item) => {
    switch (how) {
      case 'left':
        return { x: box.x - i.x, y: 0 }
      case 'right':
        return { x: box.x + box.w - (i.x + i.w), y: 0 }
      case 'center':
        return { x: box.x + box.w / 2 - (i.x + i.w / 2), y: 0 }
      case 'top':
        return { x: 0, y: box.y - i.y }
      case 'bottom':
        return { x: 0, y: box.y + box.h - (i.y + i.h) }
      case 'middle':
        return { x: 0, y: box.y + box.h / 2 - (i.y + i.h / 2) }
    }
  }
  return updateItems(b, ids, (i) => {
    const d = target(i)
    return d.x || d.y ? nudgeItem(i, d.x, d.y) : i
  })
}

/** Spaces three or more objects evenly between the first and last, left to right or top to bottom. */
export function distribute(b: Board, ids: ReadonlySet<Id>, axis: 'x' | 'y'): Board {
  const list = b.items.filter((i) => ids.has(i.id)).sort((p, q) => (axis === 'x' ? p.x - q.x : p.y - q.y))
  if (list.length < 3) return b
  const size = (i: Item) => (axis === 'x' ? i.w : i.h)
  const pos = (i: Item) => (axis === 'x' ? i.x : i.y)
  const first = list[0]
  const last = list[list.length - 1]
  const span = pos(last) + size(last) - pos(first)
  const gap = (span - list.reduce((s, i) => s + size(i), 0)) / (list.length - 1)
  const want = new Map<Id, number>()
  let at = pos(first)
  for (const i of list) {
    want.set(i.id, at)
    at += size(i) + gap
  }
  return updateItems(b, ids, (i) => {
    const d = want.get(i.id)! - pos(i)
    return Math.abs(d) < 0.01 ? i : nudgeItem(i, axis === 'x' ? d : 0, axis === 'y' ? d : 0)
  })
}

export function bringToFront(b: Board, ids: ReadonlySet<Id>): Board {
  return { ...b, items: [...b.items.filter((i) => !ids.has(i.id)), ...b.items.filter((i) => ids.has(i.id))] }
}

export function sendToBack(b: Board, ids: ReadonlySet<Id>): Board {
  return { ...b, items: [...b.items.filter((i) => ids.has(i.id)), ...b.items.filter((i) => !ids.has(i.id))] }
}

// ----- copy & paste --------------------------------------------------------------

export interface Clip {
  items: Item[]
  connectors: Connector[]
  /** Datasets the copied views show, so they paste into other boards too. */
  datasets?: Dataset[]
}

/** The given items, whole mind-map branches under them, and the connectors among them. */
export function copy(b: Board, ids: ReadonlySet<Id>): Clip {
  const all = new Set<Id>()
  for (const id of ids) {
    if (getItem(b, id)?.kind === 'mind') for (const d of subtree(b, id)) all.add(d)
    else all.add(id)
  }
  const items = b.items.filter((i) => all.has(i.id))
  const used = new Set(items.flatMap((i) => (i.view ? [i.view.dataset] : [])))
  const datasets = (b.datasets ?? []).filter((d) => used.has(d.id))
  return {
    items,
    connectors: b.connectors.filter((c) => all.has(c.from) && all.has(c.to)),
    ...(datasets.length ? { datasets } : {}),
  }
}

/**
 * Inserts copies of `clip` shifted by `(dx, dy)`. Mind-map nodes whose parent
 * was not copied become the roots of new maps. Returns the new item ids.
 */
export function paste(b: Board, clip: Clip, dx: number, dy: number): [Board, Set<Id>] {
  const mapping = new Map<Id, Id>()
  let next = b.nextId
  for (const i of clip.items) mapping.set(i.id, next++)
  const items: Item[] = clip.items.map((i) => {
    const copyItem: Item = { ...translateItem(i, dx, dy), id: mapping.get(i.id)! }
    // A copied flowchart starts with no run history: those runs happened on the original.
    delete copyItem.runs
    if (i.kind === 'mind') {
      const parent = i.parent !== undefined ? mapping.get(i.parent) : undefined
      copyItem.parent = parent
      if (parent === undefined) {
        delete copyItem.side
        // A branch that becomes its own map takes the root's look.
        if (i.parent !== undefined) copyItem.color = defaultColor('mind')
      }
    }
    return copyItem
  })
  const connectors: Connector[] = []
  for (const c of clip.connectors) {
    const from = mapping.get(c.from)
    const to = mapping.get(c.to)
    if (from !== undefined && to !== undefined) connectors.push({ ...c, id: next++, from, to })
  }
  // Pasted views share the dataset already on this board, or bring theirs along.
  const have = new Set((b.datasets ?? []).map((d) => d.id))
  const incoming = (clip.datasets ?? []).filter((d) => !have.has(d.id))
  const datasets = incoming.length ? { datasets: [...(b.datasets ?? []), ...incoming] } : {}
  return [
    { ...b, items: [...b.items, ...items], connectors: [...b.connectors, ...connectors], nextId: next, ...datasets },
    new Set(items.map((i) => i.id)),
  ]
}
