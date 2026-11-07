/**
 * What needs each person, kept in `DATA/accounts/inbox.json`: news that happens once (a board shared
 * with you, a request turned down), requests for access waiting for an answer, and when each person
 * last looked. Mentions and replies aren't kept here: they're read from the boards when asked for,
 * so a deleted comment goes from the inbox too (see AccountBoards).
 *
 * People with the app open hold a connection (`/api/inbox/live`) that says only "something's new";
 * they then ask for their inbox as anyone would, so nothing private travels on it.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Level } from './types'

/** Something that happened once, for one person. */
export type News = { id: string; at: number; kind: 'share'; board: string; by: string; level: Level } | { id: string; at: number; kind: 'declined' }

/** Someone asking for a board they can't open. */
export interface AccessRequest {
  id: string
  board: string
  from: string
  at: number
  note?: string
  /** Turned down then: kept a while, so asking again doesn't pester anyone. */
  declined?: number
}

interface Stored {
  seen: Record<string, number>
  news: Record<string, News[]>
  requests: AccessRequest[]
}

/** News kept per person. */
const NEWS_KEPT = 200
/** What a request may say. */
export const NOTE_MAX = 300
/** Requests one person can have waiting at once. */
const WAITING_MAX = 20
/** How long after being turned down someone can't ask again. */
const DECLINED_QUIET_MS = 24 * 60 * 60_000
/** Connections one person can hold (tabs and devices). */
const LISTENERS_MAX = 10
/** Until someone first looks, what's older than this counts as seen. */
const FIRST_LOOK_MS = 14 * 24 * 60 * 60_000

const newId = () => randomBytes(9).toString('base64url')

/** A note as it's kept: a line or so of plain text. */
export const cleanNote = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, NOTE_MAX)
  return t || undefined
}

export class Inbox {
  private file: string
  private data: Stored
  private now: () => number
  private timer: NodeJS.Timeout | undefined
  private listeners = new Map<string, Map<() => void, number>>()

  constructor(dir: string, now: () => number = Date.now) {
    this.file = join(dir, 'inbox.json')
    this.now = now
    let read: Partial<Stored> = {}
    try {
      if (existsSync(this.file)) read = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stored>
    } catch {
      // Unreadable: start again. Nothing here can't be lived without.
    }
    this.data = { seen: read.seen ?? {}, news: read.news ?? {}, requests: Array.isArray(read.requests) ? read.requests : [] }
  }

  private save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 1000)
    this.timer.unref?.()
  }

  flush() {
    clearTimeout(this.timer)
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }

  seenBy = (user: string) => this.data.seen[user] ?? this.now() - FIRST_LOOK_MS

  markSeen(user: string) {
    this.data.seen[user] = this.now()
    this.save()
  }

  newsFor = (user: string): readonly News[] => this.data.news[user] ?? []

  tell(user: string, news: { kind: 'share'; board: string; by: string; level: Level } | { kind: 'declined' }) {
    // A board shared again replaces the older news of it.
    const had = (this.data.news[user] ?? []).filter((n) => !(news.kind === 'share' && n.kind === 'share' && n.board === news.board))
    this.data.news[user] = [{ ...news, id: newId(), at: this.now() }, ...had].slice(0, NEWS_KEPT)
    this.save()
    this.nudge(user)
  }

  // ----- requests for access ------------------------------------------------------------------

  get requests(): readonly AccessRequest[] {
    return this.data.requests
  }

  /** Whether `user` could ask for `board` now: not already waiting, not just turned down, not asking for dozens. */
  mayAsk(user: string, board: string) {
    const now = this.now()
    const mine = this.data.requests.filter((r) => r.from === user)
    return !mine.some((r) => r.board === board && (!r.declined || now - r.declined < DECLINED_QUIET_MS)) && mine.filter((r) => !r.declined).length < WAITING_MAX
  }

  ask(user: string, board: string, note?: string): AccessRequest {
    const now = this.now()
    this.data.requests = this.data.requests.filter((r) => !(r.declined && (now - r.declined >= DECLINED_QUIET_MS || (r.from === user && r.board === board))))
    const request: AccessRequest = { id: newId(), board, from: user, at: now, ...(note ? { note } : {}) }
    this.data.requests.push(request)
    this.save()
    return request
  }

  /** Puts a request away, answered. */
  settle(id: string, declined = false) {
    if (declined) {
      const r = this.data.requests.find((x) => x.id === id)
      if (r) r.declined = this.now()
    } else this.data.requests = this.data.requests.filter((r) => r.id !== id)
    this.save()
  }

  /** Forgets what can't be answered any more (`stale`: its board or asker has gone). */
  sweep(stale: (r: AccessRequest) => boolean) {
    const kept = this.data.requests.filter((r) => !stale(r))
    if (kept.length === this.data.requests.length) return
    this.data.requests = kept
    this.save()
  }

  // ----- people with the app open --------------------------------------------------------------

  /** Calls `tell` when there's something new for `user`, until the returned function is called. */
  listen(user: string, tell: () => void): () => void {
    const mine = this.listeners.get(user) ?? new Map<() => void, number>()
    this.listeners.set(user, mine)
    // The oldest gives way: a tab closed badly mustn't lock out a new one.
    if (mine.size >= LISTENERS_MAX) mine.delete(mine.keys().next().value!)
    mine.set(tell, this.now())
    return () => {
      mine.delete(tell)
      if (!mine.size && this.listeners.get(user) === mine) this.listeners.delete(user)
    }
  }

  /** Who has the app open, each with when they connected. */
  online(): [user: string, since: number][] {
    return [...this.listeners].map(([user, mine]) => [user, Math.min(...mine.values())])
  }

  nudge(user: string) {
    for (const tell of this.listeners.get(user)?.keys() ?? []) tell()
  }
}
