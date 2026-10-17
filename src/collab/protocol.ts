/** Messages between BrainCraft tabs and the BrainCraft server in a live session (JSON over a WebSocket). */

import type { Rect, Vec } from '../model/geom'
import type { Board, Id } from '../model/types'
import type { Patch } from './patch'

export type Role = 'edit' | 'view'

/** What each person shares about themselves while connected. */
export interface Presence {
  name: string
  color: string
  /** Pointer position on the board, or null when it's off the canvas. */
  cursor: Vec | null
  selection: Id[]
  /** The part of the board on their screen, for following them. */
  view: Rect | null
}

export interface PeerInfo extends Presence {
  id: string
  role: Role
}

/** Ids handed out by each connection come from its own block, so two people never make the same id. */
export const ID_BLOCK = 2 ** 24

/** Moments, not board changes: an emote at a spot, a line of cursor chat, or starting/stopping the shared timer. */
export type Signal = { kind: 'emote'; emoji: string; at: Vec } | { kind: 'chat'; text: string } | { kind: 'timer'; seconds: number | null }

/** The shared timer as the server tells it: time left (not a clock time, so clocks needn't agree). */
export interface TimerState {
  remainingMs: number
  totalMs: number
  by: string
}

export type ServerMessage =
  | { t: 'hello'; board: Board; version: number; you: { id: string; role: Role; idBase: number }; peers: PeerInfo[]; timer?: TimerState | null }
  | { t: 'signal'; from: string; signal: Signal }
  | { t: 'timer'; timer: TimerState | null }
  | { t: 'patch'; patches: Patch[]; from: string; version: number }
  /** Your patch message `seq` is in, at `version`. */
  | { t: 'ack'; seq: number; version: number }
  | { t: 'presence'; peer: PeerInfo }
  | { t: 'leave'; id: string }
  /** Something was refused; `seq` names the patch message, if it was one. */
  | { t: 'error'; message: string; seq?: number }

export type ClientMessage =
  | { t: 'patch'; seq: number; patches: Patch[] }
  | { t: 'presence'; presence: Presence }
  | { t: 'signal'; signal: Signal }

/** The live-session part of a link: `#live=ID.KEY` (plus `&server=URL` when the server isn't where the app is). */
export interface LiveLink {
  id: string
  key: string
  server?: string
}

export function liveFromHash(hash: string): LiveLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const live = params.get('live')
  const m = live && /^([A-Za-z0-9_-]{6,64})\.([A-Za-z0-9_-]{16,128})$/.exec(live)
  if (!m) return null
  const server = params.get('server')
  return { id: m[1], key: m[2], ...(server ? { server } : {}) }
}

export function liveHash(l: LiveLink): string {
  return `live=${l.id}.${l.key}${l.server ? `&server=${encodeURIComponent(l.server)}` : ''}`
}

/** A colour for a person, from their name. */
export const PEER_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#c2255c', '#7048e8', '#0c8599', '#e67700', '#d6336c']

export function colorFor(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length]
}
