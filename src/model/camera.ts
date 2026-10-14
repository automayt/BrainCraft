import type { Rect, Vec } from './geom'

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 8

/** Screen = world * zoom + pan, in CSS pixels relative to the canvas. */
export interface Camera {
  x: number
  y: number
  zoom: number
}

export const defaultCamera = (): Camera => ({ x: 80, y: 80, zoom: 1 })

export const toScreen = (c: Camera, p: Vec): Vec => ({ x: p.x * c.zoom + c.x, y: p.y * c.zoom + c.y })
export const toWorld = (c: Camera, p: Vec): Vec => ({ x: (p.x - c.x) / c.zoom, y: (p.y - c.y) / c.zoom })

export function rectToScreen(c: Camera, r: Rect): Rect {
  const p = toScreen(c, r)
  return { x: p.x, y: p.y, w: r.w * c.zoom, h: r.h * c.zoom }
}

export function rectToWorld(c: Camera, r: Rect): Rect {
  const p = toWorld(c, r)
  return { x: p.x, y: p.y, w: r.w / c.zoom, h: r.h / c.zoom }
}

/** Multiplies the zoom by `factor`, keeping the world point under `anchor` still. */
export function zoomAt(c: Camera, anchor: Vec, factor: number): Camera {
  const w = toWorld(c, anchor)
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor))
  return { zoom, x: anchor.x - w.x * zoom, y: anchor.y - w.y * zoom }
}

export function centerOn(c: Camera, world: Vec, viewport: { w: number; h: number }): Camera {
  return { ...c, x: viewport.w / 2 - world.x * c.zoom, y: viewport.h / 2 - world.y * c.zoom }
}

/** Centres `world` in the viewport, zoomed to fit with a margin, never above 100%. */
export function fit(world: Rect, viewport: { w: number; h: number }, margin = 60): Camera {
  const zoom = Math.min(
    1,
    Math.max(
      MIN_ZOOM,
      Math.min((viewport.w - 2 * margin) / Math.max(world.w, 1), (viewport.h - 2 * margin) / Math.max(world.h, 1)),
    ),
  )
  return centerOn({ x: 0, y: 0, zoom }, { x: world.x + world.w / 2, y: world.y + world.h / 2 }, viewport)
}
