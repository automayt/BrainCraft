/** Connector paths between two items. */

import { type Rect, type Vec, add, dist, ellipseBorderPoint, rectBorderPoint, scale, sub } from './geom'
import { type Taken, orthoRoute, pathHits, take } from './orthoRoute'
import { PORT_DIR, facingPorts, portPoint } from './shapes'
import type { Connector, Item } from './types'

export interface Route {
  /** SVG path data. */
  d: string
  /** The route as a polyline, for hit testing. */
  points: Vec[]
  start: Vec
  end: Vec
  /** Unit direction the line arrives at `end` with (and leaves `start` against). */
  endDir: Vec
  startDir: Vec
  /** Halfway along the route, for the label. */
  mid: Vec
  /** A curved line's curve (start, two control points, end); other lines are `points` with rounded corners. */
  curve?: [Vec, Vec, Vec, Vec]
}

/** How round a bending line's corners are. */
export const CORNER = 10

const unit = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y)
  return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 }
}

/** Point where a straight connector meets `i` when aimed at `toward`. */
function borderTowards(i: Item, toward: Vec): Vec {
  return i.kind === 'ellipse' ? ellipseBorderPoint(i, toward) : rectBorderPoint(i, toward)
}

export function polylineMid(points: Vec[]): Vec {
  let total = 0
  for (let k = 1; k < points.length; k++) total += dist(points[k - 1], points[k])
  let half = total / 2
  for (let k = 1; k < points.length; k++) {
    const seg = dist(points[k - 1], points[k])
    if (seg >= half && seg > 0) return add(points[k - 1], scale(sub(points[k], points[k - 1]), half / seg))
    half -= seg
  }
  return points[0]
}

/** Drops points that sit on a straight line between their neighbours (or repeat). */
function simplify(points: Vec[]): Vec[] {
  const out: Vec[] = []
  for (const p of points) {
    if (out.length && dist(out[out.length - 1], p) < 0.01) continue
    if (out.length >= 2) {
      const a = out[out.length - 2]
      const b = out[out.length - 1]
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)
      if (Math.abs(cross) < 0.01) out.pop()
    }
    out.push(p)
  }
  return out
}

/** Polyline path data with gently rounded corners. */
function roundedPath(points: Vec[], radius = CORNER): string {
  let d = `M${points[0].x} ${points[0].y}`
  for (let k = 1; k < points.length - 1; k++) {
    const p = points[k]
    const r = Math.min(radius, dist(points[k - 1], p) / 2, dist(p, points[k + 1]) / 2)
    const a = add(p, scale(unit(sub(points[k - 1], p)), r))
    const b = add(p, scale(unit(sub(points[k + 1], p)), r))
    d += `L${a.x} ${a.y}Q${p.x} ${p.y} ${b.x} ${b.y}`
  }
  const last = points[points.length - 1]
  return `${d}L${last.x} ${last.y}`
}

/** An elbow: leave and arrive square to the sides, turning halfway between. */
function elbowPoints(start: Vec, end: Vec, pa: string): Vec[] {
  if (pa === 'n' || pa === 's') {
    const my = (start.y + end.y) / 2
    return [start, { x: start.x, y: my }, { x: end.x, y: my }, end]
  }
  const mx = (start.x + end.x) / 2
  return [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end]
}

/** Whether connector `c`'s plain line would cut through one of `obstacles` (so it goes around). */
export function goesAround(c: Connector, a: Item, z: Item, obstacles: readonly Rect[]): boolean {
  if (c.style !== 'elbow' || !obstacles.length) return false
  const [pa, pz] = facingPorts(a, z)
  return pathHits(elbowPoints(portPoint(a, pa), portPoint(z, pz), pa), obstacles)
}

/**
 * Lays out connector `c` between items `a` (from) and `z` (to). A square-cornered (elbow) line that
 * would cut through one of `obstacles` goes around instead.
 */
export function route(c: Connector, a: Item, z: Item, obstacles: readonly Rect[] = [], taken?: Taken): Route & { around?: true } {
  const style = c.style ?? 'straight'
  const [pa, pz] = facingPorts(a, z)
  // Flowchart symbols always connect at the middle of a side; other items do once the line bends.
  const usePorts = style !== 'straight' || a.kind === 'flow' || z.kind === 'flow'

  if (!usePorts) {
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
    const cz = { x: z.x + z.w / 2, y: z.y + z.h / 2 }
    const start = borderTowards(a, cz)
    const end = borderTowards(z, ca)
    const dir = unit(sub(end, start))
    return { d: `M${start.x} ${start.y}L${end.x} ${end.y}`, points: [start, end], start, end, endDir: dir, startDir: dir, mid: polylineMid([start, end]) }
  }

  const start = a.kind === 'flow' || style !== 'straight' ? portPoint(a, pa) : borderTowards(a, portPoint(z, pz))
  const end = z.kind === 'flow' || style !== 'straight' ? portPoint(z, pz) : borderTowards(z, start)

  if (style === 'straight') {
    const dir = unit(sub(end, start))
    return { d: `M${start.x} ${start.y}L${end.x} ${end.y}`, points: [start, end], start, end, endDir: dir, startDir: dir, mid: polylineMid([start, end]) }
  }

  if (style === 'curved') {
    const k = Math.max(30, dist(start, end) / 2.5)
    const c1 = add(start, scale(PORT_DIR[pa], k))
    const c2 = add(end, scale(PORT_DIR[pz], k))
    const points: Vec[] = []
    for (let t = 0; t <= 1.0001; t += 1 / 24) {
      const u = 1 - t
      points.push({
        x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
        y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
      })
    }
    return {
      d: `M${start.x} ${start.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`,
      points,
      start,
      end,
      endDir: unit(sub(end, c2)),
      startDir: unit(sub(c1, start)),
      mid: polylineMid(points),
      curve: [start, c1, c2, end],
    }
  }

  let pts = elbowPoints(start, end, pa)
  // Something in the way: around it.
  let around = false
  if (obstacles.length && pathHits(pts, obstacles)) {
    const way = orthoRoute(a, z, obstacles, [pa, pz], taken)
    if (way) {
      pts = way.points
      around = true
    }
  }
  pts = simplify(pts)
  if (around && taken) take(taken, pts)
  // A way around may leave and arrive by other sides.
  const first = pts[0]
  const last = pts[pts.length - 1]
  return {
    d: roundedPath(pts),
    points: pts,
    start: first,
    end: last,
    endDir: unit(sub(last, pts[pts.length - 2])),
    startDir: unit(sub(pts[1], first)),
    mid: polylineMid(pts),
    ...(around ? { around: true as const } : {}),
  }
}

/** A route moved by (dx, dy): for a line whose two ends moved together. */
export function shiftRoute<R extends Route>(r: R, dx: number, dy: number): R {
  const at = (p: Vec) => ({ x: p.x + dx, y: p.y + dy })
  // Path data is absolute pairs (M, L, Q and C), so every other number is an x.
  let n = 0
  const d = r.d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (v) => String(Number(v) + (n++ % 2 ? dy : dx)))
  return { ...r, d, points: r.points.map(at), start: at(r.start), end: at(r.end), mid: at(r.mid), ...(r.curve ? { curve: r.curve.map(at) as Route['curve'] } : {}) }
}

/** A mind-map branch from parent `p` to idea `n`: a curve from the side of one to the facing side of the other. */
export function mindBranch(n: Item, p: Item): [Vec, Vec, Vec, Vec] {
  const right = n.x >= p.x + p.w / 2
  const x0 = right ? p.x + p.w : p.x
  const y0 = p.y + p.h / 2
  const x1 = right ? n.x : n.x + n.w
  const y1 = n.y + n.h / 2
  const mx = (x0 + x1) / 2
  return [
    { x: x0, y: y0 },
    { x: mx, y: y0 },
    { x: mx, y: y1 },
    { x: x1, y: y1 },
  ]
}
