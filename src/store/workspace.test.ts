import { describe, expect, it } from 'vitest'
import { Editor } from '../editor/Editor'
import { emptyBoard } from '../model/board'
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
