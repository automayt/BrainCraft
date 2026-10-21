import { describe, expect, it } from 'vitest'
import { toScreen } from './camera'
import { Editor } from '../editor/Editor'
import { emptyBoard, getItem } from './board'
import { cleanExcalidraw, excalidrawFile, isDrawing, MAX_ELEMENTS, sceneFromText, sceneText } from './excalidraw'
import { cleanItem } from './sanitize'
import { fakeMeasure } from './test-helpers'

const rect = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'rectangle', x: 0, y: 0, width: 100, height: 50, ...extra })
const text = (id: string, t: string) => ({ id, type: 'text', x: 0, y: 0, width: 100, height: 20, text: t })
const png = 'data:image/png;base64,iVBORw0KGgo='

describe('Excalidraw scenes', () => {
  it('keeps elements and the pictures they use, and nothing else', () => {
    const scene = cleanExcalidraw({
      elements: [rect('a'), rect('gone', { isDeleted: true }), 'junk', { type: 'rectangle' }, { id: 'p', type: 'image', fileId: 'f1' }],
      files: {
        f1: { id: 'f1', mimeType: 'image/png', dataURL: png, created: 5 },
        unused: { id: 'unused', mimeType: 'image/png', dataURL: png },
        f2: { mimeType: 'text/html', dataURL: 'data:text/html,<script>' },
      },
    })
    expect(scene!.elements.map((e) => (e as { id: string }).id)).toEqual(['a', 'p'])
    expect(Object.keys(scene!.files!)).toEqual(['f1'])
  })

  it('refuses what isn’t a scene, scripts dressed as pictures, and scenes too big to keep', () => {
    expect(cleanExcalidraw(null)).toBeNull()
    expect(cleanExcalidraw({ elements: 'x' })).toBeNull()
    expect(cleanExcalidraw({ elements: Array.from({ length: MAX_ELEMENTS + 1 }, (_, k) => rect(`r${k}`)) })).toBeNull()
    expect(cleanExcalidraw({ elements: [rect('a', { blob: 'x'.repeat(9 * 1024 * 1024) })] })).toBeNull()
    const sneaky = cleanExcalidraw({ elements: [{ id: 'p', type: 'image', fileId: 'f' }], files: { f: { mimeType: 'image/svg+xml', dataURL: 'javascript:alert(1)' } } })
    expect(sneaky!.files).toBeUndefined()
  })

  it('reads Excalidraw’s clipboard and files, and nothing else', () => {
    expect(sceneFromText(JSON.stringify({ type: 'excalidraw/clipboard', elements: [rect('a')] }))!.elements).toHaveLength(1)
    expect(sceneFromText(JSON.stringify({ type: 'excalidraw', version: 2, elements: [rect('a')], appState: {} }))).not.toBeNull()
    expect(sceneFromText(JSON.stringify({ type: 'excalidraw', elements: [] }))).toBeNull()
    expect(sceneFromText('{"ops": [{"op": "createNote", "text": "excalidraw"}]}')).toBeNull()
    expect(sceneFromText('just some excalidraw words')).toBeNull()
    // And a drawing goes back out as a file Excalidraw opens.
    const file = JSON.parse(excalidrawFile({ elements: [rect('a')] }))
    expect(file).toMatchObject({ type: 'excalidraw', version: 2, elements: [{ id: 'a' }], files: {} })
    expect(sceneFromText(excalidrawFile({ elements: [rect('a')] }))).not.toBeNull()
  })

  it('finds the words in a drawing', () => {
    expect(sceneText({ elements: [rect('a'), text('t1', ' Big idea '), text('t2', 'Next')] })).toBe('Big idea\nNext')
  })

  it('is kept on images only when a board is read', () => {
    const base = { id: 1, x: 0, y: 0, w: 10, h: 10, color: '#fff', text: '', fontSize: 12 }
    expect(cleanItem({ ...base, kind: 'image', src: png, excalidraw: { elements: [rect('a')] } })!.excalidraw).toBeDefined()
    expect(cleanItem({ ...base, kind: 'sticky', excalidraw: { elements: [rect('a')] } })!.excalidraw).toBeUndefined()
    expect(cleanItem({ ...base, kind: 'image', src: png, excalidraw: { elements: 'nope' } })!.excalidraw).toBeUndefined()
  })
})

describe('drawings on the board', () => {
  const picture = { src: 'data:image/svg+xml,<svg/>', w: 400, h: 200 }

  it('puts a new drawing where it was opened, and keeps an existing one’s width and middle', () => {
    const ed = new Editor(emptyBoard(), fakeMeasure)
    ed.openDrawing(undefined, undefined, { x: 500, y: 300 })
    expect(ed.drawing).toEqual({ id: null, at: { x: 500, y: 300 } })
    const id = ed.saveDrawing(null, { elements: [rect('a'), text('t', 'Plan')] }, picture)!
    const made = getItem(ed.board, id)!
    expect(isDrawing(made)).toBe(true)
    expect(made).toMatchObject({ kind: 'image', text: 'Plan', w: 400, h: 200, x: 300, y: 200 })
    // Opened again and made taller: same width, same middle, one undo step.
    ed.openDrawing(id)
    expect(ed.drawing).toEqual({ id, at: { x: 500, y: 300 } })
    ed.saveDrawing(id, { elements: [rect('a'), rect('b')] }, { ...picture, h: 400 })
    expect(getItem(ed.board, id)).toMatchObject({ w: 400, h: 400, y: 100 })
    expect((getItem(ed.board, id)!.excalidraw!.elements as unknown[]).length).toBe(2)
    ed.undo()
    expect(getItem(ed.board, id)).toMatchObject({ h: 200, y: 200 })
  })

  it('opens with room to draw, and never further out than Excalidraw can zoom', () => {
    const ed = new Editor(emptyBoard(), fakeMeasure)
    ed.setViewport(1200, 800)
    // Far out on a big board: a new drawing opens at 100%, on the spot asked for.
    ed.setCamera({ x: 0, y: 0, zoom: 0.05 })
    ed.openDrawing(undefined, undefined, { x: 5000, y: 3000 })
    expect(ed.camera.zoom).toBe(1)
    expect(toScreen(ed.camera, { x: 5000, y: 3000 })).toEqual({ x: 600, y: 400 })
    ed.closeDrawing()
    // Already close in: left as it is.
    ed.setCamera({ x: 10, y: 20, zoom: 2 })
    ed.openDrawing(undefined, undefined, { x: 100, y: 100 })
    expect(ed.camera).toEqual({ x: 10, y: 20, zoom: 2 })
    ed.closeDrawing()
    // A drawing that's small on screen grows to fill some of it.
    const id = ed.saveDrawing(null, { elements: [{ ...rect('a'), x: 0, width: 360 }] }, picture, { x: 0, y: 0 })!
    ed.setCamera({ x: 0, y: 0, zoom: 0.1 })
    ed.openDrawing(id)
    const item = getItem(ed.board, id)!
    expect(item.w * ed.camera.zoom).toBeGreaterThan(400)
    expect(toScreen(ed.camera, { x: item.x + item.w / 2, y: item.y + item.h / 2 })).toEqual({ x: 600, y: 400 })
  })

  it('drawn in place: goes exactly where it was drawn, stays open, and its saves undo as one step', () => {
    const ed = new Editor(emptyBoard(), fakeMeasure)
    ed.openDrawing(undefined, undefined, { x: 500, y: 300 })
    const id = ed.saveDrawing(null, { elements: [rect('a')] }, picture, undefined, { x: 10, y: 20, w: 400, h: 200 })!
    expect(getItem(ed.board, id)).toMatchObject({ x: 10, y: 20, w: 400, h: 200 })
    // Still drawing it, now as that drawing.
    expect(ed.drawing?.id).toBe(id)
    ed.saveDrawing(id, { elements: [rect('a'), rect('b')] }, { ...picture, w: 600 }, undefined, { x: 10, y: 20, w: 600, h: 200 })
    expect(getItem(ed.board, id)).toMatchObject({ w: 600 })
    ed.closeDrawing()
    expect([...ed.selection]).toEqual([id])
    // Both saves were one drawing session: one undo takes the drawing away.
    ed.undo()
    expect(getItem(ed.board, id)).toBeUndefined()
  })

  it('opens only drawings, and changes nothing when the board is read-only', () => {
    const ed = new Editor(emptyBoard(), fakeMeasure)
    ed.addImage('data:image/png;base64,AAAA', 100, 100)
    const photo = ed.board.items[0].id
    ed.openDrawing(photo)
    expect(ed.drawing).toBeNull()
    ed.readOnly = true
    ed.openDrawing()
    expect(ed.drawing).toBeNull()
    expect(ed.saveDrawing(null, { elements: [rect('a')] }, picture)).toBeNull()
  })
})
