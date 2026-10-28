/**
 * Boards inside boards. A board with thousands of objects gets slow to work in, so a part of it can
 * move to a board of its own: a frame and everything in it go to a new board, and a card linking to
 * that board takes their place. Lines from outside to something that moved now end at the card.
 */

import { emptyBoard, getItem, itemsWithin, newItem, subtree } from './board'
import type { Board, Connector, Id, Item } from './types'

/** From this many objects a board can feel slow, so splitting it is suggested. */
export const HEAVY_BOARD = 4000

/** Everything that moves with a frame to a board of its own: the frame, what's in it, and whole mind maps. */
export function frameMembers(b: Board, frameId: Id): Set<Id> {
  const frame = getItem(b, frameId)
  if (frame?.kind !== 'frame') return new Set()
  const out = new Set<Id>([frameId, ...itemsWithin(b, frame, new Set())])
  // A mind map goes whole or not at all: its ideas are laid out from its central one.
  for (const id of [...out]) {
    const i = getItem(b, id)
    if (i?.kind !== 'mind') continue
    let root = i
    while (root.parent !== undefined) {
      const p = getItem(b, root.parent)
      if (!p) break
      root = p
    }
    for (const d of subtree(b, root.id)) out.add(d)
  }
  return out
}

/**
 * The new board for a frame: its objects (the frame at the top left), the lines between them, the
 * databases they show, and (given `back`) a card above that leads back to the board it came from.
 */
export function boardOfFrame(b: Board, frameId: Id, back?: { key: string; title: string }): Board | null {
  const frame = getItem(b, frameId)
  if (frame?.kind !== 'frame') return null
  const members = frameMembers(b, frameId)
  const dx = -frame.x
  const dy = -frame.y
  const items: Item[] = b.items
    .filter((i) => members.has(i.id))
    .map((i) => ({ ...i, x: i.x + dx, y: i.y + dy, ...(i.points ? { points: i.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : {}) }))
  const connectors = b.connectors.filter((c) => members.has(c.from) && members.has(c.to))
  if (back) {
    const title = back.title || 'the board it came from'
    items.push({ id: b.nextId, ...newItem('rect', { x: 0, y: -150, w: 300, h: 90 }, { text: `↩ Back to ${title}`, color: '#ffffff', linkTo: { board: back.key, label: title } }) })
  }
  const used = new Set(items.flatMap((i) => (i.view ? [i.view.dataset] : [])))
  const datasets = (b.datasets ?? []).filter((d) => used.has(d.id))
  return {
    ...emptyBoard(frame.text || 'Part of a board'),
    items,
    connectors,
    nextId: b.nextId + (back ? 1 : 0),
    ...(datasets.length ? { datasets } : {}),
    ...(b.sketch ? { sketch: b.sketch } : {}),
  }
}

/**
 * The board once a frame has moved to its own board (`key` links to it): the frame and its objects
 * gone, a card linking there in their place, and lines from outside ending at the card.
 */
export function withoutFrame(b: Board, frameId: Id, key: string): { board: Board; card: Id } | null {
  const frame = getItem(b, frameId)
  if (frame?.kind !== 'frame') return null
  const members = frameMembers(b, frameId)
  const title = frame.text || 'Part of a board'
  const moved = members.size - 1
  const card: Item = {
    id: b.nextId,
    ...newItem('rect', { x: frame.x, y: frame.y, w: Math.min(Math.max(frame.w, 240), 360), h: 130 }, {
      text: `📋 ${title}\n${moved} object${moved === 1 ? '' : 's'}, on a board of their own`,
      color: '#ffffff',
      linkTo: { board: key, label: title },
    }),
  }
  const connectors: Connector[] = []
  const seen = new Set<string>()
  for (const c of b.connectors) {
    const inFrom = members.has(c.from)
    const inTo = members.has(c.to)
    if (inFrom && inTo) continue
    if (!inFrom && !inTo) {
      connectors.push(c)
      continue
    }
    // One end moved: the line now ends at the card (once per outside object and direction).
    const next = { ...c, from: inFrom ? card.id : c.from, to: inTo ? card.id : c.to }
    const k = `${next.from}>${next.to}`
    if (seen.has(k)) continue
    seen.add(k)
    connectors.push(next)
  }
  return {
    board: { ...b, items: [...b.items.filter((i) => !members.has(i.id)), card], connectors, nextId: b.nextId + 1 },
    card: card.id,
  }
}
