/**
 * Private brainstorms: while a round is open, each sticky note someone writes
 * shows only to them; everyone else sees a blank card with the writer's name,
 * until someone reveals the lot. Nobody's first idea steers the rest.
 *
 * Like hidden vote counts, this is hidden on screen only: every browser in the
 * session holds the whole board. It keeps friends honest, not secrets safe.
 */

import { addItem, getItem, newItem, updateItem } from './board'
import { rectFromCenter, type Vec } from './geom'
import type { Board, Id, Item } from './types'

/** The open round (the newest brainstorm card not yet revealed), if any. */
export function openRound(b: Board): Item | undefined {
  for (let k = b.items.length - 1; k >= 0; k--) {
    const i = b.items[k]
    if (i.brainstorm && !i.brainstorm.revealed) return i
  }
  return undefined
}

/** Starts a round: a card with the prompt, centred on `at`. */
export function startBrainstorm(b: Board, at: Vec, by: string, prompt = ''): [Board, Id] {
  return addItem(
    b,
    newItem('comment', rectFromCenter(at, 340, 180), {
      text: prompt.trim() || 'What ideas do we have?',
      color: '#bdeedd',
      brainstorm: { by },
      createdAt: Date.now(),
    }),
  )
}

/** While a round is open, sticky notes that `after` added (and `before` didn't have) are stamped as `me`'s. */
export function stampNew(before: Board, after: Board, me: string): Board {
  if (before === after || !openRound(after)) return after
  const had = new Set(before.items.map((i) => i.id))
  let out = after
  for (const i of after.items) {
    if (i.kind === 'sticky' && !had.has(i.id) && !i.hiddenBy) out = updateItem(out, i.id, (x) => ({ ...x, hiddenBy: me }))
  }
  return out
}

/** Whether `me` should see `item` blanked: someone else's note in an open round. */
export const isMasked = (item: Item, me: string, open: boolean) => open && !!item.hiddenBy && item.hiddenBy !== me

/**
 * The board as `me` may see it: other people's hidden notes have their text
 * (and comments) taken out. For drawing and searching only; never save it.
 */
export function maskFor(b: Board, me: string): Board {
  const open = !!openRound(b)
  if (!open || !b.items.some((i) => isMasked(i, me, open))) return b
  return {
    ...b,
    items: b.items.map((i) => {
      if (!isMasked(i, me, open)) return i
      const masked: Item = { ...i, text: '', masked: true }
      delete masked.notes
      delete masked.description
      return masked
    }),
  }
}

/** How many hidden notes the round has, and from how many people. */
export function roundStats(b: Board): { notes: number; people: number } {
  const hidden = b.items.filter((i) => i.hiddenBy)
  return { notes: hidden.length, people: new Set(hidden.map((i) => i.hiddenBy)).size }
}

/** Shows everyone's notes and closes the round. */
export function reveal(b: Board, card: Id): Board {
  if (!getItem(b, card)?.brainstorm) return b
  let out = b
  for (const i of b.items) {
    if (!i.hiddenBy) continue
    out = updateItem(out, i.id, (x) => {
      const next: Item = { ...x }
      delete next.hiddenBy
      return next
    })
  }
  return updateItem(out, card, (x) => ({ ...x, brainstorm: { ...x.brainstorm!, revealed: true } }))
}
