import { describe, expect, it } from 'vitest'
import * as B from '../model/board'
import { emptyBoard } from '../model/board'
import { toScreen } from '../model/camera'
import { fractionAlong, pointAlong, route } from '../model/routes'
import { cleanConnector } from '../model/sanitize'
import { fakeMeasure } from '../model/test-helpers'
import type { Board, Connector, Id, Item } from '../model/types'
import { Editor } from './Editor'

/** Three boxes in a row, the first two linked. */
function board(style?: Connector['style']) {
  let b = emptyBoard()
  const add = (x: number, y = 0) => {
    const [n, id] = B.addItem(b, B.newItem('rect', { x, y, w: 100, h: 60 }))
    b = n
    return id
  }
  const a = add(0)
  const c = add(400)
  const d = add(400, 300)
  const [linked, line] = B.connect(b, a, c, style ? { style } : {})
  return { b: linked, a, c, d, line: line! }
}

function editor(start: Board) {
  const e = new Editor(start, fakeMeasure)
  e.camera = { x: 0, y: 0, zoom: 1 }
  return e
}

const connector = (b: Board, id: Id) => B.getConnector(b, id)!
const item = (b: Board, id: Id) => B.getItem(b, id) as Item
const at = (b: Board, id: Id) => route(connector(b, id), item(b, connector(b, id).from), item(b, connector(b, id).to))
const bent = (b: Board, id: Id, x: number, y: number) => B.updateConnector(b, id, (c) => ({ ...c, bend: { x, y } }))

describe('bending a line', () => {
  it('runs a straight line through the bend, its ends aimed there', () => {
    const { b, line } = board()
    const r = at(bent(b, line, 0, -100), line)
    expect(r.knee).toEqual({ x: 250, y: -70 })
    expect(r.points[1]).toEqual(r.knee)
    expect(r.start).toEqual({ x: 100, y: 5 })
    expect(r.end).toEqual({ x: 400, y: 5 })
  })

  it('keeps the bend as its objects move together', () => {
    const { b, a, c, line } = board()
    const moved = B.translate(bent(b, line, 0, -100), new Set([a, c]), 50, 20)
    expect(at(moved, line).knee).toEqual({ x: 300, y: -50 })
  })

  it('runs a curve through the bend at its middle', () => {
    const { b, line } = board('curved')
    const r = at(bent(b, line, 30, 80), line)
    expect(r.knee.x).toBeCloseTo(280)
    expect(r.knee.y).toBeCloseTo(110)
    expect(r.curve).toBeDefined()
  })

  it('slides the stretch across a square-cornered line', () => {
    const { b, a, d } = board()
    const [linked, line] = B.connect(b, a, d, { style: 'elbow' })
    const r = at(bent(linked, line!, -60, 0), line!)
    expect(r.points.map((p) => p.x)).toEqual([100, 190, 190, 400])
  })

  it('steps a square-cornered line out when its ends are in line', () => {
    const { b, line } = board('elbow')
    const r = at(bent(b, line, 0, 150), line)
    expect(r.points.length).toBe(6)
    expect(Math.max(...r.points.map((p) => p.y))).toBe(180)
    expect(r.start).toEqual({ x: 100, y: 30 })
    expect(r.end).toEqual({ x: 400, y: 30 })
  })

  it('leaves a bent line where it was put, even with something in its way', () => {
    let { b, line } = board('elbow')
    ;[b] = B.addItem(b, B.newItem('rect', { x: 200, y: -20, w: 100, h: 100 }))
    expect(B.connectorRoute(b, connector(b, line))!.points.some((p) => p.y < -20 || p.y > 80)).toBe(true)
    const moved = bent(b, line, 0, 200)
    const r = B.connectorRoute(moved, connector(moved, line))!
    expect(Math.max(...r.points.map((p) => p.y))).toBe(230)
  })

  it('goes back to its usual path when dragged close to it', () => {
    const { b, line } = board()
    const c = connector(b, line)
    expect(B.bentTo(b, c, { x: 250, y: 100 }, 8).bend).toEqual({ x: 0, y: 70 })
    expect(B.bentTo(b, { ...c, bend: { x: 0, y: 70 } }, { x: 180, y: 33 }, 8)).not.toHaveProperty('bend')
  })
})

describe('moving a line to other objects', () => {
  it('keeps the line and its look, and drops a bend made for the old ends', () => {
    const { b, a, d, line } = board('curved')
    const next = B.reattach(bent(b, line, 0, 50), line, 'to', d)
    expect(connector(next, line)).toMatchObject({ from: a, to: d, style: 'curved' })
    expect(connector(next, line).bend).toBeUndefined()
  })

  it('refuses a line to itself or one that already exists', () => {
    const { b, a, c, d, line } = board()
    expect(B.reattach(b, line, 'to', a)).toBe(b)
    const [two] = B.connect(b, a, d)
    expect(B.reattach(two, line, 'to', d)).toBe(two)
    expect(B.reattach(b, line, 'to', c)).toBe(b)
  })
})

describe('the handles on a line', () => {
  const mid = (e: Editor, id: Id) => toScreen(e.camera, { x: item(e.board, id).x + 50, y: item(e.board, id).y + 30 })
  const dragEnd = (e: Editor, line: Id, end: 'from' | 'to', to: { x: number; y: number }) => {
    e.selectedConnector = line
    e.pointerDown(to, 0, {}, { kind: 'lineEnd', end })
    e.pointerMove(to)
    e.pointerUp(to)
  }

  it('carries an end to another object, as one undo step', () => {
    const { b, d, line } = board()
    const e = editor(b)
    dragEnd(e, line, 'to', mid(e, d))
    expect(connector(e.board, line).to).toBe(d)
    e.undo()
    expect(connector(e.board, line).to).not.toBe(d)
  })

  it('leaves the line alone when an end is dropped on empty board, a frame or its other end', () => {
    const { b, a, line } = board()
    const [framed, frame] = B.addItem(b, B.newItem('frame', { x: 900, y: 900, w: 300, h: 300 }))
    const e = editor(framed)
    const before = e.board
    dragEnd(e, line, 'to', { x: 800, y: 800 })
    dragEnd(e, line, 'to', { x: item(e.board, frame).x + 150, y: item(e.board, frame).y + 150 })
    dragEnd(e, line, 'to', mid(e, a))
    expect(e.board).toBe(before)
  })

  it('says so when the two are already linked', () => {
    const { b, a, d, line } = board()
    const [two] = B.connect(b, a, d)
    const e = editor(two)
    dragEnd(e, line, 'to', mid(e, d))
    expect(e.board).toBe(two)
    expect(e.status).toMatch(/already linked/)
  })

  it('bends as one undo step, and Esc takes it back', () => {
    const { b, line } = board()
    const e = editor(b)
    const bend = (y: number) => {
      e.selectedConnector = line
      e.pointerDown({ x: 250, y: 30 }, 0, {}, { kind: 'lineBend' })
      e.pointerMove({ x: 250, y: y - 40 })
      e.pointerMove({ x: 250, y })
    }
    bend(200)
    e.pointerUp({ x: 250, y: 200 })
    expect(connector(e.board, line).bend).toEqual({ x: 0, y: 170 })
    e.undo()
    expect(connector(e.board, line).bend).toBeUndefined()
    bend(300)
    e.cancelDrag()
    expect(connector(e.board, line).bend).toBeUndefined()
  })

  it('a click on the bend handle changes nothing', () => {
    const { b, line } = board()
    const e = editor(b)
    e.selectedConnector = line
    e.pointerDown({ x: 250, y: 30 }, 0, {}, { kind: 'lineBend' })
    e.pointerUp({ x: 250, y: 30 })
    expect(e.board).toBe(b)
  })

  it('slides a label along the line, and back to the middle', () => {
    const { b, line } = board()
    const e = editor(B.updateConnector(b, line, (c) => ({ ...c, label: 'then' })))
    e.selectedConnector = line
    e.pointerDown({ x: 250, y: 30 }, 0, {}, { kind: 'lineLabel', id: line })
    e.pointerMove({ x: 325, y: 80 })
    expect(connector(e.board, line).labelAt).toBeCloseTo(0.75)
    expect(B.connectorRoute(e.board, connector(e.board, line))!.mid.x).toBeCloseTo(325)
    e.pointerMove({ x: 255, y: 30 })
    expect(connector(e.board, line).labelAt).toBeUndefined()
    e.pointerMove({ x: 9999, y: 30 })
    expect(connector(e.board, line).labelAt).toBe(0.94)
  })
})

describe('resizing one side', () => {
  const drag = (e: Editor, id: Id, corner: 'n' | 'e' | 's' | 'w', to: { x: number; y: number }) => {
    e.select([id])
    e.pointerDown(to, 0, {}, { kind: 'resize', corner })
    e.pointerMove(to)
    e.pointerUp(to)
    const { x, y, w, h } = item(e.board, id)
    return { x, y, w, h }
  }

  it('moves only the side that was dragged', () => {
    const { b, a } = board()
    const e = editor(b)
    expect(drag(e, a, 'e', { x: 250, y: 900 })).toEqual({ x: 0, y: 0, w: 250, h: 60 })
    expect(drag(e, a, 's', { x: 900, y: 150 })).toEqual({ x: 0, y: 0, w: 250, h: 150 })
    expect(drag(e, a, 'w', { x: 50, y: -400 })).toEqual({ x: 50, y: 0, w: 200, h: 150 })
    expect(drag(e, a, 'n', { x: -400, y: 100 })).toEqual({ x: 50, y: 100, w: 200, h: 50 })
  })
})

describe('along a line', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]

  it('finds a point and how far along one is', () => {
    expect(pointAlong(points, 0.25)).toEqual({ x: 50, y: 0 })
    expect(pointAlong(points, 1)).toEqual({ x: 100, y: 100 })
    expect(fractionAlong(points, { x: 140, y: 50 })).toBeCloseTo(0.75)
    expect(fractionAlong(points, { x: -50, y: 10 })).toBe(0)
  })
})

describe('bends and labels from elsewhere', () => {
  const base = { id: 1, from: 1, to: 2, color: '#000' }

  it('keeps sound ones', () => {
    expect(cleanConnector({ ...base, bend: { x: 3, y: -4 }, labelAt: 0.3 })).toMatchObject({ bend: { x: 3, y: -4 }, labelAt: 0.3 })
  })

  it('drops ones that would break the drawing', () => {
    for (const bend of [{ x: Infinity, y: 0 }, { x: 'a', y: 1 }, { x: 1 }, { x: 1e300, y: 0 }, 7, null]) {
      expect(cleanConnector({ ...base, bend })).not.toHaveProperty('bend')
    }
    for (const labelAt of [-1, 2, NaN, '0.5']) expect(cleanConnector({ ...base, labelAt })).not.toHaveProperty('labelAt')
  })
})
