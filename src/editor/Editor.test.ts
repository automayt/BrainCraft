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
