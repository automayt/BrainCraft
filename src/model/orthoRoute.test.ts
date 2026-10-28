import { describe, expect, it } from 'vitest'
import { connectorRoute, emptyBoard, getItem, routeBetween, routesOf } from './board'
import { insertMermaid, parseMermaid } from './mermaid'
import { pathHits } from './orthoRoute'
import { route } from './routes'
import type { Board, Connector, Item } from './types'

const box = (id: number, x: number, y: number, w = 160, h = 80): Item => ({ id, kind: 'flow', shape: 'process', x, y, w, h, color: '#fff', text: '', fontSize: 17 })
const elbow = (from: number, to: number): Connector => ({ id: 100 + from * 10 + to, from, to, style: 'elbow', color: '#888' })

/** Lines that pass through a shape other than their own two ends. */
function throughShapes(b: Board): string[] {
  const out: string[] = []
  for (const c of b.connectors) {
    const r = connectorRoute(b, c)!
    // A hair inside each shape, so touching an edge doesn't count.
    const others = b.items.filter((i) => i.id !== c.from && i.id !== c.to).map((i) => ({ x: i.x + 1, y: i.y + 1, w: i.w - 2, h: i.h - 2 }))
    if (pathHits(r.points, others)) out.push(`${getItem(b, c.from)!.text} → ${getItem(b, c.to)!.text}`)
  }
  return out
}

const chart = (mermaid: string) => insertMermaid(emptyBoard(), parseMermaid(mermaid), { x: 0, y: 0 })[0]

describe('lines around shapes', () => {
  it('go around a shape in the way, leaving and arriving at the ends’ sides', () => {
    const a = box(1, 0, 0)
    const mid = box(2, 0, 160)
    const z = box(3, 0, 320)
    const plain = route(elbow(1, 3), a, z)
    expect(pathHits(plain.points, [mid])).toBe(true)
    const r = route(elbow(1, 3), a, z, [mid])
    expect(pathHits(r.points, [mid])).toBe(false)
    // Starts on a's edge and ends on z's.
    const onEdge = (p: { x: number; y: number }, i: Item) => (Math.abs(p.x - i.x) < 0.6 || Math.abs(p.x - i.x - i.w) < 0.6 || Math.abs(p.y - i.y) < 0.6 || Math.abs(p.y - i.y - i.h) < 0.6) && p.x >= i.x - 0.6 && p.x <= i.x + i.w + 0.6 && p.y >= i.y - 0.6 && p.y <= i.y + i.h + 0.6
    expect(onEdge(r.start, a)).toBe(true)
    expect(onEdge(r.end, z)).toBe(true)
    // Every turn is square.
    for (let k = 1; k < r.points.length; k++) {
      const [p, q] = [r.points[k - 1], r.points[k]]
      expect(Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01).toBe(true)
    }
  })

  it('leave a clear line alone', () => {
    const a = box(1, 0, 0)
    const z = box(3, 0, 320)
    const aside = box(2, 400, 160)
    expect(route(elbow(1, 3), a, z, [aside]).points).toEqual(route(elbow(1, 3), a, z).points)
  })

  it('keep the same route until something near moves', () => {
    const b: Board = { ...emptyBoard(), items: [box(1, 0, 0), box(2, 0, 160), box(3, 0, 320)], connectors: [elbow(1, 3)] }
    const [a, , z] = b.items
    const c = b.connectors[0]
    const first = routeBetween(b, c, a, z)
    expect(routeBetween({ ...b }, c, a, z)).toBe(first)
    const moved = { ...b, items: [a, box(2, 600, 160), z] }
    expect(routeBetween(moved, c, a, z)).not.toBe(first)
  })
})

describe('flowcharts laid out automatically', () => {
  it('draw no line through a shape', () => {
    const charts = [
      // A step skipped, and a loop back.
      'flowchart TD\n  A[Start] --> B[One]\n  B --> C[Two]\n  C --> D[Three]\n  A --> D\n  D --> B',
      // The process template.
      'flowchart TD\n  A([Request comes in]) --> B[Review it]\n  B --> C{Approved?}\n  C -->|Yes| D[Do the work]\n  C -->|No| E[Explain why]\n  D --> F([Done])\n  E --> F',
      // The guide's.
      'flowchart TD\n  A([New idea]) --> B{Is it clear yet?}\n  B -->|Yes| C[Sketch it out]\n  B -->|No| D[Mind-map it first]\n  D --> B\n  C --> E([Share it])',
      // Sideways, with branches joining further on.
      'flowchart LR\n  A[Order] --> B{In stock?}\n  B -->|Yes| C[Pack]\n  B -->|No| D[Reorder]\n  D --> E[Wait]\n  E --> B\n  C --> F[Ship]\n  A --> F\n  F --> G([Done])',
      // Wide fan-out and fan-in.
      'flowchart TD\n  S([Start]) --> A[a]\n  S --> B[b]\n  S --> C[c]\n  S --> D[d]\n  A --> E[e]\n  B --> E\n  C --> F[f]\n  D --> F\n  E --> G([End])\n  F --> G\n  S --> G',
    ]
    for (const m of charts) expect(throughShapes(chart(m)), m).toEqual([])
  })

  it('keeps a chain in a straight line, its loop going round the side', () => {
    const b = chart('flowchart TD\n  A[Plan] --> B[Do]\n  B --> C[Check]\n  C --> A')
    const centres = b.items.map((i) => i.x + i.w / 2)
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(1)
  })
})

describe('lines that go around', () => {
  it('keep apart from each other', () => {
    const b = chart('flowchart TD\n  A[Start] --> B[One]\n  B --> C[Two]\n  C --> D[Three]\n  A --> D\n  D --> B')
    const routes = b.connectors.map((c) => connectorRoute(b, c)!).filter((r) => r.points.length > 2)
    expect(routes.length).toBeGreaterThanOrEqual(2)
    const segs = routes.map((r) => r.points.slice(1).map((q, k) => [r.points[k], q] as const))
    const runsAlong = (p: readonly [V, V], q: readonly [V, V]) => {
      const level = (s: readonly [V, V]) => Math.abs(s[0].y - s[1].y) < 0.5
      if (level(p) !== level(q)) return false
      const [a, b2, c, d] = level(p) ? [p[0].x, p[1].x, q[0].x, q[1].x] : [p[0].y, p[1].y, q[0].y, q[1].y]
      const same = level(p) ? Math.abs(p[0].y - q[0].y) < 1 : Math.abs(p[0].x - q[0].x) < 1
      return same && Math.min(Math.max(a, b2), Math.max(c, d)) - Math.max(Math.min(a, b2), Math.min(c, d)) > 1
    }
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) for (const p of segs[i]) for (const q of segs[j]) expect(runsAlong(p, q)).toBe(false)
  })
})

type V = { x: number; y: number }

describe('dragging several things together', () => {
  it('moves a line whose ends both moved, as it was', () => {
    const b: Board = { ...emptyBoard(), items: [box(1, 0, 0), box(2, 0, 160), box(3, 0, 320)], connectors: [elbow(1, 3)] }
    const before = routesOf(b).get(b.connectors[0].id)!
    const moved = { ...b, items: b.items.map((i) => (i.id === 2 ? i : { ...i, x: i.x + 50, y: i.y + 20 })) }
    const quick = routesOf(moved, true).get(b.connectors[0].id)!
    expect(quick.points).toEqual(before.points.map((p) => ({ x: p.x + 50, y: p.y + 20 })))
    // Its drawing moved too.
    const nums = (d: string) => d.match(/-?\d*\.?\d+/g)!.map(Number)
    expect(nums(quick.d)).toEqual(nums(before.d).map((v, k) => v + (k % 2 ? 20 : 50)))
  })
})
