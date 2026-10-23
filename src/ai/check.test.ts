import { describe, expect, it } from 'vitest'
import { type Op, applyOps } from '../api/ops'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import type { Board } from '../model/types'
import { problemsWith } from './check'

const ctx = { measure: fakeMeasure }
/** The problems with applying `ops` to `before`. */
const check = (ops: Op[], before: Board = emptyBoard()) => problemsWith(before, applyOps(before, ops, ctx).board, ops)
const start = (ops: Op[]) => applyOps(emptyBoard(), ops, ctx).board

describe('tidying what the assistant proposes', () => {
  it('passes a mind map grown properly', () => {
    const b = start([{ op: 'createMindMap', outline: 'infrastructure' }])
    expect(check([{ op: 'addIdeas', parent: b.items[0].id, ideas: 'Jason\n  Workstations\nBrian\n  Servers' }], b)).toEqual([])
  })

  it('catches a mind map faked out of boxes and lines, as in the screenshot', () => {
    const faked: Op[] = [
      { op: 'createShape', ref: 'root', text: 'infrastructure', at: { x: 0, y: 300 } },
      { op: 'createShape', ref: 'j', text: 'Jason', at: { x: 300, y: 100 } },
      { op: 'createShape', ref: 'b', text: 'Brian', at: { x: 300, y: 500 } },
      { op: 'connect', from: 'root', to: 'j' },
      { op: 'connect', from: 'root', to: 'b' },
    ]
    const [problem] = check(faked)
    expect(problem).toMatch(/drawn by hand.*createMindMap and addIdeas/)
    // Unless loose boxes and lines are what's wanted.
    expect(check(faked.map((o) => (o.op === 'connect' ? { ...o, freeform: true } : o)))).toEqual([])
  })

  it('catches lines between ideas, and several ideas stacked in one', () => {
    const b = start([{ op: 'createMindMap', outline: 'infrastructure\n  Jason\n  Brian' }])
    const id = (t: string) => b.items.find((i) => i.text === t)!.id
    expect(check([{ op: 'connect', from: id('Jason'), to: id('Brian') }], b).join()).toMatch(/hang off their parent/)
    // "Add Jason and Brian" put into the same idea: the other half of what went wrong.
    expect(check([{ op: 'update', id: id('infrastructure'), text: 'infrastructure\nJason\nBrian' }], b).join()).toMatch(/holds several lines.*addIdeas/)
  })

  it('catches things dropped on top of what is there, but not things placed in free space', () => {
    const b = start([{ op: 'createNote', text: 'Budget', at: { x: 0, y: 0 } }])
    expect(check([{ op: 'createNote', text: 'Venue', at: { x: 40, y: 40 } }], b).join()).toMatch(/"Venue".*lands on top of "Budget"/)
    expect(check([{ op: 'createNote', text: 'Venue' }], b)).toEqual([])
    // Inside a frame is fine: that's what frames are for.
    expect(check([{ op: 'createFrame', title: 'Trip', at: { x: -50, y: -50 }, w: 400, h: 400 }], b)).toEqual([])
  })
})
