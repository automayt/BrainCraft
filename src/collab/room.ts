/**
 * One shared board on the server: who's connected, the board's current state, and how
 * patches and API operations are applied and passed on. No I/O here; the server wires it up.
 */

import { type Op, OpError, type OpResult, applyOps } from '../api/ops'
import type { Person } from '../model/timeTracking'
import { protectedChange } from '../model/protection'
import { cleanPatches } from '../model/sanitize'
import type { Measure } from '../model/mindmap'
import { layoutAll } from '../model/mindmap'
import type { Board } from '../model/types'
import { MAX_PAGES, MAX_SNAPS, WIKI_TEXT_MAX } from '../model/wiki'
import { MAX_REVS, REV_TEXT_BUDGET, pruneRevs } from '../model/revisions'
import { type Patch, applyPatches, diff } from './patch'
import { type ClientMessage, ID_BLOCK, type PeerInfo, type Presence, type Role, type ServerMessage, type Signal } from './protocol'

/**
 * Page versions are a log: a version that exists keeps its words, title, time and writer (only its
 * note, keep mark and number may change, or the words of the same writer's quick tick version), and a
 * version kept for good is only removed with its page.
 */
function keepLog(board: Board, patches: Patch[]): Patch[] {
  if (!patches.some((p) => p.k === 'rev')) return patches
  const old = new Map((board.revs ?? []).map((r) => [r.id, r]))
  const gonePages = new Set(patches.flatMap((p) => (p.k === 'page' && p.v === null ? [p.id] : [])))
  return patches.filter((p) => {
    if (p.k !== 'rev') return true
    const was = old.get(p.id)
    if (!was) return true
    if (p.v === null) return !was.keep || gonePages.has(was.page)
    const same = p.v.page === was.page && p.v.by === was.by
    const fixed = p.v.text === was.text && p.v.title === was.title && p.v.at === was.at
    return same && (fixed || (!!was.quick && !!p.v.quick))
  })
}

export interface Member {
  id: string
  role: Role
  presence: Presence | null
  send: (m: ServerMessage) => void
  /** Recent signal times, to keep emote spam in check. */
  signals?: number[]
  /** The signed-in person (servers with accounts): their name is the one others see. */
  user?: { id: string; name: string }
  /**
   * Whether they manage the board (servers with accounts). False means protected wiki pages are
   * off limits to them; left out (shared by key), nobody manages and protection is the app's guard.
   */
  manages?: boolean
}

const SIGNALS_PER_5S = 15
const MAX_TIMER_S = 3 * 3600
/** Objects a shared board may hold: far past any friends' board, short of filling the server. */
export const MAX_ITEMS = 50_000

/** What the server stores for a room. */
export interface RoomData {
  id: string
  board: Board
  version: number
  editKey: string
  viewKey: string
  /** The next id block to hand out; block 0 is the board's own ids from before it went live. */
  nextSlot: number
  created: number
  updated: number
  /** Servers with accounts: whose board it is, and who else may view, edit or manage it. */
  owner?: string
  access?: { who: 'user' | 'group'; id: string; level: 'view' | 'edit' | 'manage' }[]
}

const MAX_PATCHES = 5000

export class Room {
  data: RoomData
  readonly members = new Map<string, Member>()
  /** Called after every change, for saving. */
  /** After every change; `edited` when the board itself changed (not just who's here). */
  onChange: ((edited: boolean) => void) | null = null
  private measure: Measure

  constructor(data: RoomData, measure: Measure) {
    this.data = data
    this.measure = measure
  }

  roleFor(key: string | null | undefined, equal: (a: string, b: string) => boolean = (a, b) => a === b): Role | null {
    if (!key) return null
    if (equal(key, this.data.editKey)) return 'edit'
    if (equal(key, this.data.viewKey)) return 'view'
    return null
  }

  private peers(except?: string): PeerInfo[] {
    return [...this.members.values()].filter((m) => m.id !== except && m.presence).map((m) => ({ id: m.id, role: m.role, ...m.presence! }))
  }

  private broadcast(m: ServerMessage, except?: string) {
    for (const member of this.members.values()) if (member.id !== except) member.send(m)
  }

  /** The shared timer, in server time. */
  private timer: { endsAt: number; totalMs: number; by: string } | null = null
  /** The clock (tests replace it). */
  now = () => Date.now()

  private timerState() {
    const t = this.timer
    if (!t || t.endsAt <= this.now()) return null
    return { remainingMs: t.endsAt - this.now(), totalMs: t.totalMs, by: t.by }
  }

  join(member: Omit<Member, 'presence'>): void {
    const m: Member = { ...member, presence: null }
    this.members.set(m.id, m)
    const idBase = m.role === 'edit' ? this.data.nextSlot++ * ID_BLOCK : 0
    if (m.role === 'edit') this.changed(false)
    m.send({ t: 'hello', board: this.data.board, version: this.data.version, you: { id: m.id, role: m.role, idBase, ...(m.user ? { user: m.user } : {}) }, peers: this.peers(m.id), timer: this.timerState() })
  }

  leave(id: string) {
    if (!this.members.delete(id)) return
    this.broadcast({ t: 'leave', id })
  }

  receive(id: string, msg: ClientMessage) {
    const m = this.members.get(id)
    if (!m || !msg || typeof msg !== 'object') return
    if (msg.t === 'presence') {
      m.presence = sanitizePresence(msg.presence)
      // A signed-in person's name is their account's, whatever their browser says.
      if (m.presence && m.user) {
        m.presence.name = m.user.name.slice(0, 40)
        m.presence.user = m.user.id
      }
      if (m.presence) this.broadcast({ t: 'presence', peer: { id, role: m.role, ...m.presence } }, id)
      return
    }
    if (msg.t === 'signal') {
      const sig = sanitizeSignal(msg.signal)
      if (!sig) return
      const now = this.now()
      m.signals = (m.signals ?? []).filter((t) => now - t < 5000)
      if (m.signals.length >= SIGNALS_PER_5S) return
      m.signals.push(now)
      if (sig.kind === 'timer') {
        // Viewers can watch the timer but not run it.
        if (m.role !== 'edit') return
        this.timer = sig.seconds ? { endsAt: now + sig.seconds * 1000, totalMs: sig.seconds * 1000, by: m.presence?.name ?? 'Someone' } : null
        this.broadcast({ t: 'timer', timer: this.timerState() })
        return
      }
      this.broadcast({ t: 'signal', from: id, signal: sig }, id)
      return
    }
    if (msg.t === 'patch') {
      // Refusals name the message, so the sender can drop it and reload the board.
      const seq = typeof msg.seq === 'number' ? msg.seq : undefined
      if (m.role !== 'edit') return m.send({ t: 'error', message: 'This link can only view the board', seq })
      if (!Array.isArray(msg.patches) || msg.patches.length > MAX_PATCHES) return m.send({ t: 'error', message: 'Bad patch', seq })
      // Checked before anyone else sees them: a bad field from one person can't crash the rest.
      const isWiki = this.data.board.kind === 'wiki'
      // Pages and embed copies belong to wikis only.
      const patches = keepLog(
        this.data.board,
        cleanPatches(msg.patches).filter((p) => isWiki || (p.k !== 'page' && p.k !== 'body' && p.k !== 'snap' && p.k !== 'rev')),
      )
      let next: Board
      try {
        next = applyPatches(this.data.board, patches)
      } catch {
        return m.send({ t: 'error', message: 'Bad patch', seq })
      }
      if (isWiki && m.manages === false) {
        const why = protectedChange(this.data.board, patches)
        if (why) return m.send({ t: 'error', message: why, seq })
      }
      if (next.items.length > MAX_ITEMS && next.items.length > this.data.board.items.length)
        return m.send({ t: 'error', message: `This board is full (${MAX_ITEMS.toLocaleString('en')} objects)`, seq })
      const pages = next.pages?.length ?? 0
      if (pages > MAX_PAGES && pages > (this.data.board.pages?.length ?? 0))
        return m.send({ t: 'error', message: `This wiki is full (${MAX_PAGES.toLocaleString('en')} pages)`, seq })
      const snaps = next.snaps?.length ?? 0
      if (snaps > MAX_SNAPS && snaps > (this.data.board.snaps?.length ?? 0)) return m.send({ t: 'error', message: 'This wiki has too many embeds', seq })
      // Too many versions: the new ones are left out, never the words that came with them.
      const kept = (b: Board) => (b.revs ?? []).reduce((n, r) => n + r.text.length, 0)
      if (isWiki && patches.some((p) => p.k === 'rev' && p.v) && ((next.revs?.length ?? 0) > MAX_REVS || kept(next) > REV_TEXT_BUDGET * 3)) {
        const old = new Set((this.data.board.revs ?? []).map((r) => r.id))
        const trimmed = patches.filter((p) => p.k !== 'rev' || !p.v || old.has(p.id))
        patches.length = 0
        patches.push(...trimmed)
        next = applyPatches(this.data.board, patches)
      }
      if (isWiki && patches.some((p) => p.k === 'body')) {
        const size = (b: Board) => (b.bodies ?? []).reduce((n, x) => n + x.text.length, 0)
        const now = size(next)
        if (now > WIKI_TEXT_MAX && now > size(this.data.board)) return m.send({ t: 'error', message: 'This wiki is full', seq })
      }
      this.data.board = next
      this.data.version++
      this.changed()
      m.send({ t: 'ack', seq: msg.seq, version: this.data.version })
      this.broadcast({ t: 'patch', patches, from: id, version: this.data.version }, id)
    }
  }

  /**
   * Applies API operations as if someone edited the board, and passes the changes to everyone.
   * `manages: false` (someone signed in who doesn't manage it) keeps them off protected pages.
   */
  applyOps(ops: Op[], who: { manages?: boolean; person?: Person } = {}): OpResult[] {
    const before = this.data.board
    const { board, results } = applyOps(before, ops, { measure: this.measure, ...(who.person ? { who: who.person } : {}) })
    // Keep server-made ids out of every person's block.
    const after = layoutAll(board, this.measure)
    const patches = diff(before, after)
    if (who.manages === false && before.kind === 'wiki') {
      const why = protectedChange(before, patches)
      if (why) throw new OpError(why)
    }
    if (patches.length) this.applyServerPatches(patches, after)
    return results
  }

  /**
   * Puts the board back to an earlier version, for everyone in the session. Wiki page versions and
   * time logged are a record of what happened, so the ones since stay (alongside the version's own).
   */
  restore(board: Board, who: { manages?: boolean } = {}) {
    const before = this.data.board
    const had = new Set((board.revs ?? []).map((r) => r.id))
    const revs = [...(board.revs ?? []), ...(before.revs ?? []).filter((r) => !had.has(r.id))].sort((a, z) => a.at - z.at)
    const { time: _then, ...rest } = board
    const merged = pruneRevs({
      ...rest,
      ...(revs.length ? { revs } : {}),
      ...(before.time?.length ? { time: before.time } : {}),
      // Ids handed out since stay taken.
      nextId: Math.max(before.nextId, board.nextId),
    })
    const after = layoutAll(merged, this.measure)
    const patches = diff(before, after)
    if (who.manages === false && before.kind === 'wiki') {
      const why = protectedChange(before, patches)
      if (why) throw new OpError(why)
    }
    if (patches.length) this.applyServerPatches(patches, after)
    else this.data.board = after
  }

  private applyServerPatches(patches: Patch[], after: Board) {
    this.data.board = after
    this.data.version++
    this.changed()
    this.broadcast({ t: 'patch', patches, from: 'server', version: this.data.version })
  }

  private changed(touch = true) {
    if (touch) this.data.updated = Date.now()
    this.onChange?.(touch)
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Presence comes from other people's browsers: keep only well-formed, bounded values. */
export function sanitizeSignal(s: unknown): Signal | null {
  if (!s || typeof s !== 'object') return null
  const x = s as Signal
  if (x.kind === 'emote') {
    const emoji = str(x.emoji, 16)
    if (!emoji || !x.at || typeof x.at !== 'object') return null
    return { kind: 'emote', emoji, at: { x: num(x.at.x), y: num(x.at.y) } }
  }
  if (x.kind === 'chat') {
    const text = str(x.text, 140).trim()
    return text ? { kind: 'chat', text } : null
  }
  if (x.kind === 'timer') {
    const seconds = x.seconds === null ? null : Math.round(num(x.seconds))
    if (seconds !== null && (seconds <= 0 || seconds > MAX_TIMER_S)) return null
    return { kind: 'timer', seconds }
  }
  return null
}

export function sanitizePresence(p: unknown): Presence | null {
  if (!p || typeof p !== 'object') return null
  const x = p as Presence
  const cursor = x.cursor && typeof x.cursor === 'object' ? { x: num(x.cursor.x), y: num(x.cursor.y) } : null
  const view = x.view && typeof x.view === 'object' ? { x: num(x.view.x), y: num(x.view.y), w: num(x.view.w), h: num(x.view.h) } : null
  return {
    name: str(x.name, 40) || 'Guest',
    color: /^#[0-9a-f]{6}$/i.test(String(x.color)) ? String(x.color) : '#7048e8',
    cursor,
    selection: Array.isArray(x.selection) ? x.selection.filter((n) => typeof n === 'number').slice(0, 500) : [],
    view,
  }
}
