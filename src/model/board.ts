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
  intersects,
  rectBorderPoint,
  remap,
  union,
  unionAll,
} from './geom'
import { type Route, goesAround, route, shiftRoute } from './routes'
import { type Taken, take } from './orthoRoute'
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

/**
 * Id lookups. Boards are immutable, so an index built for one items (or connectors) array stays
 * right for as long as that array lives. Small arrays, and arrays looked into only once or
 * twice (intermediate boards inside an edit), are scanned instead: building the index costs more.
 */
const indexes = new WeakMap<readonly { id: Id }[], Map<Id, { id: Id }> | number>()

function lookup<T extends { id: Id }>(list: readonly T[], id: Id): T | undefined {
  if (list.length < 48) return list.find((x) => x.id === id)
  const known = indexes.get(list)
  if (known instanceof Map) return known.get(id) as T | undefined
  if ((known ?? 0) < 3) {
    indexes.set(list, (known ?? 0) + 1)
    return list.find((x) => x.id === id)
  }
  const map = new Map<Id, T>()
  for (const x of list) if (!map.has(x.id)) map.set(x.id, x)
  indexes.set(list, map)
  return map.get(id)
}

export function getItem(b: Board, id: Id): Item | undefined {
  return lookup(b.items, id)
}

export function getConnector(b: Board, id: Id): Connector | undefined {
  return lookup(b.connectors, id)
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
  return routesOf(b).get(c.id) ?? null
}

/** Objects lines go around: everything but frames (they hold things) and pen strokes. */
const blocksLines = (i: Item) => i.kind !== 'frame' && i.kind !== 'pen'
/** Lines with more objects than this around them are drawn plainly: going around so much is slow and rarely clearer. */
export const MAX_OBSTACLES = 48
const CELL = 512
/** The objects lines go around, in square cells, so what's near a line is found without looking at everything. */
const solidCells = new WeakMap<readonly Item[], Map<string, Item[]>>()

function cellsOf(b: Board): Map<string, Item[]> {
  let cells = solidCells.get(b.items)
  if (!cells) {
    cells = new Map()
    const hidden = hiddenIds(b)
    for (const i of b.items) {
      if (!blocksLines(i) || hidden.has(i.id)) continue
      for (let cx = Math.floor(i.x / CELL); cx <= Math.floor((i.x + i.w) / CELL); cx++)
        for (let cy = Math.floor(i.y / CELL); cy <= Math.floor((i.y + i.h) / CELL); cy++) {
          const k = `${cx},${cy}`
          const list = cells.get(k)
          if (list) list.push(i)
          else cells.set(k, [i])
        }
    }
    solidCells.set(b.items, cells)
  }
  return cells
}

/**
 * What a line between `a` and `z` should go around: the objects near them (not ones holding either
 * end). None when there are too many to go around (see MAX_OBSTACLES).
 */
export function obstaclesFor(b: Board, a: Item, z: Item): Item[] {
  const area = expand(union(a, z), 160)
  const cells = cellsOf(b)
  const seen = new Set<Id>()
  const out: Item[] = []
  for (let cx = Math.floor(area.x / CELL); cx <= Math.floor((area.x + area.w) / CELL); cx++)
    for (let cy = Math.floor(area.y / CELL); cy <= Math.floor((area.y + area.h) / CELL); cy++)
      for (const i of cells.get(`${cx},${cy}`) ?? []) {
        if (seen.has(i.id)) continue
        seen.add(i.id)
        if (i.id === a.id || i.id === z.id || !intersects(i, area) || containsRect(i, a) || containsRect(i, z) || containsRect(a, i) || containsRect(z, i)) continue
        out.push(i)
        if (out.length > MAX_OBSTACLES) return []
      }
  return out
}

/** The last route of each connector, kept while its ends, what's near them and the lines it keeps clear of stay put. */
const lastRoute = new WeakMap<Connector, { a: Item; z: Item; obstacles: Item[]; near: string; r: Route & { around?: true } }>()

const segmentsNear = (taken: Taken, area: Rect) =>
  taken.segments
    .filter(([p, q]) => intersects({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(p.x - q.x) + 1, h: Math.abs(p.y - q.y) + 1 }, area))
    .map(([p, q]) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(q.x)},${Math.round(q.y)}`)
    .join(' ')

const sameItems = (p: Item[], q: Item[]) => p.length === q.length && p.every((i, k) => i === q[k])

/**
 * A connector's route on the board: a square-cornered line goes around what's in its way, and
 * clear of lines already gone around (`taken`). The same route comes back (the same object) until
 * any of that moves.
 */
export function routeBetween(b: Board, c: Connector, a: Item, z: Item, taken?: Taken, obstacles: Item[] = c.style === 'elbow' ? obstaclesFor(b, a, z) : []): Route {
  const near = obstacles.length && taken ? segmentsNear(taken, expand(union(a, z), 200)) : ''
  const hit = lastRoute.get(c)
  if (hit && hit.a === a && hit.z === z && hit.near === near && sameItems(hit.obstacles, obstacles)) {
    if (hit.r.around && taken) take(taken, hit.r.points)
    return hit.r
  }
  const r = route(c, a, z, obstacles, taken)
  lastRoute.set(c, { a, z, obstacles, near, r })
  return r
}

/** Whether both ends of a line moved by the same amount, keeping their sizes. */
const movedTogether = (a0: Item, a: Item, z0: Item, z: Item) =>
  a0.w === a.w && a0.h === a.h && z0.w === z.w && z0.h === z.h && a.x - a0.x === z.x - z0.x && a.y - a0.y === z.y - z0.y && a0.kind === a.kind && z0.kind === z.kind

/** Whether two versions of the items are laid out alike (only words or colours changed, say), so lines go the same way. */
function sameShapes(p: readonly Item[], q: readonly Item[]): boolean {
  if (p.length !== q.length) return false
  for (let k = 0; k < p.length; k++) {
    const i = p[k]
    const j = q[k]
    if (i === j) continue
    if (i.id !== j.id || i.x !== j.x || i.y !== j.y || i.w !== j.w || i.h !== j.h || i.kind !== j.kind || i.shape !== j.shape || i.collapsed !== j.collapsed || i.parent !== j.parent) return false
  }
  return true
}

/** Every connector's route, worked out in turn so lines that go around things keep apart. Kept per board. */
const boardRoutes = new WeakMap<readonly Connector[], { items: readonly Item[]; routes: Map<Id, Route>; quick: boolean }>()

/**
 * Every connector's route on the board. `quick` (while something's being dragged): only lines whose
 * ends moved are worked out again, on their own; the rest keep their routes until it's let go.
 */
export function routesOf(b: Board, quick = false): Map<Id, Route> {
  const hit = boardRoutes.get(b.connectors)
  if (hit && (quick || !hit.quick) && (hit.items === b.items || sameShapes(hit.items, b.items))) {
    if (hit.items !== b.items) boardRoutes.set(b.connectors, { ...hit, items: b.items })
    return hit.routes
  }
  if (quick) {
    const routes = new Map<Id, Route>()
    for (const c of b.connectors) {
      const a = getItem(b, c.from)
      const z = getItem(b, c.to)
      if (!a || !z) continue
      const last = lastRoute.get(c)
      if (last && last.a === a && last.z === z) routes.set(c.id, last.r)
      else if (last && movedTogether(last.a, a, last.z, z)) {
        // Both ends dragged together: the same line, moved with them.
        const r = shiftRoute(last.r, a.x - last.a.x, a.y - last.a.y)
        lastRoute.set(c, { ...last, a, z, r })
        routes.set(c.id, r)
      } else routes.set(c.id, routeBetween(b, c, a, z))
    }
    boardRoutes.set(b.connectors, { items: b.items, routes, quick: true })
    return routes
  }
  const found = new Map<Id, Route>()
  const taken: Taken = { segments: [], ends: new Set() }
  // Plain lines first; then the ones that go around, clear of those and of each other.
  const around: [Connector, Item, Item, Item[]][] = []
  for (const c of b.connectors) {
    const a = getItem(b, c.from)
    const z = getItem(b, c.to)
    if (!a || !z) continue
    const obstacles = c.style === 'elbow' ? obstaclesFor(b, a, z) : []
    if (goesAround(c, a, z, obstacles)) around.push([c, a, z, obstacles])
    else {
      const r = routeBetween(b, c, a, z, undefined, obstacles)
      take(taken, r.points)
      found.set(c.id, r)
    }
  }
  for (const [c, a, z, obstacles] of around) found.set(c.id, routeBetween(b, c, a, z, taken, obstacles))
  // In the board's order.
  const routes = new Map<Id, Route>()
  for (const c of b.connectors) {
    const r = found.get(c.id)
    if (r) routes.set(c.id, r)
  }
  boardRoutes.set(b.connectors, { items: b.items, routes, quick: false })
  return routes
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
export function hitTest(b: Board, p: Vec, tol: number, hidden: ReadonlySet<Id> = hiddenIds(b), withLocked = false): Hit | null {
  for (let k = b.items.length - 1; k >= 0; k--) {
    const i = b.items[k]
    if (i.kind !== 'frame' && !hidden.has(i.id) && (withLocked || !i.locked) && hitItem(i, p, tol)) return { type: 'item', id: i.id }
  }
  for (let k = b.connectors.length - 1; k >= 0; k--) {
    const c = b.connectors[k]
    if (hidden.has(c.from) || hidden.has(c.to)) continue
    const r = connectorRoute(b, c)
    if (r && nearPolyline(p, r.points, tol + 3)) return { type: 'connector', id: c.id }
  }
  for (let k = b.items.length - 1; k >= 0; k--) {
    const i = b.items[k]
    if (i.kind === 'frame' && (withLocked || !i.locked) && hitItem(i, p, tol)) return { type: 'item', id: i.id }
  }
  return null
}

/** The ids plus every other member of their groups. */
export function withGroups(b: Board, ids: Iterable<Id>): Set<Id> {
  const out = new Set(ids)
  const groups = new Set<string>()
  for (const id of out) {
    const g = getItem(b, id)?.group
    if (g) groups.add(g)
  }
  if (groups.size) for (const i of b.items) if (i.group && groups.has(i.group)) out.add(i.id)
  return out
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
  // Locked objects stay put, even inside a frame that moves.
  for (const id of Array.from(out)) if (getItem(b, id)?.locked) out.delete(id)
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
    // A copy is a new note by whoever pasted it: in a private brainstorm it is hidden as theirs.
    delete copyItem.hiddenBy
    delete copyItem.hiddenRound
    delete copyItem.masked
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

/**
 * Where `r` can go without covering anything: `r` itself if it's clear, else the clear spot nearest
 * to it, looked for in rings of `step` around it. Gives up (returns `r`) after a dozen rings.
 */
export function nearestFree(b: Board, r: Rect, step = 80): Rect {
  const reach = step * 12
  const near = b.items.filter((i) => i.kind !== 'frame' && intersects({ x: r.x - reach, y: r.y - reach, w: r.w + 2 * reach, h: r.h + 2 * reach }, itemBounds(i))).map(itemBounds)
  const clear = (c: Rect) => !near.some((n) => intersects(c, n))
  for (let ring = 0; ring <= 12; ring++) {
    for (let i = -ring; i <= ring; i++)
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue
        const c = { ...r, x: r.x + i * step, y: r.y + j * step }
        if (clear(c)) return c
      }
  }
  return r
}
