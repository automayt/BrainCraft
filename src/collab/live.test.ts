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
  onclose: ((e?: { code?: number }) => void) | null = null
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

describe('live sessions when things go wrong', () => {
  const hello = (text: string): ServerMessage => ({
    t: 'hello',
    board: { ...emptyBoard('Shared'), items: [note(1, text)], nextId: 2 },
    version: 3,
    you: { id: 'me', role: 'edit', idBase: ID_BLOCK },
    peers: [],
  })

  it('sends an unconfirmed edit again after the connection drops', () => {
    vi.useFakeTimers()
    try {
      const { editor, live, ws } = session()
      editor.edit((b) => B.updateItem(b, 1, (i) => ({ ...i, text: 'Typed just before the drop' })))
      live.flush()
      ws.onclose!()
      vi.advanceTimersByTime(1000)
      const again = FakeSocket.last!
      expect(again).not.toBe(ws)
      // The server never got it.
      again.deliver(hello('Start'))
      live.flush()
      expect(B.getItem(editor.board, 1)!.text).toBe('Typed just before the drop')
      expect(again.sent.filter((m) => m.t === 'patch')).toMatchObject([{ patches: [{ k: 'item', id: 1 }] }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not send a confirmed-looking edit again over a newer one by someone else', () => {
    vi.useFakeTimers()
    try {
      const { editor, live, ws } = session()
      editor.edit((b) => B.updateItem(b, 1, (i) => ({ ...i, text: 'Mine' })))
      live.flush()
      ws.onclose!()
      vi.advanceTimersByTime(1000)
      const again = FakeSocket.last!
      // The server took "Mine" (the ack was lost), then Bo changed the note.
      again.deliver(hello('Bo wrote this later'))
      live.flush()
      expect(B.getItem(editor.board, 1)!.text).toBe('Bo wrote this later')
      expect(again.sent.filter((m) => m.t === 'patch')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends two unconfirmed edits to one note again as the last one', () => {
    vi.useFakeTimers()
    try {
      const { editor, live, ws } = session()
      editor.edit((b) => B.updateItem(b, 1, (i) => ({ ...i, text: 'First' })))
      live.flush()
      editor.edit((b) => B.updateItem(b, 1, (i) => ({ ...i, text: 'Second' })))
      live.flush()
      ws.onclose!()
      vi.advanceTimersByTime(1000)
      const again = FakeSocket.last!
      again.deliver(hello('Start'))
      live.flush()
      expect(B.getItem(editor.board, 1)!.text).toBe('Second')
    } finally {
      vi.useRealTimers()
    }
  })

  it('splits a change full of pictures by size, and drops one the server closed on', () => {
    vi.useFakeTimers()
    try {
      const { editor, live, ws } = session()
      const big = 'data:image/png;base64,' + 'A'.repeat(3_000_000)
      editor.edit((b) => {
        for (let k = 0; k < 3; k++) b = B.addItem(b, { ...note(0, ''), kind: 'image', src: big } as Item)[0]
        return b
      })
      live.flush()
      const parts = ws.sent.filter((m) => m.t === 'patch')
      expect(parts.length).toBe(3)
      for (const p of parts) expect(JSON.stringify(p).length).toBeLessThan(5_000_000)
      // Too big for the server after all: it closes, and the same message isn't sent again.
      ws.onclose!({ code: 1009 })
      vi.advanceTimersByTime(1000)
      const again = FakeSocket.last!
      again.deliver(hello('Start'))
      live.flush()
      expect(again.sent.filter((m) => m.t === 'patch')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reloads the board after the server refuses a change, and takes others’ edits again', () => {
    vi.useFakeTimers()
    try {
      const { editor, live, ws } = session()
      editor.edit((b) => B.updateItem(b, 1, (i) => ({ ...i, text: 'Refused' })))
      live.flush()
      let closed = false
      ws.close = () => {
        closed = true
        ws.onclose!()
      }
      ws.deliver({ t: 'error', message: 'Bad patch', seq: 1 })
      expect(closed).toBe(true)
      vi.advanceTimersByTime(1000)
      const again = FakeSocket.last!
      again.deliver(hello('Start'))
      live.flush()
      // The refused change isn't sent again, and the board is everyone's.
      expect(again.sent.filter((m) => m.t === 'patch')).toHaveLength(0)
      expect(B.getItem(editor.board, 1)!.text).toBe('Start')
      again.deliver({ t: 'patch', from: 'them', version: 4, patches: [{ k: 'item', id: 1, v: note(1, 'Theirs') }] })
      expect(B.getItem(editor.board, 1)!.text).toBe('Theirs')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends a very large change in parts the server accepts', () => {
    const { editor, live, ws } = session()
    editor.edit((b) => {
      for (let k = 0; k < 4500; k++) b = B.addItem(b, note(0, `n${k}`))[0]
      return b
    })
    live.flush()
    const parts = ws.sent.filter((m) => m.t === 'patch')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(p.t === 'patch' && p.patches.length).toBeLessThanOrEqual(5000)
  })
})
