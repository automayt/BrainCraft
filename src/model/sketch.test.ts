import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { Editor } from '../editor/Editor'
import { HAND_FONT_FILES } from '../ui/handFont'
import { roughPaths } from '../ui/roughShapes'
import { emptyBoard, getItem } from './board'
import { addStep } from './flowchart'
import { cleanItem } from './sanitize'
import { flowComponent, setSketch } from './sketch'
import { fakeMeasure } from './test-helpers'

const board = () =>
  applyOps(emptyBoard('B'), [
    { op: 'createFlowchart', mermaid: 'flowchart TD\n  A([Start]) --> B[Do it]\n  B --> C([End])' },
    { op: 'createFlowchart', mermaid: 'flowchart TD\n  X[Other] --> Y[Chart]' },
    { op: 'createNote', ref: 'n', text: 'A note' },
    { op: 'createTable', columns: ['a'] },
  ], { measure: fakeMeasure }).board

describe('the hand-drawn look', () => {
  it('goes on shapes, notes and text, not on tables or pictures', () => {
    const b = board()
    const table = b.items.find((i) => i.kind === 'table')!
    const note = b.items.find((i) => i.kind === 'sticky')!
    const next = setSketch(b, [table.id, note.id], true)
    expect(getItem(next, note.id)!.sketch).toBe(true)
    expect(getItem(next, table.id)!.sketch).toBeUndefined()
    expect(getItem(setSketch(next, [note.id], false), note.id)!.sketch).toBeUndefined()
    // And a board read back keeps it only where it belongs.
    const base = { id: 1, x: 0, y: 0, w: 10, h: 10, color: '#fff', text: '', fontSize: 12, sketch: true }
    expect(cleanItem({ ...base, kind: 'flow' })!.sketch).toBe(true)
    expect(cleanItem({ ...base, kind: 'image', src: 'data:image/png;base64,AA' })!.sketch).toBeUndefined()
    expect(cleanItem({ ...base, kind: 'rect', sketch: 'yes' })!.sketch).toBeUndefined()
  })

  it('takes a whole flowchart at once, and its new steps grow hand-drawn', () => {
    const b = board()
    const start = b.items.find((i) => i.kind === 'flow' && i.text === 'Start')!
    expect([...flowComponent(b, start.id)].map((id) => getItem(b, id)!.text).sort()).toEqual(['Do it', 'End', 'Start'])
    const ed = new Editor(b, fakeMeasure)
    ed.select([start.id])
    ed.setSketch(true)
    const sketched = ed.board.items.filter((i) => i.sketch).map((i) => i.text).sort()
    expect(sketched).toEqual(['Do it', 'End', 'Start'])
    expect(ed.selectionSketched).toBe(true)
    const end = ed.board.items.find((i) => i.text === 'End')!
    const [grown, id] = addStep(ed.board, end.id, 'down')
    expect(getItem(grown, id!)!.sketch).toBe(true)
    ed.undo()
    expect(ed.board.items.some((i) => i.sketch)).toBe(false)
  })

  it('can be set through the API', () => {
    const b = applyOps(emptyBoard(), [{ op: 'createShape', ref: 's', text: 'Box' }, { op: 'update', id: 's', sketch: true }], { measure: fakeMeasure }).board
    expect(b.items[0].sketch).toBe(true)
    expect(() => applyOps(b, [{ op: 'update', id: b.items[0].id, sketch: 'yes' as never }], { measure: fakeMeasure })).toThrow(/sketch/)
  })

  it('wobbles the same way every time for the same object, and differently for another', () => {
    const style = { stroke: '#333', fill: '#aad2fa', seed: 7 }
    const geom = { kind: 'rect' as const, x: 0, y: 0, w: 200, h: 100 }
    const a = roughPaths(geom, style)
    expect(roughPaths({ ...geom }, { ...style })).toBe(a)
    expect(roughPaths({ ...geom, x: 1 }, style)[0].d).not.toBe(a[0].d)
    expect(roughPaths(geom, { ...style, seed: 8 }).map((p) => p.d)).not.toEqual(a.map((p) => p.d))
    // A coloured fill is a pencil hatch (stroked lines); white stays solid paper.
    expect(a.some((p) => p.stroke === 'rgb(4, 5, 6)')).toBe(true)
    expect(roughPaths(geom, { ...style, fill: '#ffffff' }).some((p) => p.fill === 'rgb(4, 5, 6)')).toBe(true)
  })

  it('writes in a font the build ships', () => {
    for (const [file] of HAND_FONT_FILES) expect(existsSync(`node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont/${file}`), file).toBe(true)
  })
})
