import { describe, expect, it } from 'vitest'
import { addItem, connect, emptyBoard, hiddenIds, newItem, routesOf } from './board'
import { HOP, type Line, boardHops, hopPoints, hoppedPaths } from './hops'
import type { Vec } from './geom'
import type { Board, Id } from './types'

const poly = (key: string, ...points: [number, number][]): Line => ({ key, shape: { kind: 'poly', points: points.map(([x, y]) => ({ x, y })), radius: 10 } })

/** The arcs in path data: where each starts and ends, and which way it bulges. */
function arcs(d: string): { from: Vec; to: Vec; sweep: number }[] {
  const out: { from: Vec; to: Vec; sweep: number }[] = []
  const re = /([MLQCA])([^MLQCA]*)/g
  let at: Vec = { x: 0, y: 0 }
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const n = m[2].trim().split(/[ ,]+/).filter(Boolean).map(Number)
    const to = { x: n[n.length - 2], y: n[n.length - 1] }
    if (m[1] === 'A') out.push({ from: at, to, sweep: n[4] })
    at = to
  }
  return out
}

describe('lines hopping over each other', () => {
  it('hops the level line over the upright one where they cross', () => {
    const paths = hoppedPaths([poly('down', [100, 0], [100, 200]), poly('across', [0, 100], [200, 100])])
    expect(paths.has('down')).toBe(false)
    const [hop] = arcs(paths.get('across')!)
    expect(hop.from).toEqual({ x: 100 - HOP, y: 100 })
    expect(hop.to).toEqual({ x: 100 + HOP, y: 100 })
    // Going right, the arc bulges up; going left, it still bulges up.
    expect(hop.sweep).toBe(1)
    expect(arcs(hoppedPaths([poly('down', [100, 0], [100, 200]), poly('back', [200, 100], [0, 100])]).get('back')!)[0].sweep).toBe(0)
  })

  it('hops the later of two lines crossing at the same slant', () => {
    const paths = hoppedPaths([poly('first', [0, 0], [200, 200]), poly('second', [0, 200], [200, 0])])
    expect([...paths.keys()]).toEqual(['second'])
  })

  it('leaves lines that meet at an end, or run nearly alongside, alone', () => {
    // A line ending on another, and two lines from the same point.
    expect(hopPoints([poly('a', [0, 100], [200, 100]), poly('b', [100, 0], [100, 100])]).size).toBe(0)
    expect(hopPoints([poly('a', [0, 0], [200, 0]), poly('b', [0, 0], [0, 200])]).size).toBe(0)
    // A shallow crossing.
    expect(hopPoints([poly('a', [0, 100], [400, 100]), poly('b', [0, 70], [400, 130])]).size).toBe(0)
  })

  it('makes crossings close together one wider hop', () => {
    const lines = [poly('a', [100, 0], [100, 200]), poly('b', [106, 0], [106, 200]), poly('across', [0, 100], [200, 100])]
    const hops = arcs(hoppedPaths(lines).get('across')!)
    expect(hops).toHaveLength(1)
    expect(hops[0].from.x).toBe(100 - HOP)
    expect(hops[0].to.x).toBe(106 + HOP)
  })

  it('keeps square corners and their rounding, hopping on the straight parts', () => {
    // An elbow: across, down, across again; an upright line crosses its first stretch.
    const d = hoppedPaths([poly('up', [60, 0], [60, 100]), poly('elbow', [0, 50], [150, 50], [150, 200], [300, 200])]).get('elbow')!
    expect(arcs(d)).toHaveLength(1)
    expect(d).toContain('Q150 50 150 60')
    expect(d.endsWith('L300 200')).toBe(true)
  })

  it('hops on curves, at the crossing', () => {
    const curve: Line = { key: 'curve', shape: { kind: 'cubic', p: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 200, y: 200 }] } }
    const paths = hoppedPaths([poly('down', [150, 0], [150, 300]), poly('across', [0, 150], [10, 150]), curve, poly('flat', [0, 100], [200, 100])])
    // The flat line hops the curve where it crosses (100, 100), not the other way around.
    const [hop] = arcs(paths.get('flat')!)
    expect(hop.from.x).toBeCloseTo(100 - HOP, 0)
    // The curve, more level than the upright line where they cross, hops it.
    const [over] = arcs(paths.get('curve')!)
    expect((over.from.x + over.to.x) / 2).toBeCloseTo(150, 0)
    expect(paths.get('curve')!.startsWith('M0 0C')).toBe(true)
    expect(paths.get('curve')!.endsWith('200 200')).toBe(true)
  })

  it('finds every crossing on a board full of lines', () => {
    const lines: Line[] = []
    for (let k = 0; k < 30; k++) lines.push(poly(`v${k}`, [k * 40 + 20, 0], [k * 40 + 20, 1200]))
    for (let k = 0; k < 30; k++) lines.push(poly(`h${k}`, [0, k * 40 + 20], [1200, k * 40 + 20]))
    const paths = hoppedPaths(lines)
    expect(paths.size).toBe(30)
    for (let k = 0; k < 30; k++) expect(arcs(paths.get(`h${k}`)!)).toHaveLength(30)
  })
})

describe('hops on a board', () => {
  it('a connector hops a mind-map branch, and lines into hidden ideas don’t count', () => {
    let b: Board = emptyBoard()
    let root: Id, idea: Id, top: Id, bottom: Id
    ;[b, root] = addItem(b, newItem('mind', { x: 0, y: 0, w: 120, h: 50 }, { text: 'Map' }))
    ;[b, idea] = addItem(b, newItem('mind', { x: 400, y: 300, w: 120, h: 50 }, { text: 'Idea', parent: root, side: 'right' }))
    ;[b, top] = addItem(b, newItem('rect', { x: 200, y: -300, w: 100, h: 60 }, { text: 'Top' }))
    ;[b, bottom] = addItem(b, newItem('rect', { x: 200, y: 600, w: 100, h: 60 }, { text: 'Bottom' }))
    b = connect(b, top, bottom)[0]
    const hops = boardHops(b, routesOf(b), hiddenIds(b))
    // The branch runs level-ish where the upright connector crosses it, so the branch hops.
    expect([...hops.keys()]).toEqual([`m${idea}`])
    expect(arcs(hops.get(`m${idea}`)!)).toHaveLength(1)
    // Folded away, the branch isn't drawn, so nothing hops.
    const folded = { ...b, items: b.items.map((i) => (i.id === root ? { ...i, collapsed: true } : i)) }
    expect(boardHops(folded, routesOf(folded), hiddenIds(folded)).size).toBe(0)
  })

  it('square-cornered flowchart lines that cross hop', () => {
    let b: Board = emptyBoard()
    const ids: Id[] = []
    for (const [x, y] of [
      [0, 200],
      [600, 200],
      [300, 0],
      [300, 400],
    ]) {
      let id: Id
      ;[b, id] = addItem(b, newItem('flow', { x, y, w: 120, h: 60 }, { text: 'Step', shape: 'process' }))
      ids.push(id)
    }
    b = connect(b, ids[0], ids[1], { style: 'elbow' })[0]
    b = connect(b, ids[2], ids[3], { style: 'elbow' })[0]
    const routes = routesOf(b)
    const hops = boardHops(b, routes, hiddenIds(b))
    expect(hops.size).toBe(1)
    const [line] = [...hops.values()]
    expect(arcs(line)).toHaveLength(1)
    // Kept while nothing moves.
    expect(boardHops(b, routes, hiddenIds(b))).toBe(boardHops(b, routes, hiddenIds(b)))
  })
})
