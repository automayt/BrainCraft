/**
 * Counts of what happens on the server, day by day, for the admin's usage page: boards opened and
 * made, changes, assistant and speech-to-text requests, form answers, exports, and how many
 * people were active. Only numbers are kept (and, for today and earlier days, which accounts were
 * active, to count them once); never what anyone wrote or asked.
 *
 * Kept in `DATA/usage.json`, saved a few seconds after a change, for 400 days.
 */

import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tallyFeatures } from '../src/model/featureUsage'
import type { Board } from '../src/model/types'

export const USAGE_EVENTS = {
  'board.open': 'Boards opened',
  'board.create': 'Boards made',
  edit: 'Changes',
  api: 'API changes',
  'ai.claude': 'Assistant (Claude)',
  'ai.model': 'Assistant (model server)',
  'ai.agent': 'Assistant (command-line agent)',
  transcribe: 'Speech to text (clips)',
  'form.answer': 'Form answers',
  export: 'Exports',
  preview: 'Link previews',
  signin: 'Sign-ins',
} as const

export type UsageEvent = keyof typeof USAGE_EVENTS

interface Day {
  counts: Partial<Record<UsageEvent, number>>
  /** Accounts active that day. */
  people?: string[]
  /** Changes that day, by board. */
  boards?: Record<string, number>
}

export interface UsageReport {
  events: Record<UsageEvent, string>
  /** Oldest first, one per day (days with nothing included). */
  days: { day: string; counts: Partial<Record<UsageEvent, number>>; people: number }[]
  totals: Partial<Record<UsageEvent, number>>
  /** Different people active in the last 1, 7 and 30 days. */
  active: { d1: number; d7: number; d30: number }
  /** The boards changed most in the span, most first (at most 10). */
  busiest: { id: string; changes: number }[]
}

const KEEP_DAYS = 400
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10)

export class Usage {
  private days: Record<string, Day> = {}
  private timer: NodeJS.Timeout | undefined

  private file: string | null
  private now: () => number

  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file
    this.now = now
    if (!file) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { days?: Record<string, Day> }
      for (const [k, d] of Object.entries(raw.days ?? {}))
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && d && typeof d.counts === 'object')
          this.days[k] = {
            counts: d.counts,
            ...(Array.isArray(d.people) ? { people: d.people.filter((p) => typeof p === 'string') } : {}),
            ...(d.boards && typeof d.boards === 'object' ? { boards: d.boards } : {}),
          }
    } catch {
      // A fresh count.
    }
  }

  private today(): Day {
    const k = dayOf(this.now())
    return (this.days[k] ??= { counts: {} })
  }

  count(event: UsageEvent, n = 1) {
    const d = this.today()
    d.counts[event] = (d.counts[event] ?? 0) + n
    this.later()
  }

  /** A board changed: counted as a change, and towards that board's. */
  edited(board: string) {
    const d = this.today()
    d.boards ??= Object.create(null) as Record<string, number>
    d.boards[board] = (d.boards[board] ?? 0) + 1
    this.count('edit')
  }

  /** Someone signed in did something today. */
  seen(user: string) {
    const d = this.today()
    if (d.people?.includes(user)) return
    ;(d.people ??= []).push(user)
    this.later()
  }

  report(span = 30): UsageReport {
    const now = this.now()
    const days: UsageReport['days'] = []
    const totals: Partial<Record<UsageEvent, number>> = {}
    const boards = new Map<string, number>()
    for (let k = span - 1; k >= 0; k--) {
      const day = dayOf(now - k * 86_400_000)
      const d = this.days[day]
      days.push({ day, counts: { ...d?.counts }, people: d?.people?.length ?? 0 })
      for (const [e, n] of Object.entries(d?.counts ?? {}) as [UsageEvent, number][]) totals[e] = (totals[e] ?? 0) + n
      for (const [id, n] of Object.entries(d?.boards ?? {})) boards.set(id, (boards.get(id) ?? 0) + n)
    }
    const busiest = [...boards].sort((a, z) => z[1] - a[1]).slice(0, 10).map(([id, changes]) => ({ id, changes }))
    const within = (n: number) => {
      const who = new Set<string>()
      for (let k = 0; k < n; k++) for (const p of this.days[dayOf(now - k * 86_400_000)]?.people ?? []) who.add(p)
      return who.size
    }
    return { events: { ...USAGE_EVENTS }, days, totals, active: { d1: within(1), d7: within(7), d30: within(30) }, busiest }
  }

  private later() {
    if (!this.file || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.save()
    }, 5000)
    this.timer.unref?.()
  }

  save() {
    if (!this.file) return
    const cutoff = dayOf(this.now() - KEEP_DAYS * 86_400_000)
    for (const k of Object.keys(this.days)) if (k < cutoff) delete this.days[k]
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ days: this.days }))
      renameSync(`${this.file}.tmp`, this.file)
    } catch {
      // Counts are a nicety; a full disk shouldn't stop boards saving.
    }
  }
}

/** The usage counts as CSV, one row per day, for a spreadsheet. */
export function usageCsv(r: UsageReport): string {
  const events = Object.keys(r.events) as UsageEvent[]
  const head = ['Day', 'People active', ...events.map((e) => r.events[e])]
  const rows = r.days.map((d) => [d.day, String(d.people), ...events.map((e) => String(d.counts[e] ?? 0))])
  return [head, ...rows].map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'
}

/**
 * What a finished API request counts as, if anything: only requests that worked, by their route.
 * `location` is where a redirect went (single sign-on comes back with one).
 */
export function eventOf(method: string, parts: string[], status: number, location?: string): UsageEvent | null {
  const [, area, id, sub] = parts
  if (area === 'auth') {
    if (id === 'login' && method === 'POST' && status === 200) return 'signin'
    if (id === 'sso' && sub === 'callback' && status === 302 && !String(location ?? '').includes('signin-error')) return 'signin'
    return null
  }
  if (status >= 300) return null
  if (area === 'boards') {
    if (parts.length === 2 && method === 'POST') return 'board.create'
    if (sub === 'ops' && method === 'POST') return 'api'
    if (method === 'GET' && parts[parts.length - 1] === 'export') return 'export'
    return null
  }
  if (area === 'forms' && method === 'POST') return 'form.answer'
  if (area === 'unfurl') return 'preview'
  if (area === 'ai' && method === 'POST') {
    const path = parts.slice(2).join('/')
    if (path === 'v1/messages') return 'ai.claude'
    if (path === 'openai/chat/completions') return 'ai.model'
    if (path === 'command') return 'ai.agent'
    if (path === 'transcribe') return 'transcribe'
  }
  return null
}

export interface BoardStats {
  features: ReturnType<typeof tallyFeatures>
  storage: { boards: number; files: number; total: number; biggest: { id: string; title: string; kind: 'board' | 'wiki'; bytes: number }[] }
}

/** Bytes under a folder, all the way down. */
function sizeOf(dir: string): number {
  let n = 0
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      n += e.isDirectory() ? sizeOf(p) : statSync(p).size
    }
  } catch {
    // Not there yet.
  }
  return n
}

/**
 * Every stored board's features and size. Boards open in a live session are read from memory
 * (`loaded`); the rest from disk, checked the way files are opened (`read`).
 */
export function boardStats(o: { boardsDir: string; filesDir: string; loaded: (id: string) => Board | null; read: (json: string) => Board }): BoardStats {
  const boards: Board[] = []
  const sizes: BoardStats['storage']['biggest'] = []
  let boardBytes = 0
  let names: string[] = []
  try {
    names = readdirSync(o.boardsDir).filter((f) => f.endsWith('.json'))
  } catch {
    // No boards yet.
  }
  for (const f of names) {
    const id = f.slice(0, -5)
    const path = join(o.boardsDir, f)
    let bytes = 0
    try {
      bytes = statSync(path).size
      const b = o.loaded(id) ?? o.read(JSON.stringify((JSON.parse(readFileSync(path, 'utf8')) as { board: unknown }).board))
      boards.push(b)
      sizes.push({ id, title: b.title || 'Untitled', kind: b.kind === 'wiki' ? 'wiki' : 'board', bytes })
    } catch {
      // A board that can't be read is left out of the tally, not the storage.
    }
    boardBytes += bytes
  }
  const files = sizeOf(o.filesDir)
  return {
    features: tallyFeatures(boards),
    storage: { boards: boardBytes, files, total: boardBytes + files, biggest: sizes.sort((a, z) => z.bytes - a.bytes).slice(0, 8) },
  }
}
