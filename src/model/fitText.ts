/**
 * Text that always fits its shape. Flowchart symbols and shapes size their text to the shape by
 * default, larger or smaller; one given a size with the text buttons (`fontFixed`) keeps it, and
 * sticky notes keep theirs, but either still shrinks rather than spill out of the shape.
 */

import { hiddenIds, itemBounds } from './board'
import { codeSize } from './code'
import { type Rect, center, contains, containsRect, expand, unionAll } from './geom'
import type { Measure } from './mindmap'
import { textRect } from './shapes'
import { tableSize } from './table'
import { KANBAN_COL_W } from './kanban'
import { groups, titleField, viewSize } from './dataset'
import { type Board, type DataView, type Dataset, type Item, type KanbanData, type Kind, WIDGET_TITLE_H, defaultSize, flowShapeInfo } from './types'

/** The smallest text gets, however much there is. */
export const MIN_FONT = 6
/** The largest text grows to in a big shape. */
export const MAX_FIT_FONT = 72
/** How much of its shape growing text fills, so it doesn't touch the edges. */
const GROW_FILL = 0.8

/** Objects whose text is sized to the shape unless given a size. */
const GROWS = new Set<Kind>(['flow', 'rect', 'ellipse'])
/** Objects whose text shrinks to fit (all of these; growing ones as well). */
const FITS = new Set<Kind>(['flow', 'rect', 'ellipse', 'sticky'])

export const growsText = (i: Pick<Item, 'kind'>) => GROWS.has(i.kind)
export const fitsText = (i: Pick<Item, 'kind'>) => FITS.has(i.kind)

/**
 * The largest whole font size, from `min` to `max`, at which `text` wrapped to the box's width fits
 * its height (`min` when even that doesn't).
 */
export function fitFontSize(measure: Measure, text: string, box: { w: number; h: number }, max: number, o: { min?: number; weight?: number; hand?: boolean } = {}): number {
  const min = Math.min(o.min ?? MIN_FONT, max)
  if (!text.trim() || box.w <= 2 || box.h <= 0) return max
  const fits = (s: number) => {
    const m = measure(text, s, o.weight ?? 400, box.w - 2, o.hand)
    return m.w <= box.w && m.h <= box.h
  }
  if (fits(max)) return Math.floor(max)
  let lo = Math.floor(min)
  let hi = Math.floor(max)
  if (!fits(lo)) return lo
  // fits(lo), and the largest size that fits is below hi.
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** The size an object's text is drawn at: its own, or fitted to its shape. */
export function itemFontSize(i: Item, measure: Measure): number {
  if (!fitsText(i)) return i.fontSize
  const box = textRect(i)
  const hand = !!i.sketch
  const fitted = fitFontSize(measure, i.text, box, i.fontSize, { hand })
  if (!growsText(i) || i.fontFixed || fitted < i.fontSize) return fitted
  // Room to spare: grow, leaving a margin. Text too long for that keeps its size, as it fits.
  return Math.max(fitted, fitFontSize(measure, i.text, { w: box.w * GROW_FILL, h: box.h * GROW_FILL }, MAX_FIT_FONT, { hand }))
}

// ----- fitting objects to what's in them -----------------------------------------

/** How close a frame wraps what's in it. */
const FRAME_PAD = 40
/** The narrowest wrap for text before it goes onto another line, by kind. */
const WRAP: Partial<Record<Kind, number>> = { flow: 280, rect: 320, ellipse: 260 }
/** A decision wraps sooner, so it stays a diamond rather than a sliver. */
const DECISION_WRAP = 170
const MIN_W = 72
const MIN_H = 44

/** Objects Fit to content resizes: shapes and sticky notes to their text, text boxes, code, tables, Kanban boards, database views, and frames to what's inside. */
export function canFitToContent(i: Item): boolean {
  return fitsText(i) || i.kind === 'text' || i.kind === 'frame' || i.kind === 'code' || (i.kind === 'table' && !!i.table) || (i.kind === 'kanban' && !!i.kanban) || (i.kind === 'data' && !!i.view)
}

/** Objects Same size makes alike. */
export const canMatchSize = (i: Item) => fitsText(i) || i.kind === 'comment'

/** The smallest whole value from `lo` for which `ok` holds (`ok` holding for every larger one), up to `hi`. */
function least(lo: number, hi: number, ok: (v: number) => boolean): number {
  if (ok(lo)) return lo
  if (!ok(hi)) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ok(mid)) hi = mid
    else lo = mid
  }
  return hi
}

const around = (i: Item, w: number, h: number): Rect => ({ x: Math.round(i.x + (i.w - w) / 2), y: Math.round(i.y + (i.h - h) / 2), w, h })

/**
 * Where an object goes when fitted to what's in it, or null when there's nothing to fit it to (a
 * frame with nothing in it). Shapes keep their centre; an empty one goes back to its usual size.
 */
export function fitToContent(b: Board, i: Item, measure: Measure): Rect | null {
  const hand = !!i.sketch
  if (i.kind === 'frame') {
    // What's in it: whatever sits mostly inside (its centre within), so strays are taken in too.
    const hidden = hiddenIds(b)
    const inside = b.items.filter((o) => o.id !== i.id && !hidden.has(o.id) && !(o.kind === 'frame' && containsRect(o, i)) && contains(i, center(itemBounds(o))))
    const box = unionAll(inside.map(itemBounds))
    return box && expand(box, FRAME_PAD)
  }
  if (i.kind === 'table') return i.table ? { x: i.x, y: i.y, ...tableSize(i.table) } : null
  if (i.kind === 'code') return { x: i.x, y: i.y, ...codeSize(i.text) }
  if (i.kind === 'kanban') return i.kanban ? { x: i.x, y: i.y, ...kanbanFit(i.kanban, measure) } : null
  if (i.kind === 'data') {
    const ds = i.view && b.datasets?.find((d) => d.id === i.view!.dataset)
    if (!ds) return null
    return { x: i.x, y: i.y, ...(i.view!.type === 'board' ? boardViewFit(ds, i.view!, measure) : viewSize(ds, i.view!.type)) }
  }
  if (i.kind === 'text') {
    const text = i.text || ' '
    const one = measure(text, i.fontSize, 400, 1e6, hand).w
    const w = Math.ceil(Math.min(800, Math.max(40, one)) + 8)
    return { x: i.x, y: i.y, w, h: Math.ceil(measure(text, i.fontSize, 400, w - 10, hand).h + 8) }
  }
  if (!fitsText(i)) return null
  if (!i.text.trim()) {
    const usual = i.kind === 'flow' ? flowShapeInfo(i.shape) : defaultSize(i.kind)
    return around(i, usual.w, usual.h)
  }
  const font = i.fontSize
  const fitsAt = (w: number, h: number) => {
    const r = textRect({ ...i, w, h })
    const m = measure(i.text, font, 400, r.w - 2, hand)
    return m.w <= r.w && m.h <= r.h
  }
  if (i.kind === 'sticky') {
    // Sticky notes stay square.
    const s = least(100, 4000, (v) => fitsAt(v, v))
    return around(i, s, s)
  }
  // Wrap at the text's own width, up to a comfortable line, then find the smallest shape around it.
  const wrap = Math.min(i.shape === 'decision' ? DECISION_WRAP : (WRAP[i.kind] ?? 300), measure(i.text, font, 400, 1e6, hand).w)
  const m = measure(i.text, font, 400, wrap, hand)
  let w = MIN_W
  let h = MIN_H
  for (let round = 0; round < 3; round++) {
    w = least(MIN_W, 4000, (v) => textRect({ ...i, w: v, h }).w >= m.w)
    h = least(MIN_H, 4000, (v) => textRect({ ...i, w, h: v }).h >= m.h)
  }
  // Rounding in the outline (an ellipse's, a decision's) can leave it a pixel short: grow until it fits.
  for (let k = 0; k < 20 && !fitsAt(w, h); k++) {
    w += 2
    h += 2
  }
  return around(i, w, h)
}

/** Several objects made one size, the largest of them (so each one's text still fits), each about its own centre. */
export function sameSize(items: Item[]): Map<Item['id'], Rect> {
  const w = Math.max(...items.map((i) => i.w))
  const h = Math.max(...items.map((i) => i.h))
  return new Map(items.map((i) => [i.id, around(i, w, h)]))
}

// ----- Kanban boards ---------------------------------------------------------------

/** Kanban measurements, as styles.css lays a board out. */
const KB = {
  pad: 12,
  gap: 12,
  addColumn: 28,
  header: 40,
  cardFont: 14,
  cardLine: 14 * 1.4,
  /** A card's padding and border, top and bottom. */
  cardPadY: 20,
  /** The width a card's title wraps at: the column less the card's padding, border and ⋯ button. */
  cardText: KANBAN_COL_W - 16 - 39 - 5 - 2,
  date: 23,
  cardGap: 8,
  empty: 53,
  addCard: 31,
  bottom: 8 + 4,
}

/** The size a Kanban board takes to show every column and card without scrolling. */
export function kanbanFit(k: KanbanData, measure: Measure): { w: number; h: number } {
  const n = Math.max(1, k.columns.length)
  const w = KB.pad * 2 + n * KANBAN_COL_W + n * KB.gap + KB.addColumn + 2
  let tallest = 0
  for (const col of k.columns) {
    let h = KB.header + KB.addCard + KB.bottom
    if (!col.cards.length) h += KB.empty
    for (const [index, card] of col.cards.entries()) {
      const lines = Math.max(1, Math.round(measure(card.title || 'Untitled', KB.cardFont, 400, KB.cardText).h / (KB.cardFont * 1.3)))
      h += KB.cardPadY + lines * KB.cardLine + (card.start || card.due ? KB.date : 0) + (index ? KB.cardGap : 0)
    }
    tallest = Math.max(tallest, h)
  }
  return { w: Math.ceil(w), h: Math.ceil(WIDGET_TITLE_H + KB.pad * 2 + tallest + 2) }
}

/** A database's board view, as styles.css lays it out. */
const DB = { col: 236, gap: 12, pad: 12, bar: 42, header: 33, cardPad: 41, cardText: 236 - 16 - 24, addCard: 23 + 8, bottom: 8 + 2 + 4 }

/** The size a database's board view takes to show every column and card without scrolling. */
export function boardViewFit(ds: Dataset, view: DataView, measure: Measure): { w: number; h: number } {
  const gs = groups(ds, view)
  const title = titleField(ds)
  let tallest = 0
  for (const g of gs) {
    let h = DB.header + DB.addCard + DB.bottom
    for (const [index, r] of g.records.entries()) {
      const text = String(r.values[title.id] ?? '') || 'Untitled'
      const lines = Math.max(1, Math.round(measure(text, KB.cardFont, 600, DB.cardText).h / (KB.cardFont * 1.3)))
      h += DB.cardPad + lines * KB.cardLine + (index ? KB.cardGap : 0)
    }
    tallest = Math.max(tallest, h)
  }
  const n = Math.max(1, gs.length)
  return { w: DB.pad * 2 + n * (DB.col + DB.gap) + KB.addColumn + 4, h: Math.ceil(WIDGET_TITLE_H + DB.bar + DB.pad * 2 + tallest + 2) }
}
