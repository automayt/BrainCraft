/**
 * Work notes: timestamped comments on any object. A note can @mention other
 * objects with the token `@[Label](#id)`, rendered as a link to that object.
 */

import { getItem, updateItem } from './board'
import { uid } from './uid'
import { type Board, type Id, type Item, KIND_LABELS, type Note } from './types'

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

const MENTION = /@\[([^\]]*)\]\(#(\d+)\)/g

export function mentionToken(label: string, id: Id): string {
  return `@[${label.replace(/[[\]]/g, '')}](#${id})`
}

export type NotePart = { text: string } | { mention: Id; label: string }

/** Splits note text into plain runs and mentions. */
export function parseNote(text: string): NotePart[] {
  const parts: NotePart[] = []
  let last = 0
  for (const m of text.matchAll(MENTION)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) })
    parts.push({ mention: Number(m[2]), label: m[1] })
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** Note text with mentions shown as their labels, for search and previews. */
export function plainNote(text: string): string {
  return text.replace(MENTION, '@$1')
}

/** A short human name for an object, used in lists and mentions. */
export function objectLabel(i: Item): string {
  const text = i.text.replace(/\s+/g, ' ').trim()
  if (text) return text.length > 48 ? `${text.slice(0, 47)}…` : text
  if (i.kind === 'flow' && i.shape) return `${i.shape[0].toUpperCase()}${i.shape.slice(1)} ${i.id}`
  return `${KIND_LABELS[i.kind]} ${i.id}`
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

/** Notes on other objects that mention `id`. */
export function backlinks(b: Board, id: Id): NoteRef[] {
  return allNotes(b).filter(
    ({ item, note }) => item.id !== id && parseNote(note.text).some((p) => 'mention' in p && p.mention === id),
  )
}

/** Objects whose label matches `query`, for the @mention picker. */
export function mentionCandidates(b: Board, query: string, exclude?: Id, limit = 8): Item[] {
  const q = query.toLowerCase()
  return b.items
    .filter((i) => i.id !== exclude && i.kind !== 'pen')
    .filter((i) => !q || objectLabel(i).toLowerCase().includes(q) || KIND_LABELS[i.kind].toLowerCase().includes(q))
    .slice(0, limit)
}

export const hasNotes = (b: Board, id: Id) => !!getItem(b, id)?.notes?.length
