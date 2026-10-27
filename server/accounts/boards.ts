/**
 * Boards on a server with accounts: each has an owner and an access list, and the share keys no
 * longer open anything.
 *
 *   GET    /api/boards                  the boards you can reach (admins: all, unowned ones flagged)
 *   POST   /api/boards {board?}         a new board, yours ("Make boards")
 *   GET    /api/boards/:id              the board (at least view)
 *   GET    /api/boards/:id/objects…     reads: objects, search, Mermaid, wiki pages (see boardReads.ts)
 *   POST   /api/boards/:id/ops {ops}    change it with operations (edit)
 *   GET    /api/boards/:id/access       who has access
 *   GET    /api/boards/:id/people       the people who can open it, to @mention
 *   GET    /api/mentions                where you're @mentioned, across the boards you can open
 *   PUT    /api/boards/:id/access       change who has access, or the owner (manage)
 *   DELETE /api/boards/:id              delete it (manage); it can be put back for 90 days
 *   GET    /api/boards/:id/versions…    its saved versions, and putting one back (see backupRoutes.ts)
 *   GET    /api/backups/deleted         deleted boards you could put back (ones you managed; admins: all)
 *   POST   /api/backups/deleted/:id/restore   put one back
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { OpError, opsFromText } from '../../src/api/ops'
import type { Role } from '../../src/collab/protocol'
import type { Room, RoomData } from '../../src/collab/room'
import { maskFor } from '../../src/model/brainstorm'
import { hours, summarize, timeCsv, type TimeFilter } from '../../src/model/timeTracking'
import { mentionsOf, objectLabel, parseNote } from '../../src/model/notes'
import { fromJson } from '../../src/model/serialize'
import type { Board } from '../../src/model/types'
import type { Backups } from '../backups'
import { versionRoute } from '../backupRoutes'
import { readBoard, sendRead } from '../boardReads'
import { boardWrite } from '../boardWrites'
import { atLeast, levelFor, roleOf } from './access'
import type { Accounts } from './service'
import { type BoardEntry, cleanGrants } from './store'
import type { Grant, Level, User } from './types'

const LEVEL_WORDS: Record<Level, string> = { view: 'can view', edit: 'can edit', manage: 'can manage' }
/** An admin opening the same board again within this long isn't noted again. */
const PEEK_QUIET_MS = 60 * 60_000

/** What the server gives this: its rooms, however it keeps them. */
export interface RoomHost {
  get(id: string): Room | null
  create(board: Board, owner: string): Room
  /** Deletes a board (`by`: who, noted with its last backup). */
  remove(id: string, by?: string): boolean
  /** Saved versions, and deleted boards that can be put back. */
  backups?: Backups
  /** A deleted board, back as it was stored. */
  revive?(data: RoomData): Room
  /** Every board id on disk, and a board's stored data without opening its room (for the index). */
  ids(): string[]
  peek(id: string): RoomData | null
  /** A board's room when it's open already (its latest words), without opening it. */
  loaded?(id: string): Room | null
  /** Handles /api/boards/:id/files/… (`rest` follows "files"); false when it isn't a file route. */
  files?(room: Room, req: IncomingMessage, res: ServerResponse, rest: string[], canEdit: boolean): Promise<boolean>
}

/** Mentions listed at most. */
const MENTIONS_SHOWN = 100

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export class AccountBoards {
  private accounts: Accounts
  private host: RoomHost
  private indexTimer: NodeJS.Timeout | undefined
  /** Origins allowed to open live sessions besides the server's own (BRAINCRAFT_ALLOWED_ORIGINS). */
  private origins: string[]
  /** When each admin last opened each board they could only open as an admin. */
  private peeks = new Map<string, number>()
  /** Who each board mentions, as of its last change, so listing mentions reads only boards that have yours. */
  private mentioned = new Map<string, { updated: number; ids: Set<string> }>()

  constructor(accounts: Accounts, host: RoomHost, origins: string[] = []) {
    this.accounts = accounts
    this.host = host
    this.origins = origins.map((o) => o.replace(/\/+$/, ''))
    // Boards made before this index (or before accounts) are added to it once.
    const known = accounts.store.boards
    let added = false
    for (const id of host.ids()) {
      if (known[id]) continue
      const d = host.peek(id)
      if (d) {
        known[id] = entryOf(d)
        added = true
      }
    }
    if (added) accounts.store.saveBoards()
  }

  private get store() {
    return this.accounts.store
  }

  /** Keeps the index in step with a room (its title, owner and access), written a moment later. */
  index(room: Room) {
    this.store.boards[room.data.id] = entryOf(room.data)
    this.mentioned.delete(room.data.id)
    clearTimeout(this.indexTimer)
    this.indexTimer = setTimeout(() => this.store.saveBoards(), 1500)
    this.indexTimer.unref?.()
  }

  level(user: User | null, access: { owner?: string; access?: RoomData['access'] }): Level | null {
    // An owner who's been removed leaves the board to admins.
    const owner = access.owner && this.store.user(access.owner) ? access.owner : undefined
    return levelFor(user, this.store.groups, { owner, access: access.access })
  }

  /**
   * Notes an admin opening a board that isn't shared with them (being an admin is what let them in),
   * once an hour per board.
   */
  private peek(req: IncomingMessage, user: User, data: RoomData, how: string) {
    if (user.role !== 'admin' || this.level({ ...user, role: 'user' }, data)) return
    const key = `${user.id} ${data.id}`
    const now = Date.now()
    if (now - (this.peeks.get(key) ?? 0) < PEEK_QUIET_MS) return
    if (this.peeks.size > 10_000) this.peeks.clear()
    this.peeks.set(key, now)
    this.accounts.log(req, user, { action: 'board.open-as-admin', target: boardTarget(data), text: `${user.name} ${how} “${data.board.title}”, which isn’t shared with them (as an admin)` })
  }

  private grantName = (g: Grant) =>
    g.who === 'user' ? (this.store.user(g.id)?.name ?? 'someone since removed') : (this.store.groups.find((x) => x.id === g.id)?.name ?? 'a group since removed')

  /** "Planners can edit (was can view); removed Sam", or nothing when it's the same. */
  private accessChanges(before: Grant[], after: Grant[]): string[] {
    const same = (a: Grant, b: Grant) => a.who === b.who && a.id === b.id
    const out: string[] = []
    for (const g of after) {
      const was = before.find((x) => same(x, g))
      if (!was) out.push(`${this.grantName(g)} ${LEVEL_WORDS[g.level]}`)
      else if (was.level !== g.level) out.push(`${this.grantName(g)} ${LEVEL_WORDS[g.level]} (was ${LEVEL_WORDS[was.level]})`)
    }
    for (const g of before) if (!after.some((x) => same(x, g))) out.push(`removed ${this.grantName(g)}`)
    return out
  }

  private accessWords = (grants: Grant[]) => grants.map((g) => `${this.grantName(g)} ${LEVEL_WORDS[g.level]}`).join(', ') || 'nobody else'

  /** The role a live connection gets, and who it is; null to refuse (wrong origin, no access). */
  socket(req: IncomingMessage, room: Room): { role: Role; user: User; level: Level } | null {
    const origin = req.headers.origin
    if (origin && origin.replace(/\/+$/, '') !== this.accounts.origin(req) && !this.origins.includes(origin)) return null
    const user = this.accounts.userOf(req)
    const level = this.level(user, room.data)
    const role = roleOf(level)
    if (!user || !role || !level) return null
    this.peek(req, user, room.data, 'joined the live session of')
    return { role, user, level }
  }

  /** Handles a board route; false when it isn't one. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, body: () => Promise<string>): Promise<boolean> {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[1] !== 'boards' && parts[1] !== 'mentions' && parts[1] !== 'time' && parts[1] !== 'backups') return false
    if (!this.accounts.fromApp(req)) return json(res, 403, { error: 'Missing the X-BrainCraft header' }), true
    const me = this.accounts.userOf(req)
    if (!me) return json(res, 401, { error: 'Sign in first' }), true
    const m = req.method ?? 'GET'

    if (parts[1] === 'backups') return this.deletedRoute(req, res, me, m, parts.slice(2)), true

    if (parts[1] === 'mentions') {
      if (m !== 'GET' || parts.length !== 2) return json(res, 405, { error: 'Method not allowed' }), true
      return json(res, 200, { mentions: this.mentions(me) }), true
    }

    // GET /api/time?from=&to=&who=&format=csv → time across every board you can open.
    if (parts[1] === 'time') {
      if (m !== 'GET' || parts.length !== 2) return json(res, 405, { error: 'Method not allowed' }), true
      const q = url.searchParams
      const at = (k: string) => {
        const v = q.get(k)
        return v ? Date.parse(v) : undefined
      }
      for (const k of ['from', 'to']) if (q.get(k) && !Number.isFinite(at(k))) return json(res, 400, { error: `"${k}" should be a date, like 2026-10-27` }), true
      // Your own time; admins can ask for anyone's (a name), or everyone's ("all").
      const who = q.get('who')?.trim()
      if (who && who !== 'me' && me.role !== 'admin') return json(res, 403, { error: 'Only admins can see other people’s time across boards' }), true
      const person = !who || who === 'me' ? { name: me.name, user: me.id } : who === 'all' ? undefined : { name: who }
      const report = this.timeAcross(me, { from: at('from'), to: at('to'), ...(person ? { who: person } : {}) })
      if (q.get('format') === 'csv') {
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="time.csv"', 'cache-control': 'no-store' })
        return res.end(report.csv), true
      }
      return json(res, 200, { hours: report.hours, boards: report.boards }), true
    }

    if (parts.length === 2 && m === 'GET') {
      const boards = Object.entries(this.store.boards).flatMap(([id, e]) => {
        const level = this.level(me, e)
        if (!level) return []
        const owner = e.owner ? this.store.user(e.owner) : undefined
        return [{ id, title: e.title, ...(e.kind ? { kind: e.kind } : {}), updated: e.updated, level, owner: owner ? { id: owner.id, name: owner.name } : null }]
      })
      return json(res, 200, { boards: boards.sort((a, b) => b.updated - a.updated) }), true
    }

    if (parts.length === 2 && m === 'POST') {
      if (!this.accounts.can(me, 'boards.create')) return json(res, 403, { error: 'You can’t make boards on this server. Ask an admin.' }), true
      let board = fromJson(JSON.stringify({ version: 1, title: 'Untitled board', items: [], connectors: [], nextId: 1 }))
      const raw = await body()
      if (raw.trim()) {
        try {
          const b = JSON.parse(raw) as { board?: unknown }
          if (b.board) board = fromJson(JSON.stringify(b.board))
        } catch (err) {
          return json(res, 400, { error: `Not a BrainCraft board: ${(err as Error).message}` }), true
        }
      }
      const room = this.host.create(board, me.id)
      this.index(room)
      return json(res, 201, { id: room.data.id, level: 'manage' }), true
    }

    const room = parts[2] ? this.host.get(parts[2]) : null
    // No difference between a board that doesn't exist and one you can't see.
    const level = room ? this.level(me, room.data) : null
    if (!room || !level) return json(res, 404, { error: 'No such board, or you don’t have access to it' }), true

    // Everyone who can open it, to mention: anyone on it sees their names anyway, but only people
    // who may see the directory see emails.
    if (parts[3] === 'people' && parts.length === 4 && m === 'GET') {
      const emails = this.accounts.can(me, 'people.see')
      const people = this.store.users
        .filter((u) => !u.disabled && this.level(u, room.data))
        .sort((a, z) => a.name.localeCompare(z.name))
        .slice(0, 500)
        .map((u) => ({ id: u.id, name: u.name, ...(emails ? { email: u.email } : {}) }))
      return json(res, 200, { people }), true
    }

    // Its saved versions, and putting one back.
    if (!this.host.backups && parts[3] === 'versions') return json(res, 404, { error: 'Backups are off on this server' }), true
    if (this.host.backups && parts[3] === 'versions') {
      const restored = (v: { at: number }) =>
        this.accounts.log(req, me, {
          action: 'board.restore',
          target: boardTarget(room.data),
          text: `${me.name} put “${room.data.board.title}” back to how it was on ${new Date(v.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        })
      if (m === 'GET') this.peek(req, me, room.data, 'looked at the versions of')
      if (await versionRoute(this.host.backups, room, m, parts.slice(3), { canEdit: atLeast(level, 'edit'), manages: level === 'manage', name: me.name, restored }, body, res)) return true
    }

    // Files kept with the board.
    if (parts[3] === 'files' && this.host.files && (await this.host.files(room, req, res, parts.slice(4), atLeast(level, 'edit')))) {
      if (req.method === 'GET') this.peek(req, me, room.data, 'opened a file of')
      return true
    }

    // Exports, and writing wiki pages one by one.
    if (parts.length > 3 && (await boardWrite(room, m, parts.slice(3), url.searchParams, body, { canEdit: atLeast(level, 'edit'), manages: level === 'manage' }, res))) {
      if (m === 'GET') this.peek(req, me, room.data, 'exported')
      return true
    }

    if (parts.length > 3 && m === 'GET') {
      const read = readBoard(room.data.board, parts.slice(3), url.searchParams)
      if (read) {
        this.peek(req, me, room.data, 'read')
        return sendRead(res, read), true
      }
    }

    if (parts.length === 3 && m === 'GET') {
      this.peek(req, me, room.data, 'read')
      return json(res, 200, { id: room.data.id, role: roleOf(level), level, version: room.data.version, board: room.data.board, people: room.members.size }), true
    }

    if (parts[3] === 'ops' && m === 'POST') {
      if (!atLeast(level, 'edit')) return json(res, 403, { error: 'You can only view this board' }), true
      this.peek(req, me, room.data, 'changed')
      const ops = opsFromText(await body())
      if (!ops) return json(res, 400, { error: 'Send {"ops": [...]} (see docs/API.md)' }), true
      try {
        const results = room.applyOps(ops, { manages: level === 'manage', person: { name: me.name, user: me.id } })
        this.index(room)
        return json(res, 200, { version: room.data.version, results }), true
      } catch (err) {
        return json(res, err instanceof OpError ? (/manage this wiki/.test(err.message) ? 403 : 422) : 500, { error: (err as Error).message }), true
      }
    }

    if (parts[3] === 'access') {
      if (m === 'GET') return json(res, 200, this.describe(room, level)), true
      if (m === 'PUT') {
        if (level !== 'manage') return json(res, 403, { error: 'Only people who manage this board can change who has it' }), true
        let b: { owner?: unknown; access?: unknown }
        try {
          b = JSON.parse((await body()) || '{}') as typeof b
        } catch {
          return json(res, 400, { error: 'Send {"access": [...]} ' }), true
        }
        if (b.access !== undefined) {
          const grants = cleanGrants(b.access, this.store)
          if (!grants) return json(res, 400, { error: 'Each entry needs who ("user" or "group"), an id that exists, and a level (view, edit or manage)' }), true
          const before = room.data.access ?? []
          const widened = grants.some((g) => !before.some((x) => x.who === g.who && x.id === g.id && atLeast(x.level, g.level)))
          if (widened && !this.accounts.can(me, 'boards.share')) return json(res, 403, { error: 'You can’t give others access to boards. Ask an admin.' }), true
          room.data.access = grants
          const changed = this.accessChanges(before, grants)
          if (changed.length)
            this.accounts.log(req, me, {
              action: 'board.access',
              target: boardTarget(room.data),
              changes: { access: [this.accessWords(before), this.accessWords(grants)] },
              text: `${me.name} changed who has “${room.data.board.title}”: ${changed.join('; ')}`,
            })
        }
        if (b.owner !== undefined) {
          if (typeof b.owner !== 'string' || !this.store.user(b.owner)) return json(res, 400, { error: 'The new owner must be someone on this server' }), true
          if (me.role !== 'admin' && room.data.owner !== me.id) return json(res, 403, { error: 'Only the owner (or an admin) can hand a board over' }), true
          const was = room.data.owner ? this.store.user(room.data.owner) : undefined
          const to = this.store.user(b.owner)!
          if (b.owner !== room.data.owner)
            this.accounts.log(req, me, {
              action: 'board.owner',
              target: boardTarget(room.data),
              changes: { owner: [was?.name ?? 'nobody', to.name] },
              text: `${me.name} handed “${room.data.board.title}” to ${to.name} (it was ${was ? `${was.name}’s` : 'nobody’s'})`,
            })
          room.data.owner = b.owner
        }
        room.onChange?.(false)
        this.index(room)
        return json(res, 200, this.describe(room, this.level(me, room.data))), true
      }
    }

    if (parts.length === 3 && m === 'DELETE') {
      if (level !== 'manage') return json(res, 403, { error: 'Only people who manage this board can delete it' }), true
      const owner = room.data.owner ? this.store.user(room.data.owner) : undefined
      this.accounts.log(req, me, { action: 'board.delete', target: boardTarget(room.data), text: `${me.name} deleted “${room.data.board.title}”${owner && owner.id !== me.id ? ` (${owner.name}’s board)` : ''} from the server` })
      this.host.remove(room.data.id, me.name)
      delete this.store.boards[room.data.id]
      this.store.saveBoards()
      return json(res, 200, { ok: true }), true
    }
    return json(res, 405, { error: 'Method not allowed' }), true
  }

  /**
   * GET deleted → deleted boards `me` could put back: ones they managed (admins: all).
   * POST deleted/:id/restore → puts one back, with its owner, access and files.
   */
  private deletedRoute(req: IncomingMessage, res: ServerResponse, me: User, m: string, rest: string[]) {
    const backups = this.host.backups
    if (!backups || rest[0] !== 'deleted') return json(res, 404, { error: 'Not found' })
    const mine = backups.deleted().filter((d) => me.role === 'admin' || this.level(me, d) === 'manage')
    if (rest.length === 1) {
      if (m !== 'GET') return json(res, 405, { error: 'Method not allowed' })
      return json(res, 200, {
        boards: mine.map((d) => {
          const owner = d.owner ? this.store.user(d.owner) : undefined
          return { id: d.id, title: d.title, ...(d.kind ? { kind: d.kind } : {}), deleted: d.at, ...(d.by ? { by: d.by } : {}), owner: owner ? { id: owner.id, name: owner.name } : null }
        }),
      })
    }
    if (rest.length !== 3 || rest[2] !== 'restore') return json(res, 404, { error: 'Not found' })
    if (m !== 'POST') return json(res, 405, { error: 'Method not allowed' })
    if (!mine.some((d) => d.id === rest[1])) return json(res, 404, { error: 'No such deleted board, or it isn’t yours to put back' })
    if (this.host.get(rest[1])) return json(res, 409, { error: 'A board with that id is already here' })
    const back = backups.undelete(rest[1])
    if (!back || !this.host.revive) return json(res, 422, { error: 'That board’s backup can’t be read' })
    const room = this.host.revive(back.data)
    this.index(room)
    this.accounts.log(req, me, { action: 'board.undelete', target: boardTarget(room.data), text: `${me.name} put back “${room.data.board.title}”, which had been deleted` })
    return json(res, 200, { id: room.data.id, title: room.data.board.title, ...(room.data.board.kind === 'wiki' ? { kind: 'wiki' } : {}), level: this.level(me, room.data) })
  }

  /** Where `me` is mentioned on the boards they can open, newest first. */
  /** Time on every board this person can open (as they'd see it: hidden notes stay hidden). */
  private timeAcross(me: User, f: TimeFilter) {
    const now = Date.now()
    const boards: { board: string; title: string; hours: number; byPerson: { who: string; hours: number }[] }[] = []
    const rows: string[] = []
    let total = 0
    for (const [id, e] of Object.entries(this.store.boards)) {
      if (!this.level(me, e)) continue
      const data = this.host.loaded?.(id)?.data ?? this.host.peek(id)
      if (!data?.board.time?.length) continue
      const board = maskFor(data.board, me.name)
      const s = summarize(board, f, now)
      if (!s.entries.length) continue
      total += s.total
      boards.push({ board: id, title: board.title, hours: hours(s.total), byPerson: s.byPerson.map((p) => ({ who: p.who, hours: hours(p.ms) })) })
      // The same rows as a board's CSV, with the board first.
      const lines = timeCsv(board, s).trimEnd().split('\n').slice(1)
      // A title a spreadsheet would run as a formula is kept as text.
      const t = /^[=+\-@]/.test(board.title) ? `'${board.title}` : board.title
      const title = /[",\n']/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
      for (const l of lines) rows.push(`${title},${l}`)
    }
    return {
      hours: hours(total),
      boards: boards.sort((a, z) => z.hours - a.hours),
      csv: ['Board,Person,On,Kind,Start,End,Hours,Note,Logged by', ...rows].join('\n') + '\n',
    }
  }

  private mentions(me: User) {
    const out: { board: string; title: string; kind?: 'wiki'; at?: number; by?: string; excerpt: string; item?: number; label?: string; note?: string; page?: string; pageTitle?: string }[] = []
    for (const [id, e] of Object.entries(this.store.boards)) {
      if (!this.level(me, e)) continue
      let seen = this.mentioned.get(id)
      // Ids of accounts, and (lower case) names of mentions by name alone.
      const mine = (x: { ids: Set<string> }) => x.ids.has(me.id) || x.ids.has(nameKey(me.name))
      if (seen && seen.updated === e.updated && !mine(seen)) continue
      const data = this.host.loaded?.(id)?.data ?? this.host.peek(id)
      if (!data) continue
      if (!seen || seen.updated !== e.updated) {
        seen = { updated: e.updated, ids: whoIsMentioned(data.board) }
        this.mentioned.set(id, seen)
        if (!mine(seen)) continue
      }
      // A hidden brainstorm note's comments stay hidden here too.
      for (const r of mentionsOf(maskFor(data.board, me.name), { id: me.id, name: me.name })) {
        out.push({
          board: id,
          title: data.board.title,
          ...(data.board.kind === 'wiki' ? { kind: 'wiki' as const } : {}),
          ...(r.at !== undefined ? { at: r.at } : {}),
          ...(r.by ? { by: r.by } : {}),
          excerpt: r.excerpt,
          ...(r.item ? { item: r.item.id, label: objectLabel(r.item) } : {}),
          ...(r.note ? { note: r.note.id } : {}),
          ...(r.page ? { page: r.page.id, pageTitle: r.page.title } : {}),
        })
      }
    }
    return out.sort((a, z) => (z.at ?? 0) - (a.at ?? 0)).slice(0, MENTIONS_SHOWN)
  }

  /** Who has a board, with names, for the Access dialog. */
  private describe(room: Room, level: Level | null) {
    const s = this.store
    const owner = room.data.owner ? s.user(room.data.owner) : undefined
    return {
      level,
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
      access: (room.data.access ?? []).flatMap((g) => {
        if (g.who === 'user') {
          const u = s.user(g.id)
          return u ? [{ ...g, name: u.name, email: u.email }] : []
        }
        const gr = s.groups.find((x) => x.id === g.id)
        return gr ? [{ ...g, name: gr.name }] : []
      }),
    }
  }
}

const nameKey = (name: string) => `name:${name.replace(/\s+/g, ' ').trim().toLowerCase()}`

/** Who a board mentions anywhere (comments, descriptions, pages): account ids, and names (see nameKey) of the rest. */
function whoIsMentioned(b: Board): Set<string> {
  const ids = new Set<string>()
  const scan = (text: string) => {
    if (!text.includes('](user:')) return
    for (const p of parseNote(text)) if ('person' in p) ids.add(p.person || nameKey(p.label))
  }
  for (const i of b.items) {
    if (i.description) scan(i.description)
    for (const n of i.notes ?? []) scan(n.text)
  }
  for (const body of b.bodies ?? []) scan(body.text)
  return ids
}

const boardTarget = (d: RoomData) => ({ kind: 'board' as const, id: d.id, name: d.board.title })

const entryOf = (d: RoomData): BoardEntry => ({
  title: d.board.title,
  ...(d.board.kind === 'wiki' ? { kind: 'wiki' as const } : {}),
  updated: d.updated,
  ...(d.owner ? { owner: d.owner } : {}),
  ...(d.access?.length ? { access: d.access } : {}),
})
