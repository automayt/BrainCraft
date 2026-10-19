import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { Room, type RoomData } from '../collab/room'
import { diff } from '../collab/patch'
import { isProtected, protectedChange } from './protection'
import { fakeMeasure } from './test-helpers'
import type { Board } from './types'
import { emptyWiki, getPage, pageByTitle, setPageBody, setPageMeta } from './wiki'

/** A wiki: Home, Rules (protected) with Fees under it, and Notes. */
function wiki(): Board {
  let b = applyOps(emptyWiki('Club'), [
    { op: 'createPage', title: 'Rules', text: 'Be kind' },
    { op: 'createPage', title: 'Fees', parent: 'Rules', text: '£5' },
    { op: 'createPage', title: 'Notes', text: 'Anything' },
  ], { measure: fakeMeasure, now: 1000 }).board
  b = setPageMeta(b, pageByTitle(b, 'Rules')!.id, { protected: true })
  return b
}
const id = (b: Board, title: string) => pageByTitle(b, title)!.id

describe('protected pages', () => {
  it('cover the page and the pages under it', () => {
    const b = wiki()
    expect(isProtected(b, id(b, 'Rules'))).toBe(true)
    expect(isProtected(b, id(b, 'Fees'))).toBe(true)
    expect(isProtected(b, id(b, 'Notes'))).toBe(false)
  })

  it('refuse changes to them from people who don’t manage the wiki, and only those', () => {
    const b = wiki()
    const change = (f: (x: Board) => Board) => protectedChange(b, diff(b, f(b)))
    expect(change((x) => setPageBody(x, id(x, 'Fees'), 'Free!'))).toMatch(/protected/)
    expect(change((x) => setPageMeta(x, id(x, 'Rules'), { title: 'Our rules' }))).toMatch(/protected/)
    expect(change((x) => setPageMeta(x, id(x, 'Rules'), { protected: false }))).toMatch(/protected/)
    expect(change((x) => setPageMeta(x, id(x, 'Notes'), { protected: true }))).toMatch(/Only people who manage/)
    // Adding a page under a protected one, or moving one there.
    expect(change((x) => applyOps(x, [{ op: 'createPage', title: 'Sneaky', parent: 'Rules' }], { measure: fakeMeasure }).board)).toMatch(/protected/)
    expect(change((x) => applyOps(x, [{ op: 'movePage', page: 'Notes', parent: 'Rules' }], { measure: fakeMeasure }).board)).toMatch(/protected/)
    // Everything else is fine.
    expect(change((x) => setPageBody(x, id(x, 'Notes'), 'More'))).toBeNull()
    expect(change((x) => applyOps(x, [{ op: 'createPage', title: 'New' }], { measure: fakeMeasure }).board)).toBeNull()
  })

  it('are enforced by the live room for people who don’t manage it, and through the API', () => {
    const data: RoomData = { id: 'w', board: wiki(), version: 0, editKey: 'e'.repeat(24), viewKey: 'v'.repeat(24), nextSlot: 1, created: 0, updated: 0 }
    const room = new Room(data, fakeMeasure)
    const inbox: Record<string, { t: string; message?: string }[]> = { member: [], manager: [], key: [] }
    room.join({ id: 'member', role: 'edit', manages: false, send: (m) => inbox.member.push(m as never) })
    room.join({ id: 'manager', role: 'edit', manages: true, send: (m) => inbox.manager.push(m as never) })
    room.join({ id: 'key', role: 'edit', send: (m) => inbox.key.push(m as never) })
    const edit = (who: string, text: string) => {
      const before = room.data.board
      room.receive(who, { t: 'patch', seq: 1, patches: diff(before, setPageBody(before, id(before, 'Fees'), text)) })
    }
    edit('member', 'Free!')
    expect(inbox.member.at(-1)).toMatchObject({ t: 'error', message: expect.stringMatching(/protected/) })
    expect(room.data.board.bodies!.find((x) => x.id === id(room.data.board, 'Fees'))!.text).toBe('£5')
    edit('manager', '£6')
    expect(inbox.manager.at(-1)).toMatchObject({ t: 'ack' })
    // Shared by key, nobody manages: the app guards it, the room doesn't.
    edit('key', '£7')
    expect(inbox.key.at(-1)).toMatchObject({ t: 'ack' })
    expect(() => room.applyOps([{ op: 'updatePage', page: 'Fees', text: 'x' }], { manages: false })).toThrow(/protected/)
    expect(room.applyOps([{ op: 'updatePage', page: 'Notes', text: 'ok' }], { manages: false })).toHaveLength(1)
    expect(getPage(room.data.board, id(room.data.board, 'Rules'))!.protected).toBe(true)
  })
})
