/** Read-only questions about a board, shared by `window.BrainCraft` and the MCP server. */

import * as B from '../model/board'
import * as D from '../model/dataset'
import { toMermaid } from '../model/mermaid'
import { toOutline } from '../model/mindmap'
import { objectLabel, plainNote } from '../model/notes'
import { search } from '../model/search'
import { toCsv } from '../model/table'
import type { Board, Id, Item, Kind } from '../model/types'

export interface ObjectSummary {
  id: Id
  kind: Kind
  label: string
  x: number
  y: number
  w: number
  h: number
  commentCount: number
}

export interface ObjectDetail extends ObjectSummary {
  text: string
  description?: string
  comments: { text: string; at: string; author?: string }[]
  data?: unknown
}

export const summary = (i: Item): ObjectSummary => ({
  id: i.id,
  kind: i.kind,
  label: objectLabel(i),
  x: Math.round(i.x),
  y: Math.round(i.y),
  w: Math.round(i.w),
  h: Math.round(i.h),
  commentCount: i.notes?.length ?? 0,
})

export function listObjects(b: Board, kind?: Kind): ObjectSummary[] {
  return b.items.filter((i) => !kind || i.kind === kind).map(summary)
}

export function getObject(b: Board, id: Id): ObjectDetail | null {
  const i = B.getItem(b, id)
  if (!i) return null
  return {
    ...summary(i),
    text: i.text,
    ...(i.description ? { description: plainNote(i.description) } : {}),
    comments: (i.notes ?? []).map((n) => ({ text: plainNote(n.text), at: new Date(n.at).toISOString(), ...(n.author ? { author: n.author } : {}) })),
    data: i.view
      ? dataOf(b, i)
      : i.table
      ? { csv: toCsv(i.table) }
      : (i.kanban ??
        i.timeline ??
        (i.kind === 'mind' ? { outline: toOutline(b, i.id) } : i.runs?.length ? { runs: i.runs.map((r) => ({ ...r, startedAt: new Date(r.startedAt).toISOString(), endedAt: new Date(r.endedAt).toISOString() })) } : undefined)),
  }
}

/** A database view: its settings and every record of its dataset by field name. */
function dataOf(b: Board, i: Item) {
  const ds = D.getDataset(b, i.view!.dataset)
  if (!ds) return undefined
  const v = i.view!
  const name = (id?: string) => D.fieldById(ds, id)?.name
  return {
    dataset: ds.name,
    view: { type: v.type, ...(v.groupBy ? { groupBy: name(v.groupBy) } : {}), ...(v.sort ? { sort: `${name(v.sort.field)} ${v.sort.dir}` } : {}), ...(v.query ? { search: v.query } : {}) },
    fields: ds.fields.map((f) => ({ name: f.name, type: f.type, ...(f.options ? { options: f.options.map((o) => o.name) } : {}) })),
    records: D.plainRecords(ds),
    otherViews: D.viewsOf(b, ds.id).filter((x) => x.id !== i.id).map((x) => ({ id: x.id, type: x.view!.type })),
  }
}

export function findObjects(b: Board, query: string) {
  return search(b, query).map((r) => ({ id: r.id, kind: r.kind, label: r.title, where: r.where, snippet: r.snippet }))
}

export function mermaidOf(b: Board, ids?: Id[]): string {
  return toMermaid(b, ids ? new Set(ids) : undefined)
}

/** The lines between objects, by label, for describing a board's structure. */
export function listLinks(b: Board) {
  return b.connectors.map((c) => ({
    id: c.id,
    from: c.from,
    to: c.to,
    ...(c.label ? { label: c.label } : {}),
  }))
}

/** A compact description of the whole board: what an assistant reads first. */
export function describeBoard(b: Board, kind?: Kind) {
  const counts: Partial<Record<Kind, number>> = {}
  for (const i of b.items) counts[i.kind] = (counts[i.kind] ?? 0) + 1
  return {
    title: b.title,
    counts,
    objects: listObjects(b, kind),
    links: kind ? undefined : listLinks(b),
  }
}
