/**
 * What a message to the assistant points at: objects (`@[Label](#12)`), wiki pages and other boards
 * (`[[Title]](page:…)`, `[[Title]](board:…)`), read and sent along with it, so the model has them
 * without having to look them up. Boards other than the open one are read from this browser.
 */

import { describeBoard, getObject, getPage, listPages } from '../api/queries'
import { maskFor } from '../model/brainstorm'
import { type BoardRef, type LinkTarget, parseNote, resolveName } from '../model/notes'
import type { Board } from '../model/types'
import { isWiki } from '../model/wiki'
import { boardText } from './boardText'

/** Where references are read from. */
export interface RefHost {
  /** The open board, as this person may see it. */
  board(): Board
  /** The keys links to the open board use (its id and its live-session id). */
  selfKeys: readonly string[]
  /** The other boards and wikis, by key. */
  boards: readonly BoardRef[]
  /** Another board, by key, or null when it isn't here. */
  read(key: string): Promise<Board | null>
  /** Whose hidden brainstorm notes stay readable (this person's own). */
  me: string
}

/** How much of each reference, and of all of them together, goes along (characters). */
const EACH = 16_000
const ALL = 48_000

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (cut here; ask for more with the read tools)` : s)

/** Everything `text` points at, each once (by-name links matched to a page, board or object). */
export function referencesIn(text: string, b: Board, boards: readonly BoardRef[]): LinkTarget[] {
  const out: LinkTarget[] = []
  const seen = new Set<string>()
  for (const p of parseNote(text)) {
    const to = 'mention' in p ? { item: p.mention } : 'link' in p ? (p.link ?? resolveName(p.label, b, boards)) : null
    if (!to) continue
    const key = `${to.board ?? ''}|${to.item ?? ''}|${to.page ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(to)
  }
  return out
}

/** One reference's content, with a heading saying what it is; null when it can't be found. */
async function readRef(to: LinkTarget, host: RefHost): Promise<string | null> {
  const elsewhere = to.board !== undefined && !host.selfKeys.includes(to.board)
  const raw = elsewhere ? await host.read(to.board!) : host.board()
  if (!raw) return null
  const b = elsewhere ? maskFor(raw, host.me) : raw
  const where = elsewhere ? `${isWiki(b) ? 'the wiki' : 'the board'} "${b.title}" (key ${to.board})` : 'this board'
  if (to.page !== undefined) {
    const p = getPage(b, to.page)
    if (!p) return null
    return `Page "${p.title}" (id ${p.page}) in ${where}:\n${cut(p.text, EACH)}`
  }
  if (to.item !== undefined) {
    const o = getObject(b, to.item)
    if (!o) return null
    return `Object ${to.item} on ${where}:\n${cut(JSON.stringify(o), EACH)}`
  }
  // A whole board or wiki: its outline (a wiki's pages, a board's objects).
  const body = isWiki(b) ? JSON.stringify(listPages(b)) : boardText(b, {})
  return `${where[0].toUpperCase()}${where.slice(1)}${isWiki(b) ? ', its pages' : ''}:\n${cut(body || JSON.stringify(describeBoard(b)), EACH)}`
}

/**
 * The text that goes along with a message: each thing it points at, read. Empty when it points at
 * nothing (or only at things that are gone).
 */
export async function referenceContext(text: string, host: RefHost): Promise<string> {
  const refs = referencesIn(text, host.board(), host.boards)
  if (!refs.length) return ''
  const parts: string[] = []
  let left = ALL
  for (const to of refs) {
    if (left <= 0) {
      parts.push('(More was linked than fits; read the rest with the tools.)')
      break
    }
    const got = await readRef(to, host).catch(() => null)
    const piece = got ?? `(A link to something that isn't here any more: ${JSON.stringify(to)})`
    parts.push(cut(piece, left))
    left -= piece.length
  }
  return `[What the message links to, read for you:]\n\n${parts.join('\n\n---\n\n')}`
}
