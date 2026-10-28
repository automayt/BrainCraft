/** Geometry of flowchart symbols: outlines, hit areas, text areas and connection ports. */

import { type Rect, type Vec, contains, expand } from './geom'
import type { Item } from './types'

export type Port = 'n' | 'e' | 's' | 'w'

export const PORT_DIR: Record<Port, Vec> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
}

/** Horizontal slant of an input/output parallelogram. */
const slant = (r: Rect) => Math.min(r.w * 0.15, r.h * 0.5)
/** Height of a database cylinder's top ellipse. */
const capRy = (r: Rect) => Math.min(r.h * 0.12, 14)

/** SVG path of the symbol's outline. */
export function flowOutline(i: Item): string {
  const { x, y, w, h } = i
  switch (i.shape) {
    case 'decision':
      return `M${x + w / 2} ${y}L${x + w} ${y + h / 2}L${x + w / 2} ${y + h}L${x} ${y + h / 2}Z`
    case 'terminator': {
      const r = Math.min(h / 2, w / 2)
      return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
    }
    case 'data': {
      const s = slant(i)
      return `M${x + s} ${y}H${x + w}L${x + w - s} ${y + h}H${x}Z`
    }
    case 'document':
      return `M${x} ${y}H${x + w}V${y + h * 0.85}C${x + w * 0.75} ${y + h * 0.7} ${x + w * 0.25} ${y + h * 1.0} ${x} ${y + h * 0.85}Z`
    case 'database': {
      const ry = capRy(i)
      return `M${x} ${y + ry}A${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry}Z`
    }
    default: {
      const r = Math.min(6, w / 4, h / 4)
      return `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`
    }
  }
}

/** Extra strokes drawn on top of the outline (cylinder rim, subprocess bars). */
export function flowDetail(i: Item): string | null {
  const { x, y, w, h } = i
  if (i.shape === 'database') {
    const ry = capRy(i)
    return `M${x} ${y + ry}A${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}`
  }
  if (i.shape === 'subroutine') {
    const d = Math.min(12, w * 0.08)
    return `M${x + d} ${y}V${y + h}M${x + w - d} ${y}V${y + h}`
  }
  return null
}

export function flowHit(i: Item, p: Vec, tol: number): boolean {
  if (i.shape === 'decision') {
    const dx = Math.abs(p.x - (i.x + i.w / 2)) / (i.w / 2 + tol)
    const dy = Math.abs(p.y - (i.y + i.h / 2)) / (i.h / 2 + tol)
    return dx + dy <= 1
  }
  return contains(expand(i, tol), p)
}

/** The area text is laid out in. */
export function flowTextRect(i: Item): Rect {
  let [l, t, r, b] = [12, 8, 12, 8]
  switch (i.shape) {
    case 'decision':
      ;[l, t, r, b] = [i.w * 0.2, i.h * 0.18, i.w * 0.2, i.h * 0.18]
      break
    case 'data':
      l = r = slant(i) + 8
      break
    case 'document':
      b = i.h * 0.18
      break
    case 'database':
      t = capRy(i) * 2 + 4
      break
    case 'subroutine':
      l = r = Math.min(12, i.w * 0.08) + 8
      break
    case 'terminator':
      l = r = Math.min(i.h / 2, i.w / 4)
      break
  }
  return { x: i.x + l, y: i.y + t, w: Math.max(1, i.w - l - r), h: Math.max(1, i.h - t - b) }
}

/** The area a shape's or sticky note's text is laid out in (an ellipse's: the box inside it). */
export function textRect(i: Item): Rect {
  if (i.kind === 'flow') return flowTextRect(i)
  const [mx, my] = i.kind === 'ellipse' ? [i.w * 0.15 + 4, i.h * 0.15 + 4] : [Math.min(14, i.w / 6), Math.min(14, i.h / 6)]
  return { x: i.x + mx, y: i.y + my, w: Math.max(1, i.w - 2 * mx), h: Math.max(1, i.h - 2 * my) }
}

/** Where connectors attach on each side. */
export function portPoint(i: Item, port: Port): Vec {
  const cx = i.x + i.w / 2
  const cy = i.y + i.h / 2
  switch (port) {
    case 'n':
      return { x: cx, y: i.y }
    case 's':
      return { x: cx, y: i.kind === 'flow' && i.shape === 'document' ? i.y + i.h * 0.85 : i.y + i.h }
    case 'e':
      return { x: i.kind === 'flow' && i.shape === 'data' ? i.x + i.w - slant(i) / 2 : i.x + i.w, y: cy }
    case 'w':
      return { x: i.kind === 'flow' && i.shape === 'data' ? i.x + slant(i) / 2 : i.x, y: cy }
  }
}

/** The pair of facing sides to join `a` to `z`: vertical when they are further apart vertically. */
export function facingPorts(a: Rect, z: Rect): [Port, Port] {
  const dx = z.x + z.w / 2 - (a.x + a.w / 2)
  const dy = z.y + z.h / 2 - (a.y + a.h / 2)
  const gapX = Math.abs(dx) - (a.w + z.w) / 2
  const gapY = Math.abs(dy) - (a.h + z.h) / 2
  if (gapY >= gapX) return dy >= 0 ? ['s', 'n'] : ['n', 's']
  return dx >= 0 ? ['e', 'w'] : ['w', 'e']
}
