import { describe, expect, it } from 'vitest'
import * as B from '../model/board'
import { emptyBoard } from '../model/board'
import { toScreen } from '../model/camera'
import { fakeMeasure } from '../model/test-helpers'
import { Editor } from './Editor'

function editor() {
  const e = new Editor(emptyBoard(), fakeMeasure)
  e.camera = { x: 0, y: 0, zoom: 1 }
  return e
}

const texts = (e: Editor) => e.board.items.map((i) => i.text)
const screenCenter = (e: Editor, id: number) => {
  const i = B.getItem(e.board, id)!
  return toScreen(e.camera, { x: i.x + i.w / 2, y: i.y + i.h / 2 })
}

function type(e: Editor, text: string) {
  e.setEditingText(text)
}

describe('mind map keyboard flow', () => {
  it('builds a map with Tab and Enter, as one undo step per idea', () => {
    const e = editor()
    e.setTool('mind')
    e.pointerDown({ x: 400, y: 300 }, 0, {})
    e.pointerUp({ x: 400, y: 300 })
    expect(e.editing).not.toBeNull()
    type(e, 'Trip')
    expect(e.editingKey('Tab', {})).toBe(true) // child
    type(e, 'Food')
    expect(e.editingKey('Enter', {})).toBe(true) // sibling
    type(e, 'Hotels')
    e.editingKey('Escape', {})
    expect(texts(e)).toEqual(['Trip', 'Food', 'Hotels'])
    const [root, food, hotels] = e.board.items
    expect(food.parent).toBe(root.id)
    expect(hotels.parent).toBe(root.id)
    expect(e.selection).toEqual(new Set([hotels.id]))

    e.undo()
    expect(texts(e)).toEqual(['Trip', 'Food'])
    e.undo()
    e.undo()
    expect(e.board.items).toHaveLength(0)
  })

  it('discards a new idea left empty', () => {
    const e = editor()
    e.setTool('mind')
    e.pointerDown({ x: 0, y: 0 }, 0, {})
    e.pointerUp({ x: 0, y: 0 })
    type(e, 'Root')
    e.editingKey('Tab', {})
    e.editingKey('Escape', {})
    expect(texts(e)).toEqual(['Root'])
    expect(e.selection).toEqual(new Set([e.board.items[0].id]))
  })

  it('Enter on an empty idea just finishes editing', () => {
    const e = editor()
    e.setTool('mind')
    e.pointerDown({ x: 0, y: 0 }, 0, {})
    e.pointerUp({ x: 0, y: 0 })
    type(e, 'Root')
    e.editingKey('Tab', {})
    type(e, 'One')
    e.editingKey('Enter', {})
    e.editingKey('Enter', {})
    expect(e.editing).toBeNull()
    expect(texts(e)).toEqual(['Root', 'One'])
  })

  it('navigates, collapses and deletes with the keyboard', () => {
    const e = editor()
    e.pasteText('Root\n  A\n    A1\n  B')
    const id = (t: string) => e.board.items.find((i) => i.text === t)!.id
    expect(e.selection).toEqual(new Set([id('Root')]))
    e.keyDown('ArrowRight', {})
    expect(e.selection).toEqual(new Set([id('A')]))
    e.keyDown('ArrowRight', {})
    expect(e.selection).toEqual(new Set([id('A1')]))
    e.keyDown('ArrowLeft', {})
    e.keyDown('c', {})
    expect(e.hidden.has(id('A1'))).toBe(true)
    e.keyDown('c', {})
    e.keyDown('Delete', {})
    expect(texts(e)).toEqual(['Root', 'B'])
    expect(e.selection).toEqual(new Set([id('Root')]))
  })

  it('moves a whole map when its root is dragged', () => {
    const e = editor()
    e.pasteText('Root\n  A\n  B')
    const root = e.board.items[0]
    const a = e.board.items[1]
    const start = screenCenter(e, root.id)
    e.setTool('select')
    e.pointerDown(start, 0, {})
    e.pointerMove({ x: start.x + 50, y: start.y + 20 })
    e.pointerUp({ x: start.x + 50, y: start.y + 20 })
    expect(B.getItem(e.board, a.id)!.x).toBeCloseTo(a.x + 50)
    expect(B.getItem(e.board, a.id)!.y).toBeCloseTo(a.y + 20)
  })

  it('drags a branch onto another idea to move it', () => {
    const e = editor()
    e.pasteText('Root\n  A\n    A1\n  B')
    const id = (t: string) => e.board.items.find((i) => i.text === t)!.id
    const from = screenCenter(e, id('A1'))
    const to = screenCenter(e, id('B'))
    e.select([id('A1')])
    e.pointerDown(from, 0, {})
    e.pointerMove(to)
    expect(e.drag).toMatchObject({ type: 'branch', target: id('B') })
    e.pointerUp(to)
    expect(B.getItem(e.board, id('A1'))!.parent).toBe(id('B'))
    e.undo()
    expect(B.getItem(e.board, id('A1'))!.parent).toBe(id('A'))
  })

  it('dropping a connector from an idea on empty space adds a child there', () => {
    const e = editor()
    e.pasteText('Root\n  A')
    const root = e.board.items[0]
    e.select([root.id])
    e.pointerDown(screenCenter(e, root.id), 0, {}, { kind: 'connect' })
    e.pointerUp({ x: -2000, y: 0 })
    expect(e.editing).not.toBeNull()
    const added = B.getItem(e.board, e.editing!.id)!
    expect(added.parent).toBe(root.id)
    expect(added.side).toBe('left')
  })
})

describe('whiteboard gestures', () => {
  it('creates a sticky note with a click and records one undo step with its text', () => {
    const e = editor()
    e.setTool('sticky')
    e.pointerDown({ x: 100, y: 100 }, 0, {})
    e.pointerUp({ x: 100, y: 100 })
    type(e, 'Hello')
    e.finishEditing()
    expect(texts(e)).toEqual(['Hello'])
    expect(e.tool).toBe('select')
    e.undo()
    expect(e.board.items).toHaveLength(0)
  })

  it('marquee-selects, moves and duplicates', () => {
    const e = editor()
    e.pasteText('one')
    e.pasteText('two')
    e.select([])
    e.pointerDown({ x: -1000, y: -1000 }, 0, {})
    e.pointerMove({ x: 2000, y: 2000 })
    e.pointerUp({ x: 2000, y: 2000 })
    expect(e.selection.size).toBe(2)
    e.duplicate()
    expect(e.board.items).toHaveLength(4)
    expect(e.selection.size).toBe(2)
  })

  it('connects two items with the connector tool', () => {
    const e = editor()
    e.camera = { x: 600, y: 400, zoom: 1 }
    e.pointer = { x: 0, y: 0 }
    e.pasteText('one')
    e.pointer = { x: 400, y: 0 }
    e.pasteText('two')
    const [a, b] = e.board.items
    e.setTool('connector')
    e.pointerDown(screenCenter(e, a.id), 0, {})
    e.pointerMove(screenCenter(e, b.id))
    e.pointerUp(screenCenter(e, b.id))
    expect(e.board.connectors).toMatchObject([{ from: a.id, to: b.id }])
  })

  it('copies and pastes through clipboard text', () => {
    const e = editor()
    e.pasteText('Root\n  A')
    e.select([e.board.items[1].id])
    const text = e.copyText()!
    e.pointer = { x: 1000, y: 1000 }
    e.pasteText(text)
    // A copied branch becomes a new map.
    const pasted = e.board.items[2]
    expect(pasted.text).toBe('A')
    expect(pasted.parent).toBeUndefined()
  })
})

describe('flowchart editing', () => {
  function place(e: Editor) {
    e.setFlowShape('terminator')
    e.pointerDown({ x: 300, y: 100 }, 0, {})
    e.pointerUp({ x: 300, y: 100 })
  }

  it('builds a flow with Tab, one undo step per shape', () => {
    const e = editor()
    place(e)
    type(e, 'Start')
    expect(e.editingKey('Tab', {})).toBe(true)
    type(e, 'Do the thing')
    e.editingKey('Tab', {})
    type(e, 'Check it')
    e.editingKey('Escape', {})
    expect(texts(e)).toEqual(['Start', 'Do the thing', 'Check it'])
    expect(e.board.connectors).toHaveLength(2)
    const [a, b, c] = e.board.items
    expect(b.y).toBeGreaterThan(a.y)
    expect(c.y).toBeGreaterThan(b.y)
    e.undo()
    expect(e.board.items).toHaveLength(2)
  })

  it('branches with Alt + arrow while selected', () => {
    const e = editor()
    place(e)
    e.finishEditing()
    const start = e.board.items[0]
    expect(e.keyDown('ArrowRight', { alt: true })).toBe(true)
    e.finishEditing()
    const added = e.board.items[1]
    expect(added.x).toBeGreaterThan(start.x + start.w)
    expect(e.board.connectors[0]).toMatchObject({ from: start.id, to: added.id, style: 'elbow' })
    e.select([added.id])
    e.setShape('decision')
    expect(B.getItem(e.board, added.id)).toMatchObject({ shape: 'decision', color: '#fff9b1' })
  })

  it('a click on a blue arrow adds a step; a drag connects', () => {
    const e = editor()
    place(e)
    e.finishEditing()
    const first = e.board.items[0]
    e.select([first.id])
    e.pointerDown({ x: 300, y: 200 }, 0, {}, { kind: 'flowAdd', dir: 'down' })
    e.pointerUp({ x: 301, y: 200 })
    expect(e.board.items).toHaveLength(2)
    e.finishEditing()
    // Drag from the first shape's right arrow onto empty space: a new step there.
    e.select([first.id])
    e.pointerDown({ x: 400, y: 100 }, 0, {}, { kind: 'flowAdd', dir: 'right' })
    e.pointerMove({ x: 700, y: 400 })
    e.pointerUp({ x: 700, y: 400 })
    expect(e.board.items).toHaveLength(3)
    expect(e.board.connectors).toHaveLength(2)
  })

  it('labels connectors and drops empty labels', () => {
    const e = editor()
    place(e)
    e.editingKey('Tab', {})
    e.finishEditing()
    const c = e.board.connectors[0]
    e.startEditingLabel(c.id)
    type(e, 'Yes')
    e.finishEditing()
    expect(e.board.connectors[0].label).toBe('Yes')
    e.startEditingLabel(c.id)
    type(e, '  ')
    e.finishEditing()
    expect(e.board.connectors[0].label).toBeUndefined()
    e.selectedConnector = c.id
    e.setConnectorStyle('curved')
    e.setArrowheads('both')
    expect(e.board.connectors[0]).toMatchObject({ style: 'curved', arrows: 'both' })
  })

  it('snaps a dragged shape into line with its neighbour', () => {
    const e = editor()
    e.pasteText('one')
    e.pointer = { x: 950, y: 407 }
    e.pasteText('two')
    const [a, b] = e.board.items
    e.select([b.id])
    const grab = { x: b.x + 10, y: b.y + 10 }
    e.pointerDown(grab, 0, {})
    e.pointerMove({ x: grab.x + 1, y: grab.y - 4 })
    expect(e.drag).toMatchObject({ type: 'move', guides: { y: a.y } })
    e.pointerUp({ x: grab.x + 1, y: grab.y - 4 })
    expect(B.getItem(e.board, b.id)!.y).toBe(a.y)
    // Alt turns snapping off.
    e.pointerDown({ x: b.x + 11, y: a.y + 10 }, 0, {})
    e.pointerMove({ x: b.x + 11, y: a.y + 13 }, { alt: true })
    e.pointerUp({ x: b.x + 11, y: a.y + 13 })
    expect(B.getItem(e.board, b.id)!.y).toBe(a.y + 3)
  })

  it('shows keyboard hints for the current context', () => {
    const e = editor()
    e.pasteText('Root\n  A')
    expect(e.hint).toMatch(/Tab add sub-idea/)
    place(e)
    expect(e.hint).toMatch(/Tab add the next step/)
  })
})
