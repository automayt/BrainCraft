/** Board-wide search across every object and the content inside them. */

import { getItem } from './board'
import { display, getDataset, recordTitle } from './dataset'
import { objectLabel, plainNote } from './notes'
import { statusInfo } from './status'
import { type Board, type Id, type Item, type Kind, KIND_LABELS } from './types'

export interface SearchResult {
  /** The object to select (for connectors, their source). */
  id: Id
  kind: Kind | 'connector'
  /** The object's name. */
  title: string
  /** Where the match is, e.g. "Comment" or "Row 3 · Status". */
  where: string
  /** The matching text. */
  snippet: string
  score: number
}

interface Field {
  where: string
  text: string
}

/** Every searchable piece of text in an item. */
function fields(b: Board, i: Item, seenDatasets: Set<string>): Field[] {
  const out: Field[] = [{ where: i.kind === 'frame' ? 'Title' : 'Text', text: i.text }]
  if (i.description) out.push({ where: 'Description', text: plainNote(i.description) })
  const status = statusInfo(i.status)
  if (status) out.push({ where: 'Status', text: status.label })
  for (const n of i.notes ?? []) out.push({ where: 'Comment', text: plainNote(n.text) })
  if (i.table) {
    const cols = new Map(i.table.columns.map((c) => [c.id, c.name]))
    for (const c of i.table.columns) out.push({ where: 'Column', text: c.name })
    i.table.rows.forEach((r, k) => {
      for (const [col, v] of Object.entries(r.cells)) out.push({ where: `Row ${k + 1} · ${cols.get(col) ?? ''}`, text: v })
    })
  }
  for (const col of i.kanban?.columns ?? []) {
    out.push({ where: 'Column', text: col.title })
    for (const card of col.cards) out.push({ where: `Card in ${col.title}`, text: card.title })
  }
  // A dataset's records are found once, through its first view.
  const ds = getDataset(b, i.view?.dataset)
  if (ds && !seenDatasets.has(ds.id)) {
    seenDatasets.add(ds.id)
    for (const f of ds.fields) out.push({ where: 'Field', text: f.name })
    for (const r of ds.records) {
      const name = recordTitle(ds, r)
      ds.fields.forEach((f, k) => {
        const text = display(ds, f, r.values[f.id])
        if (text && f.type !== 'checkbox') out.push({ where: k === 0 ? 'Record' : `${name} · ${f.name}`, text })
      })
      if (r.body) out.push({ where: `${name} · page`, text: r.body })
    }
  }
  if (i.timeline) {
    for (const l of i.timeline.lanes) out.push({ where: 'Lane', text: l.name })
    for (const e of i.timeline.entries) out.push({ where: `Event · ${e.start}`, text: e.title })
  }
  return out
}

function snippet(text: string, at: number, len: number): string {
  const flat = text.replace(/\s+/g, ' ')
  const start = Math.max(0, at - 30)
  const end = Math.min(flat.length, at + len + 50)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

/**
 * Finds `query` (case-insensitive, all words must appear in one field) in
 * objects, comments, table cells, cards, timeline events and line labels.
 * Best matches first: whole-word and prefix matches in an object's own text
 * rank above matches buried in its content.
 */
export function search(b: Board, query: string, kinds?: ReadonlySet<Kind | 'connector'>, limit = 60): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const results: SearchResult[] = []
  const consider = (id: Id, kind: Kind | 'connector', title: string, f: Field, own: boolean) => {
    const lower = f.text.toLowerCase().replace(/\s+/g, ' ')
    if (!words.every((w) => lower.includes(w))) return
    const at = lower.indexOf(words[0])
    let score = own ? 100 : 50
    if (lower.startsWith(words[0])) score += 30
    if (new RegExp(`\\b${words[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(lower)) score += 15
    score -= Math.min(20, lower.length / 20)
    results.push({ id, kind, title, where: f.where, snippet: snippet(f.text, at, words[0].length), score })
  }
  const seenDatasets = new Set<string>()
  for (const i of b.items) {
    if (kinds && !kinds.has(i.kind)) continue
    const title = objectLabel(i)
    fields(b, i, seenDatasets).forEach((f, k) => f.text && consider(i.id, i.kind, title, f, k === 0))
  }
  if (!kinds || kinds.has('connector')) {
    for (const c of b.connectors) {
      if (!c.label) continue
      const from = getItem(b, c.from)
      const to = getItem(b, c.to)
      const title = `${from ? objectLabel(from) : '?'} → ${to ? objectLabel(to) : '?'}`
      consider(c.from, 'connector', title, { where: 'Line label', text: c.label }, false)
    }
  }
  return results.sort((a, z) => z.score - a.score).slice(0, limit)
}

export interface LookupEntry {
  id: Id
  kind: Kind
  title: string
  notes: number
}

/** All objects grouped by kind, for the object lookup (drawings left out). */
export function lookup(b: Board, kinds?: ReadonlySet<Kind | 'connector'>): LookupEntry[] {
  const order = Object.keys(KIND_LABELS) as Kind[]
  return b.items
    .filter((i) => i.kind !== 'pen' && (!kinds || kinds.has(i.kind)))
    .map((i) => ({ id: i.id, kind: i.kind, title: objectLabel(i), notes: i.notes?.length ?? 0 }))
    .sort((a, z) => order.indexOf(a.kind) - order.indexOf(z.kind) || a.title.localeCompare(z.title))
}
