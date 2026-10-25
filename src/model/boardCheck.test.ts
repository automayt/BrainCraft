import { describe, expect, it } from 'vitest'
import { type Op, applyOps } from '../api/ops'
import { emptyBoard, getItem } from './board'
import { checkBoard, fixAll, fixProblem } from './boardCheck'
import { fakeMeasure } from './test-helpers'
import type { Board } from './types'

const make = (ops: Op[], b: Board = emptyBoard()) => applyOps(b, ops, { measure: fakeMeasure }).board
const kinds = (b: Board) => checkBoard(b).map((p) => p.kind).sort()

describe('checking a board', () => {
  it('finds nothing wrong with a tidy board', () => {
    const b = make([
      { op: 'createMindMap', outline: 'Launch\n  Website\n  Party' },
      { op: 'createNote', text: 'Budget' },
      { op: 'createFlowchart', mermaid: 'flowchart TD\n a([Start]) --> b{Ok?}\n b -->|Yes| c[Ship]\n b -->|No| d[Fix]' },
      { op: 'createShape', ref: 's', at: { x: 1800, y: 0 }, w: 300, h: 200 },
      // Words set on a shape on purpose aren't "on top of" it.
      { op: 'createText', text: 'Label on a shape', at: { x: 1820, y: 20 } },
    ])
    expect(kinds(b)).toEqual([])
  })

  it('finds overlaps, empty notes, a stray, a decision with one way out and a crammed idea', () => {
    const b = make([
      { op: 'createNote', text: 'Venue', at: { x: 0, y: 0 } },
      { op: 'createNote', text: 'Food', at: { x: 40, y: 40 } },
      { op: 'createNote', text: '', at: { x: 600, y: 0 } },
      { op: 'createNote', text: 'Lost', at: { x: 20000, y: 20000 } },
      { op: 'createFlowchart', mermaid: 'flowchart TD\n a([Start]) --> b{Ok?}\n b --> c[Ship]', at: { x: 0, y: 600 } },
      { op: 'createMindMap', outline: 'infrastructure', at: { x: 1200, y: 0 } },
    ])
    const root = b.items.find((i) => i.text === 'infrastructure')!
    const crammed = make([{ op: 'update', id: root.id, text: 'infrastructure\nJason\nBrian' }], b)
    const found = checkBoard(crammed)
    expect(found.map((p) => p.kind).sort()).toEqual(['crammed', 'empty', 'oneWay', 'overlap', 'stray'])
    expect(found.find((p) => p.kind === 'overlap')!.text).toBe('“Food” is on top of “Venue”')
    expect(found.find((p) => p.kind === 'oneWay')!.fix).toBeUndefined()

    const fixed = fixAll(crammed, fakeMeasure)
    // Everything with a fix is fixed; the decision is left for a person to finish.
    expect(kinds(fixed)).toEqual(['oneWay'])
    expect(fixed.items.some((i) => i.kind === 'sticky' && !i.text)).toBe(false)
    // The crammed idea became one idea with the others under it.
    expect(getItem(fixed, root.id)!.text).toBe('infrastructure')
    expect(fixed.items.filter((i) => i.parent === root.id).map((i) => i.text)).toEqual(['Jason', 'Brian'])
  })

  it('moves a whole mind map clear when it runs into something', () => {
    const b = make([
      { op: 'createNote', text: 'Notes', at: { x: 0, y: 0 } },
      { op: 'createMindMap', outline: 'Plan\n  A\n  B', at: { x: 20, y: 20 } },
    ])
    const p = checkBoard(b).find((x) => x.kind === 'overlap')!
    expect(p.fix).toBe('Move the mind map clear')
    const fixed = fixProblem(b, p, fakeMeasure)
    expect(checkBoard(fixed).filter((x) => x.kind === 'overlap')).toEqual([])
    // The map moved as one: its ideas still hang together.
    const plan = fixed.items.find((i) => i.text === 'Plan')!
    expect(fixed.items.filter((i) => i.parent === plan.id)).toHaveLength(2)
  })

  it('finds flowchart steps nothing leads to, and steps not joined at all', () => {
    const b = make([
      { op: 'createFlowchart', mermaid: 'flowchart TD\n a([Start]) --> b[Plan]' },
      { op: 'createFlowchart', mermaid: 'flowchart TD\n x[Orphan] --> y[Next]', at: { x: 800, y: 0 } },
    ])
    expect(kinds(b)).toEqual(['deadStart'])
  })
})
