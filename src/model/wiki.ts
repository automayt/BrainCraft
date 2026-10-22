/**
 * Wikis: pages in a tree, written in Markdown. A wiki is a board with `kind: 'wiki'`, so it is
 * saved, versioned, shared and synced live like any board. These helpers are pure: they take a
 * board and return a new one.
 */

import { emptyBoard } from './board'
import { plainMarkdown } from './markdown'
import type { Board, Page, PageBody } from './types'
import { uid } from './uid'

/** Pages a wiki may hold, and characters a page may hold. */
export const MAX_PAGES = 5_000
export const BODY_MAX = 200_000
/** How deep pages nest (the top level is 0). */
export const MAX_NESTING = 63
/** All the pages' words together, so a wiki stays small enough to save and send. */
export const WIKI_TEXT_MAX = 20_000_000
/** Embed snapshots one wiki keeps. */
export const MAX_SNAPS = 1_000

/** Page ids: short, URL-safe, never an object's own property names. */
export const isPageId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v) && v !== '__proto__' && v !== 'constructor' && v !== 'prototype'

export const isWiki = (b: Board) => b.kind === 'wiki'

/** A new wiki with one page to start on. */
export function emptyWiki(title = 'Untitled wiki', now = Date.now()): Board {
  const home: Page = { id: uid(), rank: 1, title: 'Home', created: now }
  return {
    ...emptyBoard(title),
    kind: 'wiki',
    pages: [home],
    bodies: [{ id: home.id, text: `# ${title}\n\nStart writing here: press Edit, or double-click the page.\n\n- Type / at the start of a line for headings, checklists, tables and things from your boards\n- Type [[ to link to another page\n- Add more pages in the page list\n`, at: now }],
  }
}

/** A new board or wiki, empty, for changes that make one (a new wiki has no pages until they add some). */
export function blankBoard(kind: 'wiki' | 'board', title: string): Board {
  const b: Board = { version: 1, title: title.trim().slice(0, 200) || (kind === 'wiki' ? 'Untitled wiki' : 'Untitled board'), items: [], connectors: [], nextId: 1 }
  return kind === 'wiki' ? { ...b, kind: 'wiki', pages: [], bodies: [] } : b
}

export const getPage = (b: Board, id: string | undefined): Page | undefined => (id === undefined || !b.pages ? undefined : tree(b).byId.get(id))

const bodyMaps = new WeakMap<PageBody[], Map<string, PageBody>>()
export function getBody(b: Board, id: string): PageBody | undefined {
  const list = b.bodies
  if (!list) return undefined
  let map = bodyMaps.get(list)
  if (!map) bodyMaps.set(list, (map = new Map(list.map((x) => [x.id, x]))))
  return map.get(id)
}
export const pageText = (b: Board, id: string) => getBody(b, id)?.text ?? ''

const byRank = (a: Page, z: Page) => a.rank - z.rank || (a.id < z.id ? -1 : a.id > z.id ? 1 : 0)

/**
 * The page a page really sits under: its parent if that exists and isn't (through its own
 * parents) the page itself. Two friends nesting A under B and B under A at once leave both at the
 * top, rather than in a loop nobody can see.
 */
export function parentOf(b: Board, page: Page): string | undefined {
  return tree(b).parent.get(page.id)
}

/** Each page's real parent and each parent's sub-pages in order, worked out once per list of pages. */
interface Tree {
  byId: Map<string, Page>
  parent: Map<string, string | undefined>
  /** Sub-pages by parent ('' for the top level), in order, trash included. */
  kids: Map<string, Page[]>
}

const trees = new WeakMap<Page[], Tree>()

function tree(b: Board): Tree {
  const pages = b.pages ?? []
  const known = trees.get(pages)
  if (known) return known
  const byId = new Map(pages.map((p) => [p.id, p]))
  const parent = new Map<string, string | undefined>()
  for (const p of pages) {
    let ok = p.parent !== undefined && byId.has(p.parent)
    if (ok) {
      // Up through the parents: coming back round to this page means a loop.
      const seen = new Set<string>()
      let at = byId.get(p.parent!)
      while (at) {
        if (at.id === p.id) {
          ok = false
          break
        }
        if (seen.has(at.id)) break
        seen.add(at.id)
        at = at.parent === undefined ? undefined : byId.get(at.parent)
      }
    }
    // A page added under one that went to the trash meanwhile stays in sight, at the top level.
    if (ok && !p.trashed && byId.get(p.parent!)!.trashed) ok = false
    parent.set(p.id, ok ? p.parent : undefined)
  }
  // Nesting deeper than MAX_NESTING comes back up to the top level, so no page is out of reach.
  const depth = new Map<string, number>()
  for (const p of pages) {
    const chain: string[] = []
    let at: string | undefined = p.id
    while (at !== undefined && !depth.has(at)) {
      chain.push(at)
      at = parent.get(at)
    }
    let d = at === undefined ? -1 : depth.get(at)!
    for (let k = chain.length - 1; k >= 0; k--) {
      d++
      if (d > MAX_NESTING) {
        parent.set(chain[k], undefined)
        d = 0
      }
      depth.set(chain[k], d)
    }
  }
  const kids = new Map<string, Page[]>()
  for (const p of pages) {
    const key = parent.get(p.id) ?? ''
    const list = kids.get(key)
    if (list) list.push(p)
    else kids.set(key, [p])
  }
  for (const list of kids.values()) list.sort(byRank)
  const t = { byId, parent, kids }
  trees.set(pages, t)
  return t
}

/** A page's sub-pages in order (`undefined`: the top level). Trashed pages only with `trash`. */
export function childrenOf(b: Board, parent: string | undefined, opts: { trash?: boolean } = {}): Page[] {
  const list = tree(b).kids.get(parent ?? '') ?? []
  return opts.trash ? list : list.filter((p) => !p.trashed)
}

export interface PageNode {
  page: Page
  children: PageNode[]
}

/** The wiki's pages as a tree (trash left out). */
export function pageTree(b: Board): PageNode[] {
  const build = (parent: string | undefined, depth: number): PageNode[] =>
    depth > MAX_NESTING ? [] : childrenOf(b, parent).map((page) => ({ page, children: build(page.id, depth + 1) }))
  return build(undefined, 0)
}

/** Every page in reading order: each page, then its sub-pages (trash left out). */
export function pageOrder(b: Board): Page[] {
  const out: Page[] = []
  const walk = (nodes: PageNode[]) => nodes.forEach((n) => (out.push(n.page), walk(n.children)))
  walk(pageTree(b))
  return out
}

/** The pages above a page, from the top down, ending with the page itself. */
export function pagePath(b: Board, id: string): Page[] {
  const out: Page[] = []
  let at = getPage(b, id)
  while (at && out.length <= MAX_NESTING) {
    out.unshift(at)
    const up = parentOf(b, at)
    at = up === undefined ? undefined : getPage(b, up)
  }
  return out
}

/** A page and everything under it (trashed or not). */
export function withDescendants(b: Board, id: string): Set<string> {
  const out = new Set<string>([id])
  const { kids } = tree(b)
  const todo = [id]
  while (todo.length) {
    for (const p of kids.get(todo.pop()!) ?? []) {
      if (out.has(p.id)) continue
      out.add(p.id)
      todo.push(p.id)
    }
  }
  return out
}

/** A rank between two neighbours (either may be missing: first, last, or only page). */
export function rankBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1
  if (before === undefined) return after! - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

/** Ranks 1, 2, 3… for a page's sub-pages, when the gaps between them have worn too thin. */
function renumber(b: Board, parent: string | undefined): Board {
  const order = childrenOf(b, parent, { trash: true }).map((p, k) => [p.id, k + 1] as const)
  const rank = new Map(order)
  return { ...b, pages: (b.pages ?? []).map((p) => (rank.has(p.id) && p.rank !== rank.get(p.id) ? { ...p, rank: rank.get(p.id)! } : p)) }
}

/** The rank for a new place among `parent`'s sub-pages: before `before`, else at the end. */
function rankFor(b: Board, parent: string | undefined, before: string | undefined, moving?: string): [Board, number] {
  const siblings = () => childrenOf(b, parent).filter((p) => p.id !== moving)
  let list = siblings()
  let k = before === undefined ? -1 : list.findIndex((p) => p.id === before)
  const pick = () => (k < 0 ? rankBetween(list.at(-1)?.rank, undefined) : rankBetween(list[k - 1]?.rank, list[k].rank))
  let rank = pick()
  const neighbours = k < 0 ? [list.at(-1)?.rank] : [list[k - 1]?.rank, list[k].rank]
  if (neighbours.some((r) => r !== undefined && Math.abs(r - rank) < 1e-9) || !Number.isFinite(rank)) {
    b = renumber(b, parent)
    list = siblings()
    k = before === undefined ? -1 : list.findIndex((p) => p.id === before)
    rank = pick()
  }
  return [b, rank]
}

export interface NewPage {
  title: string
  parent?: string
  /** Put it before this sibling; otherwise last. */
  before?: string
  text?: string
  icon?: string
  id?: string
}

/** Adds a page. Returns the board unchanged (and an empty id) when the wiki is full. */
export function addPage(b: Board, p: NewPage, now = Date.now(), by?: string): [Board, string] {
  if ((b.pages?.length ?? 0) >= MAX_PAGES) return [b, '']
  const parent = getPage(b, p.parent) ? p.parent : undefined
  // Twelve hex digits, and never one already used here (friends adding pages at once rarely collide).
  let id = p.id && isPageId(p.id) && !getPage(b, p.id) ? p.id : ''
  while (!id || getPage(b, id)) id = uid() + uid().slice(0, 4)
  let rank: number
  ;[b, rank] = rankFor(b, parent, p.before)
  const page: Page = { id, ...(parent !== undefined ? { parent } : {}), rank, title: p.title.slice(0, 500), ...(p.icon ? { icon: p.icon } : {}), created: now }
  const body: PageBody = { id, text: (p.text ?? '').slice(0, BODY_MAX), at: now, ...(by ? { by } : {}) }
  return [{ ...b, pages: [...(b.pages ?? []), page], bodies: [...(b.bodies ?? []), body] }, id]
}

function updatePage(b: Board, id: string, f: (p: Page) => Page): Board {
  let hit = false
  const pages = (b.pages ?? []).map((p) => {
    if (p.id !== id) return p
    hit = true
    return f(p)
  })
  return hit ? { ...b, pages } : b
}

/** Renames a page or changes its icon. */
export function setPageMeta(b: Board, id: string, meta: { title?: string; icon?: string | null; protected?: boolean }): Board {
  return updatePage(b, id, (p) => {
    const next: Page = { ...p }
    if (meta.title !== undefined) next.title = meta.title.slice(0, 500)
    if (meta.icon === null) delete next.icon
    else if (meta.icon !== undefined) next.icon = meta.icon
    if (meta.protected === true) next.protected = true
    else if (meta.protected === false) delete next.protected
    return next.title === p.title && next.icon === p.icon && next.protected === p.protected ? p : next
  })
}

/** Replaces a page's words. */
export function setPageBody(b: Board, id: string, text: string, now = Date.now(), by?: string): Board {
  if (!getPage(b, id)) return b
  const clipped = text.slice(0, BODY_MAX)
  const old = getBody(b, id)
  if (old?.text === clipped) return b
  const body: PageBody = { id, text: clipped, at: now, ...(by ? { by } : {}) }
  return { ...b, bodies: old ? (b.bodies ?? []).map((x) => (x.id === id ? body : x)) : [...(b.bodies ?? []), body] }
}

/**
 * Moves a page (with its sub-pages) under `parent` (undefined: the top), before `before` or
 * last. Refuses to move a page under itself or one of its own sub-pages.
 */
export function movePage(b: Board, id: string, parent: string | undefined, before?: string): Board {
  const page = getPage(b, id)
  if (!page) return b
  if (parent !== undefined && (!getPage(b, parent) || withDescendants(b, id).has(parent))) return b
  if (before === id) return b
  let rank: number
  ;[b, rank] = rankFor(b, parent, before, id)
  return updatePage(b, id, (p) => {
    const next: Page = { ...p, rank }
    if (parent === undefined) delete next.parent
    else next.parent = parent
    return next
  })
}

/** Puts a page and its sub-pages in the trash. */
export function trashPage(b: Board, id: string, now = Date.now()): Board {
  if (!getPage(b, id)) return b
  const all = withDescendants(b, id)
  return { ...b, pages: (b.pages ?? []).map((p) => (all.has(p.id) && !p.trashed ? { ...p, trashed: now } : p)) }
}

/** Takes a page (and what went to the trash with it) back out; to the top level if its parent is still in the trash. */
export function restorePage(b: Board, id: string): Board {
  const page = getPage(b, id)
  if (!page?.trashed) return b
  const stamp = page.trashed
  const all = withDescendants(b, id)
  const parent = parentOf(b, page)
  const parentGone = parent !== undefined && !!getPage(b, parent)?.trashed
  // Back at the top level, it goes last.
  let top = page.rank
  if (parentGone) [b, top] = rankFor(b, undefined, undefined, id)
  return {
    ...b,
    pages: (b.pages ?? []).map((p) => {
      if (!all.has(p.id) || p.trashed !== stamp) return p
      const next: Page = { ...p }
      delete next.trashed
      if (p.id === id && parentGone) {
        delete next.parent
        next.rank = top
      }
      return next
    }),
  }
}

/** Deletes a page and its sub-pages for good (words too). */
export function deletePage(b: Board, id: string): Board {
  if (!getPage(b, id)) return b
  const all = withDescendants(b, id)
  const revs = b.revs?.filter((r) => !all.has(r.page))
  return {
    ...b,
    pages: (b.pages ?? []).filter((p) => !all.has(p.id)),
    bodies: (b.bodies ?? []).filter((x) => !all.has(x.id)),
    ...(b.revs ? { revs: revs!.length ? revs : undefined } : {}),
  }
}

/** Pages in the trash, newest first (only the ones that went in themselves, not their sub-pages). */
export function trashed(b: Board): Page[] {
  return (b.pages ?? [])
    .filter((p) => {
      if (!p.trashed) return false
      const up = parentOf(b, p)
      const parent = up === undefined ? undefined : getPage(b, up)
      return !parent || parent.trashed !== p.trashed
    })
    .sort((a, z) => (z.trashed ?? 0) - (a.trashed ?? 0))
}

export interface PageHit {
  page: Page
  /** Where the words were found: the title, or the words around them on the page. */
  snippet: string
  score: number
}

/** A page's words as plain text, worked out once per version of them. */
const plainBodies = new WeakMap<PageBody, string>()
export function plainText(b: Board, id: string): string {
  const body = getBody(b, id)
  if (!body) return ''
  let hit = plainBodies.get(body)
  if (hit === undefined) plainBodies.set(body, (hit = plainMarkdown(body.text)))
  return hit
}

/** Pages whose title or words contain every word of `query`: titles first, then the best matches. */
export function searchPages(b: Board, query: string, limit = 40): PageHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out: PageHit[] = []
  for (const page of pageOrder(b)) {
    const title = page.title.toLowerCase()
    const text = plainText(b, page.id)
    const lower = text.toLowerCase()
    if (!words.every((w) => title.includes(w) || lower.includes(w))) continue
    const inTitle = words.every((w) => title.includes(w))
    const at = lower.indexOf(words[0])
    // The words around the match, starting at a whole word.
    let from = Math.max(0, at - 30)
    const space = from > 0 ? text.indexOf(' ', from) : -1
    if (space >= 0 && space < at) from = space + 1
    const snippet = inTitle || at < 0 ? pagePath(b, page.id).slice(0, -1).map((p) => p.title).join(' › ') : `${from > 0 ? '…' : ''}${text.slice(from, at + 80).replace(/\s+/g, ' ').trim()}…`
    out.push({ page, snippet, score: (inTitle ? 100 : 0) + (title.startsWith(words[0]) ? 20 : 0) - title.length / 100 })
  }
  return out.sort((a, z) => z.score - a.score).slice(0, limit)
}

/** A page by its exact title (case-insensitive), trash left out. */
export function pageByTitle(b: Board, title: string): Page | undefined {
  const t = title.trim().toLowerCase()
  return t ? (b.pages ?? []).find((p) => !p.trashed && p.title.trim().toLowerCase() === t) : undefined
}
