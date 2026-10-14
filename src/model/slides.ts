/** Presenting a board: its frames become slides, in reading order. */

import { bounds, getItem, itemBounds } from './board'
import type { Rect } from './geom'
import { plainNote } from './notes'
import type { Board, Id, Item } from './types'

export interface Slide {
  /** The frame, or undefined for the whole-board slide of a board without frames. */
  id?: Id
  title: string
  rect: Rect
  /** The frame's comments, shown as speaker notes. */
  notes: string[]
}

/** Room for a frame's title, which is drawn above it. */
const TITLE_ROOM = 34

const contains = (outer: Item, inner: Item) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

/**
 * Frames in reading order: rows from top to bottom, left to right within a row.
 * Frames sitting inside a bigger frame still count; a board without frames is one slide.
 */
export function slides(b: Board): Slide[] {
  const frames = b.items.filter((i) => i.kind === 'frame')
  if (!frames.length) {
    const all = bounds(b)
    return all ? [{ title: b.title, rect: all, notes: [] }] : []
  }
  // Frames whose tops are within half the typical frame height of each other share a row.
  const heights = frames.map((f) => f.h).sort((a, z) => a - z)
  const tolerance = heights[Math.floor(heights.length / 2)] / 2
  const sorted = [...frames].sort((a, z) => a.y - z.y)
  const rows: Item[][] = []
  for (const f of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - f.y) <= tolerance)
    if (row) row.push(f)
    else rows.push([f])
  }
  return rows
    .flatMap((r) => r.sort((a, z) => a.x - z.x))
    .map((f) => {
      const r = itemBounds(f)
      return {
        id: f.id,
        title: f.text || 'Untitled frame',
        rect: f.text ? { x: r.x, y: r.y - TITLE_ROOM, w: r.w, h: r.h + TITLE_ROOM } : r,
        notes: (f.notes ?? []).map((n) => plainNote(n.text)),
      }
    })
}

/** Which slide to start on: the selected frame, or the frame holding the selection, or the first. */
export function startSlide(b: Board, list: Slide[], selection: Iterable<Id>): number {
  for (const id of selection) {
    const direct = list.findIndex((s) => s.id === id)
    if (direct >= 0) return direct
    const item = getItem(b, id)
    if (!item) continue
    const holder = list.findIndex((s) => {
      const f = s.id !== undefined ? getItem(b, s.id) : undefined
      return f && contains(f, item)
    })
    if (holder >= 0) return holder
  }
  return 0
}
