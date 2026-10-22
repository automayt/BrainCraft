/**
 * Work notes: timestamped comments on any object. Comments and descriptions can
 * @mention other objects with the token `@[Label](#id)` and wiki-link to objects
 * and boards with `[[Label]](…)`, both rendered as links. Links work backwards
 * too: an object lists what links to it.
 */

import { getItem, updateItem } from './board'
import { uid } from './uid'
import { type Board, type Id, type Item, itemKindLabel, type Note, type Page } from './types'

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
  /** In a wiki: a page of this wiki (or of `board`'s), and a heading's anchor on it. */
  page?: string
  heading?: string
}

// `@[Label](#12)` mentions; `[[Label]](#12)` / `[[Label]](board:key)` / `[[Label]](board:key#12)`
// wiki-links; `[[Label]](page:id#heading)` / `[[Label]](board:key/page:id)` page links; and
// `[[Name]]` links typed by hand that are matched to a page, board or object by name; and
// `@[Name](user:ID)` mentions of a person (`@[Name](user:)` for someone without an account).
// Labels are bounded (and one line): unbounded ones made "@[@[@[…" take seconds to scan.
const TOKEN =
  /@\[([^\]\n]{0,300})\]\(#(\d+)\)|\[\[([^[\]\n]{0,300})\]\]\((?:board:([\w-]+))?(?:\/?page:([\w-]+)(?:#([\p{L}\p{M}\p{N}_-]+))?|#(\d+))?\)|\[\[([^[\]\n]{1,300})\]\]|@\[([^\]\n]{1,80})\]\(user:([\w-]{0,64})\)/gu
const TOKEN_AT = new RegExp(TOKEN.source, 'yu')

const clean = (label: string) => label.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()

export function mentionToken(label: string, id: Id): string {
  return `@[${clean(label)}](#${id})`
}

export function linkToken(label: string, to: LinkTarget): string {
  const board = to.board ? `board:${to.board}` : ''
  const where =
    to.page !== undefined ? `${board ? '/' : ''}page:${to.page}${to.heading ? `#${to.heading}` : ''}` : to.item !== undefined ? `#${to.item}` : ''
  return `[[${clean(label)}]](${board}${where})`
}

/** A mention of a person: their account's id, or '' for someone known only by name. */
export function personToken(name: string, id = ''): string {
  return `@[${clean(name).slice(0, 80) || 'Someone'}](user:${id})`
}

/**
 * `link` is null for a `[[Name]]` typed by hand: it points at whatever is called that. `person` is
 * a person's account id ('' for a name only).
 */
export type NotePart = { text: string } | { mention: Id; label: string } | { link: LinkTarget | null; label: string } | { person: string; label: string }

/** Splits note text into plain runs, mentions and wiki-links. */
export function parseNote(text: string): NotePart[] {
  const parts: NotePart[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) })
    parts.push(partOf(m))
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

function partOf(m: RegExpMatchArray): NotePart {
  if (m[2] !== undefined) return { mention: Number(m[2]), label: m[1] }
  if (m[10] !== undefined) return { person: m[10], label: m[9].trim() }
  if (m[8] !== undefined) return { link: null, label: m[8].trim() }
  if (m[4] === undefined && m[5] === undefined && m[7] === undefined) return { text: m[0] }
  return {
    link: {
      ...(m[4] ? { board: m[4] } : {}),
      ...(m[5] ? { page: m[5] } : {}),
      ...(m[6] ? { heading: m[6] } : {}),
      ...(m[7] ? { item: Number(m[7]) } : {}),
    },
    label: m[3],
  }
}

/** A mention or link starting exactly at `at` in `text`, for parsers that walk the text themselves. */
export function tokenAt(text: string, at: number): { part: NotePart; length: number } | null {
  TOKEN_AT.lastIndex = at
  const m = TOKEN_AT.exec(text)
  return m ? { part: partOf(m), length: m[0].length } : null
}

/** Note text with mentions and links shown as their labels, for search and previews. */
export function plainNote(text: string): string {
  return parseNote(text)
    .map((p) => ('text' in p ? p.text : 'mention' in p || 'person' in p ? `@${p.label}` : p.label))
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
      if ('person' in p) {
        const shown = `@${p.label}`
        picks.set(shown, personToken(p.label, p.person))
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

/** A board other links can point at: its link key and title (and a wiki's pages). */
export interface BoardRef {
  key: string
  title: string
  icon?: string
  kind?: 'wiki'
  pages?: { id: string; title: string; icon?: string }[]
}

/**
 * What a hand-typed `[[Name]]` points at: a board with that title, else an
 * object on this board with that label (ignoring case), else nothing.
 */
export function resolveName(name: string, b: Board, boards: readonly BoardRef[]): LinkTarget | null {
  const n = clean(name).toLowerCase()
  if (!n) return null
  // In a wiki, its own pages come first.
  const own = b.pages?.find((p) => !p.trashed && p.title.trim().toLowerCase() === n)
  if (own) return { page: own.id }
  const board = boards.find((r) => r.title.trim().toLowerCase() === n)
  if (board) return { board: board.key }
  // A page of another wiki, when only one has that title.
  const pages = boards.flatMap((r) => (r.pages ?? []).filter((p) => p.title.trim().toLowerCase() === n).map((p) => ({ board: r.key, page: p.id })))
  if (pages.length === 1) return pages[0]
  const item = b.items.find((i) => i.kind !== 'pen' && (clean(i.text).toLowerCase() === n || objectLabel(i).toLowerCase() === n))
  return item ? { item: item.id } : null
}

/** A short human name for an object, used in lists and mentions. */
export function objectLabel(i: Item): string {
  // A flip card turned to an empty side goes by its other side.
  const text = (i.text.trim() ? i.text : (i.back ?? '')).replace(/\s+/g, ' ').trim()
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

/** A link found on a board: on `item`, in one of its comments (`note`) or else its description; or on a wiki `page`. */
export interface LinkRef {
  item?: Item
  page?: Page
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
    // An object that leads somewhere links there too.
    const l = item.linkTo
    if (l && !l.url) out.push({ item, to: { ...(l.board ? { board: l.board } : {}), ...(l.page ? { page: l.page } : {}), ...(l.heading ? { heading: l.heading } : {}), ...(l.item !== undefined ? { item: l.item } : {}) } })
  }
  // A wiki's pages link too.
  const bodies = new Map((b.bodies ?? []).map((x) => [x.id, x.text]))
  for (const page of b.pages ?? []) {
    if (page.trashed) continue
    for (const p of parseNote(bodies.get(page.id) ?? '')) {
      const to = 'mention' in p ? { item: p.mention } : 'link' in p ? (p.link ?? resolveName(p.label, b, boards)) : null
      if (to) out.push({ page, to })
    }
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
    .filter((r) => !!r.item && r.item.id !== id && r.to.item === id && (!r.to.board || self.includes(r.to.board)))
    .filter((r) => {
      const key = `${r.item!.id}:${r.note?.id ?? ''}`
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
    .map((r) => ({ label: r.title, hint: `${r.icon ? `${r.icon} ` : ''}${r.kind === 'wiki' ? 'Wiki' : 'Board'}`, to: { board: r.key } }))
  // In a wiki, its own pages come first.
  const own = (b.pages ?? [])
    .filter((p) => !p.trashed && (!q || p.title.toLowerCase().includes(q)))
    .slice(0, limit)
    .map((p) => ({ label: p.title || 'Untitled', hint: `${p.icon ?? '📄'} Page`, to: { page: p.id } }))
  // Wiki pages, once there's something to look for (there may be many).
  const pages = q
    ? boards.flatMap((r) =>
        (r.pages ?? []).filter((p) => p.title.toLowerCase().includes(q)).map((p) => ({ label: p.title || 'Untitled', hint: `📘 ${r.title}`, to: { board: r.key, page: p.id } })),
      )
    : []
  // Boards and pages first, but never crowding out the objects entirely.
  return [...[...own, ...named, ...pages].slice(0, Math.max(4, limit - objects.length)), ...objects].slice(0, limit)
}

export const hasNotes =(b: Board, id: Id) => !!getItem(b, id)?.notes?.length

// ----- mentions of people ---------------------------------------------------------------

/** Who "I" am, to find mentions of me: my account's id when signed in, and my name. */
export interface Me {
  id?: string
  name: string
}

/** Whether a mention is of `me`: by account when it names one, else by name (ignoring case). */
export function isMe(part: { person: string; label: string }, me: Me): boolean {
  if (part.person) return !!me.id && part.person === me.id
  const name = clean(me.name).toLowerCase()
  return !!name && clean(part.label).toLowerCase() === name
}

/** Whether `text` mentions `me`. */
export function mentionsMe(text: string, me: Me): boolean {
  // Most text mentions nobody: skip the parse.
  if (!text.includes('](user:')) return false
  return parseNote(text).some((p) => 'person' in p && isMe(p, me))
}

/** Someone who can be mentioned: an account (`id`), or a name seen on the board or in the session. */
export interface Person {
  id?: string
  name: string
  /** A second line in the picker: their email, "Here now", "Commented here". */
  hint?: string
}

/** People whose name (or email) matches `query`, accounts before names alone, each person once. */
export function personCandidates(people: readonly Person[], query: string, limit = 6): Person[] {
  const q = query.trim().toLowerCase()
  const seen = new Set<string>()
  const ids = new Set(people.filter((p) => p.id).map((p) => clean(p.name).toLowerCase()))
  const out: Person[] = []
  for (const p of [...people.filter((x) => x.id), ...people.filter((x) => !x.id)]) {
    const name = clean(p.name)
    if (!name) continue
    const key = p.id ? `#${p.id}` : name.toLowerCase()
    // A name alone that an account already has is that account.
    if (seen.has(key) || (!p.id && ids.has(key))) continue
    if (q && !name.toLowerCase().includes(q) && !(p.hint ?? '').toLowerCase().includes(q)) continue
    seen.add(key)
    out.push({ ...p, name })
    if (out.length >= limit) break
  }
  return out
}

/** Where someone was mentioned on a board: a comment (`item` and `note`), a description (`item`), or a wiki `page`. */
export interface MentionRef {
  item?: Item
  note?: Note
  page?: Page
  /** When it was written (unknown for a description). */
  at?: number
  by?: string
  /** The words around it, as plain text. */
  excerpt: string
}

/** The text around the first mention of `me` in `text`, as plain text. */
function excerptAround(text: string, me: Me, size = 160): string {
  let at = 0
  let found = -1
  const plain = parseNote(text)
    .map((p) => {
      const s = 'text' in p ? p.text : 'mention' in p || 'person' in p ? `@${p.label}` : p.label
      if (found < 0 && 'person' in p && isMe(p, me)) found = at
      at += s.length
      return s
    })
    .join('')
  // The line it's on (a page's checklist item, say), around it when that's long.
  const pos = Math.max(0, found)
  const lineStart = plain.lastIndexOf('\n', pos - 1) + 1
  const lineEnd = plain.indexOf('\n', pos) < 0 ? plain.length : plain.indexOf('\n', pos)
  const start = Math.max(lineStart, pos - size / 2)
  const end = Math.min(lineEnd, start + size)
  const line = plain
    .slice(start, end)
    // Markdown's marks: a list's bullet and box, a heading's #, emphasis.
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/[*_`|>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (start > lineStart ? '…' : '') + line + (end < lineEnd ? '…' : '')
}

/** Every place on the board that mentions `me`, newest first (descriptions, which have no time, last). */
export function mentionsOf(b: Board, me: Me): MentionRef[] {
  const out: MentionRef[] = []
  for (const item of b.items) {
    if (item.description && mentionsMe(item.description, me)) out.push({ item, excerpt: excerptAround(item.description, me) })
    for (const note of item.notes ?? []) {
      if (mentionsMe(note.text, me)) out.push({ item, note, at: note.at, ...(note.author ? { by: note.author } : {}), excerpt: excerptAround(note.text, me) })
    }
  }
  const bodies = new Map((b.bodies ?? []).map((x) => [x.id, x]))
  for (const page of b.pages ?? []) {
    const body = bodies.get(page.id)
    if (page.trashed || !body || !mentionsMe(body.text, me)) continue
    out.push({ page, at: body.at, ...(body.by ? { by: body.by } : {}), excerpt: excerptAround(body.text, me) })
  }
  return out.sort((a, z) => (z.at ?? -1) - (a.at ?? -1))
}

/** Names of people seen on the board (comment authors and page writers), for mentioning them. */
export function namesOnBoard(b: Board): string[] {
  const names = new Set<string>()
  for (const item of b.items) for (const n of item.notes ?? []) if (n.author) names.add(n.author)
  for (const body of b.bodies ?? []) if (body.by) names.add(body.by)
  return [...names]
}
