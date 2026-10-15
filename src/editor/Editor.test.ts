import { describe, expect, it } from 'vitest'
import * as B from '../model/board'
import { emptyBoard } from '../model/board'
import * as M from '../model/mindmap'
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
    e.keyDown('/', {})
    expect(e.hidden.has(id('A1'))).toBe(true)
    e.keyDown('/', {})
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
    // Dropping on empty space offers the likeliest next shapes; 2 picks the second.
    expect(e.shapePicker?.options.slice(0, 2)).toEqual(['process', 'data'])
    expect(e.board.items).toHaveLength(2)
    e.keyDown('2', {})
    expect(e.shapePicker).toBeNull()
    expect(e.board.items).toHaveLength(3)
    expect(e.board.items[2]).toMatchObject({ shape: 'data' })
    expect(e.board.connectors).toHaveLength(2)
  })

  it('imports and exports Mermaid', () => {
    const e = editor()
    e.pasteText('flowchart LR\n  a([Start]) --> b{OK?}\n  b -->|yes| c[Done]')
    expect(e.board.items.map((i) => i.shape)).toEqual(['terminator', 'decision', 'process'])
    expect(e.selection.size).toBe(3)
    expect(e.exportMermaid()).toContain('|"yes"|')
    e.pasteText('flowchart TD\n  a -->')
    expect(e.board.items).toHaveLength(3)
    expect(e.status).toMatch(/Couldn't read/)
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

describe('presenting', () => {
  function deck() {
    const e = editor()
    e.setViewport(1000, 600)
    let b = emptyBoard()
    let one: number, two: number
    ;[b, one] = B.addItem(b, B.newItem('frame', { x: 0, y: 0, w: 400, h: 300 }, { text: 'One' }))
    ;[b, two] = B.addItem(b, B.newItem('frame', { x: 600, y: 0, w: 400, h: 300 }, { text: 'Two' }))
    e.load(b)
    return { e, one, two }
  }

  it('walks the frames with the keyboard and stops on Escape', () => {
    const { e } = deck()
    expect(e.startPresenting()).toBe(true)
    expect(e.readOnly).toBe(true)
    expect(e.presenting!.index).toBe(0)
    e.presentKey('ArrowRight')
    expect(e.presenting!.index).toBe(1)
    e.presentKey(' ')
    expect(e.presenting!.index).toBe(1)
    e.presentKey('Home')
    expect(e.presenting!.index).toBe(0)
    e.presentKey('2')
    expect(e.presenting!.index).toBe(1)
    e.presentKey('Escape')
    expect(e.presenting).toBeNull()
    expect(e.readOnly).toBe(false)
  })

  it('starts from the selected frame and zooms past 100% to fill the screen', () => {
    const { e, two } = deck()
    e.select([two])
    e.startPresenting()
    expect(e.presenting!.index).toBe(1)
    expect(e.camera.zoom).toBeGreaterThan(1)
    // The slide's frame is centred.
    const mid = toScreen(e.camera, { x: 800, y: 150 })
    expect(Math.abs(mid.x - 500)).toBeLessThan(2)
  })

  it('blocks edits while presenting and toggles overview, laser and notes', () => {
    const { e } = deck()
    e.startPresenting()
    e.setTitle('Changed')
    expect(e.board.title).not.toBe('Changed')
    e.presentKey('o')
    expect(e.presenting!.overview).toBe(true)
    e.presentKey('l')
    e.presentKey('n')
    expect(e.presenting).toMatchObject({ laser: true, notes: true })
    e.presentKey('ArrowRight')
    expect(e.presenting!.overview).toBe(false)
  })

  it('says so when there is nothing to present', () => {
    const e = editor()
    expect(e.startPresenting()).toBe(false)
    expect(e.status).toMatch(/frame/)
  })
})

describe('runbook mode', () => {
  it('walks a flowchart, records the run and can undo the record', async () => {
    const { applyOps } = await import('../api/ops')
    const e = editor()
    e.setViewport(1200, 800)
    const { board } = applyOps(emptyBoard(), [{ op: 'createFlowchart', mermaid: 'flowchart TD\n  A([In]) --> B{Urgent?}\n  B -->|Yes| C[Page]\n  B -->|No| D[Queue]\n  C --> E([Done])\n  D --> E' }], { measure: fakeMeasure })
    e.load(board)
    const id = (t: string) => e.board.items.find((i) => i.text === t)!.id
    e.select([id('Queue')])
    expect(e.startRun()).toBe(true)
    expect(e.runStep).toBe(id('In'))
    expect(e.readOnly).toBe(true)
    e.runKey('Enter')
    expect(e.runStep).toBe(id('Urgent?'))
    expect(e.runOptions.map((o) => o.label)).toEqual(['Yes', 'No'])
    e.runKey('Enter') // two ways out: Enter alone doesn't pick one
    expect(e.runStep).toBe(id('Urgent?'))
    e.runKey('2')
    expect(e.runStep).toBe(id('Queue'))
    e.runBack()
    e.runKey('1')
    e.setRunNote('Customer is down')
    e.runKey('Enter')
    expect(e.runStep).toBe(id('Done'))
    e.runKey('Enter')
    expect(e.running).toBeNull()
    expect(e.readOnly).toBe(false)
    const runs = B.getItem(e.board, id('In'))!.runs!
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('done')
    expect(runs[0].steps.map((s) => [s.text, s.choice ?? null])).toEqual([
      ['In', null],
      ['Urgent?', 'Yes'],
      ['Page', null],
      ['Done', null],
    ])
    expect(runs[0].steps[2].note).toBe('Customer is down')
    expect(e.finishedRun?.record.id).toBe(runs[0].id)
    e.undo()
    expect(B.getItem(e.board, id('In'))!.runs).toBeUndefined()
  })

  it('drops a run stopped on its first step and refuses non-flowchart shapes', async () => {
    const { applyOps } = await import('../api/ops')
    const e = editor()
    const { board } = applyOps(emptyBoard(), [{ op: 'createFlowchart', mermaid: 'flowchart TD\n  A[One] --> B[Two]' }, { op: 'createNote', text: 'x' }], { measure: fakeMeasure })
    e.load(board)
    e.startRun(e.board.items[0].id)
    e.runKey('Escape')
    expect(e.finishedRun).toBeNull()
    expect(e.startRun(e.board.items[2].id)).toBe(false)
  })
})

describe('linked data', () => {
  it('converts a Kanban board to linked data and adds a timeline view of it', () => {
    const e = editor()
    e.setViewport(1200, 800)
    let b = emptyBoard()
    let id: number
    ;[b, id] = B.addItem(
      b,
      B.newItem('kanban', { x: 0, y: 0, w: 600, h: 400 }, { text: 'Sprint', kanban: { columns: [{ id: 'a', title: 'To do', cards: [{ id: 'c', title: 'Spec', start: '2026-10-01', due: '2026-10-09' }] }, { id: 'b', title: 'Done', cards: [] }] } }),
    )
    e.load(b)
    e.convertToData(id)
    const item = B.getItem(e.board, id)!
    expect(item.kind).toBe('data')
    expect(item.kanban).toBeUndefined()
    expect(item.view!.type).toBe('board')
    expect(e.board.datasets![0].records).toHaveLength(1)
    e.addDataView(id, 'timeline')
    const views = e.board.items.filter((i) => i.view)
    expect(views.map((v) => v.view!.type)).toEqual(['board', 'timeline'])
    expect(views[1].x).toBeGreaterThan(item.x + item.w)
    // One dataset edit, every view sees it.
    const ds = e.board.datasets![0]
    e.updateDataset(ds.id, (d) => ({ ...d, name: 'Renamed' }))
    expect(e.board.datasets![0].name).toBe('Renamed')
    e.undo()
    expect(e.board.datasets![0].name).toBe('Sprint')
  })

  it('deleting the last view drops the dataset, and undo brings both back', () => {
    const e = editor()
    e.setTool('data')
    e.pointerDown({ x: 300, y: 300 }, 0, {})
    e.pointerUp({ x: 300, y: 300 })
    expect(e.board.datasets).toHaveLength(1)
    e.deleteSelection()
    expect(e.board.datasets ?? []).toHaveLength(0)
    e.undo()
    expect(e.board.datasets).toHaveLength(1)
  })
})

describe('moving mind-map ideas', () => {
  it('keeps an idea (and its branch) where it is dropped, until tidied', () => {
    const e = editor()
    let b = emptyBoard()
    let root: number, idea: number, leaf: number
    ;[b, root] = M.createMap(b, { x: 0, y: 0 }, 'Root')
    ;[b, idea] = M.addChild(b, root, undefined, 'Idea')
    ;[b, leaf] = M.addChild(b, idea, undefined, 'Leaf')
    e.load(b)
    e.camera = { x: 0, y: 0, zoom: 1 }
    const at = (id: number) => B.getItem(e.board, id)!
    const before = { idea: { ...at(idea) }, leaf: { ...at(leaf) } }
    const start = screenCenter(e, idea)
    e.pointerDown(start, 0, {})
    e.pointerMove({ x: start.x + 120, y: start.y + 200 })
    e.pointerUp({ x: start.x + 120, y: start.y + 200 })
    expect(at(idea).x).toBeCloseTo(before.idea.x + 120)
    expect(at(idea).y).toBeCloseTo(before.idea.y + 200)
    // Its branch comes along.
    expect(at(leaf).y).toBeCloseTo(before.leaf.y + 200)
    // New ideas don't undo the placement.
    e.select([root])
    e.addMindNode(root, 'child')
    e.finishEditing()
    expect(at(idea).offset).toEqual({ x: 120, y: 200 })
    e.tidyMindMap(idea)
    expect(at(idea).offset).toBeUndefined()
  })
})

describe('feel pass', () => {
  const sticky = (x: number, y: number, text = '') => B.newItem('sticky', { x, y, w: 100, h: 100 }, { text })

  it('aligns and distributes a selection', () => {
    const e = editor()
    let b = emptyBoard()
    let a: number, c: number, d: number
    ;[b, a] = B.addItem(b, sticky(0, 0))
    ;[b, c] = B.addItem(b, sticky(150, 40))
    ;[b, d] = B.addItem(b, sticky(500, 90))
    e.load(b)
    e.select([a, c, d])
    e.align('top')
    expect(e.board.items.map((i) => i.y)).toEqual([0, 0, 0])
    e.distribute('x')
    expect(e.board.items.map((i) => i.x)).toEqual([0, 250, 500])
    e.undo()
    expect(e.board.items.map((i) => i.x)).toEqual([0, 150, 500])
  })

  it('moves several mind-map ideas together without moving the whole map', () => {
    const e = editor()
    let b = emptyBoard()
    let root: number, x: number, y: number
    ;[b, root] = M.createMap(b, { x: 0, y: 0 }, 'Root')
    ;[b, x] = M.addChild(b, root, undefined, 'X')
    ;[b, y] = M.addChild(b, root, undefined, 'Y')
    e.load(b)
    e.camera = { x: 300, y: 300, zoom: 1 }
    const rootBefore = { ...B.getItem(e.board, root)! }
    const xBefore = { ...B.getItem(e.board, x)! }
    e.select([x, y])
    const start = screenCenter(e, x)
    e.pointerDown(start, 0, {})
    e.pointerMove({ x: start.x + 80, y: start.y + 60 }, { alt: true })
    e.pointerUp({ x: start.x + 80, y: start.y + 60 })
    expect(B.getItem(e.board, root)!.x).toBe(rootBefore.x)
    expect(B.getItem(e.board, x)!.x).toBeCloseTo(xBefore.x + 80)
    expect(B.getItem(e.board, x)!.offset).toEqual({ x: 80, y: 60 })
    expect(B.getItem(e.board, y)!.offset).toEqual({ x: 80, y: 60 })
  })

  it('groups sibling ideas under a new idea and nudges ideas with Ctrl+arrow', () => {
    const e = editor()
    let b = emptyBoard()
    let root: number, x: number, y: number
    ;[b, root] = M.createMap(b, { x: 0, y: 0 }, 'Root')
    ;[b, x] = M.addChild(b, root, undefined, 'X')
    ;[b, y] = M.addChild(b, root, undefined, 'Y')
    e.load(b)
    e.select([x, y])
    e.keyDown('g', { ctrl: true })
    e.finishEditing()
    const group = B.getItem(e.board, x)!.parent!
    expect(B.getItem(e.board, group)).toMatchObject({ text: 'Group', parent: root })
    expect(B.getItem(e.board, y)!.parent).toBe(group)
    e.select([group])
    e.keyDown('ArrowDown', { ctrl: true })
    expect(B.getItem(e.board, group)!.offset).toEqual({ x: 0, y: 10 })
  })

  it('snaps sticky notes beside each other without connecting them', () => {
    const e = editor()
    let b = emptyBoard()
    let a: number, c: number
    ;[b, a] = B.addItem(b, sticky(0, 0, 'A'))
    ;[b, c] = B.addItem(b, sticky(400, 300, 'B'))
    e.load(b)
    e.camera = { x: 0, y: 0, zoom: 1 }
    e.select([c])
    const start = screenCenter(e, c)
    // Bring B near the slot right of A (A spans 0–100, gap 24, so B's centre belongs at 174).
    e.pointerDown(start, 0, {})
    e.pointerMove({ x: 180, y: 60 })
    e.pointerUp({ x: 180, y: 60 })
    expect(B.getItem(e.board, c)).toMatchObject({ x: 124, y: 0 })
    expect(e.board.connectors).toHaveLength(0)
    void a
  })
})

describe('AI changes', () => {
  it('applies a proposal as one step, then undoes just that change later', async () => {
    const { applyOps } = await import('../api/ops')
    const { diff } = await import('../collab/patch')
    const e = editor()
    const proposed = applyOps(e.board, [{ op: 'createNote', text: 'From AI' }], { measure: fakeMeasure }).board
    expect(e.applyAi('p1', 'Add a note', diff(e.board, proposed))).toBe(true)
    expect(texts(e)).toEqual(['From AI'])
    expect(e.aiHistory).toMatchObject([{ id: 'p1', summary: 'Add a note', undone: false }])
    // The next object gets a fresh id, not the AI note's.
    e.addImage('data:image/png;base64,AA==', 10, 10, { x: 300, y: 0 })
    expect(new Set(e.board.items.map((i) => i.id)).size).toBe(2)
    e.toggleAiChange('p1')
    expect(e.board.items).toHaveLength(1)
    expect(e.board.items[0].kind).toBe('image')
    expect(e.aiHistory[0].undone).toBe(true)
    e.toggleAiChange('p1')
    expect(texts(e)).toContain('From AI')
  })

  it('forgets AI history when another board loads', () => {
    const e = editor()
    e.aiHistory = [{ id: 'x', at: 0, summary: 's', forward: [], inverse: [], undone: false }]
    e.load(emptyBoard('Other'))
    expect(e.aiHistory).toEqual([])
  })
})
