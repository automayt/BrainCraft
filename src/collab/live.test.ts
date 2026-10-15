import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '../editor/Editor'
import * as B from '../model/board'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import type { Item } from '../model/types'
import { LiveSession, liveUrl } from './live'
import { ID_BLOCK, type ClientMessage, type ServerMessage } from './protocol'

class FakeSocket {
  static OPEN = 1
  static last: FakeSocket | null = null
  readyState = 1
  sent: ClientMessage[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.last = this
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {}
  deliver(m: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(m) })
  }
}

const note = (id: number, text: string): Item => ({ id, kind: 'sticky', x: 0, y: 0, w: 100, h: 100, color: '#fff9b1', text, fontSize: 22 })

function session() {
  vi.stubGlobal('WebSocket', FakeSocket)
  const editor = new Editor(emptyBoard(), fakeMeasure)
  const live = new LiveSession(editor, 'https://bc.example/app/', { id: 'board123', key: 'k'.repeat(20) }, { name: 'Ana', color: '#1c7ed6' })
  const ws = FakeSocket.last!
  ws.deliver({ t: 'hello', board: { ...emptyBoard('Shared'), items: [note(1, 'Start')], nextId: 2 }, version: 3, you: { id: 'me', role: 'edit', idBase: ID_BLOCK }, peers: [] })
  return { editor, live, ws }
}

afterEach(() => vi.unstubAllGlobals())

describe('live sessions', () => {
  it('builds the socket address from the server and link', () => {
    expect(liveUrl('https://bc.example/app/', { id: 'abc123', key: 'k' })).toBe('wss://bc.example/app/api/boards/abc123/live?key=k')
    expect(liveUrl('http://localhost:8080', { id: 'abc123', key: 'k' })).toBe('ws://localhost:8080/api/boards/abc123/live?key=k')
  })

  it('loads the shared board and hands out ids from its own block', () => {
    const { editor, live } = session()
    expect(live.state).toBe('live')
    expect(editor.board.title).toBe('Shared')
    const [, id] = B.addItem(editor.board, note(0, 'x'))
    expect(id).toBe(ID_BLOCK)
  })

  it('sends local edits as patches', () => {
    const { editor, live, ws } = session()
    editor.edit((b) => B.updateItem(b, 1, (i) => ({ ...i, text: 'Mine' })))
    live.flush()
    const sent = ws.sent.filter((m) => m.t === 'patch')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ t: 'patch', seq: 1, patches: [{ k: 'item', id: 1 }] })
  })

  it('ignores others’ changes to objects it is still sending, until acknowledged', () => {
    const { editor, live, ws } = session()
    editor.edit((b) => B.updateItem(b, 1, (i) => ({ ...i, text: 'Mine' })))
    live.flush()
    ws.deliver({ t: 'patch', from: 'them', version: 4, patches: [{ k: 'item', id: 1, v: note(1, 'Theirs') }] })
    expect(B.getItem(editor.board, 1)!.text).toBe('Mine')
    ws.deliver({ t: 'ack', seq: 1, version: 5 })
    ws.deliver({ t: 'patch', from: 'them', version: 6, patches: [{ k: 'item', id: 1, v: note(1, 'Later') }] })
    expect(B.getItem(editor.board, 1)!.text).toBe('Later')
  })

  it('applies others’ changes without echoing them back', () => {
    const { editor, live, ws } = session()
    ws.deliver({ t: 'patch', from: 'them', version: 4, patches: [{ k: 'item', id: 99, v: note(99, 'New') }] })
    expect(B.getItem(editor.board, 99)!.text).toBe('New')
    live.flush()
    expect(ws.sent.filter((m) => m.t === 'patch')).toHaveLength(0)
    // Remote changes aren't on this person's undo stack.
    expect(editor.history.canUndo).toBe(false)
  })

  it('undo reverts only my own step', () => {
    const { editor, live, ws } = session()
    editor.edit((b) => B.updateItem(b, 1, (i) => ({ ...i, text: 'Mine' })))
    live.flush()
    ws.deliver({ t: 'ack', seq: 1, version: 4 })
    ws.deliver({ t: 'patch', from: 'them', version: 5, patches: [{ k: 'item', id: 50, v: note(50, 'Theirs') }] })
    editor.undo()
    expect(B.getItem(editor.board, 1)!.text).toBe('Start')
    expect(B.getItem(editor.board, 50)!.text).toBe('Theirs')
  })

  it('tracks people and follows their view', () => {
    const { editor, live, ws } = session()
    ws.deliver({ t: 'presence', peer: { id: 'p1', role: 'edit', name: 'Ben', color: '#2f9e44', cursor: { x: 5, y: 5 }, selection: [1], view: { x: 0, y: 0, w: 400, h: 300 } } })
    expect(editor.peers.get('p1')?.name).toBe('Ben')
    live.follow('p1')
    expect(live.following).toBe('p1')
    editor.pan(10, 10)
    expect(live.following).toBe('p1') // only the workspace wires manual camera moves to unfollow
    ws.deliver({ t: 'leave', id: 'p1' })
    expect(editor.peers.size).toBe(0)
    expect(live.following).toBeNull()
  })

  it('opens view-only links read-only', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const editor = new Editor(emptyBoard(), fakeMeasure)
    new LiveSession(editor, 'https://bc.example/', { id: 'board123', key: 'v'.repeat(20) }, { name: 'Viv', color: '#000000' })
    FakeSocket.last!.deliver({ t: 'hello', board: emptyBoard('Shared'), version: 1, you: { id: 'v', role: 'view', idBase: 0 }, peers: [] })
    expect(editor.readOnly).toBe(true)
  })
})
