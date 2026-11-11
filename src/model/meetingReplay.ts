/**
 * A meeting's replay: how its notes grew, turn by turn, with what was said. While the meeting is
 * heard, each turn's changes to what the meeting made are kept (the objects added or changed since
 * the turn before, and those taken away); played back, the board is rebuilt step by step, the
 * transcript's lines appearing as they were said.
 */

import type { MeetingLine } from './meeting'
import { cleanConnector, cleanItem } from './sanitize'
import type { Board, Connector, Id, Item } from './types'

/** One turn of a meeting: when (ms from its start), what changed, and what the assistant said it noted. */
export interface ReplayStep {
  at: number
  put: Item[]
  gone: Id[]
  links: Connector[]
  unlinked: Id[]
  noted?: string
}

export interface MeetingRecord {
  v: 1
  title: string
  /** When it started (ms since the epoch), and how long it went on (ms). */
  started: number
  length: number
  /** Made from a recording rather than heard live: its file name. */
  recording?: string
  /** What was said, with who already put as a name. */
  lines: (Omit<MeetingLine, 'voice'> & { who?: string })[]
  steps: ReplayStep[]
}

/** What the meeting has made so far: its objects and links, each as it is now. */
export interface Snapshot {
  items: Map<Id, string>
  links: Map<Id, string>
}

export const emptySnapshot = (): Snapshot => ({ items: new Map(), links: new Map() })

/** The objects and links that weren't there before the meeting, as they are now. */
export function snapshot(b: Board, before: ReadonlySet<Id>, linksBefore: ReadonlySet<Id>): Snapshot {
  const items = new Map<Id, string>()
  const links = new Map<Id, string>()
  for (const i of b.items) if (!before.has(i.id)) items.set(i.id, JSON.stringify(i))
  for (const c of b.connectors) if (!linksBefore.has(c.id)) links.set(c.id, JSON.stringify(c))
  return { items, links }
}

/** What changed between two snapshots, as a step; null when nothing did. */
export function stepBetween(was: Snapshot, now: Snapshot, at: number, noted?: string): ReplayStep | null {
  const put: Item[] = []
  const links: Connector[] = []
  for (const [id, json] of now.items) if (was.items.get(id) !== json) put.push(JSON.parse(json) as Item)
  for (const [id, json] of now.links) if (was.links.get(id) !== json) links.push(JSON.parse(json) as Connector)
  const gone = [...was.items.keys()].filter((id) => !now.items.has(id))
  const unlinked = [...was.links.keys()].filter((id) => !now.links.has(id))
  if (!put.length && !links.length && !gone.length && !unlinked.length && !noted) return null
  return { at, put, gone, links, unlinked, ...(noted ? { noted } : {}) }
}

/**
 * The board as it was `upto` steps into a meeting (0: before it): the board now without anything
 * the meeting made (nor its frame), then each step's changes in turn.
 */
export function replayBoard(now: Board, r: MeetingRecord, upto: number, frame?: Id): Board {
  const made = new Set<Id>()
  const linked = new Set<Id>()
  for (const s of r.steps) {
    for (const i of s.put) made.add(i.id)
    for (const id of s.gone) made.add(id)
    for (const c of s.links) linked.add(c.id)
    for (const id of s.unlinked) linked.add(id)
  }
  if (frame !== undefined) made.add(frame)
  const items = new Map<Id, Item>()
  const links = new Map<Id, Connector>()
  for (const s of r.steps.slice(0, upto)) {
    for (const i of s.put) items.set(i.id, i)
    for (const id of s.gone) items.delete(id)
    for (const c of s.links) links.set(c.id, c)
    for (const id of s.unlinked) links.delete(id)
  }
  const kept = now.items.filter((i) => !made.has(i.id) && !items.has(i.id))
  const all = [...kept, ...items.values()]
  const ids = new Set(all.map((i) => i.id))
  const conns = [...now.connectors.filter((c) => !linked.has(c.id) && !links.has(c.id)), ...links.values()].filter((c) => ids.has(c.from) && ids.has(c.to))
  return { ...now, items: all, connectors: conns }
}

/** How many steps had happened by `at` ms into the meeting. */
export function stepsBy(r: MeetingRecord, at: number): number {
  let n = 0
  while (n < r.steps.length && r.steps[n].at <= at) n++
  return n
}

/** A replay read back from its file; null when it isn't one. */
export function readRecord(text: string): MeetingRecord | null {
  try {
    const r = JSON.parse(text) as MeetingRecord
    if (r?.v !== 1 || !Array.isArray(r.steps) || !Array.isArray(r.lines) || typeof r.started !== 'number' || typeof r.length !== 'number') return null
    const okStep = (s: ReplayStep) => s && typeof s.at === 'number' && [s.put, s.gone, s.links, s.unlinked].every(Array.isArray)
    if (!r.steps.every(okStep)) return null
    // From a shared board's files: what it puts on the board is checked like anything else that arrives.
    const ids = (v: unknown[]) => v.filter((x): x is Id => Number.isInteger(x))
    const steps = r.steps.map((s) => ({
      at: s.at,
      put: s.put.map(cleanItem).filter((i): i is Item => !!i),
      gone: ids(s.gone),
      links: s.links.map(cleanConnector).filter((c): c is Connector => !!c),
      unlinked: ids(s.unlinked),
      ...(typeof s.noted === 'string' ? { noted: s.noted.slice(0, 2000) } : {}),
    }))
    const lines = r.lines
      .filter((l) => l && typeof l.at === 'number' && typeof l.text === 'string')
      .map((l) => ({ at: l.at, text: l.text.slice(0, 20_000), ...(typeof l.who === 'string' ? { who: l.who.slice(0, 60) } : {}) }))
    return { v: 1, title: typeof r.title === 'string' ? r.title.slice(0, 200) : 'Meeting', started: r.started, length: r.length, ...(typeof r.recording === 'string' ? { recording: r.recording.slice(0, 200) } : {}), lines, steps }
  } catch {
    return null
  }
}
