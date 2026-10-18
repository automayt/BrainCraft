import { describe, expect, it } from 'vitest'
import { Editor } from '../editor/Editor'
import { addItem, emptyBoard, newItem } from '../model/board'
import { diff } from '../collab/patch'
import { fakeMeasure } from '../model/test-helpers'
import { MemoryKV } from './kv'
import { encodeBoard } from './share'
import { Workspace } from './workspace'

async function workspace(hash = '') {
  const kv = new MemoryKV()
  const editor = new Editor(emptyBoard(), fakeMeasure)
  const ws = await Workspace.start(editor, kv, hash)
  return { ws, editor, kv }
}

describe('workspace', () => {
  it('starts on the welcome board in an empty browser', async () => {
    const { ws, editor } = await workspace()
    expect(ws.boards).toHaveLength(1)
    expect(editor.board.title).toBe('Welcome to BrainCraft')
    expect(ws.readOnly).toBe(false)
  })

  it('autosaves edits to the current board', async () => {
    const { ws, editor } = await workspace()
    editor.setTitle('Renamed')
    expect(ws.saveState).toBe('unsaved')
    await ws.flush()
    expect(ws.saveState).toBe('saved')
    expect((await ws.library.load(ws.boardId!))!.title).toBe('Renamed')
    expect(ws.boards[0].title).toBe('Renamed')
  })

  it('saves the open board before switching to another', async () => {
    const { ws, editor } = await workspace()
    const first = ws.boardId!
    editor.setTitle('Unsaved change')
    const second = await ws.newBoard(emptyBoard('Second'))
    expect(editor.board.title).toBe('Second')
    expect((await ws.library.load(first))!.title).toBe('Unsaved change')
    await ws.switchTo(first)
    expect(editor.board.title).toBe('Unsaved change')
    expect(ws.boards.map((b) => b.id).sort()).toEqual([first, second].sort())
  })

  it('opens another board when the open one is deleted', async () => {
    const { ws, editor } = await workspace()
    const first = ws.boardId!
    await ws.newBoard(emptyBoard('Second'))
    await ws.remove(ws.boardId!)
    expect(ws.boardId).toBe(first)
    expect(editor.board.title).toBe('Welcome to BrainCraft')
    await ws.remove(first)
    expect(ws.boards).toHaveLength(1)
  })

  it('restores an old version as an undoable step and keeps what it replaced', async () => {
    const { ws, editor } = await workspace()
    await ws.saveVersion('Original')
    editor.setTitle('Changed')
    const original = (await ws.versions()).find((v) => v.name === 'Original')!
    await ws.restoreVersion(original)
    expect(editor.board.title).toBe('Welcome to BrainCraft')
    expect((await ws.versions()).some((v) => v.name?.startsWith('Before restoring'))).toBe(true)
    editor.undo()
    expect(editor.board.title).toBe('Changed')
  })

  it('follows one wiki page through the versions and puts an old one back', async () => {
    const { ws, editor } = await workspace()
    await ws.newWiki('Trip')
    const page = editor.board.pages![0].id
    const tick = () => new Promise((r) => setTimeout(r, 3))
    editor.setPageText(page, 'Flights')
    await ws.saveVersion('First')
    await tick()
    editor.setPageText(page, 'Flights\nHotel')
    await ws.saveVersion('Second')
    await tick()
    // A version where this page didn't change folds into the change before it.
    editor.addWikiPage({ title: 'Other' })
    await ws.saveVersion('Third')
    editor.setPageText(page, 'Train instead')
    const history = await ws.pageHistory(page)
    expect(history.map((h) => h.text)).toEqual(['Flights\nHotel', 'Flights'])
    expect(history.map((h) => h.v.name)).toEqual(['Third', 'First'])
    expect((await ws.versions())[0]).toMatchObject({ kind: 'wiki', items: 2 })
    editor.restorePageVersion(page, history[1].title, history[1].text, 'then')
    expect(editor.board.bodies!.find((b) => b.id === page)!.text).toBe('Flights')
    // The other page is untouched, and one undo brings the newer words back.
    expect(editor.board.pages!.some((p) => p.title === 'Other')).toBe(true)
    editor.undo()
    expect(editor.board.bodies!.find((b) => b.id === page)!.text).toBe('Train instead')
  })

  it('opens share links read-only and can keep a copy', async () => {
    const hash = `#view=${await encodeBoard(emptyBoard('From a friend'))}`
    const { ws, editor } = await workspace(hash)
    expect(ws.readOnly).toBe(true)
    expect(editor.readOnly).toBe(true)
    expect(editor.board.title).toBe('From a friend')
    editor.setTitle('Nope')
    expect(editor.board.title).toBe('From a friend')
    expect(ws.boards).toHaveLength(0)

    await ws.keepCopy()
    expect(ws.readOnly).toBe(false)
    editor.setTitle('Mine now')
    expect(editor.board.title).toBe('Mine now')
    expect(ws.boards).toHaveLength(1)
  })

  it('falls back to the library when a share link is damaged', async () => {
    const { ws } = await workspace('#view=not-a-board')
    expect(ws.readOnly).toBe(false)
    expect(ws.boards).toHaveLength(1)
  })
})

describe('tabs', () => {
  const settle = () => new Promise((r) => setTimeout(r, 120))

  it('keeps two tabs on the same board in step, both ways', async () => {
    const kv = new MemoryKV()
    const a = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    const b = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    await b.switchTo(a.boardId!)
    await settle()
    a.editor.setTitle('Edited in tab A')
    await settle()
    expect(b.editor.board.title).toBe('Edited in tab A')
    const first = b.editor.board.items[0].id
    b.editor.updateItem(first, (i) => ({ ...i, text: 'From B' }))
    await settle()
    expect(a.editor.board.items.find((i) => i.id === first)!.text).toBe('From B')
    // Each tab's undo stays its own.
    expect(b.editor.history.canUndo).toBe(true)
    a.dispose()
    b.dispose()
  })

  it('never hands out an id another tab just used', async () => {
    const kv = new MemoryKV()
    const a = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    const b = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    await b.switchTo(a.boardId!)
    await settle()
    a.editor.addImage('data:image/png;base64,AA==', 10, 10, { x: 0, y: 0 })
    await settle()
    b.editor.addImage('data:image/png;base64,AA==', 10, 10, { x: 50, y: 0 })
    await settle()
    const ids = a.editor.board.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(a.editor.board.items).toHaveLength(b.editor.board.items.length)
    a.dispose()
    b.dispose()
  })

  it('catches a newly opened tab up on changes not saved yet', async () => {
    const kv = new MemoryKV()
    const a = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    a.editor.setTitle('Not saved yet')
    const b = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    await b.switchTo(a.boardId!)
    await settle()
    expect(b.editor.board.title).toBe('Not saved yet')
    a.dispose()
    b.dispose()
  })

  it('refreshes the board list when another tab adds a board', async () => {
    const kv = new MemoryKV()
    const a = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    const b = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    await a.newBoard(emptyBoard('Made in A'))
    await settle()
    expect(b.boards.map((x) => x.title)).toContain('Made in A')
    a.dispose()
    b.dispose()
  })
})

describe('since you were here', () => {
  it('offers what changed while this person was away, then counts it as seen', async () => {
    const kv = new MemoryKV()
    const ws = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    ws.markSeen(true)
    await new Promise((r) => setTimeout(r, 10))
    // Someone else's change arrives (another tab, a live session…).
    const [b] = addItem(ws.editor.board, newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'From Sam' }))
    ws.editor.applyRemote(diff(ws.editor.board, b))
    await ws.checkCatchUp()
    expect(ws.editor.catchUp?.added).toHaveLength(1)
    ws.editor.dismissCatchUp()
    await new Promise((r) => setTimeout(r, 10))
    expect(ws.editor.catchUp).toBeNull()
    await ws.checkCatchUp()
    expect(ws.editor.catchUp).toBeNull()
    ws.dispose()
  })

  it('does not count your own last edit as news after switching boards and back', async () => {
    const kv = new MemoryKV()
    const ws = await Workspace.start(new Editor(emptyBoard(), fakeMeasure), kv, '')
    const first = ws.boardId!
    ws.markSeen(true)
    await new Promise((r) => setTimeout(r, 10))
    ws.editor.addNote(ws.editor.board.items[0].id, 'Written just before leaving')
    await ws.newBoard(emptyBoard('Elsewhere'))
    await ws.switchTo(first)
    expect(ws.editor.catchUp).toBeNull()
    ws.dispose()
  })
})

describe('wiki-links', () => {
  it('opens a linked board and shows its object, and finds links back', async () => {
    const { ws, editor } = await workspace()
    const home = ws.boardId!
    const [withSticky, sticky] = addItem(emptyBoard('Garage'), newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'Jack' }))
    const garage = await ws.newBoard(withSticky)
    await ws.switchTo(home)
    const target = editor.board.items[0].id
    editor.addNote(target, `See [[Jack]](board:${garage}#${sticky})`)
    await ws.flush()
    await ws.openLink({ board: garage, item: sticky })
    expect(ws.boardId).toBe(garage)
    expect([...editor.selection]).toEqual([sticky])
    const here = await ws.linksHere()
    expect(here.map((l) => [l.boardId, l.from, l.to.item, l.text])).toEqual([[home, target, sticky, 'See Jack']])
    ws.dispose()
  })
})

describe('autosave races', () => {
  it('saves an edit made while switching onto the board it was made on', async () => {
    const { ws, editor } = await workspace()
    const a = ws.boardId!
    const b = await ws.newBoard(emptyBoard('B'))
    await ws.switchTo(a)
    // Switch away, and edit A before the switch lands (a live or tab change can do this).
    const going = ws.switchTo(b)
    const [withNote] = addItem(editor.board, newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }, { text: 'late edit on A' }))
    editor.applyRemote(diff(editor.board, withNote))
    await going
    await ws.flush()
    expect((await ws.library.load(b))!.items.some((i) => i.text === 'late edit on A')).toBe(false)
    ws.dispose()
  })

  it('never saves the old board over the new one while the switch reads from storage', async () => {
    const { ws, editor, kv } = await workspace()
    const a = ws.boardId!
    const b = await ws.newBoard(emptyBoard('B'))
    await ws.switchTo(a)
    editor.setTitle('Board A')
    await ws.flush()
    // Hold the switch at its storage read, and change the board (as another tab or a friend can).
    let release = () => {}
    const get = kv.get.bind(kv)
    kv.get = (async (key: string) => {
      if (key === `handle:${b}`) await new Promise<void>((r) => (release = r))
      return get(key)
    }) as typeof kv.get
    const going = ws.switchTo(b)
    await new Promise((r) => setTimeout(r, 0))
    const [withNote] = addItem(editor.board, newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }, { text: 'on A' }))
    editor.applyRemote(diff(editor.board, withNote))
    release()
    await going
    await ws.flush()
    expect((await ws.library.load(b))!.title).toBe('B')
    ws.dispose()
  })

  it('a save under way doesn’t bring back a board deleted meanwhile', async () => {
    const { ws, editor } = await workspace()
    await ws.newBoard(emptyBoard('Keep'))
    const doomed = await ws.newBoard(emptyBoard('Doomed'))
    editor.setTitle('Doomed, edited')
    const saving = ws.flush()
    await ws.remove(doomed)
    await saving
    // And an edit arriving before the next board opens isn't saved anywhere either.
    expect(await ws.library.load(doomed)).toBeFalsy()
    expect((await ws.library.list()).some((m) => m.id === doomed)).toBe(false)
    ws.dispose()
  })

  it('never writes a deleted board over another one', async () => {
    const { ws, editor } = await workspace()
    const keep = await ws.newBoard(emptyBoard('Keep'))
    const doomed = await ws.newBoard(emptyBoard('Doomed'))
    editor.setTitle('Doomed, edited')
    await ws.remove(doomed)
    await ws.flush()
    expect((await ws.library.load(keep))!.title).toBe('Keep')
    ws.rescue()
    await ws.flush()
    expect((await ws.library.load(keep))!.title).toBe('Keep')
    ws.dispose()
  })
})

describe('live links', () => {
  it('keeps the edit key when someone who can edit opens the view link', async () => {
    const { ws } = await workspace()
    const server = 'https://bc.example/'
    await ws.joinLive({ id: 'room1', key: 'edit-key-1234567890' }, server)
    await ws.joinLive({ id: 'room1', key: 'view-key-1234567890' }, server)
    const known = await ws.library.findLive(server, 'room1')
    expect(known?.live).toMatchObject({ key: 'edit-key-1234567890', role: 'edit', viewKey: 'view-key-1234567890' })
    ws.dispose()
  })
})
