/**
 * Changing a wiki over HTTP, page by page, and taking any board out as a file:
 *
 *   POST   /api/boards/:id/pages {title, parent?, before?, text?, icon?, note?}   a new page
 *   PUT    /api/boards/:id/pages/:page {title?, text?, append?, icon?, note?, protected?}
 *   POST   /api/boards/:id/pages/:page/move {parent?, before?}
 *   DELETE /api/boards/:id/pages/:page                                              to the trash
 *   GET    /api/boards/:id/export?format=json|md|html|zip                           the board as a file
 *   GET    /api/boards/:id/pages/:page/export?format=md|html                        one page as a file
 *
 * The writes are the wiki operations (ops.ts) under the hood, so they keep page history the same way
 * and everyone in the live session sees them. The caller has already checked that the asker may
 * view the board; writes check edit here, and `manages: false` keeps protected pages out of reach.
 */

import type { ServerResponse } from 'node:http'
import { OpError, type Op } from '../src/api/ops'
import { getPage as describePage } from '../src/api/queries'
import { maskFor } from '../src/model/brainstorm'
import { boardMarkdown } from '../src/model/boardMarkdown'
import type { Room } from '../src/collab/room'
import { toJson } from '../src/model/serialize'
import type { Board } from '../src/model/types'
import { getPage, isWiki, pageByTitle, pageOrder } from '../src/model/wiki'
import { fileNameFor, pageMarkdown, wikiZip } from '../src/model/wikiFiles'
import { wikiHtml } from '../src/model/wikiHtml'

export interface Asker {
  canEdit: boolean
  /** Whether they manage the board; false keeps them off protected pages (servers with accounts). */
  manages?: boolean
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function file(res: ServerResponse, name: string, type: string, body: string | Uint8Array) {
  // The name as typed (for browsers that read it) and a plain-ASCII one for the rest.
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  res.writeHead(200, { 'content-type': type, 'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'no-store' })
  res.end(body)
}

/** The page a path names: its id, or its exact title. */
const pageRef = (b: Board, ref: string) => {
  const own = getPage(b, ref)
  return own && !own.trashed ? own : pageByTitle(b, ref)
}

/** A whole board's own words, as Markdown: a canvas as an outline, a wiki page after page. */
function boardText(b: Board): string {
  if (!isWiki(b)) return boardMarkdown(b)
  return pageOrder(b)
    .map((p) => pageMarkdown(b, p.id, () => null).trim())
    .join('\n\n---\n\n')
    .concat('\n')
}

/** Answers an export or a wiki write; false when `rest` isn't one of them. */
export async function boardWrite(room: Room, method: string, rest: string[], query: URLSearchParams, body: () => Promise<string>, who: Asker, res: ServerResponse): Promise<boolean> {
  let parts: string[]
  try {
    parts = rest.map(decodeURIComponent)
  } catch {
    return json(res, 400, { error: 'Bad address' }), true
  }
  const b = room.data.board
  const title = fileNameFor(b.title || (isWiki(b) ? 'wiki' : 'board'))

  // ----- exports (reading) ---------------------------------------------------------------------------
  if (method === 'GET' && parts[0] === 'export' && parts.length === 1) {
    const format = (query.get('format') ?? 'json').toLowerCase()
    const shown = maskFor(b, '')
    if (format === 'json') return file(res, `${title}.braincraft`, 'application/json; charset=utf-8', toJson(shown)), true
    if (format === 'md') return file(res, `${title}.md`, 'text/markdown; charset=utf-8', boardText(shown)), true
    if (!isWiki(b)) return json(res, 400, { error: 'A canvas exports as json or md (pictures and PDFs come from the app)' }), true
    if (format === 'html') return file(res, `${title}.html`, 'text/html; charset=utf-8', wikiHtml(b)), true
    if (format === 'zip') return file(res, `${title}.zip`, 'application/zip', wikiZip(b, () => null)), true
    return json(res, 400, { error: 'Formats: json, md, html, zip' }), true
  }
  if (method === 'GET' && parts[0] === 'pages' && parts[2] === 'export' && parts.length === 3) {
    if (!isWiki(b)) return json(res, 409, { error: 'This board is a canvas, not a wiki' }), true
    const page = pageRef(b, parts[1])
    if (!page) return json(res, 404, { error: 'No page with that id or title' }), true
    const format = (query.get('format') ?? 'md').toLowerCase()
    const name = fileNameFor(page.title)
    if (format === 'md') return file(res, `${name}.md`, 'text/markdown; charset=utf-8', pageMarkdown(b, page.id, () => null)), true
    if (format === 'html') return file(res, `${name}.html`, 'text/html; charset=utf-8', wikiHtml(b, { pages: [page.id] })), true
    return json(res, 400, { error: 'Formats: md, html' }), true
  }

  // ----- writing pages ---------------------------------------------------------------------------------
  if (parts[0] !== 'pages' || method === 'GET') return false
  if (!isWiki(b)) return json(res, 409, { error: 'This board is a canvas, not a wiki: change it with /ops' }), true
  if (!who.canEdit) return json(res, 403, { error: 'You can only view this wiki' }), true
  let input: Record<string, unknown> = {}
  if (method !== 'DELETE') {
    try {
      const raw = (await body()) || '{}'
      const v = JSON.parse(raw) as unknown
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
      input = v as Record<string, unknown>
    } catch {
      return json(res, 400, { error: 'Send a JSON object' }), true
    }
  }
  const pick = (...keys: string[]) => Object.fromEntries(keys.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]))
  let op: Op
  let status = 200
  if (method === 'POST' && parts.length === 1) {
    op = { op: 'createPage', ...pick('title', 'parent', 'before', 'text', 'icon', 'note') } as Op
    status = 201
  } else {
    const page = parts[1] ? pageRef(b, parts[1]) : undefined
    if (!page) return json(res, 404, { error: 'No page with that id or title' }), true
    if (method === 'PUT' && parts.length === 2) op = { op: 'updatePage', page: page.id, ...pick('title', 'text', 'append', 'icon', 'note', 'protected') } as Op
    else if (method === 'POST' && parts[2] === 'move' && parts.length === 3) op = { op: 'movePage', page: page.id, ...pick('parent', 'before') } as Op
    else if (method === 'DELETE' && parts.length === 2) op = { op: 'deletePage', page: page.id }
    else return json(res, 405, { error: 'Method not allowed' }), true
    // Only the wiki's managers may protect pages or lift protection.
    if ('protected' in op && who.manages === false) return json(res, 403, { error: 'Only people who manage this wiki can protect pages' }), true
  }
  try {
    const [result] = room.applyOps([op], { manages: who.manages })
    const id = result.page!
    if (op.op === 'deletePage') return json(res, 200, { page: id, trashed: true }), true
    return json(res, status, describePage(room.data.board, id)), true
  } catch (err) {
    if (err instanceof OpError) return json(res, /manage this wiki/.test(err.message) ? 403 : 422, { error: err.message.replace(/^Operation 1 \(\w+\): /, '') }), true
    throw err
  }
}
