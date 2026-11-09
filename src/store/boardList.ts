/**
 * Your boards as one list: the boards kept in this browser and, on a server with accounts, the
 * boards there you can open. A server board you've opened here is one entry, not two.
 */

import type { ServerBoard } from './account'
import type { BoardMeta } from './library'
import { nested } from './nest'

export interface BoardEntry {
  /** Unique in the list: the browser's id, or the server's for a board not opened here yet. */
  key: string
  title: string
  icon?: string
  kind?: 'wiki'
  /** Last edited, here or on the server, whichever is later. */
  updated: number
  /** When you last opened it here (for one never opened here: when it was last edited). */
  opened: number
  /** The copy in this browser (with its thumbnail), if it has been opened here. */
  local?: BoardMeta
  /** The board on the server, if it is one. */
  server?: ServerBoard
  /** The board it was divided from (a key of another entry). */
  parent?: string
  /** Your category for it, if you've put it in one. */
  category?: string
}

export type BoardFilter = 'all' | 'boards' | 'wikis' | 'shared'
export type BoardSort = 'recent' | 'name'

/**
 * Merges the two lists, newest first. `categories` are those kept in this browser, by its board ids
 * (a board on the server keeps its category there instead).
 */
export function boardEntries(local: readonly BoardMeta[], server: readonly ServerBoard[], serverUrl?: string, categories: Readonly<Record<string, string>> = {}): BoardEntry[] {
  const onServer = new Map(server.map((s) => [s.id, s]))
  const out: BoardEntry[] = []
  const matched = new Set<string>()
  for (const b of local) {
    const s = b.live?.account && b.live.server === serverUrl ? onServer.get(b.live.id) : undefined
    if (s) matched.add(s.id)
    // A friend may have renamed it since this browser last had it open.
    const newer = s && s.updated > b.updated
    out.push({
      key: b.id,
      title: newer ? s.title : b.title,
      icon: b.icon,
      kind: b.kind ?? s?.kind,
      updated: Math.max(b.updated, s?.updated ?? 0),
      opened: b.opened ?? b.updated,
      local: b,
      server: s,
      parent: b.parent ?? s?.parent,
      ...((s ? s.category : categories[b.id]) ? { category: s ? s.category : categories[b.id] } : {}),
    })
  }
  for (const s of server)
    if (!matched.has(s.id)) out.push({ key: `server:${s.id}`, title: s.title, kind: s.kind, updated: s.updated, opened: s.updated, server: s, parent: s.parent, ...(s.category ? { category: s.category } : {}) })
  return out.sort((p, q) => q.updated - p.updated)
}

/** The last opened first: what Recent shows. (A friend editing a board doesn't move it.) */
export const byOpened = (all: readonly BoardEntry[]): BoardEntry[] => [...all].sort((p, q) => q.opened - p.opened)

/** The keys another board may use to name this one as its parent. */
export const keysOf = (e: BoardEntry): string[] => [e.key, ...(e.local?.live ? [e.local.live.id] : []), ...(e.server ? [e.server.id] : [])]

/** Whether it's someone else's board, shared with you. */
export const sharedWithMe = (e: BoardEntry, me: string | undefined) => !!e.server?.owner && e.server.owner.id !== me

/** Every category in use, by name, with how many boards are in it. */
export function categoriesOf(all: readonly BoardEntry[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const e of all) if (e.category) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, z) => a.name.localeCompare(z.name, undefined, { sensitivity: 'base', numeric: true }))
}

/**
 * What the list shows for a search, a filter, a category (null: those in none) and an order. Sorted
 * by name, child boards follow their parent.
 */
export function shownEntries(all: readonly BoardEntry[], o: { query?: string; filter?: BoardFilter; sort?: BoardSort; me?: string; category?: string | null }): { entry: BoardEntry; depth: number }[] {
  const q = o.query?.trim().toLowerCase() ?? ''
  const list = all.filter(
    (e) =>
      (!q || e.title.toLowerCase().includes(q)) &&
      (o.category === undefined || (o.category === null ? !e.category : e.category === o.category)) &&
      (o.filter === 'boards' ? e.kind !== 'wiki' : o.filter === 'wikis' ? e.kind === 'wiki' : o.filter === 'shared' ? sharedWithMe(e, o.me) : true),
  )
  if (o.sort !== 'name') return list.map((entry) => ({ entry, depth: 0 }))
  const byName = [...list].sort((p, q) => (p.title || 'Untitled').localeCompare(q.title || 'Untitled', undefined, { sensitivity: 'base', numeric: true }))
  return nested(byName, keysOf, (e) => e.parent).map(({ item, depth }) => ({ entry: item, depth }))
}
