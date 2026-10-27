/**
 * The board as the assistant reads it: one line per object instead of JSON, which is about a
 * third of the tokens. Big boards list their structure (frames, mind-map roots, tables and
 * other widgets), the selection and what's on screen; the rest can be read by area, by kind,
 * or found by text.
 */

import { type Rect, intersects } from '../model/geom'
import { objectLabel } from '../model/notes'
import * as TT from '../model/timeTracking'
import type { Board, Id, Item, Kind } from '../model/types'

/** Above this many objects, the board is summarised instead of listed in full. */
export const FULL_LIST = 250

const STRUCTURE = new Set<Kind>(['frame', 'table', 'kanban', 'timeline', 'data'])

const quote = (s: string) => JSON.stringify(s)
/** Long widget contents are cut short; the rest can be read with get_object. */
const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n)}… (more with get_object)` : s)

export function objectLine(i: Item): string {
  const parts = [`${i.id} ${i.kind}`, `(${Math.round(i.x)},${Math.round(i.y)} ${Math.round(i.w)}x${Math.round(i.h)})`, quote(objectLabel(i))]
  if (i.masked) parts.push("hidden:someone-else's-private-brainstorm-note(leave-it-alone)")
  if (i.kind === 'mind' && i.parent !== undefined) parts.push(`parent:${i.parent}`)
  if (i.kind === 'flow' && i.shape) parts.push(`shape:${i.shape}`)
  if (typeof i.back === 'string') parts.push(i.flipped ? 'flip-card:showing-back' : 'flip-card:showing-front')
  if (i.status) parts.push(`status:${i.status}`)
  if (i.assignees) parts.push(`assigned:${i.assignees.join(',')}`)
  if (i.estimate) parts.push(`estimate:${i.estimate}min`)
  if (i.kind === 'link' && i.link) parts.push(`url:${i.link.url}`)
  if (i.notes?.length) parts.push(`comments:${i.notes.length}`)
  if (i.description) parts.push('has-description')
  if (i.reactions) parts.push(`reactions:${Object.entries(i.reactions).map(([e, who]) => `${e}×${who.length}`).join(',')}`)
  if (i.poll) parts.push(`vote-card options:${i.poll.options.join(',')} ${i.poll.ended ? 'closed' : i.poll.revealed ? 'revealed' : 'counts-hidden'}`)
  // What's in a widget, so a change to it can be made without reading it first.
  if (i.kind === 'kanban' && i.kanban) parts.push(`columns:${quote(clip(i.kanban.columns.map((c) => `${c.title}[${c.cards.map((k) => k.title).join('; ')}]`).join(' | ')))}`)
  if (i.kind === 'table' && i.table) {
    const cols = i.table.columns
    parts.push(`rows:${quote(clip([cols.map((c) => c.name).join('|'), ...i.table.rows.map((r) => cols.map((c) => r.cells[c.id] ?? '').join('|'))].join('; ')))}`)
  }
  if (i.kind === 'timeline' && i.timeline) {
    const t = i.timeline
    parts.push(`lanes:${quote(clip(t.lanes.map((l) => `${l.name}[${t.entries.filter((e) => e.lane === l.id).map((e) => `${e.title} ${e.start}${e.end ? `..${e.end}` : ''}`).join('; ')}]`).join(' | ')))}`)
  }
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
    b.time?.length ? [timeLine(b)] : [],
  ]
  return sections
    .map((lines) => lines.filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
}

/** Time tracked, in brief: the total, who's timing what now, and the most time by what it was on. */
function timeLine(b: Board): string {
  const now = Date.now()
  const s = TT.summarize(b, {}, now)
  const running = TT.running(b).map((e) => `${e.who} on ${quote(TT.describeTarget(b, e.on, e.label).label)}`)
  const top = s.byTarget.slice(0, 8).map((t) => `${quote(t.label)} ${TT.hours(t.ms)}h`)
  return `Time tracked: ${TT.hours(s.total)}h (${s.byPerson.map((p) => `${p.who} ${TT.hours(p.ms)}h`).join(', ')}). ${running.length ? `Timing now: ${running.join(', ')}. ` : ''}Most on: ${top.join(', ')}. Every entry: read_time.`
}
