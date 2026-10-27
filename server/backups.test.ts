import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { Room, type RoomData } from '../src/collab/room'
import { emptyBoard } from '../src/model/board'
import { emptyWiki, pageByTitle } from '../src/model/wiki'
import { fakeMeasure } from '../src/model/test-helpers'
import { AccountBoards, type RoomHost } from './accounts/boards'
import { cookieOf, req, res, tempDir } from './accounts/fakes'
import { Accounts } from './accounts/service'
import { Backups, DAY, DELETED_KEEP, HOUR, retained, type Version } from './backups'
import { versionRoute } from './backupRoutes'
import { header, splitName } from './tar'

/** A data folder with boards in memory, their files on disk, and backups beside them. */
function setup(every = HOUR) {
  const data = tempDir()
  const rooms = new Map<string, Room>()
  const open = new Set<string>()
  let clock = Date.UTC(2026, 9, 27, 12)
  const backups = new Backups({
    dir: join(data, 'backups'),
    data,
    every,
    now: () => clock,
    host: {
      ids: () => [...rooms.keys()],
      data: (id) => rooms.get(id)?.data ?? null,
      open: (id) => open.has(id),
      filesDir: (id) => join(data, 'files', id),
    },
  })
  const room = (id: string, board = emptyBoard('Trip')) => {
    const r = new Room({ id, board, version: 0, editKey: 'e'.repeat(24), viewKey: 'v'.repeat(24), nextSlot: 1, created: clock, updated: clock }, fakeMeasure)
    r.onChange = () => open.add(id)
    rooms.set(id, r)
    return r
  }
  const file = (id: string, name: string, text: string) => {
    mkdirSync(join(data, 'files', id), { recursive: true })
    writeFileSync(join(data, 'files', id, name), text)
  }
  return {
    data,
    rooms,
    backups,
    room,
    file,
    tick: (ms: number) => (clock += ms),
    get now() {
      return clock
    },
  }
}

const v = (id: string, at: number, reason: Version['reason'] = 'auto'): Version => ({ id, at, reason, title: 'x', objects: 0, updated: at, hash: id, bytes: 1, files: [] })
const note = (r: Room, text: string) => r.applyOps([{ op: 'createNote', text }])

/** The names and contents of a .tar.gz. */
function untar(gz: Buffer): Map<string, string> {
  const tar = gunzipSync(gz)
  const out = new Map<string, string>()
  for (let at = 0; at + 512 <= tar.length; ) {
    const h = tar.subarray(at, at + 512)
    if (h.every((b) => b === 0)) break
    const str = (from: number, len: number) => h.subarray(from, from + len).toString('utf8').replace(/\0.*$/s, '')
    const name = [str(345, 155), str(0, 100)].filter(Boolean).join('/')
    const size = parseInt(str(124, 12), 8)
    out.set(name, tar.subarray(at + 512, at + 512 + size).toString('utf8'))
    at += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

async function read(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = []
  for await (const c of stream) parts.push(c as Buffer)
  return Buffer.concat(parts)
}

describe('which versions are kept', () => {
  const now = Date.UTC(2026, 9, 27, 12)
  it('keeps everything from two days, then one a day, a week and a month', () => {
    const hourly = Array.from({ length: 24 * 60 }, (_, k) => v(`h${k}`, now - k * HOUR))
    const keep = retained(hourly, now)
    // Two days of hours (49 counting now), then one a day for the rest of the month.
    expect([...keep].filter((id) => Number(id.slice(1)) <= 48)).toHaveLength(49)
    // Then one for each day to a month (about 28), and one a week after that (about 5).
    expect(keep.size).toBeGreaterThan(49 + 30)
    expect(keep.size).toBeLessThan(49 + 38)
    // Within a day past the first two, only the newest stays.
    const day = hourly.filter((x) => x.at <= now - 10 * DAY && x.at > now - 11 * DAY && keep.has(x.id))
    expect(day.length).toBeLessThanOrEqual(2)
  })

  it('always keeps the newest, and ones made on purpose for a month', () => {
    expect([...retained([v('old', now - 400 * DAY)], now)]).toEqual(['old'])
    const keep = retained([v('a', now - 5 * DAY, 'manual'), v('b', now - 5 * DAY + HOUR), v('c', now - 5 * DAY + 2 * HOUR, 'before-restore'), v('new', now)], now)
    expect(keep).toEqual(new Set(['a', 'c', 'new', 'b']))
    // Past a year, nothing but the newest.
    expect(retained([v('n', now), v('y', now - 366 * DAY)], now)).toEqual(new Set(['n']))
  })
})

describe('backups of boards', () => {
  it('saves a version of a changed board at most once an hour, and not when nothing changed', async () => {
    const s = setup()
    const r = s.room('board-one')
    expect(await s.backups.pass()).toBe(1)
    expect(s.backups.versions('board-one')).toHaveLength(1)
    s.tick(10 * 60_000)
    note(r, 'Hello')
    // Changed, but the hour isn't up.
    expect(await s.backups.pass()).toBe(0)
    s.tick(HOUR)
    expect(await s.backups.pass()).toBe(1)
    const [latest] = s.backups.versions('board-one')
    expect(latest).toMatchObject({ reason: 'auto', title: 'Trip', objects: 1 })
    expect(s.backups.read('board-one', latest.id)!.board.items).toHaveLength(1)
    // An hour on with no change: nothing new.
    s.tick(2 * HOUR)
    expect(await s.backups.pass()).toBe(0)
    // Asked for, the same board isn't stored twice.
    expect(s.backups.snapshot('board-one', 'manual', { by: 'Sam', note: 'Before the trip' })!.id).toBe(latest.id)
    // Named afterwards, the same version keeps the name.
    expect(s.backups.versions('board-one')[0]).toMatchObject({ note: 'Before the trip', by: 'Sam' })
    expect(s.backups.versions('board-one')).toHaveLength(2)
  })

  it('only looks again at boards that were open since the first round', async () => {
    const s = setup()
    const r = s.room('board-one')
    await s.backups.pass()
    s.tick(2 * HOUR)
    // Changed behind its room's back (no change event): not looked at.
    r.data = { ...r.data, board: { ...r.data.board, title: 'Moved' }, updated: s.now }
    expect(await s.backups.pass()).toBe(0)
    note(r, 'Hi')
    expect(await s.backups.pass()).toBe(1)
  })

  it('copies the files a version has, and puts back the ones that went missing', () => {
    const s = setup()
    s.room('board-one')
    s.file('board-one', 'f1.bin', 'pdf bytes')
    s.file('board-one', 'f1.type', 'application/pdf')
    const first = s.backups.snapshot('board-one', 'manual')!
    expect(first.files).toEqual(['f1'])
    rmSync(join(s.data, 'files', 'board-one', 'f1.bin'))
    s.backups.restoreFiles('board-one', first)
    expect(readFileSync(join(s.data, 'files', 'board-one', 'f1.bin'), 'utf8')).toBe('pdf bytes')
  })

  it('forgets copies of files no version needs any more', async () => {
    const s = setup()
    const r = s.room('board-one')
    s.file('board-one', 'old.bin', 'x')
    s.backups.snapshot('board-one', 'auto')
    rmSync(join(s.data, 'files', 'board-one', 'old.bin'))
    s.tick(3 * DAY)
    note(r, 'Later')
    s.tick(400 * DAY)
    note(r, 'Much later')
    await s.backups.pass()
    expect(s.backups.versions('board-one')).toHaveLength(1)
    expect(existsSync(join(s.backups.dir, 'files', 'board-one', 'old.bin'))).toBe(false)
  })

  it('keeps a deleted board, with its files, to put back for 90 days', async () => {
    const s = setup()
    const r = s.room('board-one')
    note(r, 'Keep me')
    s.file('board-one', 'f1.bin', 'bytes')
    s.backups.deleting('board-one', 'Sam')
    s.rooms.delete('board-one')
    rmSync(join(s.data, 'files', 'board-one'), { recursive: true })
    expect(s.backups.deleted()).toEqual([expect.objectContaining({ id: 'board-one', title: 'Trip', by: 'Sam' })])
    expect(s.backups.versions('board-one')[0].reason).toBe('before-delete')
    const back = s.backups.undelete('board-one')!
    expect(back.data.board.items).toHaveLength(1)
    expect(back.data.editKey).toBe('e'.repeat(24))
    expect(readFileSync(join(s.data, 'files', 'board-one', 'f1.bin'), 'utf8')).toBe('bytes')
    expect(s.backups.deleted()).toEqual([])
    // Deleted again and left: gone after 90 days.
    s.room('board-two')
    s.backups.deleting('board-two')
    s.rooms.delete('board-two')
    s.tick(DELETED_KEEP + DAY)
    await s.backups.pass()
    expect(s.backups.deleted()).toEqual([])
    expect(existsSync(join(s.backups.dir, 'boards', 'board-two'))).toBe(false)
  })

  it('refuses ids and version names that could reach outside the folder', () => {
    const s = setup()
    s.room('board-one')
    const id = s.backups.snapshot('board-one', 'manual')!.id
    expect(s.backups.read('board-one', `../${id}`)).toBeNull()
    expect(s.backups.read('../../etc', id)).toBeNull()
    expect(s.backups.versions('..')).toEqual([])
  })

  it('copies people, groups and settings once a day, and downloads everything but the backups', async () => {
    const s = setup()
    mkdirSync(join(s.data, 'accounts'), { recursive: true })
    writeFileSync(join(s.data, 'accounts', 'users.json'), '[{"name":"Ann"}]')
    writeFileSync(join(s.data, 'accounts', 'users.json.tmp'), 'half')
    mkdirSync(join(s.data, 'boards'), { recursive: true })
    writeFileSync(join(s.data, 'boards', 'board-one.json'), '{"id":"board-one"}')
    s.room('board-one')
    await s.backups.pass()
    const days = readdirSync(join(s.backups.dir, 'server'))
    expect(days).toEqual(['20261027.tar.gz'])
    const day = untar(readFileSync(join(s.backups.dir, 'server', days[0])))
    expect([...day.keys()]).toEqual(['accounts/users.json'])
    expect(s.backups.insideData).toBe(true)
    const all = untar(await read(s.backups.archive()))
    expect(all.get('boards/board-one.json')).toBe('{"id":"board-one"}')
    expect(all.get('accounts/users.json')).toBe('[{"name":"Ann"}]')
    expect([...all.keys()].some((k) => k.startsWith('backups/') || k.endsWith('.tmp'))).toBe(false)
  })
})

describe('tar headers', () => {
  it('split long names at a slash, and refuse ones that can’t fit', () => {
    expect(splitName('a/b.json')).toEqual(['', 'a/b.json'])
    const long = `${'d'.repeat(120)}/${'f'.repeat(90)}`
    expect(splitName(long)).toEqual(['d'.repeat(120), 'f'.repeat(90)])
    expect(splitName('x'.repeat(300))).toBeNull()
    const h = header('a.txt', 5, 0)
    // The checksum is the sum of the header with its own field as spaces.
    const copy = Buffer.from(h)
    copy.write('        ', 148, 'ascii')
    expect(parseInt(h.subarray(148, 154).toString('ascii'), 8)).toBe(copy.reduce((n, b) => n + b, 0))
  })
})

describe('putting a board back to an earlier version', () => {
  const call = async (s: ReturnType<typeof setup>, r: Room, method: string, rest: string[], canEdit = true, manages?: boolean, body = '') => {
    const out = res()
    expect(await versionRoute(s.backups, r, method, rest, { canEdit, manages, name: 'Sam' }, async () => body, out)).toBe(true)
    return out.reply
  }

  it('lists, reads and restores versions, for everyone in the session, and can be undone', async () => {
    const s = setup()
    const r = s.room('board-one')
    note(r, 'First')
    const first = (await call(s, r, 'POST', ['versions'], true, undefined, '{"note":"Before the trip"}')).body.version as { id: string; by: string; reason: string }
    expect(first).toMatchObject({ by: 'Sam', reason: 'manual', note: 'Before the trip' })
    expect(first).not.toHaveProperty('hash')
    s.tick(HOUR)
    note(r, 'Second')
    r.applyOps([{ op: 'logTime', who: 'Sam', duration: 30 }])
    const sent: unknown[] = []
    r.join({ id: 'peer', role: 'edit', send: (m) => sent.push(m) })
    expect(((await call(s, r, 'GET', ['versions'])).body.versions as unknown[]).length).toBe(1)
    expect(((await call(s, r, 'GET', ['versions', first.id])).body.board as { items: unknown[] }).items).toHaveLength(1)
    // Viewers can look, not restore.
    expect((await call(s, r, 'POST', ['versions', first.id, 'restore'], false)).status).toBe(403)
    const done = await call(s, r, 'POST', ['versions', first.id, 'restore'])
    expect(done.status).toBe(200)
    expect(r.data.board.items).toHaveLength(1)
    // The time logged since stays: it's a record of work, not the board's content.
    expect(r.data.board.time).toHaveLength(1)
    expect(sent.some((m) => (m as { t: string }).t === 'patch')).toBe(true)
    // The board as it was before is a version too, so the restore can be undone.
    const before = (done.body.before as { id: string; reason: string })
    expect(before.reason).toBe('before-restore')
    await call(s, r, 'POST', ['versions', before.id, 'restore'])
    expect(r.data.board.items).toHaveLength(2)
    expect((await call(s, r, 'GET', ['versions', 'nope'])).status).toBe(404)
  })

  it('keeps a wiki’s page history, and leaves protected pages alone for people who don’t manage it', async () => {
    const s = setup()
    const r = s.room('wiki-one', emptyWiki('Notes'))
    r.applyOps([{ op: 'createPage', title: 'Plan', text: 'one' }])
    const first = (await call(s, r, 'POST', ['versions'])).body.version as { id: string }
    s.tick(HOUR)
    r.applyOps([{ op: 'updatePage', page: 'Plan', text: 'two' }])
    const revs = r.data.board.revs!.length
    await call(s, r, 'POST', ['versions', first.id, 'restore'])
    expect(r.data.board.revs!.length).toBeGreaterThanOrEqual(revs)
    r.applyOps([{ op: 'updatePage', page: 'Plan', text: 'three', protected: true }])
    const second = (await call(s, r, 'POST', ['versions'])).body.version as { id: string }
    expect((await call(s, r, 'POST', ['versions', first.id, 'restore'], true, false)).status).toBe(403)
    expect(pageByTitle(r.data.board, 'Plan')).toBeTruthy()
    expect(second.id).toBeTruthy()
    // A board's version can't go onto a wiki.
    const board = s.room('board-two')
    const other = (await call(s, board, 'POST', ['versions'])).body.version as { id: string }
    s.rooms.get('board-two')!.data = { ...r.data, id: 'board-two' }
    expect((await call(s, s.rooms.get('board-two')!, 'POST', ['versions', other.id, 'restore'])).status).toBe(409)
  })
})

describe('deleted boards on a server with accounts', () => {
  async function server() {
    const s = setup()
    const accounts = new Accounts({ dir: join(s.data, 'accounts') })
    let n = 0
    const host: RoomHost = {
      get: (id) => s.rooms.get(id) ?? null,
      create(board, owner) {
        const room = s.room(`board-${++n}xx`, board)
        room.data.owner = owner
        room.data.access = []
        return room
      },
      remove(id, by) {
        s.backups.deleting(id, by)
        return s.rooms.delete(id)
      },
      revive(data: RoomData) {
        const room = s.room(data.id, data.board)
        room.data = data
        return room
      },
      backups: s.backups,
      ids: () => [...s.rooms.keys()],
      peek: (id) => s.rooms.get(id)?.data ?? null,
    }
    const boards = new AccountBoards(accounts, host)
    const call = async (method: string, path: string, cookie: string, body?: unknown) => {
      const r = res()
      const url = new URL(`http://localhost:8080${path}`)
      const body$ = async () => (body === undefined ? '' : JSON.stringify(body))
      if (!(await accounts.handle(req(method, { cookie }), r, url, body$))) await boards.handle(req(method, { cookie }), r, url, body$)
      return r.reply
    }
    const ann = cookieOf(await call('POST', '/api/auth/setup', '', { email: 'ann@x.org', name: 'Ann', password: 'a long password' }))
    const person = async (email: string, name: string) => {
      const made = await call('POST', '/api/admin/users', ann, { email, name })
      return cookieOf(await call('POST', '/api/auth/reset', '', { token: String(made.body.link).split('#reset=')[1], password: `${name} long password` }))
    }
    return { ...s, call, ann, sam: await person('sam@x.org', 'Sam'), lee: await person('lee@x.org', 'Lee') }
  }

  it('can be put back by whoever managed them, or an admin, with versions to the board’s editors', async () => {
    const s = await server()
    const id = String((await s.call('POST', '/api/boards', s.sam, { board: emptyBoard('Trip') })).body.id)
    await s.call('POST', `/api/boards/${id}/ops`, s.sam, { ops: [{ op: 'createNote', text: 'Hi' }] })
    // Versions of a board Lee can't open are as hidden as the board.
    expect((await s.call('GET', `/api/boards/${id}/versions`, s.lee)).status).toBe(404)
    expect((await s.call('POST', `/api/boards/${id}/versions`, s.sam)).status).toBe(201)
    expect((await s.call('DELETE', `/api/boards/${id}`, s.sam)).status).toBe(200)
    expect((await s.call('GET', '/api/backups/deleted', s.lee)).body.boards).toEqual([])
    expect((await s.call('POST', `/api/backups/deleted/${id}/restore`, s.lee)).status).toBe(404)
    expect((await s.call('GET', '/api/backups/deleted', s.sam)).body.boards).toEqual([expect.objectContaining({ id, title: 'Trip', by: 'Sam', owner: expect.objectContaining({ name: 'Sam' }) })])
    expect((await s.call('GET', '/api/backups/deleted', s.ann)).body.boards).toHaveLength(1)
    const back = await s.call('POST', `/api/backups/deleted/${id}/restore`, s.sam)
    expect(back.body).toMatchObject({ id, title: 'Trip', level: 'manage' })
    expect(s.rooms.get(id)!.data.board.items).toHaveLength(1)
    expect(((await s.call('GET', '/api/boards', s.sam)).body.boards as { id: string }[]).map((b) => b.id)).toEqual([id])
    expect((await s.call('GET', '/api/backups/deleted', s.ann)).body.boards).toEqual([])
    const log = (await s.call('GET', '/api/admin/audit?kind=boards', s.ann)).body.entries as { action: string }[]
    expect(log.map((e) => e.action)).toContain('board.undelete')
  })
})
