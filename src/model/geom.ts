/** Geometry helpers. All rectangles are axis-aligned `{x, y, w, h}` with non-negative size. */

export interface Vec {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const vec = (x: number, y: number): Vec => ({ x, y })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const len = (a: Vec): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)

export function rectFromPoints(a: Vec, b: Vec): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function rectFromCenter(c: Vec, w: number, h: number): Rect {
  return { x: c.x - w / 2, y: c.y - h / 2, w, h }
}

export const center = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

export function expand(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }
}

export function contains(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function unionAll(rects: Iterable<Rect>): Rect | null {
  let out: Rect | null = null
  for (const r of rects) out = out ? union(out, r) : r
  return out
}

export function boundsOf(points: readonly Vec[]): Rect | null {
  return unionAll(points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))
}

/** Shortest distance from `p` to the segment `a`–`b`. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a)
  const l2 = ab.x * ab.x + ab.y * ab.y
  if (l2 === 0) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2))
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })
}

/** Where the ray from the centre of `r` towards `toward` leaves the rectangle. */
export function rectBorderPoint(r: Rect, toward: Vec): Vec {
  const c = center(r)
  const d = sub(toward, c)
  if (d.x === 0 && d.y === 0) return c
  const tx = d.x !== 0 ? r.w / 2 / Math.abs(d.x) : Infinity
  const ty = d.y !== 0 ? r.h / 2 / Math.abs(d.y) : Infinity
  return add(c, scale(d, Math.min(tx, ty)))
}

/** Where the ray from the centre of the ellipse inscribed in `r` towards `toward` leaves it. */
export function ellipseBorderPoint(r: Rect, toward: Vec): Vec {
  const c = center(r)
  const d = sub(toward, c)
  if (d.x === 0 && d.y === 0) return c
  const k = Math.hypot(d.x / (r.w / 2), d.y / (r.h / 2))
  return add(c, scale(d, 1 / k))
}

export function ellipseContains(r: Rect, p: Vec): boolean {
  if (r.w <= 0 || r.h <= 0) return false
  const c = center(r)
  return ((p.x - c.x) / (r.w / 2)) ** 2 + ((p.y - c.y) / (r.h / 2)) ** 2 <= 1
}

/** Map `p` from `from` into `to`, preserving its relative position. */
export function remap(p: Vec, from: Rect, to: Rect): Vec {
  const sx = from.w > 0 ? to.w / from.w : 1
  const sy = from.h > 0 ? to.h / from.h : 1
  return { x: to.x + (p.x - from.x) * sx, y: to.y + (p.y - from.y) * sy }
}
