/**
 * Work notes: timestamped comments on any object. Comments and descriptions can
 * @mention other objects with the token `@[Label](#id)` and wiki-link to objects
 * and boards with `[[Label]](…)`, both rendered as links. Links work backwards
 * too: an object lists what links to it.
 */

import { getItem, updateItem } from './board'
import { uid } from './uid'
import { type Board, type Id, type Item, itemKindLabel, type Note } from './types'

export function addNote(b: Board, id: Id, text: string, author?: string, at = Date.now()): Board {
  const trimmed = text.trim()
  if (!trimmed) return b
  const note: Note = { id: uid(), text: trimmed, at, ...(author ? { author } : {}) }
  return updateItem(b, id, (i) => ({ ...i, notes: [...(i.notes ?? []), note] }))
}

export function deleteNote(b: Board, id: Id, noteId: string): Board {
  return updateItem(b, id, (i) => {
    const notes = (i.notes ?? []).filter((n) => n.id !== noteId)
    if (notes.length === (i.notes ?? []).length) return i
    const next: Item = { ...i, notes }
    if (!notes.length) delete next.notes
    return next
  })
}

/**
 * Where a wiki-link points: an object on this board (`item` only), a board
 * (`board` only), or an object on another board (both). `board` is the board's
 * live-session id when it has one, so the link works for every friend, and its
 * id in this browser's library otherwise.
 */
export interface LinkTarget {
  board?: string
  item?: Id
}

// `@[Label](#12)` mentions, `[[Label]](#12)` / `[[Label]](board:key)` / `[[Label]](board:key#12)`
// wiki-links, and `[[Name]]` links typed by hand that are matched to a board or object by name.
const TOKEN = /@\[([^\]]*)\]\(#(\d+)\)|\[\[([^[\]\n]*)\]\]\((?:board:([\w-]+))?(?:#(\d+))?\)|\[\[([^[\]\n]+)\]\]/g

const clean = (label: string) => label.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()

export function mentionToken(label: string, id: Id): string {
  return `@[${clean(label)}](#${id})`
}

export function linkToken(label: string, to: LinkTarget): string {
  return `[[${clean(label)}]](${to.board ? `board:${to.board}` : ''}${to.item !== undefined ? `#${to.item}` : ''})`
}

/** `link` is null for a `[[Name]]` typed by hand: it points at whatever is called that. */
export type NotePart = { text: string } | { mention: Id; label: string } | { link: LinkTarget | null; label: string }

/** Splits note text into plain runs, mentions and wiki-links. */
export function parseNote(text: string): NotePart[] {
  const parts: NotePart[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) })
    if (m[2] !== undefined) parts.push({ mention: Number(m[2]), label: m[1] })
    else if (m[6] !== undefined) parts.push({ link: null, label: m[6].trim() })
    else if (m[4] === undefined && m[5] === undefined) parts.push({ text: m[0] })
    else parts.push({ link: { ...(m[4] ? { board: m[4] } : {}), ...(m[5] ? { item: Number(m[5]) } : {}) }, label: m[3] })
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** Note text with mentions and links shown as their labels, for search and previews. */
export function plainNote(text: string): string {
  return parseNote(text)
    .map((p) => ('text' in p ? p.text : 'mention' in p ? `@${p.label}` : p.label))
    .join('')
}

/** Everything `text` links to; mentions count as links to objects on the same board. */
export function linksIn(text: string): LinkTarget[] {
  const out: LinkTarget[] = []
  for (const p of parseNote(text)) {
    if ('mention' in p) out.push({ item: p.mention })
    else if ('link' in p && p.link) out.push(p.link)
  }
  return out
}

/**
 * Note text as it reads in a text box: links become `[[Label]]` and mentions
 * `@Label`. `picks` maps each of those back to its link, for {@link fromEditable}.
 */
export function toEditable(text: string): { text: string; picks: Map<string, string> } {
  const picks = new Map<string, string>()
  const out = parseNote(text)
    .map((p) => {
      if ('text' in p) return p.text
      if ('mention' in p) {
        const shown = `@${p.label}`
        picks.set(shown, mentionToken(p.label, p.mention))
        return shown
      }
      const shown = `[[${p.label}]]`
      if (p.link) picks.set(shown, linkToken(p.label, p.link))
      return shown
    })
    .join('')
  return { text: out, picks }
}

/** Turns the `[[Label]]` and `@Label` picked in a text box back into links. */
export function fromEditable(text: string, picks: ReadonlyMap<string, string>): string {
  if (!picks.size) return text
  // Longest first, so a pick for "@Budget" doesn't swallow the start of "@Budget 2026".
  const shown = [...picks.keys()].sort((a, z) => z.length - a.length)
  const pattern = new RegExp(shown.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return text.replace(pattern, (s) => picks.get(s)!)
}

/** A board other links can point at: its link key and title. */
export interface BoardRef {
  key: string
  title: string
  icon?: string
}

/**
 * What a hand-typed `[[Name]]` points at: a board with that title, else an
 * object on this board with that label (ignoring case), else nothing.
 */
export function resolveName(name: string, b: Board, boards: readonly BoardRef[]): LinkTarget | null {
  const n = clean(name).toLowerCase()
  if (!n) return null
  const board = boards.find((r) => r.title.trim().toLowerCase() === n)
  if (board) return { board: board.key }
  const item = b.items.find((i) => i.kind !== 'pen' && (clean(i.text).toLowerCase() === n || objectLabel(i).toLowerCase() === n))
  return item ? { item: item.id } : null
}

/** A short human name for an object, used in lists and mentions. */
export function objectLabel(i: Item): string {
  const text = i.text.replace(/\s+/g, ' ').trim()
  if (text) return text.length > 48 ? `${text.slice(0, 47)}…` : text
  if (i.kind === 'flow' && i.shape) return `${i.shape[0].toUpperCase()}${i.shape.slice(1)} ${i.id}`
  return `${itemKindLabel(i)} ${i.id}`
}

export interface NoteRef {
  item: Item
  note: Note
}

/** Every note on the board, newest first. */
export function allNotes(b: Board): NoteRef[] {
  const out: NoteRef[] = []
  for (const item of b.items) for (const note of item.notes ?? []) out.push({ item, note })
  return out.sort((a, z) => z.note.at - a.note.at)
}

/** A link found on a board: on `item`, in one of its comments (`note`) or else its description. */
export interface LinkRef {
  item: Item
  note?: Note
  to: LinkTarget
}

/** Every link in the board's descriptions and comments, with `[[Name]]` links matched by name. */
export function boardLinks(b: Board, boards: readonly BoardRef[] = []): LinkRef[] {
  const out: LinkRef[] = []
  const scan = (item: Item, text: string, note?: Note) => {
    for (const p of parseNote(text)) {
      const to = 'mention' in p ? { item: p.mention } : 'link' in p ? (p.link ?? resolveName(p.label, b, boards)) : null
      if (to) out.push({ item, ...(note ? { note } : {}), to })
    }
  }
  for (const item of b.items) {
    if (item.description) scan(item, item.description)
    for (const note of item.notes ?? []) scan(item, note.text, note)
  }
  return out
}

/**
 * Descriptions and comments on other objects that link to `id`: descriptions
 * first, then comments newest first. `self` holds this board's own link keys,
 * so `[[…]](board:self#id)` counts too.
 */
export function backlinks(b: Board, id: Id, self: readonly string[] = [], boards: readonly BoardRef[] = []): LinkRef[] {
  const seen = new Set<string>()
  return boardLinks(b, boards)
    .filter((r) => r.item.id !== id && r.to.item === id && (!r.to.board || self.includes(r.to.board)))
    .filter((r) => {
      const key = `${r.item.id}:${r.note?.id ?? ''}`
      return !seen.has(key) && !!seen.add(key)
    })
    .sort((a, z) => (a.note?.at ?? Infinity) - (z.note?.at ?? Infinity))
    .reverse()
}

/** Objects whose label matches `query`, for the @mention picker. */
export function mentionCandidates(b: Board, query: string, exclude?: Id, limit = 8): Item[] {
  const q = query.toLowerCase()
  return b.items
    .filter((i) => i.id !== exclude && i.kind !== 'pen')
    .filter((i) => !q || objectLabel(i).toLowerCase().includes(q) || itemKindLabel(i).toLowerCase().includes(q))
    .slice(0, limit)
}

export interface LinkCandidate {
  label: string
  /** What it is: "Board", or the object's kind. */
  hint: string
  to: LinkTarget
}

/** Boards (other than this one) and objects on this board whose name matches `query`, for the [[ picker. */
export function linkCandidates(b: Board, query: string, boards: readonly BoardRef[], exclude?: Id, limit = 8): LinkCandidate[] {
  const q = query.trim().toLowerCase()
  const objects = mentionCandidates(b, q, exclude, limit).map((i) => ({ label: objectLabel(i), hint: itemKindLabel(i), to: { item: i.id } }))
  const named = boards
    .filter((r) => !q || r.title.toLowerCase().includes(q))
    .map((r) => ({ label: r.title, hint: r.icon ? `${r.icon} Board` : 'Board', to: { board: r.key } }))
  // Boards first, but never crowding out the objects entirely.
  return [...named.slice(0, Math.max(4, limit - objects.length)), ...objects].slice(0, limit)
}

export const hasNotes =(b: Board, id: Id) => !!getItem(b, id)?.notes?.length
