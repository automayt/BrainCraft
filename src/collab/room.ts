/**
 * One shared board on the server: who's connected, the board's current state, and how
 * patches and API operations are applied and passed on. No I/O here; the server wires it up.
 */

import { type Op, type OpResult, applyOps } from '../api/ops'
import type { Measure } from '../model/mindmap'
import { layoutAll } from '../model/mindmap'
import type { Board } from '../model/types'
import { type Patch, applyPatches, diff } from './patch'
import { type ClientMessage, ID_BLOCK, type PeerInfo, type Presence, type Role, type ServerMessage, type Signal } from './protocol'

export interface Member {
  id: string
  role: Role
  presence: Presence | null
  send: (m: ServerMessage) => void
  /** Recent signal times, to keep emote spam in check. */
  signals?: number[]
}

const SIGNALS_PER_5S = 15
const MAX_TIMER_S = 3 * 3600

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
}

const MAX_PATCHES = 5000

export class Room {
  data: RoomData
  readonly members = new Map<string, Member>()
  /** Called after every change, for saving. */
  onChange: (() => void) | null = null
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
    m.send({ t: 'hello', board: this.data.board, version: this.data.version, you: { id: m.id, role: m.role, idBase }, peers: this.peers(m.id), timer: this.timerState() })
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
      if (m.role !== 'edit') return m.send({ t: 'error', message: 'This link can only view the board' })
      if (!Array.isArray(msg.patches) || msg.patches.length > MAX_PATCHES) return m.send({ t: 'error', message: 'Bad patch' })
      this.data.board = applyPatches(this.data.board, msg.patches)
      this.data.version++
      this.changed()
      m.send({ t: 'ack', seq: msg.seq, version: this.data.version })
      this.broadcast({ t: 'patch', patches: msg.patches, from: id, version: this.data.version }, id)
    }
  }

  /** Applies API operations as if someone edited the board, and passes the changes to everyone. */
  applyOps(ops: Op[]): OpResult[] {
    const before = this.data.board
    const { board, results } = applyOps(before, ops, { measure: this.measure })
    // Keep server-made ids out of every person's block.
    const after = layoutAll(board, this.measure)
    const patches = diff(before, after)
    if (patches.length) this.applyServerPatches(patches, after)
    return results
  }

  private applyServerPatches(patches: Patch[], after: Board) {
    this.data.board = after
    this.data.version++
    this.changed()
    this.broadcast({ t: 'patch', patches, from: 'server', version: this.data.version })
  }

  private changed(touch = true) {
    if (touch) this.data.updated = Date.now()
    this.onChange?.()
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
