import type { Camera } from '../../model/camera'

/**
 * Where a drawing's scene sits on the board: a scene point `p` is at `o + p * s` (for as long as
 * it's open), and the camera conversions that follow from it.
 */
export function placement(s: number, ox: number, oy: number) {
  return {
    s,
    ox,
    oy,
    /** Excalidraw's view showing what the board camera `c` shows. */
    view: (c: Camera) => ({ zoom: c.zoom * s, scrollX: (ox * c.zoom + c.x) / (s * c.zoom), scrollY: (oy * c.zoom + c.y) / (s * c.zoom) }),
    /** The board camera showing what Excalidraw's view shows. */
    camera: (scrollX: number, scrollY: number, zoom: number): Camera => {
      const z = zoom / s
      return { zoom: z, x: scrollX * zoom - ox * z, y: scrollY * zoom - oy * z }
    },
    /** The board rectangle of a scene rectangle. */
    rect: (x: number, y: number, w: number, h: number) => ({ x: ox + x * s, y: oy + y * s, w: w * s, h: h * s }),
  }
}
