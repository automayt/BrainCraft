/**
 * Boards on a server with accounts: each has an owner and an access list, and the share keys no
 * longer open anything.
 *
 *   GET    /api/boards                  the boards you can reach (admins: all, unowned ones flagged)
 *   POST   /api/boards {board?}         a new board, yours ("Make boards")
 *   GET    /api/boards/:id              the board (at least view)
 *   POST   /api/boards/:id/ops {ops}    change it with operations (edit)
 *   GET    /api/boards/:id/access       who has access
 *   PUT    /api/boards/:id/access       change who has access, or the owner (manage)
 *   DELETE /api/boards/:id              delete it (manage)
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { OpError, opsFromText } from '../../src/api/ops'
import type { Role } from '../../src/collab/protocol'
import type { Room, RoomData } from '../../src/collab/room'
import { fromJson } from '../../src/model/serialize'
import type { Board } from '../../src/model/types'
import { atLeast, levelFor, roleOf } from './access'
import type { Accounts } from './service'
import { type BoardEntry, cleanGrants } from './store'
import type { Level, User } from './types'

/** What the server gives this: its rooms, however it keeps them. */
export interface RoomHost {
  get(id: string): Room | null
  create(board: Board, owner: string): Room
  remove(id: string): boolean
  /** Every board id on disk, and a board's stored data without opening its room (for the index). */
  ids(): string[]
  peek(id: string): RoomData | null
}

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
    clearTimeout(this.indexTimer)
    this.indexTimer = setTimeout(() => this.store.saveBoards(), 1500)
    this.indexTimer.unref?.()
  }

  level(user: User | null, access: { owner?: string; access?: RoomData['access'] }): Level | null {
    // An owner who's been removed leaves the board to admins.
    const owner = access.owner && this.store.user(access.owner) ? access.owner : undefined
    return levelFor(user, this.store.groups, { owner, access: access.access })
  }

  /** The role a live connection gets, and who it is; null to refuse (wrong origin, no access). */
  socket(req: IncomingMessage, room: Room): { role: Role; user: User } | null {
    const origin = req.headers.origin
    if (origin && origin.replace(/\/+$/, '') !== this.accounts.origin(req) && !this.origins.includes(origin)) return null
    const user = this.accounts.userOf(req)
    const role = roleOf(this.level(user, room.data))
    return user && role ? { role, user } : null
  }

  /** Handles a board route; false when it isn't one. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, body: () => Promise<string>): Promise<boolean> {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[1] !== 'boards') return false
    if (!this.accounts.fromApp(req)) return json(res, 403, { error: 'Missing the X-BrainCraft header' }), true
    const me = this.accounts.userOf(req)
    if (!me) return json(res, 401, { error: 'Sign in first' }), true
    const m = req.method ?? 'GET'

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

    if (parts.length === 3 && m === 'GET') {
      return json(res, 200, { id: room.data.id, role: roleOf(level), level, version: room.data.version, board: room.data.board, people: room.members.size }), true
    }

    if (parts[3] === 'ops' && m === 'POST') {
      if (!atLeast(level, 'edit')) return json(res, 403, { error: 'You can only view this board' }), true
      const ops = opsFromText(await body())
      if (!ops) return json(res, 400, { error: 'Send {"ops": [...]} (see docs/API.md)' }), true
      try {
        const results = room.applyOps(ops)
        this.index(room)
        return json(res, 200, { version: room.data.version, results }), true
      } catch (err) {
        return json(res, err instanceof OpError ? 422 : 500, { error: (err as Error).message }), true
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
        }
        if (b.owner !== undefined) {
          if (typeof b.owner !== 'string' || !this.store.user(b.owner)) return json(res, 400, { error: 'The new owner must be someone on this server' }), true
          if (me.role !== 'admin' && room.data.owner !== me.id) return json(res, 403, { error: 'Only the owner (or an admin) can hand a board over' }), true
          room.data.owner = b.owner
        }
        room.onChange?.()
        this.index(room)
        return json(res, 200, this.describe(room, this.level(me, room.data))), true
      }
    }

    if (parts.length === 3 && m === 'DELETE') {
      if (level !== 'manage') return json(res, 403, { error: 'Only people who manage this board can delete it' }), true
      this.host.remove(room.data.id)
      delete this.store.boards[room.data.id]
      this.store.saveBoards()
      return json(res, 200, { ok: true }), true
    }
    return json(res, 405, { error: 'Method not allowed' }), true
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

const entryOf = (d: RoomData): BoardEntry => ({
  title: d.board.title,
  ...(d.board.kind === 'wiki' ? { kind: 'wiki' as const } : {}),
  updated: d.updated,
  ...(d.owner ? { owner: d.owner } : {}),
  ...(d.access?.length ? { access: d.access } : {}),
})
