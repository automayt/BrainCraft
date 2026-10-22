/**
 * Links on objects: any object on a board (text, a note, a shape, a frame…) can lead somewhere when
 * its link is followed: a wiki page (and a heading on it), another board, an object, or a web
 * address. The object shows a link badge; the page it leads to lists it among what links there.
 */

import type { LinkTarget } from './notes'
import type { Board, Id, Item, Kind } from './types'
import { isPageId } from './wiki'

export interface ItemLink extends LinkTarget {
  /** A web address (http or https), instead of somewhere in BrainCraft. */
  url?: string
  /** What it leads to, as last seen (a page's title), for anyone who doesn't have that board. */
  label?: string
}

/** Link cards are links already; everything else can have one. */
export const canLink = (kind: Kind) => kind !== 'link'

const KEY = /^[\w-]{1,64}$/
const SLUG = /^[\p{L}\p{M}\p{N}_-]{1,120}$/u

/** A link from anywhere (a board file, a live peer, the API), checked; null when it isn't one. */
export function cleanItemLink(v: unknown): ItemLink | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const x = v as Record<string, unknown>
  const label = typeof x.label === 'string' && x.label.trim() ? { label: x.label.trim().slice(0, 120) } : {}
  if (typeof x.url === 'string') {
    try {
      const u = new URL(x.url.trim())
      return /^https?:$/.test(u.protocol) && x.url.length <= 2000 ? { url: u.href, ...label } : null
    } catch {
      return null
    }
  }
  const out: ItemLink = {}
  if (typeof x.board === 'string' && KEY.test(x.board)) out.board = x.board
  if (isPageId(x.page)) out.page = x.page
  if (out.page && typeof x.heading === 'string' && SLUG.test(x.heading)) out.heading = x.heading
  if (typeof x.item === 'number' && Number.isSafeInteger(x.item) && x.item > 0) out.item = x.item
  // Somewhere to go: a board, a page or an object (a page or heading alone means this wiki's).
  if (out.board === undefined && out.page === undefined && out.item === undefined) return null
  return { ...out, ...label }
}

/** Gives objects a link (or takes it away with null); objects that can't have one are left as they are. */
export function setItemLink(b: Board, ids: Iterable<Id>, link: ItemLink | null): Board {
  const want = new Set(ids)
  let changed = false
  const items = b.items.map((i): Item => {
    if (!want.has(i.id) || !canLink(i.kind)) return i
    if (!link && !i.linkTo) return i
    changed = true
    if (link) return { ...i, linkTo: link }
    const next = { ...i }
    delete next.linkTo
    return next
  })
  return changed ? { ...b, items } : b
}

/** A web address for a link, when it's one (for showing it, or opening it). */
export const isWebLink = (l: ItemLink) => !!l.url

/** A short description of where a link leads, for its badge's tooltip. */
export function describeLink(l: ItemLink): string {
  if (l.url) return l.label ? `${l.label} (${l.url})` : l.url
  const what = l.page !== undefined ? 'the page' : l.item !== undefined ? 'the object' : 'the board'
  return l.label ? `${l.label}` : `Go to ${what}`
}
