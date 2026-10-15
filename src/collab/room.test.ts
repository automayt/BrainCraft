import { describe, expect, it } from 'vitest'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import type { Item } from '../model/types'
import { ID_BLOCK, type ServerMessage } from './protocol'
import { Room, sanitizePresence } from './room'

function room() {
  const r = new Room({ id: 'r1', board: emptyBoard('Shared'), version: 0, editKey: 'edit-key-1234567890', viewKey: 'view-key-1234567890', nextSlot: 1, created: 0, updated: 0 }, fakeMeasure)
  const inbox = new Map<string, ServerMessage[]>()
  const join = (id: string, role: 'edit' | 'view') => {
    inbox.set(id, [])
    r.join({ id, role, send: (m) => inbox.get(id)!.push(m) })
  }
  return { r, inbox, join }
}

const note = (id: number, text: string): Item => ({ id, kind: 'sticky', x: 0, y: 0, w: 100, h: 100, color: '#fff9b1', text, fontSize: 22 })

describe('rooms', () => {
  it('greets each editor with the board and their own id block', () => {
    const { inbox, join } = room()
    join('a', 'edit')
    join('b', 'edit')
    join('v', 'view')
    const hello = (id: string) => inbox.get(id)![0] as Extract<ServerMessage, { t: 'hello' }>
    expect(hello('a').you.idBase).toBe(ID_BLOCK)
    expect(hello('b').you.idBase).toBe(2 * ID_BLOCK)
    expect(hello('v').you).toMatchObject({ role: 'view', idBase: 0 })
    expect(hello('a').board.title).toBe('Shared')
  })

  it('applies patches, acknowledges the sender and passes them to everyone else', () => {
    const { r, inbox, join } = room()
    join('a', 'edit')
    join('b', 'edit')
    r.receive('a', { t: 'patch', seq: 1, patches: [{ k: 'item', id: ID_BLOCK, v: note(ID_BLOCK, 'Hi') }] })
    expect(r.data.board.items).toHaveLength(1)
    expect(r.data.version).toBe(1)
    expect(inbox.get('a')!.at(-1)).toEqual({ t: 'ack', seq: 1, version: 1 })
    expect(inbox.get('b')!.at(-1)).toMatchObject({ t: 'patch', from: 'a', version: 1 })
  })

  it('refuses edits from view-only links', () => {
    const { r, inbox, join } = room()
    join('v', 'view')
    r.receive('v', { t: 'patch', seq: 1, patches: [{ k: 'title', v: 'Hacked' }] })
    expect(r.data.board.title).toBe('Shared')
    expect(inbox.get('v')!.at(-1)).toMatchObject({ t: 'error' })
  })

  it('relays presence and says when someone leaves', () => {
    const { r, inbox, join } = room()
    join('a', 'edit')
    join('b', 'edit')
    r.receive('a', { t: 'presence', presence: { name: 'Sam', color: '#1c7ed6', cursor: { x: 1, y: 2 }, selection: [], view: null } })
    expect(inbox.get('b')!.at(-1)).toMatchObject({ t: 'presence', peer: { id: 'a', name: 'Sam' } })
    r.leave('a')
    expect(inbox.get('b')!.at(-1)).toEqual({ t: 'leave', id: 'a' })
  })

  it('runs API operations and broadcasts the result', () => {
    const { r, inbox, join } = room()
    join('a', 'edit')
    const results = r.applyOps([{ op: 'createNote', text: 'From the API' }])
    expect(results[0].op).toBe('createNote')
    expect(r.data.board.items[0].text).toBe('From the API')
    expect(inbox.get('a')!.at(-1)).toMatchObject({ t: 'patch', from: 'server' })
  })

  it('knows keys', () => {
    const { r } = room()
    expect(r.roleFor('edit-key-1234567890')).toBe('edit')
    expect(r.roleFor('view-key-1234567890')).toBe('view')
    expect(r.roleFor('nope')).toBeNull()
  })

  it('cleans up presence from browsers', () => {
    expect(sanitizePresence({ name: 'x'.repeat(100), color: 'red', cursor: { x: 'a' }, selection: [1, 'b'] })).toEqual({
      name: 'x'.repeat(40),
      color: '#7048e8',
      cursor: { x: 0, y: 0 },
      selection: [1],
      view: null,
    })
    expect(sanitizePresence(null)).toBeNull()
  })
})
