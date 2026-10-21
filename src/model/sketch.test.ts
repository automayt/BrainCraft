import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { Editor } from '../editor/Editor'
import { HAND_FONT_FILES } from '../ui/handFont'
import { roughPaths } from '../ui/roughShapes'
import { emptyBoard, getItem } from './board'
import { addStep } from './flowchart'
import { cleanItem } from './sanitize'
import { flowComponent, setBoardSketch, setSketch, sketchNew } from './sketch'
import { applyPatches, diff } from '../collab/patch'
import { cleanPatches } from './sanitize'
import { fromJson, toJson } from './serialize'
import { withoutBackground } from './excalidraw'
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

describe('hand-drawn mind maps', () => {
  it('are measured in the handwriting, so their words fit', async () => {
    const { layoutAll } = await import('./mindmap')
    const widths: boolean[] = []
    const measure = (text: string, fontSize: number, _w: number, max: number, hand?: boolean) => {
      widths.push(!!hand)
      return { w: Math.min(max, text.length * fontSize * (hand ? 0.7 : 0.5)), h: fontSize * 1.3 }
    }
    const b = applyOps(emptyBoard(), [{ op: 'createMindMap', outline: 'Packing\n  Good coffee' }], { measure: fakeMeasure }).board
    const plain = layoutAll(b, measure)
    const leaf = (x: typeof b) => x.items.find((i) => i.text === 'Good coffee')!
    const hand = layoutAll(setSketch(b, b.items.map((i) => i.id), true), measure)
    expect(leaf(hand).w).toBeGreaterThan(leaf(plain).w)
    expect(widths).toContain(true)
  })
})

describe('a hand-drawn board', () => {
  it('draws everything by hand, and everything added from then on', () => {
    const b = setBoardSketch(board(), true)
    expect(b.sketch).toBe(true)
    // Everything that can be, is (a table can't).
    expect(b.items.filter((i) => i.kind !== 'table').every((i) => i.sketch)).toBe(true)
    // Made with the editor's tools afterwards: hand-drawn too.
    const ed = new Editor(b, fakeMeasure)
    ed.load({ ...b, items: b.items.map((i) => (i.text === 'End' ? { ...i, sketch: undefined } : i)) })
    const end = ed.board.items.find((i) => i.text === 'End')!
    ed.addFlowStep(end.id, 'down')
    const made = ed.board.items.at(-1)!
    expect(made).toMatchObject({ kind: 'flow', sketch: true })
    // ...while one switched back to clean lines stays clean.
    expect(ed.board.items.find((i) => i.text === 'End')!.sketch).toBeUndefined()
    // Undo the board switch: clean lines, and new things clean again.
    const plain = setBoardSketch(ed.board, false)
    expect(plain.sketch).toBeUndefined()
    expect(plain.items.some((i) => i.sketch)).toBe(false)
  })

  it('leaves alone what was already there, and objects switched back by hand', () => {
    const b = { ...board(), sketch: true as const }
    const later = applyOps(b, [{ op: 'createNote', ref: 'n', text: 'New' }], { measure: fakeMeasure }).board
    const marked = sketchNew(b, later)
    expect(marked.items.at(-1)!.sketch).toBe(true)
    // The older objects weren't touched.
    expect(marked.items.slice(0, -1).every((i) => !i.sketch)).toBe(true)
    // Nothing new, nothing changes.
    expect(sketchNew(marked, marked)).toBe(marked)
    // Not a hand-drawn board: nothing changes.
    expect(sketchNew(board(), applyOps(board(), [{ op: 'createNote', text: 'x' }], { measure: fakeMeasure }).board).items.at(-1)!.sketch).toBeUndefined()
  })

  it('reaches friends in a live session, and is saved with the board', () => {
    const a = board()
    const z = setBoardSketch(a, true)
    const patches = cleanPatches(JSON.parse(JSON.stringify(diff(a, z))))
    expect(patches).toContainEqual({ k: 'sketch', v: true })
    expect(applyPatches(a, patches).sketch).toBe(true)
    expect(applyPatches(z, cleanPatches([{ k: 'sketch', v: false }])).sketch).toBeUndefined()
    expect(cleanPatches([{ k: 'sketch', v: 'yes' }])).toEqual([])
    expect(fromJson(toJson(z)).sketch).toBe(true)
    expect(fromJson(JSON.stringify({ ...JSON.parse(toJson(a)), sketch: 'yes' })).sketch).toBeUndefined()
  })
})

describe('Excalidraw drawings on the board', () => {
  it('sit on it without the white sheet older ones were saved on', () => {
    const svg = '<svg width="100" height="50"><rect x="0" y="0" width="100" height="50" fill="#ffffff"></rect><path d="M0 0"/></svg>'
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const bare = decodeURIComponent(withoutBackground(src).split(',')[1])
    expect(bare).toBe('<svg width="100" height="50"><path d="M0 0"/></svg>')
    // Newer pictures (no sheet) and other pictures are left as they are.
    const none = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg><path d="M0 0"/></svg>')}`
    expect(withoutBackground(none)).toBe(none)
    expect(withoutBackground('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })
})

