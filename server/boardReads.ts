/**
 * Reading a board over HTTP, the same answers the MCP tools and `window.BrainCraft` give:
 *
 *   GET /api/boards/:id/objects[?kind=]           what's on it (a wiki: its pages)
 *   GET /api/boards/:id/objects/:objectId         one object in full
 *   GET /api/boards/:id/search?q=                 search everything on it
 *   GET /api/boards/:id/mermaid[?ids=1,2]         its flowcharts as Mermaid (text)
 *   GET /api/boards/:id/pages                     a wiki's page tree
 *   GET /api/boards/:id/pages/:page[?version=]    one page (id or exact title), or a saved version
 *   GET /api/boards/:id/pages/:page/history       a page's versions
 *   GET /api/boards/:id/time[?from=&to=&who=&format=csv]   time tracked on it
 *
 * Shared by key-shared boards and boards on a server with accounts; the caller has already
 * checked that the asker may at least view the board. Hidden brainstorm notes stay blank: an API
 * caller is nobody's own writer.
 */

import type { ServerResponse } from 'node:http'
import { describeBoard, findObjects, getObject, getPage, listPages, mermaidOf, pageHistory, pageVersion, timeReport } from '../src/api/queries'
import { summarize, timeCsv } from '../src/model/timeTracking'
import { maskFor } from '../src/model/brainstorm'
import { KIND_LABELS, type Board, type Kind } from '../src/model/types'
import { isWiki } from '../src/model/wiki'

export interface ReadReply {
  status: number
  body?: unknown
  /** A plain-text answer instead of JSON. */
  text?: string
}

/** Sends a read's answer. */
export function sendRead(res: ServerResponse, r: ReadReply) {
  const text = r.text !== undefined
  res.writeHead(r.status, { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text ? r.text : JSON.stringify(r.body))
}

/** The sub-routes this answers (after /api/boards/:id/). */
export const READ_ROUTES = new Set(['objects', 'search', 'mermaid', 'pages', 'time'])

const notWiki = { status: 409, body: { error: 'This board is a canvas, not a wiki: read it with /objects' } }

/** Answers a read of the board; null when `rest` isn't one of these routes. */
export function readBoard(raw: Board, rest: string[], q: URLSearchParams): ReadReply | null {
  if (!READ_ROUTES.has(rest[0])) return null
  const board = maskFor(raw, '')
  let parts: string[]
  try {
    parts = rest.map(decodeURIComponent)
  } catch {
    return { status: 400, body: { error: 'Bad address' } }
  }
  const [what, sub, extra] = parts

  if (what === 'objects' && !sub) {
    const kind = q.get('kind')
    if (kind && !Object.hasOwn(KIND_LABELS, kind)) return { status: 400, body: { error: `Unknown kind "${kind}". Kinds: ${Object.keys(KIND_LABELS).join(', ')}` } }
    return { status: 200, body: describeBoard(board, (kind as Kind) || undefined) }
  }
  if (what === 'objects' && sub && !extra) {
    const id = Number(sub)
    const o = Number.isInteger(id) ? getObject(board, id) : null
    return o ? { status: 200, body: o } : { status: 404, body: { error: 'No object with that id on this board' } }
  }
  if (what === 'search' && !sub) {
    const query = (q.get('q') ?? '').trim()
    if (!query) return { status: 400, body: { error: 'Say what to look for: ?q=words' } }
    return { status: 200, body: { query, results: findObjects(board, query.slice(0, 200)) } }
  }
  if (what === 'mermaid' && !sub) {
    const ids = q.get('ids')?.split(',').map(Number).filter(Number.isInteger)
    return { status: 200, text: mermaidOf(board, ids?.length ? ids : undefined) }
  }
  if (what === 'time' && !sub) {
    const f = { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, who: q.get('who') ?? undefined }
    for (const k of ['from', 'to'] as const) if (f[k] && !Number.isFinite(Date.parse(f[k]!))) return { status: 400, body: { error: `"${k}" should be a date, like 2026-10-27` } }
    if (q.get('format') === 'csv') {
      const at = (s: string | undefined) => (s ? Date.parse(s) : undefined)
      const s = summarize(board, { from: at(f.from), to: at(f.to), ...(f.who ? { who: { name: f.who } } : {}) }, Date.now())
      return { status: 200, text: timeCsv(board, s) }
    }
    return { status: 200, body: timeReport(board, f) }
  }
  if (what === 'pages') {
    if (!isWiki(board)) return notWiki
    if (!sub) return { status: 200, body: listPages(board) }
    const ref = sub
    if (extra === 'history' && parts.length === 3) {
      const h = pageHistory(board, ref)
      return h ? { status: 200, body: h } : { status: 404, body: { error: 'No page with that id or title' } }
    }
    if (extra) return { status: 404, body: { error: 'Not found' } }
    const version = q.get('version')
    if (version !== null) {
      const v = pageVersion(board, ref, Number(version))
      if (v === null) return { status: 404, body: { error: 'No page with that id or title' } }
      return typeof v === 'string' ? { status: 404, body: { error: v } } : { status: 200, body: v }
    }
    const p = getPage(board, ref)
    return p ? { status: 200, body: p } : { status: 404, body: { error: 'No page with that id or title' } }
  }
  return { status: 404, body: { error: 'Not found' } }
}
