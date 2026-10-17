/**
 * Flip cards: sticky notes with a second side. Flipping swaps the two sides,
 * so whichever side is up is the note's ordinary text: editing, search and
 * export all work on what's showing. Everyone sees the same side.
 */

import { getItem, updateItem } from './board'
import type { Board, Id, Item } from './types'

export const isFlipCard = (i: Item) => i.kind === 'sticky' && typeof i.back === 'string'

/** Gives sticky notes a (blank) back, making them flip cards; or takes the back off again. */
export function setFlipCard(b: Board, ids: Iterable<Id>, on: boolean): Board {
  for (const id of ids) {
    const i = getItem(b, id)
    if (!i || i.kind !== 'sticky' || isFlipCard(i) === on) continue
    b = updateItem(b, id, (x) => {
      const next: Item = { ...x }
      if (on) next.back = ''
      else {
        // Keep the front, whichever side is up.
        if (next.flipped) next.text = next.back ?? ''
        delete next.back
        delete next.flipped
      }
      return next
    })
  }
  return b
}

/** Turns flip cards over. */
export function flip(b: Board, ids: Iterable<Id>): Board {
  for (const id of ids) {
    const i = getItem(b, id)
    if (!i || !isFlipCard(i)) continue
    b = updateItem(b, id, (x) => ({ ...x, text: x.back ?? '', back: x.text, flipped: !x.flipped }))
  }
  return b
}

/** The card's front and back, whichever is up. */
export function sides(i: Item): { front: string; back: string } {
  return i.flipped ? { front: i.back ?? '', back: i.text } : { front: i.text, back: i.back ?? '' }
}
