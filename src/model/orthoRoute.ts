/**
 * Square-cornered lines that go around things. When the plain elbow between two objects would cut
 * through something else, this finds another way: along lanes a little clear of every obstacle,
 * from any side of each end, preferring short lines with few turns.
 */

import type { Rect, Vec } from './geom'
import { PORT_DIR, type Port, portPoint } from './shapes'
import type { Item } from './types'

/** How far lines keep from the objects they pass. */
export const CLEARANCE = 14
/** A turn costs as much as this much more line, so straighter routes win. */
const BEND = 40
/** Leaving or arriving on another side than the one facing the other end costs this much. */
const OTHER_SIDE = 60
const PORTS: Port[] = ['n', 'e', 's', 'w']
/** Running along a stretch another line already uses costs this much more, so lines keep apart. */
const SHARED = 3
/** Ending at a point another line already ends at costs this much. */
const SHARED_END = 260

/** Where lines already routed run and end, so the next one keeps clear of them. */
export interface Taken {
  segments: [Vec, Vec][]
  ends: Set<string>
}

const endKey = (p: Vec) => `${Math.round(p.x)},${Math.round(p.y)}`

/** Taken segments by the row (level ones) or column (upright ones) they run along, in 6-unit bands. */
interface Lanes {
  rows: Map<number, [number, number][]>
  cols: Map<number, [number, number][]>
}

const BAND = 6

function lanesOf(taken: Taken, area: Rect): Lanes {
  const rows = new Map<number, [number, number][]>()
  const cols = new Map<number, [number, number][]>()
  const add = (m: Map<number, [number, number][]>, at: number, from: number, to: number) => {
    const k = Math.round(at / BAND)
    ;(m.get(k) ?? m.set(k, []).get(k)!).push([Math.min(from, to), Math.max(from, to)])
  }
  for (const [p, q] of taken.segments) {
    if (Math.max(p.x, q.x) < area.x || Math.min(p.x, q.x) > area.x + area.w || Math.max(p.y, q.y) < area.y || Math.min(p.y, q.y) > area.y + area.h) continue
    if (Math.abs(p.y - q.y) < 0.5) add(rows, p.y, p.x, q.x)
    else if (Math.abs(p.x - q.x) < 0.5) add(cols, p.x, p.y, q.y)
  }
  return { rows, cols }
}

/** How much of a–b runs along a taken segment. */
function overlap(a: Vec, b: Vec, lanes: Lanes): number {
  const level = Math.abs(a.y - b.y) < 0.5
  const [m, at, from, to] = level ? [lanes.rows, a.y, a.x, b.x] : [lanes.cols, a.x, a.y, b.y]
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const k = Math.round(at / BAND)
  let n = 0
  for (const band of [k - 1, k, k + 1]) for (const [p, q] of m.get(band) ?? []) n += Math.max(0, Math.min(hi, q) - Math.max(lo, p))
  return n
}

/** Notes a routed line, so the next keep clear of it. */
export function take(taken: Taken, points: Vec[]) {
  for (let k = 1; k < points.length; k++) taken.segments.push([points[k - 1], points[k]])
  taken.ends.add(endKey(points[0]))
  taken.ends.add(endKey(points[points.length - 1]))
}

const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m })

/** Whether the segment a–b (level or upright) cuts through the inside of `r`. */
export function segmentHits(a: Vec, b: Vec, r: Rect): boolean {
  const eps = 0.5
  if (Math.abs(a.y - b.y) < 0.01) {
    const [x1, x2] = a.x < b.x ? [a.x, b.x] : [b.x, a.x]
    return a.y > r.y + eps && a.y < r.y + r.h - eps && x2 > r.x + eps && x1 < r.x + r.w - eps
  }
  if (Math.abs(a.x - b.x) < 0.01) {
    const [y1, y2] = a.y < b.y ? [a.y, b.y] : [b.y, a.y]
    return a.x > r.x + eps && a.x < r.x + r.w - eps && y2 > r.y + eps && y1 < r.y + r.h - eps
  }
  // Not square: test the box it spans.
  const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
  return box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y
}

/** Whether a polyline cuts through any of the rects. */
export function pathHits(points: Vec[], rects: readonly Rect[]): boolean {
  for (let k = 1; k < points.length; k++) for (const r of rects) if (segmentHits(points[k - 1], points[k], r)) return true
  return false
}

/** A small binary heap of [cost, value]. */
class Heap<T> {
  private items: [number, T][] = []
  get size() {
    return this.items.length
  }
  push(cost: number, v: T) {
    const a = this.items
    a.push([cost, v])
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): [number, T] {
    const a = this.items
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

const sorted = (v: number[]) => [...new Set(v.map((n) => Math.round(n * 2) / 2))].sort((p, q) => p - q)

/**
 * The way from `a` to `z` around `obstacles`, as points from a side of `a` to a side of `z`, or null
 * when there's none. `prefer` are the sides that face each other, which win when it's close.
 */
export function orthoRoute(a: Item, z: Item, obstacles: readonly Rect[], prefer: [Port, Port], taken?: Taken): { points: Vec[]; ports: [Port, Port] } | null {
  const blocks = [...obstacles, a, z].map((r) => grow(r, CLEARANCE))
  const stub = (i: Item, p: Port) => {
    const at = portPoint(i, p)
    return { at, out: { x: at.x + PORT_DIR[p].x * CLEARANCE, y: at.y + PORT_DIR[p].y * CLEARANCE } }
  }
  const starts = PORTS.map((p) => ({ p, ...stub(a, p) }))
  const ends = PORTS.map((p) => ({ p, ...stub(z, p) }))

  // Lanes: just clear of every obstacle, through the middle of the gaps between them, and through
  // each end's sides.
  const area = grow(
    blocks.reduce((u, r) => ({ x: Math.min(u.x, r.x), y: Math.min(u.y, r.y), w: Math.max(u.x + u.w, r.x + r.w) - Math.min(u.x, r.x), h: Math.max(u.y + u.h, r.y + r.h) - Math.min(u.y, r.y) })),
    CLEARANCE * 2,
  )
  const edgesX = blocks.flatMap((r) => [r.x, r.x + r.w])
  const edgesY = blocks.flatMap((r) => [r.y, r.y + r.h])
  const between = (v: number[]) => {
    const s = sorted(v)
    return s.slice(1).map((n, k) => (n + s[k]) / 2)
  }
  const xs = sorted([...edgesX, ...between(edgesX), area.x, area.x + area.w, ...[...starts, ...ends].map((s) => s.out.x)])
  const ys = sorted([...edgesY, ...between(edgesY), area.y, area.y + area.h, ...[...starts, ...ends].map((s) => s.out.y)])
  const inside = (x: number, y: number) => blocks.some((r) => x > r.x + 0.5 && x < r.x + r.w - 0.5 && y > r.y + 0.5 && y < r.y + r.h - 0.5)
  // Every obstacle's edges are lanes, so a step between neighbouring lanes is either clear all the
  // way or inside an obstacle all the way: its middle says which. Each is worked out once.
  const clear = new Map<number, boolean>()
  const clearAt = (i2: number, j2: number) => {
    // Half-steps: (i2, j2) on a grid twice as fine, so steps' middles have keys too.
    const k = i2 * (ys.length * 2) + j2
    let v = clear.get(k)
    if (v === undefined) {
      const x = i2 % 2 ? (xs[(i2 - 1) / 2] + xs[(i2 + 1) / 2]) / 2 : xs[i2 / 2]
      const y = j2 % 2 ? (ys[(j2 - 1) / 2] + ys[(j2 + 1) / 2]) / 2 : ys[j2 / 2]
      v = !inside(x, y)
      clear.set(k, v)
    }
    return v
  }
  const lanes = taken?.segments.length ? lanesOf(taken, area) : null
  const ix = new Map(xs.map((v, k) => [v, k]))
  const iy = new Map(ys.map((v, k) => [v, k]))
  const key = (i: number, j: number, d: number) => (i * ys.length + j) * 4 + d
  const DIRS: Vec[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ]
  const round = (n: number) => Math.round(n * 2) / 2

  const target = new Map<number, (typeof ends)[number]>()
  for (const e of ends) {
    const i = ix.get(round(e.out.x))
    const j = iy.get(round(e.out.y))
    if (i !== undefined && j !== undefined) target.set(i * ys.length + j, e)
  }
  const goal = (x: number, y: number) => Math.min(...ends.map((e) => Math.abs(e.out.x - x) + Math.abs(e.out.y - y)))

  const best = new Map<number, number>()
  const from = new Map<number, number>()
  const heap = new Heap<number>()
  for (const s of starts) {
    const i = ix.get(round(s.out.x))
    const j = iy.get(round(s.out.y))
    if (i === undefined || j === undefined) continue
    const d = PORTS.indexOf(s.p)
    const k = key(i, j, d)
    const cost = (s.p === prefer[0] ? 0 : OTHER_SIDE) + (taken?.ends.has(endKey(s.at)) ? SHARED_END : 0)
    if (cost < (best.get(k) ?? Infinity)) {
      best.set(k, cost)
      heap.push(cost + goal(xs[i], ys[j]), k)
    }
  }

  let done: { k: number; end: (typeof ends)[number] } | null = null
  let doneCost = Infinity
  let steps = 0
  while (heap.size && steps++ < 60000) {
    const [f, k] = heap.pop()
    if (f >= doneCost) break
    const g = best.get(k)!
    const d = k % 4
    const cell = (k - d) / 4
    const j = cell % ys.length
    const i = (cell - j) / ys.length
    const x = xs[i]
    const y = ys[j]
    const end = target.get(cell)
    if (end) {
      // Arriving: the last stretch runs into the side, so it must head the opposite way to the side's outward direction.
      const inward = (PORTS.indexOf(end.p) + 2) % 4
      const total = g + (d === inward ? 0 : BEND) + (end.p === prefer[1] ? 0 : OTHER_SIDE) + (taken?.ends.has(endKey(end.at)) ? SHARED_END : 0)
      if (total < doneCost) {
        doneCost = total
        done = { k, end }
      }
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue
      const ni = i + DIRS[nd].x
      const nj = j + DIRS[nd].y
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue
      const nx = xs[ni]
      const ny = ys[nj]
      if (!clearAt(2 * ni, 2 * nj) && !target.has(ni * ys.length + nj)) continue
      if (!clearAt(i + ni, j + nj)) continue
      const nk = key(ni, nj, nd)
      const cost = g + Math.abs(nx - x) + Math.abs(ny - y) + (nd === d ? 0 : BEND) + (lanes ? SHARED * overlap({ x, y }, { x: nx, y: ny }, lanes) : 0)
      if (cost < (best.get(nk) ?? Infinity)) {
        best.set(nk, cost)
        from.set(nk, k)
        heap.push(cost + goal(nx, ny), nk)
      }
    }
  }
  if (!done) return null

  const cells: Vec[] = []
  let k: number | undefined = done.k
  while (k !== undefined) {
    const cell = (k - (k % 4)) / 4
    const j = cell % ys.length
    cells.unshift({ x: xs[(cell - j) / ys.length], y: ys[j] })
    k = from.get(k)
  }
  const first = cells[0]
  const start = starts.find((s) => Math.abs(s.out.x - first.x) < 1 && Math.abs(s.out.y - first.y) < 1)!
  return { points: [start.at, ...cells, done.end.at], ports: [start.p, done.end.p] }
}
