/** Wiki-links between boards: which boards in this browser link to the open one. */

import { boardLinks, type BoardRef, type LinkTarget, objectLabel, plainNote } from '../model/notes'
import type { Id, Note } from '../model/types'
import type { BoardMeta, Library } from './library'

/** The key links use for a board: its live-session id when shared (the same for every friend), else its id here. */
export const linkKey = (m: Pick<BoardMeta, 'id' | 'live'>) => m.live?.id ?? m.id

export const boardRefs = (boards: readonly BoardMeta[]): BoardRef[] => boards.map((m) => ({ key: linkKey(m), title: m.title }))

/** A link on another board, from object `from` (in a comment, or else its description). */
export interface CrossLink {
  boardId: string
  boardTitle: string
  from: Id
  fromLabel: string
  note?: Note
  /** The comment or description, as plain text. */
  text: string
  to: LinkTarget
}

type Found = Omit<CrossLink, 'boardTitle'>

/** Reads each board once and remembers its links until the board (or the list of board names) changes. */
export class LinkIndex {
  private readonly library: Library
  private cache = new Map<string, { updated: number; names: string; links: Found[] }>()

  constructor(library: Library) {
    this.library = library
  }

  /** Links on `boards` (except `skip`) pointing at the board known by any of `keys`. */
  async to(keys: readonly string[], boards: readonly BoardMeta[], skip?: string | null): Promise<CrossLink[]> {
    const refs = boardRefs(boards)
    // `[[Name]]` links are matched to board titles, so renaming a board changes what they point at.
    const names = refs.map((r) => `${r.key}:${r.title}`).join('|')
    const out: CrossLink[] = []
    for (const m of boards) {
      if (m.id === skip) continue
      let hit = this.cache.get(m.id)
      if (!hit || hit.updated !== m.updated || hit.names !== names) {
        const b = await this.library.load(m.id)
        const links = (b ? boardLinks(b, refs) : [])
          .filter((r) => r.to.board)
          .map((r): Found => ({ boardId: m.id, from: r.item.id, fromLabel: objectLabel(r.item), ...(r.note ? { note: r.note } : {}), text: plainNote(r.note?.text ?? r.item.description ?? ''), to: r.to }))
        hit = { updated: m.updated, names, links }
        this.cache.set(m.id, hit)
      }
      // A comment that links here twice is listed once (per object it links to).
      const seen = new Set<string>()
      for (const l of hit.links) {
        const key = `${l.from}:${l.note?.id ?? ''}:${l.to.item ?? ''}`
        if (keys.includes(l.to.board!) && !seen.has(key)) {
          seen.add(key)
          out.push({ ...l, boardTitle: m.title })
        }
      }
    }
    return out
  }
}
