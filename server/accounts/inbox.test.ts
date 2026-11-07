import { describe, expect, it } from 'vitest'
import { Room, type RoomData } from '../../src/collab/room'
import { emptyBoard } from '../../src/model/board'
import { fakeMeasure } from '../../src/model/test-helpers'
import { AccountBoards, type RoomHost } from './boards'
import { cookieOf, req, res, tempDir } from './fakes'
import { Inbox, NOTE_MAX, cleanNote } from './inbox'
import { Accounts } from './service'

type Item = Record<string, unknown> & { kind: string; id: string }

/** A server with accounts, an admin (Ann), Sam who owns a board called Trip, and Lee who doesn't have it. */
async function server(dir = tempDir()) {
  const accounts = new Accounts({ dir })
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
  const items = async (who: { cookie: string } | string) => ((await call('GET', '/api/inbox', typeof who === 'string' ? who : who.cookie)).body.items as Item[]) ?? []
  const share = (id: string, level = 'edit') => call('PUT', `/api/boards/${trip}/access`, sam.cookie, { access: [{ who: 'user', id, level }] })
  return { accounts, boards, rooms, call, ann, sam, lee, trip, items, share }
}

describe('being given a board', () => {
  it('tells the person, with who gave it and what they can do', async () => {
    const s = await server()
    await s.share(s.lee.id)
    expect(await s.items(s.lee)).toMatchObject([{ kind: 'share', board: s.trip, title: 'Trip', by: 'Sam', level: 'edit' }])
  })

  it('tells nobody else, and not the person who shared it', async () => {
    const s = await server()
    await s.share(s.lee.id)
    expect(await s.items(s.sam)).toEqual([])
    expect(await s.items(s.ann)).toEqual([])
  })

  it('reaches everyone a group lets in', async () => {
    const s = await server()
    const everyone = s.accounts.store.groups.find((g) => g.everyone)!
    await s.call('PUT', `/api/boards/${s.trip}/access`, s.sam.cookie, { access: [{ who: 'group', id: everyone.id, level: 'view' }] })
    expect(await s.items(s.lee)).toMatchObject([{ kind: 'share', level: 'view' }])
    expect(await s.items(s.ann)).toMatchObject([{ kind: 'share' }])
  })

  it('says so again when someone can do more, not when they can do less', async () => {
    const s = await server()
    await s.share(s.lee.id, 'view')
    await s.share(s.lee.id, 'edit')
    expect(await s.items(s.lee)).toMatchObject([{ kind: 'share', level: 'edit' }])
    await s.share(s.lee.id, 'view')
    expect(await s.items(s.lee)).toMatchObject([{ kind: 'share', level: 'edit' }])
  })

  it('drops the news when the board goes or is taken away', async () => {
    const s = await server()
    await s.share(s.lee.id)
    await s.call('PUT', `/api/boards/${s.trip}/access`, s.sam.cookie, { access: [] })
    expect(await s.items(s.lee)).toEqual([])
  })

  it('tells someone a board was handed to them', async () => {
    const s = await server()
    await s.call('PUT', `/api/boards/${s.trip}/access`, s.sam.cookie, { owner: s.lee.id })
    expect(await s.items(s.lee)).toMatchObject([{ kind: 'share', level: 'manage', by: 'Sam' }])
  })
})

describe('asking for access', () => {
  it('gets to whoever manages the board, with the note', async () => {
    const s = await server()
    expect((await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie, { note: 'For the trip' })).status).toBe(200)
    expect(await s.items(s.sam)).toMatchObject([{ kind: 'request', board: s.trip, title: 'Trip', by: 'Lee', note: 'For the trip' }])
    // An admin who doesn't manage it isn't bothered.
    expect(await s.items(s.ann)).toEqual([])
  })

  it('goes to admins when the board has nobody to manage it', async () => {
    const s = await server()
    s.rooms.get(s.trip)!.data.owner = undefined
    s.accounts.store.boards[s.trip].owner = undefined
    await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie)
    expect(await s.items(s.ann)).toMatchObject([{ kind: 'request' }])
  })

  it('says the same whether the board exists or not', async () => {
    const s = await server()
    const real = await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie)
    const made = await s.call('POST', `/api/boards/nosuchboard/ask`, s.lee.cookie)
    expect(made.status).toBe(real.status)
    expect(made.body).toEqual(real.body)
  })

  it('keeps nothing for a board that doesn’t exist', async () => {
    const s = await server()
    await s.call('POST', `/api/boards/nosuchboard/ask`, s.lee.cookie)
    expect(s.boards.inbox.requests).toEqual([])
  })

  it('needs someone signed in', async () => {
    const s = await server()
    expect((await s.call('POST', `/api/boards/${s.trip}/ask`, '')).status).toBe(401)
  })

  it('asks once, however many times the button is pressed', async () => {
    const s = await server()
    await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie)
    await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie)
    expect(await s.items(s.sam)).toHaveLength(1)
  })

  it('does nothing for someone who already has the board', async () => {
    const s = await server()
    await s.share(s.lee.id)
    await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie)
    expect(await s.items(s.sam)).toEqual([])
  })

  it('counts as new until it’s answered, even after looking', async () => {
    const s = await server()
    await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie)
    await s.call('POST', '/api/inbox/seen', s.sam.cookie)
    expect((await s.call('GET', '/api/inbox', s.sam.cookie)).body.unread).toBe(1)
  })
})

describe('answering a request', () => {
  const asked = async () => {
    const s = await server()
    await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie, { note: 'Please' })
    const [request] = await s.items(s.sam)
    return { ...s, request, answer: (cookie: string, answer: unknown) => s.call('POST', `/api/inbox/requests/${request.id}`, cookie, { answer }) }
  }

  it('lets them in at the level chosen, and tells them', async () => {
    const s = await asked()
    expect((await s.answer(s.sam.cookie, 'edit')).status).toBe(200)
    expect(((await s.call('GET', `/api/boards/${s.trip}`, s.lee.cookie)).body as { level: string }).level).toBe('edit')
    expect(await s.items(s.lee)).toMatchObject([{ kind: 'share', by: 'Sam', level: 'edit' }])
    expect(await s.items(s.sam)).toEqual([])
  })

  it('goes in the activity log', async () => {
    const s = await asked()
    await s.answer(s.sam.cookie, 'view')
    const actions = s.accounts.audit.query({}).entries.map((e) => e.action)
    expect(actions).toContain('board.request')
    expect(actions).toContain('board.access')
  })

  it('turning down says so, without the board’s name or who did it', async () => {
    const s = await asked()
    await s.answer(s.sam.cookie, 'no')
    const [news] = await s.items(s.lee)
    expect(news.kind).toBe('declined')
    expect(news).not.toHaveProperty('title')
    expect(news).not.toHaveProperty('by')
    expect(JSON.stringify(news)).not.toContain(s.trip)
    expect((await s.call('GET', `/api/boards/${s.trip}`, s.lee.cookie)).status).toBe(404)
  })

  it('stops someone turned down from asking again straight away', async () => {
    const s = await asked()
    await s.answer(s.sam.cookie, 'no')
    await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie)
    expect(await s.items(s.sam)).toEqual([])
  })

  it('is for those who manage the board', async () => {
    const s = await asked()
    expect((await s.answer(s.lee.cookie, 'edit')).status).toBe(404)
    expect((await s.call('GET', `/api/boards/${s.trip}`, s.lee.cookie)).status).toBe(404)
  })

  it('needs permission to share', async () => {
    const s = await asked()
    s.accounts.store.groups.find((g) => g.everyone)!.permissions = ['boards.create']
    expect((await s.answer(s.sam.cookie, 'edit')).status).toBe(403)
    expect((await s.call('GET', `/api/boards/${s.trip}`, s.lee.cookie)).status).toBe(404)
    expect(await s.items(s.sam)).toHaveLength(1)
  })

  it('refuses an answer it doesn’t know', async () => {
    const s = await asked()
    expect((await s.answer(s.sam.cookie, 'manage')).status).toBe(400)
  })

  it('can’t be answered twice', async () => {
    const s = await asked()
    await s.answer(s.sam.cookie, 'view')
    expect((await s.answer(s.sam.cookie, 'edit')).status).toBe(404)
  })
})

describe('mentions and replies in the inbox', () => {
  const withComments = async (notes: { author: string; text: string; at: number }[]) => {
    const s = await server()
    await s.share(s.lee.id)
    s.rooms.get(s.trip)!.applyOps([{ op: 'createShape', text: 'Tent' }], { manages: true, person: { name: 'Sam', user: s.sam.id } })
    const board = s.rooms.get(s.trip)!.data.board
    board.items[0].notes = notes.map((n, k) => ({ id: `n${k}`, ...n }))
    return s
  }

  it('shows a mention by the person who wrote it', async () => {
    const s = await withComments([{ author: 'Sam', text: `Over to you @[Lee](user:ID)`, at: Date.now() }])
    s.rooms.get(s.trip)!.data.board.items[0].notes![0].text = `Over to you @[Lee](user:${s.lee.id})`
    expect((await s.items(s.lee)).find((i) => i.kind === 'mention')).toMatchObject({ by: 'Sam', title: 'Trip', label: 'Tent' })
  })

  it('shows someone else’s comment after yours as a reply', async () => {
    const s = await withComments([
      { author: 'Lee', text: 'Which tent?', at: 100 },
      { author: 'Sam', text: 'The big one', at: 200 },
    ])
    expect((await s.items(s.lee)).find((i) => i.kind === 'reply')).toMatchObject({ by: 'Sam', excerpt: 'The big one', note: 'n1' })
    expect((await s.items(s.sam)).filter((i) => i.kind === 'reply')).toEqual([])
  })

  it('doesn’t count a comment before yours', async () => {
    const s = await withComments([
      { author: 'Sam', text: 'Tents?', at: 100 },
      { author: 'Lee', text: 'Yes', at: 200 },
    ])
    expect((await s.items(s.lee)).filter((i) => i.kind === 'reply')).toEqual([])
  })

  it('doesn’t show a mention twice as a reply', async () => {
    const s = await withComments([
      { author: 'Lee', text: 'Which?', at: 100 },
      { author: 'Sam', text: 'x', at: 200 },
    ])
    s.rooms.get(s.trip)!.data.board.items[0].notes![1].text = `Ask @[Lee](user:${s.lee.id})`
    const kinds = (await s.items(s.lee)).map((i) => i.kind)
    expect(kinds).toContain('mention')
    expect(kinds).not.toContain('reply')
  })

  it('stops once the board is taken away', async () => {
    const s = await withComments([
      { author: 'Lee', text: 'Which?', at: 100 },
      { author: 'Sam', text: 'That', at: 200 },
    ])
    await s.call('PUT', `/api/boards/${s.trip}/access`, s.sam.cookie, { access: [] })
    expect(await s.items(s.lee)).toEqual([])
  })

  it('counts what came after the last look as new', async () => {
    const s = await withComments([
      { author: 'Lee', text: 'Which?', at: Date.now() - 1000 },
      { author: 'Sam', text: 'That', at: Date.now() - 500 },
    ])
    expect(((await s.call('GET', '/api/inbox', s.lee.cookie)).body.unread as number) > 0).toBe(true)
    await s.call('POST', '/api/inbox/seen', s.lee.cookie)
    expect((await s.call('GET', '/api/inbox', s.lee.cookie)).body.unread).toBe(0)
  })
})

describe('telling people with the app open', () => {
  it('nudges someone given a board, carrying nothing about it', async () => {
    const s = await server()
    let told = 0
    s.boards.inbox.listen(s.lee.id, () => told++)
    await s.share(s.lee.id)
    expect(told).toBe(1)
  })

  it('nudges managers when someone asks', async () => {
    const s = await server()
    let told = 0
    s.boards.inbox.listen(s.sam.id, () => told++)
    await s.call('POST', `/api/boards/${s.trip}/ask`, s.lee.cookie)
    expect(told).toBe(1)
  })

  it('nudges for a new reply once, and not for other changes to the board', async () => {
    const s = await server()
    await s.share(s.lee.id)
    const room = s.rooms.get(s.trip)!
    room.applyOps([{ op: 'createShape', text: 'Tent' }], { manages: true, person: { name: 'Sam', user: s.sam.id } })
    let told = 0
    s.boards.inbox.listen(s.lee.id, () => told++)
    room.data.board.items[0].notes = [
      { id: 'a', author: 'Lee', text: 'Which?', at: Date.now() + 1000 },
      { id: 'b', author: 'Sam', text: 'That', at: Date.now() + 2000 },
    ]
    s.boards.index(room)
    expect(told).toBe(1)
    s.boards.index(room)
    expect(told).toBe(1)
  })

  it('stops when the connection closes', async () => {
    const s = await server()
    let told = 0
    s.boards.inbox.listen(s.lee.id, () => told++)()
    await s.share(s.lee.id)
    expect(told).toBe(0)
  })

  it('refuses a connection from another site or without a sign-in', async () => {
    const s = await server()
    expect(s.boards.inboxSocket(req('GET', { cookie: s.lee.cookie, origin: 'http://evil.example' }))).toBeNull()
    expect(s.boards.inboxSocket(req('GET', {}))).toBeNull()
    expect(s.boards.inboxSocket(req('GET', { cookie: s.lee.cookie }))?.id).toBe(s.lee.id)
  })
})

describe('the inbox file', () => {
  it('survives a restart', () => {
    const dir = tempDir()
    const a = new Inbox(dir)
    a.ask('lee', 'b1', 'Hi')
    a.tell('lee', { kind: 'declined' })
    a.markSeen('sam')
    a.flush()
    const b = new Inbox(dir)
    expect(b.requests).toMatchObject([{ board: 'b1', note: 'Hi' }])
    expect(b.newsFor('lee')).toHaveLength(1)
  })

  it('lets someone ask again a day after being turned down', () => {
    let now = 1_000
    const a = new Inbox(tempDir(), () => now)
    a.settle(a.ask('lee', 'b1').id, true)
    expect(a.mayAsk('lee', 'b1')).toBe(false)
    now += 25 * 60 * 60_000
    expect(a.mayAsk('lee', 'b1')).toBe(true)
    a.ask('lee', 'b1')
    expect(a.requests).toHaveLength(1)
  })

  it('limits how many requests one person can have waiting', () => {
    const a = new Inbox(tempDir())
    for (let k = 0; k < 20; k++) a.ask('lee', `b${k}`)
    expect(a.mayAsk('lee', 'one-more')).toBe(false)
    expect(a.mayAsk('sam', 'one-more')).toBe(true)
  })

  it('keeps notes short and on one line', () => {
    expect(cleanNote('  two\nlines  ')).toBe('two lines')
    expect(cleanNote('x'.repeat(1000))).toHaveLength(NOTE_MAX)
    expect(cleanNote(42)).toBeUndefined()
    expect(cleanNote('   ')).toBeUndefined()
  })

  it('lets a new tab in when one person has too many open', () => {
    const a = new Inbox(tempDir())
    const told: number[] = []
    for (let k = 0; k < 11; k++) a.listen('lee', () => told.push(k))
    a.nudge('lee')
    expect(told).toHaveLength(10)
    expect(told).toContain(10)
    expect(told).not.toContain(0)
  })
})
