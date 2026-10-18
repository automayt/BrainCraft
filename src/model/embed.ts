/**
 * Canvas objects shown inside wiki pages: `![[Label|height]](board:KEY#ID)` embeds an object (a
 * frame with what's in it, a mind map, a table…) and `![[Board]](board:KEY)` a whole board.
 * A wiki keeps a small snapshot of each, so friends who don't have the board still see it.
 */

import { getItem, itemsWithin, subtree } from './board'
import { maskFor } from './brainstorm'
import type { Board, Id, Item, Snap } from './types'

export type { Snap }

/** Objects a snapshot may hold, and the longest picture it keeps. */
export const SNAP_MAX_ITEMS = 300
export const SNAP_MAX_SRC = 200_000
/** All the pictures in one snapshot together. */
export const SNAP_MAX_TOTAL = 1_000_000
/** Records of one database a snapshot keeps. */
export const SNAP_MAX_RECORDS = 500

/** The Markdown line that embeds `item` of `board` (or the whole board) in a page. */
export const embedToken = (label: string, board: string, item?: Id) =>
  `![[${label.replace(/[[\]|\n]/g, ' ').replace(/\s+/g, ' ').trim()}]](board:${board}${item !== undefined ? `#${item}` : ''})`

export const snapKey =(board: string, item?: Id) => (item === undefined ? board : `${board}#${item}`)
export const isSnapKey = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}(#\d{1,16})?$/.test(v)

/**
 * What embedding `id` shows: a frame with everything in it, a mind map's branch, a timeline with
 * the Kanban boards it follows. Unlike moving, locked objects count (a locked background is part
 * of the picture).
 */
export function embedSet(b: Board, id: Id): Set<Id> {
  const item = getItem(b, id)
  const out = new Set<Id>()
  if (!item) return out
  out.add(id)
  if (item.kind === 'frame') for (const x of itemsWithin(b, item, new Set())) out.add(x)
  for (const x of Array.from(out)) {
    const i = getItem(b, x)
    if (i?.kind === 'mind') for (const d of subtree(b, x)) out.add(d)
  }
  for (const x of Array.from(out)) for (const s of getItem(b, x)?.timeline?.sources ?? []) if (getItem(b, s)) out.add(s)
  return out
}

/** The part of a board an embed shows (the whole board when `id` is missing), or null if it's gone. */
export function embedBoard(b: Board, id?: Id): Board | null {
  if (id === undefined) return b
  const keep = embedSet(b, id)
  if (!keep.size) return null
  const items = b.items.filter((i) => keep.has(i.id))
  const sets = new Set(items.flatMap((i) => (i.view ? [i.view.dataset] : [])))
  const datasets = (b.datasets ?? []).filter((d) => sets.has(d.id))
  return {
    ...b,
    items,
    connectors: b.connectors.filter((c) => keep.has(c.from) && keep.has(c.to)),
    ...(datasets.length ? { datasets } : { datasets: undefined }),
  }
}

/**
 * A snapshot to keep in a wiki: every unrevealed brainstorm note blanked (yours too: friends will
 * see it), big pictures left out, and no more than `SNAP_MAX_ITEMS` objects.
 */
export function makeSnap(source: Board, board: string, item: Id | undefined, at: number, by?: string): Snap | null {
  const part = embedBoard(maskFor(source, ''), item)
  if (!part) return null
  // Pictures until they'd make the snapshot heavy; the rest show as empty frames.
  let budget = SNAP_MAX_TOTAL
  const items = part.items.slice(0, SNAP_MAX_ITEMS).map((i) => {
    // What the picture shows, not the conversation around it: comments, notes and votes stay on the board.
    const light: Item = { ...i }
    for (const k of SNAP_DROP) delete light[k]
    if (light.src && (light.src.length > SNAP_MAX_SRC || light.src.length > budget)) delete light.src
    else if (light.src) budget -= light.src.length
    return light
  })
  const kept = new Set(items.map((i) => i.id))
  // Only the datasets the kept views show, and not every record of a big one.
  const shown = new Set(items.flatMap((i) => (i.view ? [i.view.dataset] : [])))
  const datasets = (part.datasets ?? []).filter((d) => shown.has(d.id)).map((d) => (d.records.length > SNAP_MAX_RECORDS ? { ...d, records: d.records.slice(0, SNAP_MAX_RECORDS) } : d))
  return {
    key: snapKey(board, item),
    at,
    ...(by ? { by } : {}),
    items,
    connectors: part.connectors.filter((c) => kept.has(c.from) && kept.has(c.to)),
    ...(datasets.length ? { datasets } : {}),
  }
}

/** Fields a snapshot leaves out: talk about an object rather than the object. */
const SNAP_DROP = ['notes', 'description', 'reactions', 'votes', 'runs', 'by'] as const

/** A snapshot as a board to draw. */
export const snapBoard = (s: Snap, title = ''): Board => ({ version: 1, title, items: s.items, connectors: s.connectors, nextId: 1, ...(s.datasets ? { datasets: s.datasets } : {}) })

export const getSnap = (b: Board, key: string) => b.snaps?.find((s) => s.key === key)

/** Puts (or replaces) a snapshot in the wiki. */
export function setSnap(b: Board, snap: Snap): Board {
  const list = b.snaps ?? []
  return { ...b, snaps: list.some((s) => s.key === snap.key) ? list.map((s) => (s.key === snap.key ? snap : s)) : [...list, snap] }
}

/** Snapshots no page embeds any more. */
export function unusedSnaps(b: Board, used: ReadonlySet<string>): string[] {
  return (b.snaps ?? []).filter((s) => !used.has(s.key)).map((s) => s.key)
}
