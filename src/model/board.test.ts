import { describe, expect, it } from 'vitest'
import * as B from './board'
import { fit, toScreen, toWorld, zoomAt, MAX_ZOOM } from './camera'
import { History } from './history'
import { clipFromText, clipToText, fromJson, toJson, welcomeBoard } from './serialize'
import type { Board } from './types'

const sticky = (x: number, y: number) => B.newItem('sticky', { x, y, w: 100, h: 100 })

function add(b: Board, ...items: ReturnType<typeof sticky>[]): [Board, number[]] {
  const ids: number[] = []
  for (const i of items) {
    let id: number
    ;[b, id] = B.addItem(b, i)
    ids.push(id)
  }
  return [b, ids]
}

describe('board', () => {
  it('hands out unique, increasing ids', () => {
    let [b, [a, c]] = add(B.emptyBoard(), sticky(0, 0), sticky(200, 0))
    let k: number | null
    ;[b, k] = B.connect(b, a, c)
    expect(a).toBeLessThan(c)
    expect(c).toBeLessThan(k!)
  })

  it('rejects self, dangling and duplicate connectors', () => {
    let [b, [a, c]] = add(B.emptyBoard(), sticky(0, 0), sticky(200, 0))
    expect(B.connect(b, a, a)[1]).toBeNull()
    expect(B.connect(b, a, 999)[1]).toBeNull()
    ;[b] = B.connect(b, a, c)
    expect(B.connect(b, a, c)[1]).toBeNull()
  })

  it('drops connectors with removed items', () => {
    let [b, [a, c, d]] = add(B.emptyBoard(), sticky(0, 0), sticky(200, 0), sticky(400, 0))
    ;[b] = B.connect(b, a, c)
    ;[b] = B.connect(b, c, d)
    b = B.remove(b, new Set([a]))
    expect(b.items).toHaveLength(2)
    expect(b.connectors).toHaveLength(1)
    expect(b.connectors[0].from).toBe(c)
  })

  it('hit-tests the top item first and frames last', () => {
    let b = B.emptyBoard()
    let frame: number
    ;[b, frame] = B.addItem(b, B.newItem('frame', { x: -50, y: -50, w: 500, h: 500 }))
    const [b2, [low, high]] = add(b, sticky(0, 0), sticky(50, 50))
    b = b2
    expect(B.hitTest(b, { x: 75, y: 75 }, 0)).toEqual({ type: 'item', id: high })
    expect(B.hitTest(b, { x: 10, y: 10 }, 0)).toEqual({ type: 'item', id: low })
    expect(B.hitTest(b, { x: 300, y: 300 }, 0)).toEqual({ type: 'item', id: frame })
    expect(B.hitTest(b, { x: 0, y: -60 }, 0)).toEqual({ type: 'item', id: frame })
    expect(B.hitTest(b, { x: 1000, y: 0 }, 0)).toBeNull()
    b = B.bringToFront(b, new Set([frame]))
    expect(B.hitTest(b, { x: 10, y: 10 }, 0)).toEqual({ type: 'item', id: low })
  })

  it('hit-tests connectors and clips them to item outlines', () => {
    let [b, [a, c]] = add(B.emptyBoard(), sticky(0, 0), sticky(400, 0))
    let k: number | null
    ;[b, k] = B.connect(b, a, c)
    expect(B.hitTest(b, { x: 250, y: 52 }, 0)).toEqual({ type: 'connector', id: k })
    expect(B.connectorEndpoints(b, B.getConnector(b, k!)!)).toEqual([
      { x: 100, y: 50 },
      { x: 400, y: 50 },
    ])
  })

  it('hit-tests ellipses and drawings by shape', () => {
    const e = { ...B.newItem('ellipse', { x: 0, y: 0, w: 100, h: 100 }), id: 1 }
    expect(B.hitItem(e, { x: 50, y: 50 }, 0)).toBe(true)
    expect(B.hitItem(e, { x: 3, y: 3 }, 0)).toBe(false)
    const p = { ...B.penItem([{ x: 0, y: 0 }, { x: 100, y: 0 }], '#000', 4), id: 2 }
    expect(B.hitItem(p, { x: 50, y: 3 }, 2)).toBe(true)
    expect(B.hitItem(p, { x: 50, y: 20 }, 2)).toBe(false)
  })

  it('moves frames with their contents', () => {
    let b = B.emptyBoard()
    let frame: number
    ;[b, frame] = B.addItem(b, B.newItem('frame', { x: 0, y: 0, w: 500, h: 500 }))
    const [b2, [inside, outside]] = add(b, sticky(10, 10), sticky(600, 0))
    b = b2
    const moving = B.movingSet(b, new Set([frame]))
    expect(moving).toEqual(new Set([frame, inside]))
    b = B.translate(b, moving, 10, 20)
    expect(B.getItem(b, inside)).toMatchObject({ x: 20, y: 30 })
    expect(B.getItem(b, outside)).toMatchObject({ x: 600, y: 0 })
  })

  it('scales drawings when resized', () => {
    const p = { ...B.penItem([{ x: 0, y: 0 }, { x: 10, y: 10 }], '#000', 0), id: 1 }
    expect(B.setRect(p, { x: 0, y: 0, w: 20, h: 40 }).points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 40 },
    ])
  })

  it('reorders layers', () => {
    const [b, [a, c, d]] = add(B.emptyBoard(), sticky(0, 0), sticky(0, 0), sticky(0, 0))
    const front = B.bringToFront(b, new Set([a]))
    expect(front.items.map((i) => i.id)).toEqual([c, d, a])
    expect(B.sendToBack(front, new Set([d])).items.map((i) => i.id)).toEqual([d, c, a])
  })

  it('copies items with the connectors between them', () => {
    let [b, [a, c, d]] = add(B.emptyBoard(), sticky(0, 0), sticky(200, 0), sticky(400, 0))
    ;[b] = B.connect(b, a, c)
    ;[b] = B.connect(b, c, d)
    const [after, ids] = B.paste(b, B.copy(b, new Set([a, c])), 0, 300)
    expect(ids.size).toBe(2)
    expect(after.items).toHaveLength(5)
    expect(after.connectors).toHaveLength(3)
    const last = after.connectors[2]
    expect(ids.has(last.from) && ids.has(last.to)).toBe(true)
    expect(B.getItem(after, last.from)).toMatchObject({ x: 0, y: 300 })
    expect(new Set(after.items.map((i) => i.id)).size).toBe(5)
  })
})

describe('history', () => {
  it('undoes and redoes, and forgets redo after a new change', () => {
    const h = new History()
    let b = B.emptyBoard()
    const before = b
    ;[b] = B.addItem(b, sticky(0, 0))
    expect(h.commit(before, b)).toBe(true)
    expect(h.commit(b, b)).toBe(false)
    const undone = h.undo()!.before
    expect(undone.items).toHaveLength(0)
    expect(h.redo()!.after.items).toHaveLength(1)
    h.undo()
    h.commit(undone, B.addItem(undone, sticky(5, 5))[0])
    expect(h.canRedo).toBe(false)
  })
})

describe('camera', () => {
  it('round-trips and zooms about an anchor', () => {
    let c = { x: 10, y: -20, zoom: 2.5 }
    const p = { x: 123, y: -45 }
    const back = toWorld(c, toScreen(c, p))
    expect(back.x).toBeCloseTo(p.x)
    const anchor = { x: 300, y: 200 }
    const w = toWorld(c, anchor)
    c = zoomAt(c, anchor, 1.5)
    expect(toWorld(c, anchor).x).toBeCloseTo(w.x)
    expect(zoomAt(c, anchor, 1000).zoom).toBe(MAX_ZOOM)
  })

  it('fits content in the viewport', () => {
    const c = fit({ x: 1000, y: 1000, w: 200, h: 100 }, { w: 800, h: 600 })
    expect(c.zoom).toBe(1)
    expect(toScreen(c, { x: 1100, y: 1050 })).toEqual({ x: 400, y: 300 })
  })
})

describe('serialize', () => {
  it('round-trips boards and repairs ids', () => {
    const b = welcomeBoard()
    expect(fromJson(toJson(b))).toEqual(b)
    const broken = fromJson(toJson({ ...b, nextId: 1 }))
    expect(broken.nextId).toBe(b.nextId)
  })

  it('drops malformed items and dangling references', () => {
    const json = JSON.stringify({
      title: 'x',
      items: [
        { id: 1, kind: 'sticky', x: 0, y: 0, w: 1, h: 1, color: '#fff', text: '', fontSize: 12 },
        { id: 2, kind: 'mind', x: 0, y: 0, w: 1, h: 1, color: '#fff', text: '', fontSize: 12, parent: 99, side: 'left' },
        { id: 3, kind: 'bogus' },
      ],
      connectors: [
        { id: 4, from: 1, to: 2, color: '#000' },
        { id: 5, from: 1, to: 3, color: '#000' },
      ],
    })
    const b = fromJson(json)
    expect(b.items.map((i) => i.id)).toEqual([1, 2])
    expect(b.items[1].parent).toBeUndefined()
    expect(b.connectors.map((c) => c.id)).toEqual([4])
    expect(b.nextId).toBe(5)
    expect(() => fromJson('{"hello":1}')).toThrow()
  })

  it('round-trips clipboard payloads and ignores other text', () => {
    const b = welcomeBoard()
    const clip = B.copy(b, new Set([b.items[2].id]))
    expect(clipFromText(clipToText(clip))).toEqual(clip)
    expect(clipFromText('just text')).toBeNull()
  })
})
