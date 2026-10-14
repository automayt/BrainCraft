import { describe, expect, it } from 'vitest'
import { emptyBoard, getItem } from './board'
import { insertMermaid, looksLikeMermaid, parseMermaid, rankNodes, toMermaid } from './mermaid'

const SAMPLE = `%% order flow
flowchart TD
    A([Order received]) --> B[Validate payment]
    B --> C{Payment OK?}
    C -->|Yes| D[[Pack & ship]]
    C -- No --> E[/Email customer/]
    D --> F[(Orders DB)]
    E -.-> B
    F --- G@{ shape: doc, label: "Receipt" }
    classDef done fill:#9f6
    class F done
`

describe('mermaid import', () => {
  it('detects flowcharts', () => {
    expect(looksLikeMermaid(SAMPLE)).toBe(true)
    expect(looksLikeMermaid('graph LR\nA-->B')).toBe(true)
    expect(looksLikeMermaid('sequenceDiagram\nA->>B: hi')).toBe(false)
    expect(looksLikeMermaid('- a\n  - b')).toBe(false)
  })

  it('reads shapes, labels and link styles', () => {
    const g = parseMermaid(SAMPLE)
    expect(g.dir).toBe('TD')
    expect(g.nodes.map((n) => [n.key, n.shape, n.label])).toEqual([
      ['A', 'terminator', 'Order received'],
      ['B', 'process', 'Validate payment'],
      ['C', 'decision', 'Payment OK?'],
      ['D', 'subroutine', 'Pack & ship'],
      ['E', 'data', 'Email customer'],
      ['F', 'database', 'Orders DB'],
      ['G', 'document', 'Receipt'],
    ])
    expect(g.edges).toEqual([
      { from: 'A', to: 'B', arrows: 'end', dashed: false },
      { from: 'B', to: 'C', arrows: 'end', dashed: false },
      { from: 'C', to: 'D', label: 'Yes', arrows: 'end', dashed: false },
      { from: 'C', to: 'E', label: 'No', arrows: 'end', dashed: false },
      { from: 'D', to: 'F', arrows: 'end', dashed: false },
      { from: 'E', to: 'B', arrows: 'end', dashed: true },
      { from: 'F', to: 'G', arrows: 'none', dashed: false },
    ])
  })

  it('handles chains, groups, both-way links, quotes and semicolons', () => {
    const g = parseMermaid('graph LR;\n a["Say &quot;hi&quot;<br/>twice"] --> b --> c;  a & b <--> d')
    expect(g.dir).toBe('LR')
    expect(g.nodes[0].label).toBe('Say &quot;hi&quot;\ntwice')
    expect(g.edges.map((e) => `${e.from}${e.to}${e.arrows}`)).toEqual(['abend', 'bcend', 'adboth', 'bdboth'])
  })

  it('explains what it cannot read', () => {
    expect(() => parseMermaid('pie\n"a": 1')).toThrow(/flowchart/)
    expect(() => parseMermaid('flowchart TD\nA --> ')).toThrow(/Line 2/)
  })

  it('ranks nodes in layers despite cycles', () => {
    const rank = rankNodes(parseMermaid(SAMPLE))
    expect(Object.fromEntries(rank)).toEqual({ A: 0, B: 1, C: 2, D: 3, E: 3, F: 4, G: 5 })
  })

  it('lays the chart out top to bottom with labelled elbow links', () => {
    const [b, ids] = insertMermaid(emptyBoard(), parseMermaid(SAMPLE), { x: 0, y: 0 })
    expect(ids).toHaveLength(7)
    const [a, bb, c] = ids.map((id) => getItem(b, id)!)
    expect(a.y + a.h).toBeLessThan(bb.y)
    expect(bb.y + bb.h).toBeLessThan(c.y)
    expect(b.connectors.find((x) => x.label === 'No')).toMatchObject({ style: 'elbow' })
    expect(b.connectors.find((x) => x.dashed)).toBeTruthy()
  })
})

describe('mermaid export', () => {
  it('round-trips through the board', () => {
    const g = parseMermaid(SAMPLE)
    const [b] = insertMermaid(emptyBoard(), g, { x: 0, y: 0 })
    const again = parseMermaid(toMermaid(b))
    expect(again.dir).toBe('TD')
    expect(again.nodes.map((n) => [n.shape, n.label])).toEqual(g.nodes.map((n) => [n.shape, n.label]))
    expect(again.edges.map((e) => [e.label, e.arrows, e.dashed])).toEqual(g.edges.map((e) => [e.label, e.arrows, e.dashed]))
  })

  it('escapes quotes and line breaks', () => {
    const [b] = insertMermaid(emptyBoard(), parseMermaid('flowchart LR\nA[x] --> B[y]'), { x: 0, y: 0 })
    const withText = { ...b, items: b.items.map((i, k) => (k === 0 ? { ...i, text: 'Say "hi"\nnow' } : i)) }
    expect(toMermaid(withText)).toContain('["Say #quot;hi#quot;<br>now"]')
    expect(toMermaid(withText).split('\n')[0]).toBe('flowchart LR')
  })
})
