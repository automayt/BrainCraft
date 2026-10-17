/**
 * The board as the assistant reads it: one line per object instead of JSON, which is about a
 * third of the tokens. Big boards list their structure (frames, mind-map roots, tables and
 * other widgets), the selection and what's on screen; the rest can be read by area, by kind,
 * or found by text.
 */

import { type Rect, intersects } from '../model/geom'
import { objectLabel } from '../model/notes'
import type { Board, Id, Item, Kind } from '../model/types'

/** Above this many objects, the board is summarised instead of listed in full. */
export const FULL_LIST = 250

const STRUCTURE = new Set<Kind>(['frame', 'table', 'kanban', 'timeline', 'data'])

const quote = (s: string) => JSON.stringify(s)

export function objectLine(i: Item): string {
  const parts = [`${i.id} ${i.kind}`, `(${Math.round(i.x)},${Math.round(i.y)} ${Math.round(i.w)}x${Math.round(i.h)})`, quote(objectLabel(i))]
  if (i.kind === 'mind' && i.parent !== undefined) parts.push(`parent:${i.parent}`)
  if (i.kind === 'flow' && i.shape) parts.push(`shape:${i.shape}`)
  if (i.notes?.length) parts.push(`comments:${i.notes.length}`)
  if (i.description) parts.push('has-description')
  if (i.reactions) parts.push(`reactions:${Object.entries(i.reactions).map(([e, who]) => `${e}×${who.length}`).join(',')}`)
  if (i.poll) parts.push(`vote-card options:${i.poll.options.join(',')} ${i.poll.ended ? 'closed' : i.poll.revealed ? 'revealed' : 'counts-hidden'}`)
  return parts.join(' ')
}

export interface BoardTextOptions {
  kind?: Kind
  /** Only objects touching this area. */
  area?: Rect
  /** Listed first and always included (the selection). */
  focus?: Id[]
  /** What's on screen, for big boards. */
  view?: Rect
}

export function boardText(b: Board, o: BoardTextOptions = {}): string {
  const counts = new Map<Kind, number>()
  for (const i of b.items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1)
  const head = `Board ${quote(b.title)}: ${b.items.length} objects (${[...counts].map(([k, n]) => `${n} ${k}`).join(', ') || 'empty'}), ${b.connectors.length} lines.`

  let pool = b.items.filter((i) => (!o.kind || i.kind === o.kind) && (!o.area || intersects(o.area, i)))
  const focus = new Set(o.focus ?? [])
  const filtered = !!(o.kind || o.area)
  let note = ''
  if (pool.length > FULL_LIST) {
    // Too many to list: the selection, then structure, then what's on screen, up to the limit.
    const pick = new Map<Id, Item>()
    const add = (i: Item) => pick.size < FULL_LIST && pick.set(i.id, i)
    for (const i of pool) if (focus.has(i.id)) add(i)
    for (const i of pool) if (STRUCTURE.has(i.kind) || (i.kind === 'mind' && i.parent === undefined)) add(i)
    if (o.view) for (const i of pool) if (intersects(o.view, i)) add(i)
    for (const i of pool) add(i)
    const left = pool.length - pick.size
    pool = [...pick.values()]
    note = `Showing ${pool.length} of ${pool.length + left}: the selection, frames, mind-map roots, widgets, then what's on screen. Read other parts with read_board {"area": {x,y,w,h}} or {"kind": …}, or search with find.`
  }
  // The selection first, then board order.
  pool.sort((a, z) => Number(focus.has(z.id)) - Number(focus.has(a.id)))
  const ids = new Set(pool.map((i) => i.id))
  const lines = b.connectors.filter((c) => ids.has(c.from) || ids.has(c.to))
  const sections = [
    [head, filtered ? `Filter: ${[o.kind && `kind ${o.kind}`, o.area && `area ${Math.round(o.area.x)},${Math.round(o.area.y)} ${Math.round(o.area.w)}x${Math.round(o.area.h)}`].filter(Boolean).join(', ')}.` : ''],
    ['Objects — id kind (x,y wxh) "label" [extras]:', ...pool.map(objectLine)],
    [note],
    lines.length ? ['Lines — from->to "label":', ...lines.map((c) => `${c.from}->${c.to}${c.label ? ` ${quote(c.label)}` : ''}${ids.has(c.from) && ids.has(c.to) ? '' : ' (one end not listed)'}`)] : [],
  ]
  return sections
    .map((lines) => lines.filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
}
