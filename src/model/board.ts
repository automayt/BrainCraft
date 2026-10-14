/**
 * Pure operations on a {@link Board}. Every function returns a new board (or the
 * same object when nothing changed) and never mutates its input, so old boards
 * can be kept as undo snapshots.
 */

import {
  type Rect,
  type Vec,
  boundsOf,
  center,
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
import {
  type Board,
  type Connector,
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
export function connect(b: Board, from: Id, to: Id, color = INKS[1][1]): [Board, Id | null] {
  if (from === to || !getItem(b, from) || !getItem(b, to)) return [b, null]
  if (b.connectors.some((c) => c.from === from && c.to === to)) return [b, null]
  const id = b.nextId
  return [{ ...b, connectors: [...b.connectors, { id, from, to, color }], nextId: id + 1 }, id]
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
  return {
    ...b,
    items: b.items.filter((i) => !items.has(i.id)),
    connectors: b.connectors.filter((c) => !connectors.has(c.id) && !items.has(c.from) && !items.has(c.to)),
  }
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
    default:
      return contains(expand(i, tol), p)
  }
}

/** Where a connector aimed at `toward` attaches to `i`. */
export function anchorTowards(i: Item, toward: Vec): Vec {
  return i.kind === 'ellipse' ? ellipseBorderPoint(i, toward) : rectBorderPoint(i, toward)
}

export function connectorEndpoints(b: Board, c: Connector): [Vec, Vec] | null {
  const a = getItem(b, c.from)
  const z = getItem(b, c.to)
  if (!a || !z) return null
  return [anchorTowards(a, center(z)), anchorTowards(z, center(a))]
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
    const ends = connectorEndpoints(b, c)
    if (ends && distToSegment(p, ends[0], ends[1]) <= tol + 3) return { type: 'connector', id: c.id }
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
  for (const id of Array.from(out)) {
    const i = getItem(b, id)
    if (i?.kind === 'mind') {
      const root = rootOf(b, id)
      if (root) for (const d of subtree(b, root.id)) out.add(d)
    }
  }
  return out
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
}

/** The given items, whole mind-map branches under them, and the connectors among them. */
export function copy(b: Board, ids: ReadonlySet<Id>): Clip {
  const all = new Set<Id>()
  for (const id of ids) {
    if (getItem(b, id)?.kind === 'mind') for (const d of subtree(b, id)) all.add(d)
    else all.add(id)
  }
  return {
    items: b.items.filter((i) => all.has(i.id)),
    connectors: b.connectors.filter((c) => all.has(c.from) && all.has(c.to)),
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
  return [
    { ...b, items: [...b.items, ...items], connectors: [...b.connectors, ...connectors], nextId: next },
    new Set(items.map((i) => i.id)),
  ]
}
