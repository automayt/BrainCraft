/** Read-only questions about a board, shared by `window.BrainCraft` and the MCP server. */

import { expandTextEmbeds } from '../model/embedText'
import * as B from '../model/board'
import * as D from '../model/dataset'
import { toMermaid } from '../model/mermaid'
import { toOutline } from '../model/mindmap'
import { linksIn, objectLabel, plainNote } from '../model/notes'
import { search } from '../model/search'
import { sceneText } from '../model/excalidraw'
import { toCsv } from '../model/table'
import type { Board, Id, Item, Kind, Status } from '../model/types'
import * as W from '../model/wiki'
import { diffCounts } from '../model/merge'
import * as RV from '../model/revisions'

export interface ObjectSummary {
  id: Id
  kind: Kind
  label: string
  x: number
  y: number
  w: number
  h: number
  commentCount: number
  status?: Status
  /** Someone else's private brainstorm note: blank until the round is revealed, and off limits. */
  hidden?: true
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
  ...(i.status ? { status: i.status } : {}),
  ...(i.masked ? { hidden: true as const } : {}),
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
    data: i.excalidraw
      ? { excalidraw: { elements: i.excalidraw.elements.length, text: sceneText(i.excalidraw) } }
      : i.view
      ? dataOf(b, i)
      : i.table
      ? { csv: toCsv(i.table) }
      : (i.kanban ??
        i.timeline ??
        i.link ??
        (i.kind === 'mind' ? { outline: toOutline(b, i.id) } : i.runs?.length ? { runs: i.runs.map((r) => ({ ...r, startedAt: new Date(r.startedAt).toISOString(), endedAt: new Date(r.endedAt).toISOString() })) } : undefined)),
  }
}

/** A database view: its settings and every record of its dataset by field name. */
function dataOf(b: Board, i: Item) {
  const stored = D.getDataset(b, i.view!.dataset)
  if (!stored) return undefined
  // Links as titles, rollups and formulas worked out.
  const ds = D.withComputed(b, stored)
  const v = i.view!
  const name = (id?: string) => D.fieldById(ds, id)?.name
  return {
    dataset: ds.name,
    view: { type: v.type, ...(v.groupBy ? { groupBy: name(v.groupBy) } : {}), ...(v.sort ? { sort: `${name(v.sort.field)} ${v.sort.dir}` } : {}), ...(v.query ? { search: v.query } : {}) },
    fields: ds.fields.map((f) => ({
      name: f.name,
      type: f.type,
      ...(f.options ? { options: f.options.map((o) => o.name) } : {}),
      ...(f.formula !== undefined ? { formula: f.formula } : {}),
      ...(f.relation ? { linksTo: D.getDataset(b, f.relation.dataset)?.name ?? '?' } : {}),
      ...(f.rollup ? { rollup: `${f.rollup.fn} of ${D.fieldById(ds, f.rollup.relation)?.name ?? '?'}${f.rollup.field ? ` → ${f.rollup.field}` : ''}` } : {}),
    })),
    records: D.plainRecords(ds),
    otherViews: D.viewsOf(b, ds.id).filter((x) => x.id !== i.id).map((x) => ({ id: x.id, type: x.view!.type })),
  }
}

export function findObjects(b: Board, query: string) {
  if (W.isWiki(b)) return W.searchPages(b, query).map((h) => ({ page: h.page.id, title: h.page.title, snippet: h.snippet }))
  return search(b, query).map((r) => ({ id: r.id, kind: r.kind, label: r.title, where: r.where, snippet: r.snippet }))
}

/** A wiki's pages as a tree: ids, titles, who changed each last and how long it is. */
export function listPages(b: Board) {
  const node = (n: W.PageNode): unknown => {
    const body = W.getBody(b, n.page.id)
    return {
      page: n.page.id,
      title: n.page.title,
      ...(n.page.icon ? { icon: n.page.icon } : {}),
      ...(body?.at ? { edited: new Date(body.at).toISOString(), ...(body.by ? { by: body.by } : {}) } : {}),
      characters: body?.text.length ?? 0,
      ...(n.children.length ? { children: n.children.map(node) } : {}),
    }
  }
  return { title: b.title, pages: W.pageTree(b).map(node), trash: W.trashed(b).map((p) => ({ page: p.id, title: p.title })) }
}

const findPage = (b: Board, ref: string) => {
  const own = W.getPage(b, ref)
  return own && !own.trashed ? own : W.pageByTitle(b, ref)
}

/** One saved version of a page (numbered from 1), or a sentence saying why there isn't one. */
export function pageVersion(b: Board, ref: string, version: number) {
  const page = findPage(b, ref)
  if (!page) return null
  const revs = RV.pageRevs(b, page.id)
  const r = revs[version - 1]
  if (!r) return `No version ${version}: this page has ${revs.length} saved version${revs.length === 1 ? '' : 's'}.`
  return { page: page.id, version, title: r.title, text: r.text, saved: new Date(r.at).toISOString(), ...(r.by ? { by: r.by } : {}), ...(r.note ? { note: r.note } : {}), ...(r.keep ? { milestone: true } : {}) }
}

/** One wiki page: where it sits, its Markdown, its sub-pages and the pages linking to it. */
export function getPage(b: Board, ref: string) {
  const page = findPage(b, ref)
  if (!page) return null
  const revs = RV.pageRevs(b, page.id)
  const body = W.getBody(b, page.id)
  return {
    ...(revs.length ? { versions: revs.length, unsavedChanges: RV.unsavedChanges(b, page.id) } : {}),
    page: page.id,
    title: page.title,
    path: W.pagePath(b, page.id).slice(0, -1).map((p) => p.title),
    text: body?.text ?? '',
    // Text embeds (![[Label|text]](board:…)) as what they show now; edit the board, not this.
    ...(body && expandTextEmbeds(b, body.text) !== body.text ? { textEmbedsShow: expandTextEmbeds(b, body.text) } : {}),
    ...(body?.at ? { edited: new Date(body.at).toISOString(), ...(body.by ? { by: body.by } : {}) } : {}),
    children: W.childrenOf(b, page.id).map((p) => ({ page: p.id, title: p.title })),
    linkedFrom: W.pageOrder(b)
      .filter((p) => p.id !== page.id && linksIn(W.pageText(b, p.id)).some((t) => t.page === page.id && !t.board))
      .map((p) => ({ page: p.id, title: p.title })),
  }
}

/** A page's saved versions, newest first: number, when, who, their note and lines added and removed. */
export function pageHistory(b: Board, ref: string) {
  const page = findPage(b, ref)
  if (!page) return null
  const revs = RV.pageRevs(b, page.id)
  return {
    page: page.id,
    title: page.title,
    unsavedChanges: RV.unsavedChanges(b, page.id),
    versions: revs
      .map((r, k) => {
        const c = diffCounts(revs[k - 1]?.text ?? '', r.text)
        return { version: k + 1, saved: new Date(r.at).toISOString(), ...(r.by ? { by: r.by } : {}), ...(r.note ? { note: r.note } : {}), ...(r.keep ? { milestone: true } : {}), added: c.added, removed: c.removed, ...(revs[k - 1] && revs[k - 1].title !== r.title ? { renamedFrom: revs[k - 1].title } : {}) }
      })
      .reverse(),
  }
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
  if (W.isWiki(b)) return { kind: 'wiki', ...listPages(b), note: 'This is a wiki: read pages with read_page, change them with createPage, updatePage, movePage and deletePage.' }
  const counts: Partial<Record<Kind, number>> = {}
  for (const i of b.items) counts[i.kind] = (counts[i.kind] ?? 0) + 1
  return {
    title: b.title,
    counts,
    objects: listObjects(b, kind),
    links: kind ? undefined : listLinks(b),
  }
}
