/**
 * Web links to a place in BrainCraft, to paste in a chat or an email: a board, a page of a wiki
 * (and a heading on it) or an object on a board. `#open=KEY&page=ID&h=heading` or `#open=KEY&item=12`.
 * They open for anyone who has that board in their browser (a friend in the live session does).
 * Pasted into a page or a comment, they turn into an ordinary BrainCraft link.
 */

import type { LinkTarget } from '../model/notes'
import { isPageId } from '../model/wiki'

/** Where a link goes: a board by its link key, and maybe a page, heading or object on it. */
export interface Place {
  page?: string
  heading?: string
  item?: number
}

const KEY = /^[\w-]{1,64}$/

/** The place in a hash's extra parameters (`page`, `h`, `item`), which a live link can carry too. */
export function placeFromParams(params: URLSearchParams): Place {
  const page = params.get('page')
  const heading = params.get('h')
  const item = Number(params.get('item'))
  return {
    ...(isPageId(page) ? { page } : {}),
    ...(heading && /^[\w-]{1,64}$/.test(heading) ? { heading } : {}),
    ...(params.has('item') && Number.isSafeInteger(item) && item >= 0 ? { item } : {}),
  }
}

/** A `#open=` link's target, or null when the hash isn't one. */
export function openFromHash(hash: string): LinkTarget | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const board = params.get('open')
  if (!board || !KEY.test(board)) return null
  return { board, ...placeFromParams(params) }
}

/** The hash (without `#`) for a place. */
export function placeParams(p: Place): string {
  return [p.page !== undefined ? `page=${p.page}` : '', p.heading ? `h=${p.heading}` : '', p.item !== undefined ? `item=${p.item}` : ''].filter(Boolean).join('&')
}

export function openHash(board: string, p: Place = {}): string {
  const rest = placeParams(p)
  return `open=${board}${rest ? `&${rest}` : ''}`
}

/** The target of a BrainCraft web link pasted as text, or null for anything else. */
export function targetFromUrl(text: string): LinkTarget | null {
  const t = text.trim()
  if (!/^https?:\/\/\S+#open=/.test(t)) return null
  try {
    return openFromHash(new URL(t).hash)
  } catch {
    return null
  }
}
