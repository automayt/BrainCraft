/**
 * Reactions and dot voting.
 *
 * Reactions are emoji anyone can put on any object, with who did it. A vote is a card (a
 * comment block with a `poll`) that names its options; each person gets a few votes to spread
 * over them, and the counts stay hidden until someone reveals them. Both are plain fields on
 * items, so they sync, undo and save like everything else.
 */

import { addItem, bounds, getItem, newItem, translate, updateItem } from './board'
import type { Board, Id, Item, Poll } from './types'

export const REACTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '⭐'] as const

/** Puts `who`'s `emoji` on the item, or takes it off again. */
export function toggleReaction(i: Item, emoji: string, who: string): Item {
  const now = i.reactions?.[emoji] ?? []
  const next = now.includes(who) ? now.filter((w) => w !== who) : [...now, who]
  const reactions = { ...i.reactions, [emoji]: next }
  if (!next.length) delete reactions[emoji]
  const out: Item = { ...i, reactions }
  if (!Object.keys(reactions).length) delete out.reactions
  return out
}

/** Reactions with at least one person, most popular first. */
export function reactionList(i: Item): { emoji: string; who: string[] }[] {
  return Object.entries(i.reactions ?? {})
    .filter(([, who]) => who.length)
    .map(([emoji, who]) => ({ emoji, who }))
    .sort((a, z) => z.who.length - a.who.length)
}

// ----- dot voting --------------------------------------------------------------------

export const pollOf = (b: Board, id: Id): (Item & { poll: Poll }) | undefined => {
  const card = getItem(b, id)
  return card?.poll ? (card as Item & { poll: Poll }) : undefined
}

/** The vote that's open now (the newest one not ended). */
export function activePoll(b: Board): (Item & { poll: Poll }) | undefined {
  for (let k = b.items.length - 1; k >= 0; k--) {
    const i = b.items[k]
    if (i.poll && !i.poll.ended) return i as Item & { poll: Poll }
  }
  return undefined
}

const key = (poll: Id) => String(poll)

/** A record's own entry (people's names like "constructor" aren't object built-ins). */
const own = <T>(r: Record<string, T> | undefined, k: string): T | undefined => (r && Object.hasOwn(r, k) ? r[k] : undefined)

/** `who`'s votes on one option. */
export const votesBy = (i: Item, poll: Id, who: string) => {
  const n = own(own(i.votes, key(poll)), who)
  return typeof n === 'number' ? n : 0
}

/** All votes on one option. */
export const totalVotes = (i: Item, poll: Id) => Object.values(own(i.votes, key(poll)) ?? {}).reduce((a, n) => a + (typeof n === 'number' ? n : 0), 0)

/** How many of their votes `who` has used in this poll. */
export function usedVotes(b: Board, poll: Id, who: string): number {
  const p = pollOf(b, poll)
  if (!p) return 0
  return p.poll.options.reduce((sum, id) => sum + (getItem(b, id) ? votesBy(getItem(b, id)!, poll, who) : 0), 0)
}

/** People who have voted so far. */
export function voters(b: Board, poll: Id): string[] {
  const p = pollOf(b, poll)
  const who = new Set<string>()
  for (const id of p?.poll.options ?? []) for (const [name, n] of Object.entries(getItem(b, id)?.votes?.[key(poll)] ?? {})) if (n > 0) who.add(name)
  return [...who]
}

/** Adds (+1) or takes back (−1) one of `who`'s votes on an option, within their allowance. */
export function castVote(b: Board, poll: Id, option: Id, who: string, delta: 1 | -1): Board {
  const p = pollOf(b, poll)
  if (!p || p.poll.ended || !p.poll.options.includes(option)) return b
  const item = getItem(b, option)
  if (!item) return b
  const mine = votesBy(item, poll, who)
  if (delta > 0 && usedVotes(b, poll, who) >= p.poll.each) return b
  if (delta < 0 && mine <= 0) return b
  return updateItem(b, option, (i) => {
    const forPoll = { ...i.votes?.[key(poll)], [who]: mine + delta }
    if (!forPoll[who]) delete forPoll[who]
    return { ...i, votes: { ...i.votes, [key(poll)]: forPoll } }
  })
}

export function setRevealed(b: Board, poll: Id, revealed: boolean): Board {
  return updateItem(b, poll, (i) => (i.poll ? { ...i, poll: { ...i.poll, revealed } } : i))
}

/** Closes a vote: the results stay on show, and no more votes can be cast. */
export function endPoll(b: Board, poll: Id): Board {
  return updateItem(b, poll, (i) => (i.poll ? { ...i, poll: { ...i.poll, ended: true, revealed: true } } : i))
}

/** Options with their totals, most votes first. */
export function results(b: Board, poll: Id): { item: Item; votes: number }[] {
  const p = pollOf(b, poll)
  return (p?.poll.options ?? [])
    .map((id) => getItem(b, id))
    .filter((i): i is Item => !!i)
    .map((item) => ({ item, votes: totalVotes(item, poll) }))
    .sort((a, z) => z.votes - a.votes)
}

/** Starts a vote on `options`: a card just above them saying how it works. */
export function startPoll(b: Board, options: Id[], opts: { question?: string; each?: number } = {}): [Board, Id] {
  const ids = options.filter((id) => getItem(b, id) && !getItem(b, id)!.poll)
  const box = bounds(b, new Set(ids)) ?? { x: 0, y: 0, w: 0, h: 0 }
  const each = Math.max(1, Math.min(10, opts.each ?? Math.max(1, Math.min(5, Math.ceil(ids.length / 3)))))
  const card = newItem('comment', { x: box.x, y: box.y - 170, w: 320, h: 140 }, {
    text: opts.question?.trim() || 'Vote for your favourites',
    color: '#c9b8ff',
    poll: { options: ids, each, revealed: false },
    createdAt: Date.now(),
  })
  return addItem(b, card)
}

/** Lays the options out in a grid by votes, most first, where they were. */
export function sortByVotes(b: Board, poll: Id): Board {
  const ranked = results(b, poll).map((r) => r.item)
  if (!ranked.length) return b
  const box = bounds(b, new Set(ranked.map((i) => i.id)))!
  const cols = Math.max(1, Math.ceil(Math.sqrt(ranked.length)))
  const cellW = Math.max(...ranked.map((i) => i.w)) + 24
  const cellH = Math.max(...ranked.map((i) => i.h)) + 24
  let out = b
  ranked.forEach((i, k) => {
    const x = box.x + (k % cols) * cellW
    const y = box.y + Math.floor(k / cols) * cellH
    out = translate(out, new Set([i.id]), x - i.x, y - i.y)
  })
  return out
}
