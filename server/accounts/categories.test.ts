import { describe, expect, it } from 'vitest'
import { Room, type RoomData } from '../../src/collab/room'
import { emptyBoard } from '../../src/model/board'
import { fakeMeasure } from '../../src/model/test-helpers'
import { AccountBoards, type RoomHost } from './boards'
import { Categories, cleanCategory } from './categories'
import { cookieOf, req, res, tempDir } from './fakes'
import { Accounts } from './service'

/** Sam owns Trip and Budget and shares Trip with Lee. */
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
    loaded: (id) => rooms.get(id) ?? null,
  }
  const boards = new AccountBoards(accounts, host)
  const call = async (method: string, path: string, cookie: string, body?: unknown) => {
    const r = res()
    const url = new URL(`http://localhost:8080${path}`)
    const text = async () => (body === undefined ? '' : JSON.stringify(body))
    if (!(await accounts.handle(req(method, { cookie }), r, url, text))) await boards.handle(req(method, { cookie }), r, url, text)
    return r.reply
  }
  const ann = cookieOf(await call('POST', '/api/auth/setup', '', { email: 'ann@x.org', name: 'Ann', password: 'a long password' }))
  const person = async (email: string, name: string) => {
    const made = await call('POST', '/api/admin/users', ann, { email, name })
    const cookie = cookieOf(await call('POST', '/api/auth/reset', '', { token: String(made.body.link).split('#reset=')[1], password: `${name} long password` }))
    return { cookie, id: (made.body.user as { id: string }).id }
  }
  const sam = await person('sam@x.org', 'Sam')
  const lee = await person('lee@x.org', 'Lee')
  const trip = String((await call('POST', '/api/boards', sam.cookie, { board: emptyBoard('Trip') })).body.id)
  const budget = String((await call('POST', '/api/boards', sam.cookie, { board: emptyBoard('Budget') })).body.id)
  await call('PUT', `/api/boards/${trip}/access`, sam.cookie, { access: [{ who: 'user', id: lee.id, level: 'view' }] })
  const listed = async (cookie: string) => Object.fromEntries(((await call('GET', '/api/boards', cookie)).body.boards as { title: string; category?: string }[]).map((b) => [b.title, b.category ?? null]))
  return { accounts, boards, call, sam, lee, trip, budget, listed }
}

describe('categories for boards', () => {
  it('are each person’s own', async () => {
    const s = await server()
    expect((await s.call('PUT', `/api/boards/${s.trip}/category`, s.sam.cookie, { category: 'Webex meetings' })).status).toBe(200)
    expect(await s.listed(s.sam.cookie)).toEqual({ Trip: 'Webex meetings', Budget: null })
    expect(await s.listed(s.lee.cookie)).toEqual({ Trip: null })
  })

  it('can be set by someone who can only view the board', async () => {
    const s = await server()
    await s.call('PUT', `/api/boards/${s.trip}/category`, s.lee.cookie, { category: 'Holidays' })
    expect(await s.listed(s.lee.cookie)).toEqual({ Trip: 'Holidays' })
  })

  it('are only for boards you can open, without saying whether others exist', async () => {
    const s = await server()
    expect((await s.call('PUT', `/api/boards/${s.budget}/category`, s.lee.cookie, { category: 'Mine' })).status).toBe(404)
    expect((await s.call('PUT', '/api/boards/nosuchboard/category', s.lee.cookie, { category: 'Mine' })).status).toBe(404)
  })

  it('take a board out with null', async () => {
    const s = await server()
    await s.call('PUT', `/api/boards/${s.trip}/category`, s.sam.cookie, { category: 'Webex meetings' })
    await s.call('PUT', `/api/boards/${s.trip}/category`, s.sam.cookie, { category: null })
    expect(await s.listed(s.sam.cookie)).toEqual({ Trip: null, Budget: null })
  })

  it('rename for one person, every board in it', async () => {
    const s = await server()
    for (const id of [s.trip, s.budget]) await s.call('PUT', `/api/boards/${id}/category`, s.sam.cookie, { category: 'Meetings' })
    await s.call('PUT', `/api/boards/${s.trip}/category`, s.lee.cookie, { category: 'Meetings' })
    expect((await s.call('POST', '/api/categories/rename', s.sam.cookie, { from: 'Meetings', to: 'Webex meetings' })).status).toBe(200)
    expect(await s.listed(s.sam.cookie)).toEqual({ Trip: 'Webex meetings', Budget: 'Webex meetings' })
    expect(await s.listed(s.lee.cookie)).toEqual({ Trip: 'Meetings' })
  })

  it('removing one leaves its boards in none', async () => {
    const s = await server()
    await s.call('PUT', `/api/boards/${s.trip}/category`, s.sam.cookie, { category: 'Meetings' })
    await s.call('POST', '/api/categories/rename', s.sam.cookie, { from: 'Meetings', to: null })
    expect(await s.listed(s.sam.cookie)).toEqual({ Trip: null, Budget: null })
  })

  it('refuses what isn’t a name', async () => {
    const s = await server()
    expect((await s.call('PUT', `/api/boards/${s.trip}/category`, s.sam.cookie, { category: 42 })).status).toBe(400)
    expect((await s.call('POST', '/api/categories/rename', s.sam.cookie, { from: '', to: 'x' })).status).toBe(400)
  })

  it('go when the board is deleted', async () => {
    const s = await server()
    await s.call('PUT', `/api/boards/${s.trip}/category`, s.sam.cookie, { category: 'Meetings' })
    await s.call('DELETE', `/api/boards/${s.trip}`, s.sam.cookie)
    expect(s.boards.categories.of(s.sam.id)).toEqual({})
  })
})

describe('the categories file', () => {
  it('survives a restart', () => {
    const dir = tempDir()
    const a = new Categories(dir)
    a.set('sam', 'b1', 'Meetings')
    a.flush()
    expect(new Categories(dir).of('sam')).toEqual({ b1: 'Meetings' })
  })

  it('keeps names to one short line', () => {
    expect(cleanCategory('  Webex\n meetings  ')).toBe('Webex meetings')
    expect(cleanCategory('x'.repeat(100))).toHaveLength(60)
    expect(cleanCategory('   ')).toBeNull()
    expect(cleanCategory(null)).toBeNull()
    expect(cleanCategory(7)).toBeUndefined()
  })
})
