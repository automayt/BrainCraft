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
}

export type BoardFilter = 'all' | 'boards' | 'wikis' | 'shared'
export type BoardSort = 'recent' | 'name'

/** Merges the two lists, newest first. */
export function boardEntries(local: readonly BoardMeta[], server: readonly ServerBoard[], serverUrl?: string): BoardEntry[] {
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
    })
  }
  for (const s of server) if (!matched.has(s.id)) out.push({ key: `server:${s.id}`, title: s.title, kind: s.kind, updated: s.updated, opened: s.updated, server: s, parent: s.parent })
  return out.sort((p, q) => q.updated - p.updated)
}

/** The last opened first: what Recent shows. (A friend editing a board doesn't move it.) */
export const byOpened = (all: readonly BoardEntry[]): BoardEntry[] => [...all].sort((p, q) => q.opened - p.opened)

/** The keys another board may use to name this one as its parent. */
export const keysOf = (e: BoardEntry): string[] => [e.key, ...(e.local?.live ? [e.local.live.id] : []), ...(e.server ? [e.server.id] : [])]

/** Whether it's someone else's board, shared with you. */
export const sharedWithMe = (e: BoardEntry, me: string | undefined) => !!e.server?.owner && e.server.owner.id !== me

/** What the list shows for a search, a filter and an order. Sorted by name, child boards follow their parent. */
export function shownEntries(all: readonly BoardEntry[], o: { query?: string; filter?: BoardFilter; sort?: BoardSort; me?: string }): { entry: BoardEntry; depth: number }[] {
  const q = o.query?.trim().toLowerCase() ?? ''
  const list = all.filter(
    (e) =>
      (!q || e.title.toLowerCase().includes(q)) &&
      (o.filter === 'boards' ? e.kind !== 'wiki' : o.filter === 'wikis' ? e.kind === 'wiki' : o.filter === 'shared' ? sharedWithMe(e, o.me) : true),
  )
  if (o.sort !== 'name') return list.map((entry) => ({ entry, depth: 0 }))
  const byName = [...list].sort((p, q) => (p.title || 'Untitled').localeCompare(q.title || 'Untitled', undefined, { sensitivity: 'base', numeric: true }))
  return nested(byName, keysOf, (e) => e.parent).map(({ item, depth }) => ({ entry: item, depth }))
}
