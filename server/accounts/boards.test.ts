import { describe, expect, it } from 'vitest'
import { Room, type RoomData } from '../../src/collab/room'
import { emptyBoard } from '../../src/model/board'
import { fakeMeasure } from '../../src/model/test-helpers'
import { AccountBoards, type RoomHost } from './boards'
import { cookieOf, req, res, tempDir } from './fakes'
import { Accounts } from './service'

/** A server with accounts, its rooms in memory, an admin (Ann) and two people (Sam, Lee). */
async function server() {
  const accounts = new Accounts({ dir: tempDir() })
  const rooms = new Map<string, Room>()
  let n = 0
  const host: RoomHost = {
    get: (id) => rooms.get(id) ?? null,
    create(board, owner) {
      const data: RoomData = { id: `board${++n}`, board, version: 0, editKey: 'k'.repeat(24), viewKey: 'v'.repeat(24), nextSlot: 1, created: 0, updated: n, owner, access: [] }
      const room = new Room(data, fakeMeasure)
      rooms.set(data.id, room)
      return room
    },
    remove: (id) => rooms.delete(id),
    ids: () => [...rooms.keys()],
    peek: (id) => rooms.get(id)?.data ?? null,
  }
  const boards = new AccountBoards(accounts, host)
  const call = async (method: string, path: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = res()
    const url = new URL(`http://localhost:8080${path}`)
    const body$ = async () => (body === undefined ? '' : JSON.stringify(body))
    if (!(await accounts.handle(req(method, { cookie, ...headers }), r, url, body$))) await boards.handle(req(method, { cookie, ...headers }), r, url, body$)
    return r.reply
  }
  const ann = cookieOf(await call('POST', '/api/auth/setup', '', { email: 'ann@x.org', name: 'Ann', password: 'a long password' }))
  const person = async (email: string, name: string, groups: string[] = []) => {
    const made = await call('POST', '/api/admin/users', ann, { email, name, groups })
    const cookie = cookieOf(await call('POST', '/api/auth/reset', '', { token: String(made.body.link).split('#reset=')[1], password: `${name} long password` }))
    return { cookie, id: (made.body.user as { id: string }).id }
  }
  const team = (await call('POST', '/api/admin/groups', ann, { name: 'Team', permissions: ['boards.share'] })).body.group as { id: string }
  const sam = await person('sam@x.org', 'Sam', [team.id])
  const lee = await person('lee@x.org', 'Lee')
  return { accounts, boards, rooms, call, ann, sam, lee, team, host }
}

describe('boards on a server with accounts', () => {
  it('belong to whoever makes them, and are listed only for people with access', async () => {
    const s = await server()
    const made = await s.call('POST', '/api/boards', s.sam.cookie, { board: emptyBoard('Trip') })
    expect(made.status).toBe(201)
    const id = String(made.body.id)
    expect(s.rooms.get(id)!.data.owner).toBe(s.sam.id)
    expect(((await s.call('GET', '/api/boards', s.sam.cookie)).body.boards as { title: string; level: string }[])[0]).toMatchObject({ title: 'Trip', level: 'manage' })
    expect((await s.call('GET', '/api/boards', s.lee.cookie)).body.boards).toEqual([])
    // Lee can't open it, and can't tell it exists.
    expect((await s.call('GET', `/api/boards/${id}`, s.lee.cookie)).status).toBe(404)
    // An admin sees everything.
    expect(((await s.call('GET', '/api/boards', s.ann)).body.boards as unknown[]).length).toBe(1)
    // Signed out: nothing.
    expect((await s.call('GET', '/api/boards', '')).status).toBe(401)
  })

  it('opens by the level granted: view can read, edit can change, manage can share', async () => {
    const s = await server()
    const id = String((await s.call('POST', '/api/boards', s.sam.cookie, { board: emptyBoard('Plan') })).body.id)
    const put = await s.call('PUT', `/api/boards/${id}/access`, s.sam.cookie, { access: [{ who: 'user', id: s.lee.id, level: 'view' }] })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ owner: { name: 'Sam' }, access: [{ who: 'user', id: s.lee.id, level: 'view', name: 'Lee' }] })
    expect((await s.call('GET', `/api/boards/${id}`, s.lee.cookie)).body).toMatchObject({ level: 'view', role: 'view' })
    const ops = { ops: [{ op: 'createNote', text: 'Hi' }] }
    expect((await s.call('POST', `/api/boards/${id}/ops`, s.lee.cookie, ops)).status).toBe(403)
    expect((await s.call('PUT', `/api/boards/${id}/access`, s.lee.cookie, { access: [] })).status).toBe(403)
    await s.call('PUT', `/api/boards/${id}/access`, s.sam.cookie, { access: [{ who: 'user', id: s.lee.id, level: 'edit' }] })
    expect((await s.call('POST', `/api/boards/${id}/ops`, s.lee.cookie, ops)).status).toBe(200)
    expect((await s.call('DELETE', `/api/boards/${id}`, s.lee.cookie)).status).toBe(403)
  })

  it('lets only people with “Share boards” give access, and only owners or admins hand a board over', async () => {
    const s = await server()
    // Lee isn't in Team, so can't share; give Lee a board of their own to try with.
    const lees = String((await s.call('POST', '/api/boards', s.lee.cookie, { board: emptyBoard('Lee’s') })).body.id)
    expect((await s.call('PUT', `/api/boards/${lees}/access`, s.lee.cookie, { access: [{ who: 'user', id: s.sam.id, level: 'view' }] })).status).toBe(403)
    // Sam (Team) can, by group too.
    const sams = String((await s.call('POST', '/api/boards', s.sam.cookie, { board: emptyBoard('Sam’s') })).body.id)
    expect((await s.call('PUT', `/api/boards/${sams}/access`, s.sam.cookie, { access: [{ who: 'group', id: s.team.id, level: 'edit' }] })).status).toBe(200)
    // Junk is refused.
    expect((await s.call('PUT', `/api/boards/${sams}/access`, s.sam.cookie, { access: [{ who: 'user', id: 'nobody', level: 'edit' }] })).status).toBe(400)
    expect((await s.call('PUT', `/api/boards/${sams}/access`, s.sam.cookie, { access: [{ who: 'user', id: s.lee.id, level: 'owner' }] })).status).toBe(400)
    // A manager who isn't the owner can't hand it over; the owner can.
    await s.call('PUT', `/api/boards/${sams}/access`, s.sam.cookie, { access: [{ who: 'user', id: s.lee.id, level: 'manage' }] })
    expect((await s.call('PUT', `/api/boards/${sams}/access`, s.lee.cookie, { owner: s.lee.id })).status).toBe(403)
    expect((await s.call('PUT', `/api/boards/${sams}/access`, s.sam.cookie, { owner: s.lee.id })).status).toBe(200)
    expect(s.rooms.get(sams)!.data.owner).toBe(s.lee.id)
  })

  it('leaves boards from before accounts (no owner) to admins, who can give them one', async () => {
    const s = await server()
    const old = s.host.create(emptyBoard('Old'), '')
    delete old.data.owner
    s.boards.index(old)
    expect((await s.call('GET', '/api/boards', s.sam.cookie)).body.boards).toEqual([])
    expect((await s.call('GET', `/api/boards/${old.data.id}`, s.ann)).status).toBe(200)
    await s.call('PUT', `/api/boards/${old.data.id}/access`, s.ann, { owner: s.sam.id })
    expect(((await s.call('GET', '/api/boards', s.sam.cookie)).body.boards as { level: string }[])[0].level).toBe('manage')
  })

  it('opens live sessions by session only, from the server’s own pages, with the account’s name', async () => {
    const s = await server()
    const id = String((await s.call('POST', '/api/boards', s.sam.cookie, { board: emptyBoard('Live') })).body.id)
    const room = s.rooms.get(id)!
    const ws = (cookie: string, origin?: string) => s.boards.socket(req('GET', { cookie, ...(origin ? { origin } : {}) }), room)
    expect(ws(s.sam.cookie, 'http://localhost:8080')).toMatchObject({ role: 'edit', user: { name: 'Sam' } })
    expect(ws(s.sam.cookie, 'https://evil.example')).toBeNull()
    expect(ws(s.lee.cookie, 'http://localhost:8080')).toBeNull()
    expect(ws('', 'http://localhost:8080')).toBeNull()
    // The name others see is the account's, whatever the browser claims.
    const inbox: { t: string; peer?: { name: string } }[] = []
    room.join({ id: 'c1', role: 'edit', send: (m) => inbox.push(m as never), user: { id: s.sam.id, name: 'Sam' } })
    room.join({ id: 'c2', role: 'edit', send: (m) => inbox.push(m as never) })
    room.receive('c1', { t: 'presence', presence: { name: 'The Admin', color: '#123456', cursor: null, selection: [], view: null } })
    expect(inbox.find((m) => m.t === 'presence')?.peer?.name).toBe('Sam')
  })
})

describe('the activity log for boards', () => {
  it('notes access changes, handing over and deleting, and an admin opening a board not shared with them (once)', async () => {
    const s = await server()
    const id = String((await s.call('POST', '/api/boards', s.sam.cookie, { board: emptyBoard('Trip') })).body.id)
    await s.call('PUT', `/api/boards/${id}/access`, s.sam.cookie, { access: [{ who: 'user', id: s.lee.id, level: 'view' }, { who: 'group', id: s.team.id, level: 'edit' }] })
    await s.call('PUT', `/api/boards/${id}/access`, s.sam.cookie, { access: [{ who: 'user', id: s.lee.id, level: 'edit' }] })
    await s.call('PUT', `/api/boards/${id}/access`, s.sam.cookie, { access: [{ who: 'user', id: s.lee.id, level: 'edit' }] }) // the same: nothing noted
    await s.call('GET', `/api/boards/${id}`, s.ann)
    await s.call('GET', `/api/boards/${id}`, s.ann)
    await s.call('GET', `/api/boards/${id}`, s.lee.cookie)
    // Her own board isn't news.
    const own = String((await s.call('POST', '/api/boards', s.ann, { board: emptyBoard('Mine') })).body.id)
    await s.call('GET', `/api/boards/${own}`, s.ann)
    await s.call('PUT', `/api/boards/${id}/access`, s.ann, { owner: s.lee.id })
    await s.call('DELETE', `/api/boards/${id}`, s.ann)
    const texts = s.accounts.audit.query({ kind: 'boards' }).entries.map((e) => e.text)
    expect(texts).toEqual([
      'Ann deleted “Trip” (Lee’s board) from the server',
      'Ann handed “Trip” to Lee (it was Sam’s)',
      'Ann read “Trip”, which isn’t shared with them (as an admin)',
      'Sam changed who has “Trip”: Lee can edit (was can view); removed Team',
      'Sam changed who has “Trip”: Lee can view; Team can edit',
    ])
    expect(s.accounts.audit.query({ kind: 'boards' }).entries[3].changes).toEqual({ access: ['Lee can view, Team can edit', 'Lee can edit'] })
  })
})
