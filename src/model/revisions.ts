/**
 * Saved versions of wiki pages, kept in the wiki itself so everyone with it (and everyone in a
 * live session) sees the same history. A version is saved when someone finishes writing on a
 * page, every few minutes during a long stretch of writing, before and after a page is put back,
 * and when an AI assistant or the API changes it. Versions are only added, never edited (except
 * for a note or a milestone mark), so friends saving at the same time never clash.
 */

import { lineDiff } from './merge'
import type { Board, PageRev } from './types'
import { uid } from './uid'
import { getBody, getPage, pageText } from './wiki'

/** Versions kept per page, besides milestones. */
export const REV_KEEP = 50
/** All the versions' words together, past which the oldest go (milestones and each page's latest stay). */
export const REV_TEXT_BUDGET = 5_000_000
/** During a long stretch of writing, a version is saved at least this often. */
export const REV_EVERY = 10 * 60_000
/** How many versions a live room accepts in one wiki. */
export const MAX_REVS = 20_000
/** How many versions a wiki keeps in all (well under what a room accepts, so saving never hits it). */
export const REV_TOTAL_KEEP = 15_000

const byTime = (a: PageRev, z: PageRev) => a.at - z.at || (a.id < z.id ? -1 : a.id > z.id ? 1 : 0)

const indexes = new WeakMap<PageRev[], Map<string, PageRev[]>>()

/** A page's saved versions, oldest first. */
export function pageRevs(b: Board, page: string): PageRev[] {
  const list = b.revs
  if (!list) return []
  let index = indexes.get(list)
  if (!index) {
    index = new Map()
    for (const r of list) {
      const l = index.get(r.page)
      if (l) l.push(r)
      else index.set(r.page, [r])
    }
    for (const l of index.values()) l.sort(byTime)
    indexes.set(list, index)
  }
  return index.get(page) ?? []
}

export const latestRev = (b: Board, page: string): PageRev | undefined => pageRevs(b, page).at(-1)

/** A version's number on its page: 1 for the first saved one, and the same for good once given. */
export const revNumber = (b: Board, rev: PageRev) => rev.n ?? pageRevs(b, rev.page).findIndex((r) => r.id === rev.id) + 1

/** Whether older versions of the page have gone (pruned), so its oldest kept one isn't its first. */
export const olderGone = (b: Board, page: string) => {
  const first = pageRevs(b, page)[0]
  return !!first && revNumber(b, first) > 1
}

/** Small changes by one person this close together make one version. */
export const QUICK_MS = 2 * 60_000

/** Whether the page as it is now says something its latest saved version doesn't. */
export function unsavedChanges(b: Board, page: string): boolean {
  const p = getPage(b, page)
  if (!p) return false
  const last = latestRev(b, page)
  return !last || last.title !== p.title || last.text !== pageText(b, page)
}

export interface SaveOptions {
  /** When the words were written, and by whom (the page's last writer when missing). */
  at?: number
  by?: string
  note?: string
  keep?: boolean
  /** A small change: joins the same person's small change of a moment ago instead of adding one. */
  quick?: boolean
  /** Who is saving: a note only goes on an unchanged version they wrote themselves. */
  me?: string
}

/**
 * Saves the page as it is now as a version, unless its latest version already says the same: then
 * a note goes on that version if it's the same writer's and has none yet (never over a friend's).
 */
export function savePageVersion(b: Board, page: string, opts: SaveOptions = {}): Board {
  const p = getPage(b, page)
  if (!p) return b
  const body = getBody(b, page)
  const text = body?.text ?? ''
  const last = latestRev(b, page)
  const note = opts.note?.trim().slice(0, 300) || undefined
  if (last && last.title === p.title && last.text === text) {
    const addNote = !!note && !last.note && (opts.me === undefined || last.by === opts.me)
    if (!addNote && (!opts.keep || last.keep)) return b
    const marked: PageRev = { ...last, ...(addNote ? { note } : {}), ...(opts.keep ? { keep: true } : {}) }
    return { ...b, revs: b.revs!.map((r) => (r === last ? marked : r)) }
  }
  const by = opts.by ?? body?.by
  const at = Math.max(opts.at ?? body?.at ?? p.created, last ? last.at + 1 : 0)
  // A tick a moment after the same person's last tick: one version for the lot.
  if (opts.quick && last?.quick && last.by === by && at - last.at < QUICK_MS) {
    const joined = [last.note, note].filter(Boolean).join(', ')
    const merged: PageRev = { ...last, at, title: p.title, text, ...(joined ? { note: joined.length > 300 ? `${joined.slice(0, 299)}…` : joined } : {}) }
    return { ...b, revs: b.revs!.map((r) => (r === last ? merged : r)) }
  }
  const n = (last ? (last.n ?? pageRevs(b, page).length) : 0) + 1
  const rev: PageRev = {
    id: uid() + uid().slice(0, 4),
    page,
    at,
    n,
    ...(by ? { by } : {}),
    title: p.title,
    text,
    ...(note ? { note } : {}),
    ...(opts.keep ? { keep: true } : {}),
    ...(opts.quick ? { quick: true } : {}),
  }
  return pruneRevs({ ...b, revs: [...(b.revs ?? []), rev] })
}

/** Gives a version a note, or marks it as a milestone (or not). */
export function markRev(b: Board, id: string, mark: { note?: string; keep?: boolean }): Board {
  const old = b.revs?.find((r) => r.id === id)
  if (!old) return b
  const next: PageRev = { ...old }
  if (mark.note !== undefined) {
    const note = mark.note.trim().slice(0, 300)
    if (note) next.note = note
    else delete next.note
  }
  if (mark.keep !== undefined) {
    if (mark.keep) next.keep = true
    else delete next.keep
  }
  return { ...b, revs: b.revs!.map((r) => (r === old ? next : r)) }
}

/**
 * Drops the oldest versions past {@link REV_KEEP} per page, then past {@link REV_TEXT_BUDGET} in
 * all. Milestones and each page's latest version always stay.
 */
export function pruneRevs(b: Board): Board {
  const list = b.revs
  if (!list?.length) return b
  const drop = new Set<string>()
  const pages = new Set(list.map((r) => r.page))
  const latest = new Set<string>()
  for (const page of pages) {
    const revs = pageRevs(b, page)
    latest.add(revs.at(-1)!.id)
    const plain = revs.filter((r) => !r.keep && r !== revs.at(-1))
    for (const r of plain.slice(0, Math.max(0, plain.length - (REV_KEEP - 1)))) drop.add(r.id)
  }
  let size = list.reduce((n, r) => n + (drop.has(r.id) ? 0 : r.text.length), 0)
  let count = list.length - drop.size
  if (size > REV_TEXT_BUDGET || count > REV_TOTAL_KEEP) {
    for (const r of [...list].sort(byTime)) {
      if (size <= REV_TEXT_BUDGET && count <= REV_TOTAL_KEEP) break
      if (r.keep || latest.has(r.id) || drop.has(r.id)) continue
      drop.add(r.id)
      size -= r.text.length
      count--
    }
  }
  return drop.size ? { ...b, revs: list.filter((r) => !drop.has(r.id)) } : b
}

/** One line of a page, and the version that brought it in (null: written since the last saved version). */
export interface WhoLine {
  s: string
  rev: PageRev | null
}

/** Who wrote what: each line of the page now, with the version it first appeared in. */
export function whoWrote(b: Board, page: string): WhoLine[] {
  let lines: WhoLine[] | null = null
  let before = ''
  const step = (text: string, rev: PageRev | null) => {
    // The first version wrote every line it has (a blank line included).
    if (!lines) {
      lines = text.split('\n').map((s) => ({ s, rev }))
      before = text
      return
    }
    if (text === before) return
    const out: WhoLine[] = []
    let k = 0
    for (const l of lineDiff(before, text)) {
      if (l.t === 'same') out.push(lines![k++] ?? { s: l.s, rev })
      else if (l.t === 'del') k++
      else out.push({ s: l.s, rev })
    }
    lines = out
    before = text
  }
  for (const r of pageRevs(b, page)) step(r.text, r)
  step(pageText(b, page), null)
  return lines ?? []
}

export interface Change {
  rev: PageRev
  /** The version before it on the same page, if any. */
  prev?: PageRev
}

/**
 * A page's starting point: the version kept automatically when someone first opened it to write,
 * of words nobody in particular wrote (a template's, say). Not a change anyone made.
 */
export const isStartingPoint = (b: Board, rev: PageRev) => !rev.by && revNumber(b, rev) === 1

/** The latest saved versions across the whole wiki, newest first (starting points left out). */
export function recentChanges(b: Board, limit = 100): Change[] {
  const out: Change[] = []
  for (const rev of [...(b.revs ?? [])].sort((a, z) => byTime(z, a))) {
    if (out.length >= limit) break
    if (isStartingPoint(b, rev)) continue
    const revs = pageRevs(b, rev.page)
    const k = revs.findIndex((r) => r.id === rev.id)
    out.push({ rev, ...(k > 0 ? { prev: revs[k - 1] } : {}) })
  }
  return out
}
