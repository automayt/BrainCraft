import { describe, expect, it } from 'vitest'
import { addItem, connect, connectorRoute, emptyBoard, getItem, hitItem, hitTest } from './board'
import * as F from './flowchart'
import { route } from './routes'
import { facingPorts, flowTextRect, portPoint } from './shapes'
import type { Board, Item } from './types'

const flow = (b: Board, shape: Parameters<typeof F.flowItem>[0], x: number, y: number): [Board, number] =>
  addItem(b, F.flowItem(shape, { x, y }))

describe('flowchart shapes', () => {
  it('hit-tests a decision as a diamond', () => {
    const d = { ...F.flowItem('decision', { x: 0, y: 0 }, { w: 100, h: 100 }), id: 1 } as Item
    expect(hitItem(d, { x: 0, y: 0 }, 0)).toBe(true)
    expect(hitItem(d, { x: 40, y: 40 }, 0)).toBe(false)
    expect(hitItem(d, { x: 49, y: 0 }, 0)).toBe(true)
  })

  it('keeps text inside the symbol', () => {
    const d = { ...F.flowItem('decision', { x: 0, y: 0 }, { w: 100, h: 100 }), id: 1 } as Item
    const t = flowTextRect(d)
    expect(t.x).toBeGreaterThan(d.x)
    expect(t.x + t.w).toBeLessThan(d.x + d.w)
  })

  it('chooses facing sides', () => {
    const a = { x: 0, y: 0, w: 100, h: 50 }
    expect(facingPorts(a, { x: 0, y: 200, w: 100, h: 50 })).toEqual(['s', 'n'])
    expect(facingPorts(a, { x: 0, y: -200, w: 100, h: 50 })).toEqual(['n', 's'])
    expect(facingPorts(a, { x: 300, y: 20, w: 100, h: 50 })).toEqual(['e', 'w'])
    expect(facingPorts(a, { x: -300, y: 0, w: 100, h: 50 })).toEqual(['w', 'e'])
  })
})

describe('connector routes', () => {
  const a = { ...F.flowItem('process', { x: 0, y: 0 }, { w: 100, h: 60 }), id: 1 } as Item
  const z = { ...F.flowItem('process', { x: 200, y: 200 }, { w: 100, h: 60 }), id: 2 } as Item

  it('runs elbows square out of the sides, turning halfway', () => {
    const r = route({ id: 3, from: 1, to: 2, color: '#000', style: 'elbow' }, a, z)
    expect(r.points).toEqual([
      { x: 0, y: 30 },
      { x: 0, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 170 },
    ])
    expect(r.endDir).toEqual({ x: 0, y: 1 })
    expect(r.mid).toEqual({ x: 100, y: 100 })
  })

  it('straightens an elbow between aligned shapes', () => {
    const below = { ...z, x: a.x, y: 150 }
    const r = route({ id: 3, from: 1, to: 2, color: '#000', style: 'elbow' }, a, below)
    expect(r.points).toHaveLength(2)
  })

  it('attaches straight lines to flowchart ports and curved lines leave square', () => {
    const s = route({ id: 3, from: 1, to: 2, color: '#000' }, a, z)
    expect(s.start).toEqual(portPoint(a, 's'))
    const c = route({ id: 3, from: 1, to: 2, color: '#000', style: 'curved' }, a, z)
    expect(c.startDir).toEqual({ x: 0, y: 1 })
    expect(c.points.length).toBeGreaterThan(10)
  })

  it('hit-tests elbow connectors along their bends', () => {
    let b = emptyBoard()
    let p: number, q: number, k: number | null
    ;[b, p] = flow(b, 'process', 0, 0)
    ;[b, q] = flow(b, 'process', 400, 300)
    ;[b, k] = connect(b, p, q, { style: 'elbow' })
    const r = connectorRoute(b, b.connectors[0])!
    expect(hitTest(b, r.points[1], 0)).toEqual({ type: 'connector', id: k })
    expect(hitTest(b, { x: r.points[0].x + 150, y: r.points[0].y + 10 }, 0)).toBeNull()
  })
})

describe('adding steps', () => {
  it('places the next step below, aligned, and links it with an elbow', () => {
    let b = emptyBoard()
    let start: number, next: number | null
    ;[b, start] = flow(b, 'terminator', 0, 0)
    ;[b, next] = F.addStep(b, start, 'down')
    const s = getItem(b, start)!
    const n = getItem(b, next!)!
    expect(n.shape).toBe('process')
    expect(n.x + n.w / 2).toBeCloseTo(s.x + s.w / 2)
    expect(n.y).toBeCloseTo(s.y + s.h + F.FLOW_GAP)
    expect(b.connectors).toMatchObject([{ from: start, to: next, style: 'elbow' }])
  })

  it('keeps the flow direction from the incoming link', () => {
    let b = emptyBoard()
    let a: number, c: number | null
    ;[b, a] = flow(b, 'process', 0, 0)
    ;[b, c] = F.addStep(b, a, 'right')
    expect(F.flowDirection(b, c!)).toBe('right')
    expect(F.flowDirection(b, a)).toBe('down')
  })

  it('slides past shapes already in the way', () => {
    let b = emptyBoard()
    let a: number, first: number | null, second: number | null
    ;[b, a] = flow(b, 'decision', 0, 0)
    ;[b, first] = F.addStep(b, a, 'down')
    ;[b, second] = F.addStep(b, a, 'down')
    const p = getItem(b, first!)!
    const q = getItem(b, second!)!
    expect(q.x).toBeGreaterThan(p.x + p.w)
    expect(q.y).toBeCloseTo(p.y)
  })

  it('matches the size of a same-shaped neighbour', () => {
    let b = emptyBoard()
    let a: number, c: number | null
    ;[b, a] = addItem(b, F.flowItem('process', { x: 0, y: 0 }, { w: 300, h: 120 }))
    ;[b, c] = F.addStep(b, a, 'down')
    expect(getItem(b, c!)).toMatchObject({ w: 300, h: 120 })
  })
})

describe('shape recommendations', () => {
  it('follows convention, then what this board does most', () => {
    let b = emptyBoard()
    expect(F.recommendShapes(b, 'decision').slice(0, 3)).toEqual(['process', 'decision', 'terminator'])
    let d: number
    ;[b, d] = flow(b, 'decision', 0, 0)
    ;[b] = F.addStep(b, d, 'down', 'terminator')
    ;[b] = F.addStep(b, d, 'right', 'terminator')
    expect(F.recommendShapes(b, 'decision')[0]).toBe('terminator')
    expect(F.recommendShapes(b, 'decision')).toHaveLength(7)
  })

  it('adds a chosen step where it was dropped', () => {
    let b = emptyBoard()
    let a: number, z: number
    ;[b, a] = flow(b, 'process', 0, 0)
    ;[b, z] = F.addStepAt(b, a, 'data', { x: 500, y: 400 })
    expect(getItem(b, z)).toMatchObject({ shape: 'data' })
    expect(getItem(b, z)!.x + getItem(b, z)!.w / 2).toBe(500)
    expect(b.connectors).toHaveLength(1)
  })
})
