/**
 * Hop-overs: where two lines cross, one of them jumps over the other in a small arc, so it's clear
 * the lines pass each other rather than meet. The more level line hops (between two equally level
 * ones, the one drawn later), over connectors and mind-map branches alike.
 */

import { getItem } from './board'
import { type Vec, dist } from './geom'
import { CORNER, type Route, mindBranch } from './routes'
import type { Board, Id } from './types'

/** How far a hop rises from its line, and half how far along it runs. */
export const HOP = 6
/** Crossings this close to either line's end aren't hopped: the lines meet there, or nearly. */
const END_CLEAR = HOP + 8
/** Lines crossing at a shallower angle than this run alongside each other rather than across. */
const MIN_SIN = Math.sin((25 * Math.PI) / 180)
/** Hops closer than this along a line become one wider hop. */
const MERGE_GAP = 4
const CELL = 128
const CURVE_STEPS = 24

/** A line's shape: straight pieces whose corners are rounded by `radius`, or one cubic curve. */
export type LineShape = { kind: 'poly'; points: Vec[]; radius: number } | { kind: 'cubic'; p: [Vec, Vec, Vec, Vec] }

export interface Line {
  key: string
  shape: LineShape
}

interface Seg {
  line: number
  a: Vec
  b: Vec
  /** For straight pieces: which piece. For curves: the curve's t at `a` and `b`. */
  k: number
  t0: number
  t1: number
  /** Distance along the whole line to `a`. */
  at: number
  len: number
}

const bez = (p: [Vec, Vec, Vec, Vec], t: number): Vec => {
  const u = 1 - t
  return {
    x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
    y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
  }
}

const bezSlope = (p: [Vec, Vec, Vec, Vec], t: number): Vec => {
  const u = 1 - t
  return {
    x: 3 * u * u * (p[1].x - p[0].x) + 6 * u * t * (p[2].x - p[1].x) + 3 * t * t * (p[3].x - p[2].x),
    y: 3 * u * u * (p[1].y - p[0].y) + 6 * u * t * (p[2].y - p[1].y) + 3 * t * t * (p[3].y - p[2].y),
  }
}

/** A line as straight segments: its own pieces, or a curve followed closely. */
function segmentsOf(line: LineShape, index: number): Seg[] {
  const out: Seg[] = []
  let at = 0
  if (line.kind === 'poly') {
    for (let k = 1; k < line.points.length; k++) {
      const a = line.points[k - 1]
      const b = line.points[k]
      const len = dist(a, b)
      out.push({ line: index, a, b, k: k - 1, t0: 0, t1: 1, at, len })
      at += len
    }
    return out
  }
  let a = line.p[0]
  for (let s = 1; s <= CURVE_STEPS; s++) {
    const b = bez(line.p, s / CURVE_STEPS)
    const len = dist(a, b)
    out.push({ line: index, a, b, k: s - 1, t0: (s - 1) / CURVE_STEPS, t1: s / CURVE_STEPS, at, len })
    at += len
    a = b
  }
  return out
}

/** Where two segments cross: the fraction along each, or null. */
function crossing(p: Seg, q: Seg): { u: number; v: number; sin: number } | null {
  const rx = p.b.x - p.a.x
  const ry = p.b.y - p.a.y
  const sx = q.b.x - q.a.x
  const sy = q.b.y - q.a.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return null
  const qx = q.a.x - p.a.x
  const qy = q.a.y - p.a.y
  const u = (qx * sy - qy * sx) / den
  const v = (qx * ry - qy * rx) / den
  if (u < 0 || u > 1 || v < 0 || v > 1) return null
  return { u, v, sin: Math.abs(den) / (p.len * q.len) }
}

/** How level a segment is: 1 across, 0 up and down. */
const level = (s: Seg) => (s.len ? Math.abs(s.b.x - s.a.x) / s.len : 0)

/**
 * Where each line hops: distances along it, by line. Crossings are found through square cells, so
 * a board full of lines isn't every line against every other.
 */
export function hopPoints(lines: readonly Line[]): Map<number, number[]> {
  const segs = lines.flatMap((l, i) => segmentsOf(l.shape, i))
  const total = new Map<number, number>()
  for (const s of segs) total.set(s.line, s.at + s.len)
  const cells = new Map<string, number[]>()
  const out = new Map<number, number[]>()
  for (let n = 0; n < segs.length; n++) {
    const s = segs[n]
    if (s.len < 0.5) continue
    const x0 = Math.floor(Math.min(s.a.x, s.b.x) / CELL)
    const x1 = Math.floor(Math.max(s.a.x, s.b.x) / CELL)
    const y0 = Math.floor(Math.min(s.a.y, s.b.y) / CELL)
    const y1 = Math.floor(Math.max(s.a.y, s.b.y) / CELL)
    const seen = new Set<number>()
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`
        const list = cells.get(key)
        if (!list) {
          cells.set(key, [n])
          continue
        }
        for (const m of list) {
          if (seen.has(m)) continue
          seen.add(m)
          const o = segs[m]
          if (o.line === s.line) continue
          const x = crossing(o, s)
          if (!x || x.sin < MIN_SIN) continue
          const atO = o.at + x.u * o.len
          const atS = s.at + x.v * s.len
          if (atO < END_CLEAR || atS < END_CLEAR || total.get(o.line)! - atO < END_CLEAR || total.get(s.line)! - atS < END_CLEAR) continue
          // The more level one hops; between two alike, the later one.
          const lo = level(o)
          const ls = level(s)
          const [line, at] = lo > ls + 0.05 ? [o.line, atO] : ls > lo + 0.05 ? [s.line, atS] : o.line > s.line ? [o.line, atO] : [s.line, atS]
          const list2 = out.get(line)
          if (list2) list2.push(at)
          else out.set(line, [at])
        }
        list.push(n)
      }
  }
  for (const v of out.values()) v.sort((p, q) => p - q)
  return out
}

/** Hops along a line as spans [from, to] of distance along it, close ones made one. */
function spans(at: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const s of at) {
    const last = out[out.length - 1]
    if (last && s - HOP <= last[1] + MERGE_GAP) last[1] = s + HOP
    else out.push([s - HOP, s + HOP])
  }
  return out
}

const f = (n: number) => String(Math.round(n * 100) / 100)
const pt = (p: Vec) => `${f(p.x)} ${f(p.y)}`

/** An arc from `a` to `b` rising HOP above the line between them: upwards, or leftwards on an upright line. */
function arc(a: Vec, b: Vec): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const up = dx > 1e-6 ? 1 : dx < -1e-6 ? 0 : dy < 0 ? 1 : 0
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  return `A${f(dist(a, b) / 2)} ${HOP} ${f(angle)} 0 ${up} ${pt(b)}`
}

/** Path data for straight pieces with rounded corners (as connectors draw them), hopping at `at`. */
function polyPath(points: Vec[], radius: number, at: number[]): string {
  const hops = spans(at)
  const n = points.length
  const corner = (k: number) => (k <= 0 || k >= n - 1 ? 0 : Math.min(radius, dist(points[k - 1], points[k]) / 2, dist(points[k], points[k + 1]) / 2))
  let d = `M${pt(points[0])}`
  let along = 0
  for (let k = 0; k < n - 1; k++) {
    const a = points[k]
    const b = points[k + 1]
    const len = dist(a, b)
    const ux = len ? (b.x - a.x) / len : 0
    const uy = len ? (b.y - a.y) / len : 0
    const on = (s: number): Vec => ({ x: a.x + ux * s, y: a.y + uy * s })
    const lo = corner(k)
    const hi = len - corner(k + 1)
    for (const [s0, s1] of hops) {
      const p = s0 - along
      const q = s1 - along
      // Hops in a rounded corner (or off this piece) are left out.
      if (p < lo + 1 || q > hi - 1) continue
      d += `L${pt(on(p))}${arc(on(p), on(q))}`
    }
    if (k + 1 < n - 1) {
      const r = corner(k + 1)
      const next = points[k + 2]
      const nl = dist(b, next)
      const out = nl ? { x: b.x + ((next.x - b.x) / nl) * r, y: b.y + ((next.y - b.y) / nl) * r } : b
      d += `L${pt(on(len - r))}Q${pt(b)} ${pt(out)}`
    } else d += `L${pt(b)}`
    along += len
  }
  return d
}

/** Path data for a cubic curve hopping at `at` (distances along it). */
function cubicPath(p: [Vec, Vec, Vec, Vec], at: number[]): string {
  // Distance along the curve at each step, to turn distances into t and back.
  const lens = [0]
  let prev = p[0]
  for (let s = 1; s <= CURVE_STEPS; s++) {
    const q = bez(p, s / CURVE_STEPS)
    lens.push(lens[s - 1] + dist(prev, q))
    prev = q
  }
  const tAt = (l: number) => {
    let s = 1
    while (s < CURVE_STEPS && lens[s] < l) s++
    const span = lens[s] - lens[s - 1]
    return (s - 1 + (span ? (l - lens[s - 1]) / span : 0)) / CURVE_STEPS
  }
  // The part of the curve between t0 and t1, as a curve of its own.
  const piece = (t0: number, t1: number) => {
    const k = (t1 - t0) / 3
    const a = bez(p, t0)
    const b = bez(p, t1)
    const da = bezSlope(p, t0)
    const db = bezSlope(p, t1)
    return `C${pt({ x: a.x + da.x * k, y: a.y + da.y * k })} ${pt({ x: b.x - db.x * k, y: b.y - db.y * k })} ${pt(b)}`
  }
  let d = `M${pt(p[0])}`
  let t = 0
  for (const [s0, s1] of spans(at)) {
    if (s0 < 1 || s1 > lens[CURVE_STEPS] - 1) continue
    const t0 = tAt(s0)
    const t1 = tAt(s1)
    d += piece(t, t0) + arc(bez(p, t0), bez(p, t1))
    t = t1
  }
  return d + piece(t, 1)
}

/** Path data for each line that hops over another, by key; lines that don't keep their own. */
export function hoppedPaths(lines: readonly Line[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const [i, at] of hopPoints(lines)) {
    const { key, shape } = lines[i]
    out.set(key, shape.kind === 'poly' ? polyPath(shape.points, shape.radius, at) : cubicPath(shape.p, at))
  }
  return out
}

/** Whether two lines lie the same way. */
function sameLine(p: Line, q: Line): boolean {
  if (p.key !== q.key || p.shape.kind !== q.shape.kind) return false
  if (p.shape.kind === 'poly') return q.shape.kind === 'poly' && p.shape.points === q.shape.points
  const a = p.shape.p
  const b = (q.shape as { p: Vec[] }).p
  return a.every((v, k) => v.x === b[k].x && v.y === b[k].y)
}

/** The last board's hops, kept while its lines stay put (typing in a note doesn't move any). */
let last: { lines: Line[]; paths: Map<string, string> } | null = null

/**
 * Path data for the lines on a board that hop over others, by key: `m` and an idea's id for its
 * mind-map branch, `c` and a connector's id for a connector. Branches come first, as they're drawn.
 */
export function boardHops(b: Board, routes: ReadonlyMap<Id, Route>, hidden: ReadonlySet<Id>): Map<string, string> {
  const lines: Line[] = []
  for (const n of b.items) {
    if (n.kind !== 'mind' || n.parent === undefined || hidden.has(n.id)) continue
    const p = getItem(b, n.parent)
    if (p) lines.push({ key: `m${n.id}`, shape: { kind: 'cubic', p: mindBranch(n, p) } })
  }
  for (const c of b.connectors) {
    const r = routes.get(c.id)
    if (!r || hidden.has(c.from) || hidden.has(c.to)) continue
    lines.push({ key: `c${c.id}`, shape: r.curve ? { kind: 'cubic', p: r.curve } : { kind: 'poly', points: r.points, radius: CORNER } })
  }
  if (last && last.lines.length === lines.length && last.lines.every((l, k) => sameLine(l, lines[k]))) return last.paths
  const paths = hoppedPaths(lines)
  last = { lines, paths }
  return paths
}
