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
 *   GET    /api/inbox                   what needs you: shares, mentions, replies, requests for access
 *   POST   /api/inbox/seen              you've looked
 *   POST   /api/inbox/requests/:id {answer}   answer a request: "view", "edit" or "no" (manage)
 *   POST   /api/boards/:id/ask {note?}  ask for a board you can't open (the same reply whether it exists or not)
 *   PUT    /api/boards/:id/category {category}   your category for it (null for none)
 *   POST   /api/categories/rename {from, to}     rename one of your categories (to null: empty it)
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
import { mentionsOf, objectLabel, parseNote, repliesTo } from '../../src/model/notes'
import { fromJson } from '../../src/model/serialize'
import type { Board } from '../../src/model/types'
import type { Backups } from '../backups'
import { versionRoute } from '../backupRoutes'
import { readBoard, sendRead } from '../boardReads'
import { boardWrite } from '../boardWrites'
import { atLeast, levelFor, roleOf } from './access'
import { Inbox, cleanNote } from './inbox'
import { Categories, cleanCategory } from './categories'
import type { Accounts } from './service'
import { type BoardEntry, cleanGrants } from './store'
import { type Grant, LEVELS, type Level, type User } from './types'

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

/** Closing a live connection: access to the board was taken away, or changed (reconnect to get it). */
export const CLOSE_REMOVED = 4403
export const CLOSE_CHANGED = 4409

/** Mentions listed at most, and entries in an inbox. */
const MENTIONS_SHOWN = 100

/** A mention of you, or a comment after yours. */
interface PersonNews {
  kind: 'mention' | 'reply'
  board: string
  title: string
  boardKind?: 'wiki'
  at?: number
  by?: string
  excerpt: string
  item?: number
  label?: string
  note?: string
  page?: string
  pageTitle?: string
}

/** How many boards' worth of "already told" are remembered before starting again. */
const TOLD_KEPT = 10_000

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
  /** Who each board mentions or has comments by, as of its last change, so listing them reads only boards that have yours. */
  private mentioned = new Map<string, { updated: number; ids: Set<string> }>()
  /** What needs each person. */
  inbox: Inbox
  /** Each person's categories for their boards. */
  categories: Categories
  /** The newest thing each online person has been told about on each board. */
  private told = new Map<string, number>()

  constructor(accounts: Accounts, host: RoomHost, origins: string[] = []) {
    this.accounts = accounts
    this.host = host
    this.origins = origins.map((o) => o.replace(/\/+$/, ''))
    this.inbox = new Inbox(accounts.dir, accounts.now)
    this.categories = new Categories(accounts.dir)
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
    this.tellOnline(room)
  }

  /** Someone with the app open who has something new on this board hears about it now. */
  private tellOnline(room: Room) {
    const online = this.inbox.online()
    if (!online.length) return
    const ids = whoIsMentioned(room.data.board)
    for (const [id, since] of online) {
      const user = this.store.user(id)
      if (!user || !ids.size || !concerns(ids, user) || !this.level(user, room.data)) continue
      const newest = Math.max(0, ...this.newsOn(room.data.board, user).map((n) => n.at ?? 0))
      const key = `${id} ${room.data.id}`
      if (newest <= (this.told.get(key) ?? since)) continue
      if (this.told.size > TOLD_KEPT) this.told.clear()
      this.told.set(key, newest)
      this.inbox.nudge(id)
    }
  }

  /** Mentions of `me` and replies to them on a board, as they'd see it. */
  private newsOn(board: Board, me: User) {
    // A hidden brainstorm note's comments stay hidden here too.
    const seen = maskFor(board, me.name)
    const who = { id: me.id, name: me.name }
    return [...mentionsOf(seen, who).map((r) => ({ ...r, kind: 'mention' as const })), ...repliesTo(seen, who).map((r) => ({ ...r, kind: 'reply' as const }))].filter((r) => r.by !== me.name)
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

  private ownOrigin(req: IncomingMessage) {
    const origin = req.headers.origin
    return !origin || origin.replace(/\/+$/, '') === this.accounts.origin(req) || this.origins.includes(origin)
  }

  /** Who an inbox connection is for; null to refuse (wrong origin, not signed in). */
  inboxSocket(req: IncomingMessage): User | null {
    return this.ownOrigin(req) ? this.accounts.userOf(req) : null
  }

  /** The role a live connection gets, and who it is; null to refuse (wrong origin, no access). */
  socket(req: IncomingMessage, room: Room): { role: Role; user: User; level: Level } | null {
    if (!this.ownOrigin(req)) return null
    const user = this.accounts.userOf(req)
    const level = this.level(user, room.data)
    const role = roleOf(level)
    if (!user || !role || !level) return null
    this.peek(req, user, room.data, 'joined the live session of')
    return { role, user, level }
  }

  /**
   * Everyone connected to `room` keeps only the access they still have, after a change to its access
   * list or owner, or to people and groups: someone who lost it is disconnected, and someone whose
   * level changed is reconnected with the new one.
   */
  recheck(room: Room) {
    for (const m of [...room.members.values()]) {
      if (!m.user || !m.close) continue
      const user = this.store.user(m.user.id) ?? null
      const level = this.level(user, room.data)
      const role = roleOf(level)
      if (!role) m.close(CLOSE_REMOVED, 'Access removed')
      else if (role !== m.role || (level === 'manage') !== !!m.manages) m.close(CLOSE_CHANGED, 'Access changed')
    }
  }

  /** The same for every board open on the server. */
  recheckAll() {
    for (const id of this.host.ids()) {
      const room = this.host.loaded?.(id)
      if (room?.members.size) this.recheck(room)
    }
  }

  /** Handles a board route; false when it isn't one. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, body: () => Promise<string>): Promise<boolean> {
    const parts = url.pathname.split('/').filter(Boolean)
    if (!['boards', 'mentions', 'inbox', 'categories', 'time', 'backups'].includes(parts[1])) return false
    if (!this.accounts.fromApp(req)) return json(res, 403, { error: 'Missing the X-BrainCraft header' }), true
    const me = this.accounts.userOf(req)
    if (!me) return json(res, 401, { error: 'Sign in first' }), true
    const m = req.method ?? 'GET'

    if (parts[1] === 'backups') return this.deletedRoute(req, res, me, m, parts.slice(2)), true

    if (parts[1] === 'mentions') {
      if (m !== 'GET' || parts.length !== 2) return json(res, 405, { error: 'Method not allowed' }), true
      return json(res, 200, { mentions: this.peopleNews(me).filter((n) => n.kind === 'mention').map(({ kind: _kind, boardKind, ...n }) => ({ ...n, ...(boardKind ? { kind: boardKind } : {}) })) }), true
    }

    if (parts[1] === 'inbox') return this.inboxRoute(req, res, me, m, parts.slice(2), body), true

    if (parts[1] === 'categories') {
      if (parts[2] !== 'rename' || parts.length !== 3) return json(res, 404, { error: 'Not found' }), true
      if (m !== 'POST') return json(res, 405, { error: 'Method not allowed' }), true
      let b: { from?: unknown; to?: unknown }
      try {
        b = JSON.parse((await body()) || '{}') as typeof b
      } catch {
        return json(res, 400, { error: 'Send {"from": "…", "to": "…"}' }), true
      }
      const from = cleanCategory(b.from)
      const to = cleanCategory(b.to)
      if (!from || to === undefined) return json(res, 400, { error: 'Send {"from": "…", "to": "…"} (to null to empty it)' }), true
      this.categories.rename(me.id, from, to)
      return json(res, 200, { ok: true }), true
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
      const mine = this.categories.of(me.id)
      const boards = Object.entries(this.store.boards).flatMap(([id, e]) => {
        const level = this.level(me, e)
        if (!level) return []
        const owner = e.owner ? this.store.user(e.owner) : undefined
        const category = mine[id]
        return [{ id, title: e.title, ...(e.kind ? { kind: e.kind } : {}), ...(e.parent ? { parent: e.parent } : {}), ...(category ? { category } : {}), updated: e.updated, level, owner: owner ? { id: owner.id, name: owner.name } : null }]
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

    // Before anything says whether the board exists: asking for one that doesn't looks the same.
    if (parts[3] === 'ask' && parts.length === 4) {
      if (m !== 'POST') return json(res, 405, { error: 'Method not allowed' }), true
      return this.ask(req, me, parts[2], await body()), json(res, 200, { ok: true }), true
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

    // Anyone who can open a board may file it away for themselves.
    if (parts[3] === 'category' && parts.length === 4) {
      if (m !== 'PUT') return json(res, 405, { error: 'Method not allowed' }), true
      let category: string | null | undefined
      try {
        category = cleanCategory((JSON.parse((await body()) || '{}') as { category?: unknown }).category ?? null)
      } catch {
        return json(res, 400, { error: 'Send {"category": "…"} (null for none)' }), true
      }
      if (category === undefined) return json(res, 400, { error: 'Send {"category": "…"} (null for none)' }), true
      if (!this.categories.set(me.id, room.data.id, category)) return json(res, 422, { error: 'That’s as many boards in categories as one person can have' }), true
      return json(res, 200, { category }), true
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
          if (!this.grant(req, me, room, grants)) return json(res, 403, { error: 'You can’t give others access to boards. Ask an admin.' }), true
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
          const before = { owner: room.data.owner, access: room.data.access }
          room.data.owner = b.owner
          this.tellNewAccess(me, room, before)
        }
        room.onChange?.(false)
        this.index(room)
        this.recheck(room)
        return json(res, 200, this.describe(room, this.level(me, room.data))), true
      }
    }

    if (parts.length === 3 && m === 'DELETE') {
      if (level !== 'manage') return json(res, 403, { error: 'Only people who manage this board can delete it' }), true
      const owner = room.data.owner ? this.store.user(room.data.owner) : undefined
      this.accounts.log(req, me, { action: 'board.delete', target: boardTarget(room.data), text: `${me.name} deleted “${room.data.board.title}”${owner && owner.id !== me.id ? ` (${owner.name}’s board)` : ''} from the server` })
      this.host.remove(room.data.id, me.name)
      this.categories.forget(room.data.id)
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

  /**
   * Gives a board these grants, in the activity log and everyone's inbox; false when that would give
   * access `me` may not give.
   */
  private grant(req: IncomingMessage, me: User, room: Room, grants: Grant[]) {
    const before = room.data.access ?? []
    const widened = grants.some((g) => !before.some((x) => x.who === g.who && x.id === g.id && atLeast(x.level, g.level)))
    if (widened && !this.accounts.can(me, 'boards.share')) return false
    const had = { owner: room.data.owner, access: before }
    room.data.access = grants
    const changed = this.accessChanges(before, grants)
    if (changed.length)
      this.accounts.log(req, me, {
        action: 'board.access',
        target: boardTarget(room.data),
        changes: { access: [this.accessWords(before), this.accessWords(grants)] },
        text: `${me.name} changed who has “${room.data.board.title}”: ${changed.join('; ')}`,
      })
    this.tellNewAccess(me, room, had)
    return true
  }

  /** Everyone who can do more with a board than they could (`had`) hears who gave it to them. */
  private tellNewAccess(me: User, room: Room, had: { owner?: string; access?: RoomData['access'] }) {
    const rank = (l: Level | null) => (l ? LEVELS.indexOf(l) : -1)
    for (const u of this.store.users) {
      if (u.id === me.id || u.disabled) continue
      // As themselves, not as admins: being able to open everything isn't having been given this.
      const plain: User = { ...u, role: 'user' }
      const level = this.level(plain, room.data)
      if (level && rank(level) > rank(this.level(plain, had))) this.inbox.tell(u.id, { kind: 'share', board: room.data.id, by: me.name, level })
    }
  }

  /** Who answers requests for a board: those who manage it, or admins when nobody does. */
  private managers(data: { owner?: string; access?: RoomData['access'] }) {
    const live = this.store.users.filter((u) => !u.disabled)
    const those = live.filter((u) => this.level({ ...u, role: 'user' }, data) === 'manage')
    return those.length ? those : live.filter((u) => u.role === 'admin')
  }

  /** Asks for a board. Silent whatever happens: the reply must not say whether it exists. */
  private ask(req: IncomingMessage, me: User, id: string, raw: string) {
    const entry = this.store.boards[id]
    if (!entry || this.level(me, entry) || !this.inbox.mayAsk(me.id, id)) return
    let note: string | undefined
    try {
      note = cleanNote((JSON.parse(raw || '{}') as { note?: unknown }).note)
    } catch {
      // A note that can't be read: the request still stands.
    }
    this.inbox.ask(me.id, id, note)
    this.accounts.log(req, me, { action: 'board.request', target: { kind: 'board', id, name: entry.title }, text: `${me.name} asked for access to “${entry.title}”` })
    for (const u of this.managers(entry)) this.inbox.nudge(u.id)
  }

  private inboxRoute(req: IncomingMessage, res: ServerResponse, me: User, m: string, rest: string[], body: () => Promise<string>): void | Promise<void> {
    if (rest.length === 0) {
      if (m !== 'GET') return json(res, 405, { error: 'Method not allowed' })
      const items = this.inboxOf(me)
      const seen = this.inbox.seenBy(me.id)
      return json(res, 200, { seen, unread: items.filter((i) => i.kind === 'request' || (i.at ?? 0) > seen).length, items })
    }
    if (rest.length === 1 && rest[0] === 'seen') {
      if (m !== 'POST') return json(res, 405, { error: 'Method not allowed' })
      this.inbox.markSeen(me.id)
      return json(res, 200, { ok: true })
    }
    if (rest.length === 2 && rest[0] === 'requests') {
      if (m !== 'POST') return json(res, 405, { error: 'Method not allowed' })
      return this.answer(req, res, me, rest[1], body)
    }
    return json(res, 404, { error: 'Not found' })
  }

  private async answer(req: IncomingMessage, res: ServerResponse, me: User, id: string, body: () => Promise<string>) {
    const request = this.inbox.requests.find((r) => r.id === id && !r.declined)
    const room = request ? this.host.get(request.board) : null
    if (!request || !room || this.level(me, room.data) !== 'manage') return json(res, 404, { error: 'No such request' })
    let answer: unknown
    try {
      answer = (JSON.parse((await body()) || '{}') as { answer?: unknown }).answer
    } catch {
      return json(res, 400, { error: 'Send {"answer": "view", "edit" or "no"}' })
    }
    const asker = this.store.user(request.from)
    if (answer === 'no') {
      this.inbox.settle(request.id, true)
      this.accounts.log(req, me, { action: 'board.request', target: boardTarget(room.data), text: `${me.name} turned down ${asker?.name ?? 'someone'}’s request for “${room.data.board.title}”` })
      if (asker) this.inbox.tell(asker.id, { kind: 'declined' })
    } else if (answer === 'view' || answer === 'edit') {
      const grants = (room.data.access ?? []).filter((g) => !(g.who === 'user' && g.id === request.from))
      if (!this.grant(req, me, room, [...grants, { who: 'user', id: request.from, level: answer }])) return json(res, 403, { error: 'You can’t give others access to boards. Ask an admin.' })
      this.inbox.settle(request.id)
      room.onChange?.(false)
      this.index(room)
      this.recheck(room)
    } else return json(res, 400, { error: 'Send {"answer": "view", "edit" or "no"}' })
    // It goes from the other managers' inboxes too.
    for (const u of this.managers(room.data)) if (u.id !== me.id) this.inbox.nudge(u.id)
    return json(res, 200, { ok: true })
  }

  /** Everything for one person's inbox, newest first. */
  private inboxOf(me: User) {
    const boards = this.store.boards
    const about = (id: string) => ({ title: boards[id]?.title ?? '', ...(boards[id]?.kind ? { boardKind: boards[id].kind } : {}) })
    this.inbox.sweep((r) => !boards[r.board] || !this.store.user(r.from))
    const requests = this.inbox.requests.flatMap((r) => {
      const entry = boards[r.board]
      const from = this.store.user(r.from)
      if (r.declined || !entry || !from || !this.managers(entry).some((u) => u.id === me.id)) return []
      return [{ kind: 'request' as const, id: r.id, board: r.board, ...about(r.board), at: r.at, by: from.name, ...(this.accounts.can(me, 'people.see') ? { email: from.email } : {}), ...(r.note ? { note: r.note } : {}) }]
    })
    const news = this.inbox.newsFor(me.id).flatMap<{ kind: string; id: string; at: number }>((n) => {
      if (n.kind === 'declined') return [n]
      const entry = boards[n.board]
      return entry && this.level(me, entry) ? [{ ...n, ...about(n.board) }] : []
    })
    const people = this.peopleNews(me).map((n) => ({ ...n, id: `${n.board}/${n.item ?? ''}/${n.note ?? ''}/${n.page ?? ''}/${n.kind}` }))
    return [...requests, ...news, ...people].sort((a, z) => (z.at ?? 0) - (a.at ?? 0)).slice(0, MENTIONS_SHOWN)
  }

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

  /** Where `me` is mentioned on the boards they can open, and replies to them, newest first. */
  private peopleNews(me: User) {
    const out: PersonNews[] = []
    for (const [id, e] of Object.entries(this.store.boards)) {
      if (!this.level(me, e)) continue
      let seen = this.mentioned.get(id)
      const mine = (x: { ids: Set<string> }) => concerns(x.ids, me)
      if (seen && seen.updated === e.updated && !mine(seen)) continue
      const data = this.host.loaded?.(id)?.data ?? this.host.peek(id)
      if (!data) continue
      if (!seen || seen.updated !== e.updated) {
        seen = { updated: e.updated, ids: whoIsMentioned(data.board) }
        this.mentioned.set(id, seen)
        if (!mine(seen)) continue
      }
      for (const r of this.newsOn(data.board, me)) {
        out.push({
          kind: r.kind,
          board: id,
          title: data.board.title,
          ...(data.board.kind === 'wiki' ? { boardKind: 'wiki' as const } : {}),
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
const writerKey = (name: string) => `wrote:${name.replace(/\s+/g, ' ').trim().toLowerCase()}`

/** Whether what whoIsMentioned found has anything to do with `me`. */
const concerns = (ids: Set<string>, me: User) => ids.has(me.id) || ids.has(nameKey(me.name)) || ids.has(writerKey(me.name))

/**
 * Who a board mentions anywhere (comments, descriptions, pages): account ids, and names (see nameKey)
 * of the rest. And who has written comments, since those people get replies.
 */
function whoIsMentioned(b: Board): Set<string> {
  const ids = new Set<string>()
  const scan = (text: string) => {
    if (!text.includes('](user:')) return
    for (const p of parseNote(text)) if ('person' in p) ids.add(p.person || nameKey(p.label))
  }
  for (const i of b.items) {
    if (i.description) scan(i.description)
    for (const n of i.notes ?? []) {
      scan(n.text)
      if (n.author) ids.add(writerKey(n.author))
    }
  }
  for (const body of b.bodies ?? []) scan(body.text)
  return ids
}

const boardTarget = (d: RoomData) => ({ kind: 'board' as const, id: d.id, name: d.board.title })

const entryOf = (d: RoomData): BoardEntry => ({
  title: d.board.title,
  ...(d.board.kind === 'wiki' ? { kind: 'wiki' as const } : {}),
  ...(d.board.parent ? { parent: d.board.parent.key } : {}),
  updated: d.updated,
  ...(d.owner ? { owner: d.owner } : {}),
  ...(d.access?.length ? { access: d.access } : {}),
})
