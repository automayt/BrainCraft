import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { describeBoard } from '../api/queries'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { FULL_LIST, boardText } from './boardText'

const build = (ops: Parameters<typeof applyOps>[1]) => applyOps(emptyBoard('Plan'), ops, { measure: fakeMeasure }).board

describe('boardText', () => {
  it('lists every object on one line, then the lines between them', () => {
    const b = build([
      { op: 'createNote', ref: 'a', text: 'Faster checkout', at: { x: 0, y: 0 } },
      { op: 'createNote', ref: 'b', text: 'Saved carts', at: { x: 300, y: 0 } },
      { op: 'connect', from: 'a', to: 'b', label: 'then' },
      { op: 'createMindMap', outline: 'Goals\n  Speed\n  Trust', at: { x: 0, y: 400 } },
    ])
    const t = boardText(b)
    expect(t).toMatch(/^Board "Plan": 5 objects/)
    expect(t).toContain('1 sticky (0,0 200x200) "Faster checkout"')
    expect(t).not.toContain('\n\n\n')
    expect(t).toMatch(/\d+ mind \(.*\) "Speed" parent:\d+/)
    expect(t).toContain('1->2 "then"')
  })

  it('summarises big boards: selection, structure and what is on screen, with a pointer to the rest', () => {
    const ops: Parameters<typeof applyOps>[1] = [{ op: 'createFrame', title: 'Area A', at: { x: -2000, y: -2000 }, w: 400, h: 300 }]
    for (let k = 0; k < 600; k++) ops.push({ op: 'createNote', text: `Note ${k}`, at: { x: (k % 30) * 250, y: Math.floor(k / 30) * 250 } })
    const b = build(ops)
    const last = b.items.at(-1)!.id
    const t = boardText(b, { focus: [last], view: { x: 0, y: 0, w: 1000, h: 600 } })
    const objects = t.split('\n').filter((l) => /^\d+ \w+ \(/.test(l))
    expect(objects).toHaveLength(FULL_LIST)
    // The selection comes first, then the frame, then what's on screen.
    expect(objects[0]).toContain(`"Note 599"`)
    expect(objects[1]).toContain('frame')
    expect(objects[2]).toContain('"Note 0"')
    expect(t).toContain('Showing 250 of 601')
  })

  it('reads one area or one kind', () => {
    const b = build([
      { op: 'createNote', text: 'Left', at: { x: 0, y: 0 } },
      { op: 'createNote', text: 'Right', at: { x: 5000, y: 0 } },
      { op: 'createText', text: 'Title', at: { x: 0, y: -300 } },
    ])
    const area = boardText(b, { area: { x: 4900, y: -100, w: 500, h: 500 } })
    expect(area).toContain('"Right"')
    expect(area).not.toContain('"Left"')
    expect(boardText(b, { kind: 'text' })).not.toContain('"Left"')
  })

  it('is much smaller than the JSON description', () => {
    const ops: Parameters<typeof applyOps>[1] = []
    for (let k = 0; k < 200; k++) ops.push({ op: 'createNote', ref: `n${k}`, text: `Idea number ${k} with some words`, at: { x: k * 250, y: 0 } })
    for (let k = 0; k + 1 < 200; k += 2) ops.push({ op: 'connect', from: `n${k}`, to: `n${k + 1}` })
    const b = build(ops)
    const json = JSON.stringify(describeBoard(b))
    expect(boardText(b).length).toBeLessThan(json.length * 0.6)
  })
})
