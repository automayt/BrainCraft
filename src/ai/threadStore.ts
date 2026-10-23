/**
 * Where the conversation with the assistant is kept between visits: with your account on a server
 * with accounts (so it follows you to any device), otherwise in this browser. Pictures and the
 * bulky insides of proposals are left out; a proposal still waiting when it was kept comes back
 * as discarded, since what it would change can't be known any more.
 */

import { call } from '../store/account'
import type { Proposal } from './assistant'
import { type Message, dropStale } from './thread'

/** Where something was said: the board or wiki that was open. */
export interface Where {
  key: string
  title: string
  kind: 'wiki' | 'board'
}

/** A turn as the panel shows it. */
export interface Turn {
  role: 'user' | 'assistant' | 'error'
  text: string
  proposals: Proposal[]
  where?: Where
}

export interface Usage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export interface SavedThread {
  v: 1
  at: number
  messages: Message[]
  turns: Turn[]
  usage?: Usage
}

/** Where to keep it: the signed-in person's account on `server`, or this browser. */
export interface Keeper {
  server: string | null
  /** Signed in on a server with accounts. */
  account: string | null
}

export const ownerOf = (k: Keeper) => (k.account && k.server ? `account:${k.server}:${k.account}` : 'browser')

const KEY = 'braincraft.assistant.thread'
/** The most kept, in characters (the server takes up to 4 MB). */
const MAX = 2_500_000

const noPictures = (m: Message): Message =>
  typeof m.content === 'string' ? m : ({ ...m, content: m.content.map((b) => (b.type === 'image' ? { type: 'text' as const, text: '[A picture was sent here.]' } : b)) } as Message)

/** The conversation as kept; null when it's too big even after leaving out old reads. */
export function toSaved(messages: readonly Message[], turns: readonly Turn[], usage?: Usage): SavedThread | null {
  const kept = turns.slice(-200).map((t) => ({
    ...t,
    proposals: t.proposals.map((p) => ({ ...p, ops: [], patches: [], bases: undefined, status: p.status === 'pending' ? ('discarded' as const) : p.status })),
  }))
  let m = messages.map(noPictures)
  const fits = () => JSON.stringify({ m, kept }).length <= MAX
  if (!fits()) m = dropStale(m, 2)
  if (!fits()) return null
  return { v: 1, at: Date.now(), messages: m, turns: kept, ...(usage ? { usage } : {}) }
}

/** A kept conversation, checked; null when there's none or it isn't one. */
export function fromSaved(raw: unknown): SavedThread | null {
  const t = raw as Partial<SavedThread> | null
  if (!t || typeof t !== 'object' || t.v !== 1 || !Array.isArray(t.messages) || !Array.isArray(t.turns)) return null
  const turns = t.turns.filter((x): x is Turn => !!x && typeof x === 'object' && typeof (x as Turn).text === 'string' && Array.isArray((x as Turn).proposals))
  return { v: 1, at: Number(t.at) || 0, messages: t.messages, turns, ...(t.usage ? { usage: t.usage } : {}) }
}

export async function loadThread(k: Keeper): Promise<SavedThread | null> {
  try {
    if (ownerOf(k) !== 'browser') return fromSaved((await call<{ thread: unknown }>(k.server!, 'api/assistant/thread')).thread)
    return fromSaved(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return null
  }
}

export async function saveThread(k: Keeper, t: SavedThread): Promise<void> {
  try {
    if (ownerOf(k) !== 'browser') await call(k.server!, 'api/assistant/thread', 'PUT', t)
    else localStorage.setItem(KEY, JSON.stringify(t))
  } catch {
    // Kept next time; the conversation goes on here either way.
  }
}

export async function forgetThread(k: Keeper): Promise<void> {
  try {
    if (ownerOf(k) !== 'browser') await call(k.server!, 'api/assistant/thread', 'DELETE')
    else localStorage.removeItem(KEY)
  } catch {
    // Nothing kept, or it can't be reached: nothing to forget here.
  }
}
