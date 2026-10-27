/**
 * The activity log of a server with accounts: what admins changed (people, groups, who has which
 * board), sign-ins, API tokens, passwords, and admins opening boards nobody shared with them.
 *
 * It lives in `DATA/accounts/audit.jsonl`, one entry per line, and is only ever added to. Each
 * entry carries the hash of the one before it, so an entry edited or removed by hand shows up when
 * the log is checked. Past 10 MB the file is set aside as `audit-<first entry>.jsonl` and a new one
 * carries on the chain; nothing is ever deleted.
 */

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** What each action is about, for filtering. */
export const AUDIT_ACTIONS = {
  'server.setup': 'people',
  'user.add': 'people',
  'user.change': 'people',
  'user.remove': 'people',
  'user.reset-link': 'people',
  'user.promote': 'people',
  'group.add': 'people',
  'group.change': 'people',
  'group.remove': 'people',
  'audit.download': 'people',
  signin: 'signin',
  'signin.failed': 'signin',
  signout: 'signin',
  'sso.new-account': 'signin',
  'sso.linked': 'signin',
  'board.access': 'boards',
  'board.owner': 'boards',
  'board.delete': 'boards',
  'board.open-as-admin': 'boards',
  'board.restore': 'boards',
  'board.undelete': 'boards',
  'backup.download': 'settings',
  'token.create': 'security',
  'token.revoke': 'security',
  'password.change': 'security',
  'password.reset': 'security',
  'settings.change': 'settings',
} as const

export type AuditAction = keyof typeof AUDIT_ACTIONS
export type AuditKind = (typeof AUDIT_ACTIONS)[AuditAction]
export const AUDIT_KINDS: AuditKind[] = ['people', 'signin', 'boards', 'security', 'settings']

/** Who did it, as they were then (so it still reads right after they're renamed or removed). */
export interface Actor {
  id: string
  name: string
  email: string
  admin?: true
}

export interface AuditTarget {
  kind: 'user' | 'group' | 'board' | 'token' | 'server'
  id: string
  name?: string
}

export interface AuditEntry {
  /** 1, 2, 3… across every file. */
  n: number
  at: number
  action: AuditAction
  /** Null when nobody was signed in (a failed sign-in) or the server did it itself. */
  by: Actor | null
  ip?: string
  target?: AuditTarget
  /** In words, for people reading the log. */
  text: string
  /** What changed, field by field: [before, after]. */
  changes?: Record<string, [string, string]>
  /** The hash of the entry before (empty for the very first). */
  prev: string
  hash: string
}

export type AuditInput = Omit<AuditEntry, 'n' | 'at' | 'prev' | 'hash'>

export interface AuditQuery {
  /** Entries before this number (for "older"). */
  before?: number
  limit?: number
  kind?: AuditKind
  /** Only what admins did. */
  admins?: boolean
  /** Words to find in the text, the names or the emails. */
  q?: string
}

const FILE = 'audit.jsonl'
/** Bigger than this, the file is set aside and a new one begun. */
export const AUDIT_ROTATE_BYTES = 10 * 1024 * 1024
/** A long value (a big access list) is cut to this many characters. */
const VALUE_MAX = 2000

const hashOf = (e: Omit<AuditEntry, 'hash'>) => createHash('sha256').update(`${e.prev}\n${JSON.stringify(e)}`).digest('base64url')

const clip = (s: string) => (s.length > VALUE_MAX ? `${s.slice(0, VALUE_MAX)}…` : s)

function parseLines(text: string): (AuditEntry | null)[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        const e = JSON.parse(l) as AuditEntry
        return e && typeof e.n === 'number' && typeof e.hash === 'string' ? e : null
      } catch {
        return null
      }
    })
}

export class AuditLog {
  private dir: string
  private now: () => number
  private rotateAt: number
  private last: { n: number; hash: string } = { n: 0, hash: '' }

  constructor(dir: string, now: () => number = Date.now, rotateAt = AUDIT_ROTATE_BYTES) {
    this.dir = dir
    this.now = now
    this.rotateAt = rotateAt
    const path = join(dir, FILE)
    let text = existsSync(path) ? readFileSync(path, 'utf8') : ''
    // A line half-written when the server stopped: start the next one on its own line.
    if (text && !text.endsWith('\n')) {
      appendFileSync(path, '\n')
      text += '\n'
    }
    const files = this.files()
    for (let i = files.length - 1; i >= 0 && !this.last.n; i--) {
      const entries = parseLines(i === files.length - 1 ? text : readFileSync(join(dir, files[i]), 'utf8'))
      const end = entries.findLast((e) => e)
      if (end) this.last = { n: end.n, hash: end.hash }
    }
  }

  /** The log's files, oldest first (the set-aside ones, then the current one). */
  files(): string[] {
    const old = existsSync(this.dir) ? readdirSync(this.dir).filter((f) => /^audit-\d+\.jsonl$/.test(f)).sort() : []
    return existsSync(join(this.dir, FILE)) ? [...old, FILE] : old
  }

  /** Adds an entry; never throws (a full disk shouldn't stop people working), but says so. */
  record(input: AuditInput): AuditEntry {
    const body: Omit<AuditEntry, 'hash'> = {
      n: this.last.n + 1,
      at: this.now(),
      action: input.action,
      by: input.by,
      ...(input.ip ? { ip: input.ip } : {}),
      ...(input.target ? { target: input.target } : {}),
      text: clip(input.text),
      ...(input.changes && Object.keys(input.changes).length
        ? { changes: Object.fromEntries(Object.entries(input.changes).map(([k, [a, b]]) => [k, [clip(a), clip(b)]])) }
        : {}),
      prev: this.last.hash,
    }
    const entry: AuditEntry = { ...body, hash: hashOf(body) }
    try {
      const path = join(this.dir, FILE)
      if (existsSync(path) && statSync(path).size > this.rotateAt) renameSync(path, join(this.dir, `audit-${String(body.n).padStart(10, '0')}.jsonl`))
      appendFileSync(path, `${JSON.stringify(entry)}\n`)
      this.last = { n: entry.n, hash: entry.hash }
    } catch (err) {
      console.error(`Couldn't write to the activity log: ${(err as Error).message}`)
    }
    return entry
  }

  /** The newest entries that match, newest first, and whether there are older ones. */
  query(q: AuditQuery = {}): { entries: AuditEntry[]; more: boolean } {
    const limit = Math.max(1, Math.min(500, q.limit ?? 100))
    const words = (q.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const fits = (e: AuditEntry) =>
      (q.before === undefined || e.n < q.before) &&
      (!q.kind || AUDIT_ACTIONS[e.action] === q.kind) &&
      (!q.admins || !!e.by?.admin) &&
      (!words.length ||
        words.every((w) => [e.text, e.by?.name, e.by?.email, e.target?.name, e.action, e.ip].some((s) => s?.toLowerCase().includes(w))))
    const out: AuditEntry[] = []
    const files = this.files()
    for (let i = files.length - 1; i >= 0; i--) {
      const entries = parseLines(readFileSync(join(this.dir, files[i]), 'utf8'))
      for (let j = entries.length - 1; j >= 0; j--) {
        const e = entries[j]
        if (!e || !fits(e)) continue
        if (out.length === limit) return { entries: out, more: true }
        out.push(e)
      }
    }
    return { entries: out, more: false }
  }

  /** Walks the whole chain: whether every entry is there and unchanged, and where it first isn't. */
  verify(): { ok: boolean; count: number; brokenAt?: number } {
    let prev = ''
    let n = 0
    for (const f of this.files()) {
      for (const e of parseLines(readFileSync(join(this.dir, f), 'utf8'))) {
        if (!e) return { ok: false, count: n, brokenAt: n + 1 }
        const { hash, ...body } = e
        if (e.n !== n + 1 || e.prev !== prev || hashOf(body) !== hash) return { ok: false, count: n, brokenAt: n + 1 }
        prev = hash
        n = e.n
      }
    }
    return { ok: true, count: n }
  }

  /** Every file, oldest first, as one download. */
  all(): string {
    return this.files()
      .map((f) => readFileSync(join(this.dir, f), 'utf8'))
      .join('')
  }
}

// ----- describing changes -----------------------------------------------------------------------------

/** A value as the log shows it. */
export const shown = (v: unknown): string =>
  v === undefined || v === null || v === false ? 'no' : v === true ? 'yes' : Array.isArray(v) ? (v.length ? v.map(String).join(', ') : 'none') : String(v)

/** The fields that differ between two snapshots, as [before, after] words. */
export function changesOf(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {}
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = shown(before[k])
    const b = shown(after[k])
    if (a !== b) out[k] = [a, b]
  }
  return out
}

/** "role user → admin; groups none → Planners". */
export const changeText = (c: Record<string, [string, string]>, labels: Record<string, string> = {}) =>
  Object.entries(c)
    .map(([k, [a, b]]) => `${labels[k] ?? k} ${a} → ${b}`)
    .join('; ')
