import { describe, expect, it } from 'vitest'
import { toScreen } from '../../model/camera'
import { placement } from './placement'

describe('a drawing open on the board', () => {
  it('shows each scene point where the board shows it, and moves the board with Excalidraw’s view', () => {
    const p = placement(0.5, 300, -40)
    const camera = { x: 120, y: 75, zoom: 1.6 }
    const view = p.view(camera)
    // Excalidraw puts scene point q on screen at (q + scroll) * zoom; the board at its world point.
    for (const q of [{ x: 0, y: 0 }, { x: 250, y: -90 }, { x: -13, y: 777 }]) {
      const board = toScreen(camera, { x: p.ox + q.x * p.s, y: p.oy + q.y * p.s })
      expect((q.x + view.scrollX) * view.zoom).toBeCloseTo(board.x, 9)
      expect((q.y + view.scrollY) * view.zoom).toBeCloseTo(board.y, 9)
    }
    // And back: the camera for that view is the one it came from.
    const back = p.camera(view.scrollX, view.scrollY, view.zoom)
    expect(back.x).toBeCloseTo(camera.x, 9)
    expect(back.y).toBeCloseTo(camera.y, 9)
    expect(back.zoom).toBeCloseTo(camera.zoom, 9)
    // Its rectangle on the board.
    expect(p.rect(10, 20, 100, 50)).toEqual({ x: 305, y: -30, w: 50, h: 25 })
  })
})
