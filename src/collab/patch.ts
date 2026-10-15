/**
 * Board changes as small patches: one per object, line, dataset or record that changed.
 * Live collaboration sends these between people (last write wins, per object), and undo
 * applies them in reverse so undoing your own change never undoes someone else's.
 */

import type { Board, Connector, DataRecord, Dataset, Field, Id, Item } from '../model/types'

export interface DatasetMeta {
  id: string
  name: string
  fields: Field[]
  /** Record ids in order. */
  order: string[]
}

export type Patch =
  | { k: 'item'; id: Id; v: Item | null }
  | { k: 'conn'; id: Id; v: Connector | null }
  | { k: 'title'; v: string }
  /** Paint order of the board's items (only sent when the order of existing items changes). */
  | { k: 'order'; v: Id[] }
  | { k: 'ds'; id: string; v: DatasetMeta | null }
  | { k: 'rec'; ds: string; id: string; v: DataRecord | null }

/** What a patch is about: two patches with the same key replace each other. */
export function keyOf(p: Patch): string {
  switch (p.k) {
    case 'item':
      return `i:${p.id}`
    case 'conn':
      return `c:${p.id}`
    case 'title':
      return 'title'
    case 'order':
      return 'order'
    case 'ds':
      return `d:${p.id}`
    case 'rec':
      return `r:${p.ds}:${p.id}`
  }
}

const same = (a: unknown, z: unknown) => a === z || JSON.stringify(a) === JSON.stringify(z)

/** Whether patching `a` into `z` (keeping survivors in place, appending newcomers) gives `z`'s order. */
function landsInOrder<T>(a: T[], z: T[]): boolean {
  const inZ = new Set(z)
  const inA = new Set(a)
  const landed = [...a.filter((x) => inZ.has(x)), ...z.filter((x) => !inA.has(x))]
  return landed.every((x, k) => x === z[k])
}

const metaOf = (d: Dataset): DatasetMeta => ({ id: d.id, name: d.name, fields: d.fields, order: d.records.map((r) => r.id) })

/** The patches that turn board `a` into board `z`. */
export function diff(a: Board, z: Board): Patch[] {
  if (a === z) return []
  const out: Patch[] = []
  if (a.title !== z.title) out.push({ k: 'title', v: z.title })

  if (a.items !== z.items) {
    const before = new Map(a.items.map((i) => [i.id, i]))
    const after = new Set<Id>()
    for (const i of z.items) {
      after.add(i.id)
      const old = before.get(i.id)
      if (old !== i && !same(old, i)) out.push({ k: 'item', id: i.id, v: i })
    }
    for (const i of a.items) if (!after.has(i.id)) out.push({ k: 'item', id: i.id, v: null })
    // New items land on top when patched in; send the order when that wouldn't match.
    const ids = z.items.map((i) => i.id)
    const had = new Set(a.items.map((i) => i.id))
    const landed = [...a.items.map((i) => i.id).filter((id) => after.has(id)), ...ids.filter((id) => !had.has(id))]
    if (landed.some((id, k) => id !== ids[k])) out.push({ k: 'order', v: ids })
  }

  if (a.connectors !== z.connectors) {
    const before = new Map(a.connectors.map((c) => [c.id, c]))
    const after = new Set<Id>()
    for (const c of z.connectors) {
      after.add(c.id)
      const old = before.get(c.id)
      if (old !== c && !same(old, c)) out.push({ k: 'conn', id: c.id, v: c })
    }
    for (const c of a.connectors) if (!after.has(c.id)) out.push({ k: 'conn', id: c.id, v: null })
  }

  if (a.datasets !== z.datasets) {
    const before = new Map((a.datasets ?? []).map((d) => [d.id, d]))
    const after = new Set<string>()
    for (const d of z.datasets ?? []) {
      after.add(d.id)
      const old = before.get(d.id)
      if (old === d) continue
      // A new dataset must exist before its records; an existing one's order goes after them.
      if (!old) out.push({ k: 'ds', id: d.id, v: metaOf(d) })
      const recs = new Map((old?.records ?? []).map((r) => [r.id, r]))
      const kept = new Set<string>()
      for (const r of d.records) {
        kept.add(r.id)
        const was = recs.get(r.id)
        if (was !== r && !same(was, r)) out.push({ k: 'rec', ds: d.id, id: r.id, v: r })
      }
      for (const r of old?.records ?? []) if (!kept.has(r.id)) out.push({ k: 'rec', ds: d.id, id: r.id, v: null })
      if (old && (old.name !== d.name || !same(old.fields, d.fields) || !landsInOrder(old.records.map((r) => r.id), d.records.map((r) => r.id))))
        out.push({ k: 'ds', id: d.id, v: metaOf(d) })
    }
    for (const d of a.datasets ?? []) if (!after.has(d.id)) out.push({ k: 'ds', id: d.id, v: null })
  }
  return out
}

/** Puts `ids` first in that order; anything else keeps its place after them. */
function reorder<T>(list: T[], idOf: (t: T) => string | number, ids: (string | number)[]): T[] {
  const byId = new Map(list.map((x) => [idOf(x), x]))
  const first = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  const placed = new Set(ids)
  return [...first, ...list.filter((x) => !placed.has(idOf(x)))]
}

/** Applies patches in order. Lines whose ends are gone are dropped, the same way everywhere. */
export function applyPatches(b: Board, patches: Patch[]): Board {
  if (!patches.length) return b
  let items = b.items
  let connectors = b.connectors
  let datasets = b.datasets
  let title = b.title
  const setItem = (id: Id, v: Item | null) => {
    const at = items.findIndex((i) => i.id === id)
    if (v === null) {
      if (at >= 0) items = items.filter((i) => i.id !== id)
    } else if (at >= 0) items = items.map((i, k) => (k === at ? v : i))
    else items = [...items, v]
  }
  const setConn = (id: Id, v: Connector | null) => {
    const at = connectors.findIndex((c) => c.id === id)
    if (v === null) {
      if (at >= 0) connectors = connectors.filter((c) => c.id !== id)
    } else if (at >= 0) connectors = connectors.map((c, k) => (k === at ? v : c))
    else connectors = [...connectors, v]
  }
  const setDataset = (id: string, f: (d: Dataset | undefined) => Dataset | null) => {
    const list = datasets ?? []
    const old = list.find((d) => d.id === id)
    const next = f(old)
    if (next === null) datasets = list.filter((d) => d.id !== id)
    else if (old) datasets = list.map((d) => (d.id === id ? next : d))
    else datasets = [...list, next]
  }

  for (const p of patches) {
    switch (p.k) {
      case 'title':
        title = p.v
        break
      case 'item':
        setItem(p.id, p.v)
        break
      case 'conn':
        setConn(p.id, p.v)
        break
      case 'order':
        items = reorder(items, (i) => i.id, p.v)
        break
      case 'ds': {
        const meta = p.v
        setDataset(p.id, (old) =>
          meta === null ? null : { id: meta.id, name: meta.name, fields: meta.fields, records: reorder(old?.records ?? [], (r) => r.id, meta.order) },
        )
        break
      }
      case 'rec': {
        const { id, v } = p
        if (!(datasets ?? []).some((d) => d.id === p.ds)) break
        setDataset(p.ds, (old) => {
          const recs = old!.records
          const at = recs.findIndex((r) => r.id === id)
          const records = v === null ? recs.filter((r) => r.id !== id) : at >= 0 ? recs.map((r, k) => (k === at ? v : r)) : [...recs, v]
          return { ...old!, records }
        })
        break
      }
    }
  }
  const ids = new Set(items.map((i) => i.id))
  if (connectors.some((c) => !ids.has(c.from) || !ids.has(c.to))) connectors = connectors.filter((c) => ids.has(c.from) && ids.has(c.to))
  // nextId stays: in a live session each person hands out ids from their own range.
  const next: Board = { ...b, title, items, connectors }
  if (datasets?.length) next.datasets = datasets
  else delete next.datasets
  return next
}

/** Merges patches so each key appears once (the last one wins), keeping first-seen order. */
export function squash(patches: Patch[]): Patch[] {
  const last = new Map<string, Patch>()
  for (const p of patches) {
    const k = keyOf(p)
    last.delete(k)
    last.set(k, p)
  }
  return [...last.values()]
}
