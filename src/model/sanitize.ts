/**
 * Boards arrive from files, share links, pasted clips and other people in
 * live sessions, so every field is checked before anything draws it: wrong
 * types are repaired or dropped and long strings cut, rather than crashing
 * every viewer. The loader, the clip paste and the live room all use this.
 */

import type { Patch } from '../collab/patch'
import type {
  Board,
  Connector,
  DataRecord,
  DataView,
  Dataset,
  Field,
  FieldValue,
  Item,
  KanbanData,
  Kind,
  LinkCard,
  Note,
  Poll,
  RunRecord,
  SelectOption,
  Status,
  TableData,
  TimelineData,
} from './types'
import { defaultColor, defaultFontSize } from './types'

export const KINDS: readonly Kind[] = ['sticky', 'rect', 'ellipse', 'text', 'frame', 'pen', 'mind', 'flow', 'comment', 'image', 'table', 'kanban', 'timeline', 'data', 'link', 'code']
const STATUSES: readonly Status[] = ['todo', 'doing', 'waiting', 'undecided', 'done', 'dropped']
const FLOW_SHAPES = ['process', 'decision', 'terminator', 'data', 'document', 'database', 'subroutine']
const VIEW_TYPES = ['table', 'board', 'timeline', 'calendar', 'gallery']
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'person', 'checkbox']
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const day = (v: unknown): string | undefined => (typeof v === 'string' && ISO_DAY.test(v) ? v : undefined)
const TEXT_MAX = 100_000
const NAME_MAX = 500

function cleanLink(v: unknown): LinkCard | undefined {
  if (!isObj(v)) return undefined
  const url = str(v.url, 2048)
  if (!url) return undefined
  const out: LinkCard = { url }
  const title = str(v.title, 300)
  const description = str(v.description, 500)
  const image = str(v.image, 2048)
  const site = str(v.site, 120)
  if (title) out.title = title
  if (description) out.description = description
  if (image) out.image = image
  if (site) out.site = site
  if (v.checked === true) out.checked = true
  return out
}

function cleanNotes(v: unknown): Note[] | undefined {
  const notes = arr(v).flatMap((n): Note[] => {
    if (!isObj(n) || typeof n.text !== 'string') return []
    const note: Note = { id: str(n.id, 64) || Math.random().toString(36).slice(2), text: n.text.slice(0, TEXT_MAX), at: num(n.at) ?? 0 }
    const author = str(n.author, 60)
    if (author) note.author = author
    return [note]
  })
  return notes.length ? notes : undefined
}

function cleanTable(v: unknown): TableData | undefined {
  if (!isObj(v)) return undefined
  const columns = arr(v.columns).flatMap((c) =>
    isObj(c) && typeof c.id === 'string' ? [{ id: c.id.slice(0, 64), name: str(c.name, NAME_MAX) ?? '', width: num(c.width) ?? 160, ...(c.hidden === true ? { hidden: true } : {}) }] : [],
  )
  if (!columns.length) return undefined
  const rows = arr(v.rows).flatMap((r) => {
    if (!isObj(r) || typeof r.id !== 'string') return []
    const cells: Record<string, string> = {}
    if (isObj(r.cells)) for (const [k, val] of Object.entries(r.cells)) if (typeof val === 'string' || typeof val === 'number') cells[k] = String(val).slice(0, TEXT_MAX)
    return [{ id: r.id.slice(0, 64), cells, ...(r.hidden === true ? { hidden: true } : {}) }]
  })
  const out: TableData = { columns, rows }
  if (isObj(v.sort) && typeof v.sort.column === 'string' && (v.sort.dir === 'asc' || v.sort.dir === 'desc')) out.sort = { column: v.sort.column, dir: v.sort.dir }
  if (isObj(v.filters)) {
    const filters: Record<string, string> = {}
    for (const [k, val] of Object.entries(v.filters)) if (typeof val === 'string') filters[k] = val.slice(0, NAME_MAX)
    out.filters = filters
  }
  if (v.showFilters === true) out.showFilters = true
  if (v.showHidden === true) out.showHidden = true
  return out
}

function cleanKanban(v: unknown): KanbanData | undefined {
  if (!isObj(v)) return undefined
  const columns = arr(v.columns).flatMap((c) => {
    if (!isObj(c) || typeof c.id !== 'string') return []
    const cards = arr(c.cards).flatMap((k) => {
      if (!isObj(k) || typeof k.id !== 'string') return []
      return [
        {
          id: k.id.slice(0, 64),
          title: str(k.title, TEXT_MAX) ?? '',
          ...(str(k.color, 32) ? { color: str(k.color, 32) } : {}),
          ...(day(k.start) ? { start: day(k.start) } : {}),
          ...(day(k.due) ? { due: day(k.due) } : {}),
        },
      ]
    })
    return [{ id: c.id.slice(0, 64), title: str(c.title, NAME_MAX) ?? '', cards }]
  })
  return columns.length ? { columns } : undefined
}

function cleanTimeline(v: unknown): TimelineData | undefined {
  if (!isObj(v)) return undefined
  const lanes = arr(v.lanes).flatMap((l) => (isObj(l) && typeof l.id === 'string' ? [{ id: l.id.slice(0, 64), name: str(l.name, NAME_MAX) ?? '' }] : []))
  const entries = arr(v.entries).flatMap((e) => {
    if (!isObj(e) || typeof e.id !== 'string' || typeof e.lane !== 'string' || !day(e.start)) return []
    const after = arr(e.after).filter((x): x is string => typeof x === 'string')
    return [
      {
        id: e.id.slice(0, 64),
        lane: e.lane,
        title: str(e.title, TEXT_MAX) ?? '',
        start: day(e.start)!,
        ...(day(e.end) ? { end: day(e.end) } : {}),
        color: str(e.color, 32) ?? '#888888',
        ...(after.length ? { after } : {}),
      },
    ]
  })
  const out: TimelineData = { lanes, entries }
  const sources = arr(v.sources).filter((s): s is number => num(s) !== undefined)
  if (sources.length) out.sources = sources
  if (isObj(v.range) && day(v.range.start) && day(v.range.end)) out.range = { start: day(v.range.start)!, end: day(v.range.end)! }
  return out
}

function cleanView(v: unknown): DataView | undefined {
  if (!isObj(v) || typeof v.dataset !== 'string' || !VIEW_TYPES.includes(v.type as string)) return undefined
  const out: DataView = { dataset: v.dataset, type: v.type as DataView['type'] }
  if (isObj(v.sort) && typeof v.sort.field === 'string' && (v.sort.dir === 'asc' || v.sort.dir === 'desc')) out.sort = { field: v.sort.field, dir: v.sort.dir }
  const query = str(v.query, NAME_MAX)
  if (query) out.query = query
  const hidden = arr(v.hidden).filter((h): h is string => typeof h === 'string')
  if (hidden.length) out.hidden = hidden
  for (const k of ['groupBy', 'start', 'end'] as const) if (typeof v[k] === 'string') out[k] = v[k] as string
  if (typeof v.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v.month)) out.month = v.month
  return out
}

function cleanRuns(v: unknown): RunRecord[] | undefined {
  const runs = arr(v).flatMap((r): RunRecord[] => {
    if (!isObj(r) || typeof r.id !== 'string') return []
    const steps = arr(r.steps).flatMap((s) =>
      isObj(s) && num(s.node) !== undefined && num(s.at) !== undefined
        ? [{ node: s.node as number, text: str(s.text, NAME_MAX) ?? '', at: s.at as number, ...(str(s.choice, NAME_MAX) ? { choice: str(s.choice, NAME_MAX) } : {}), ...(str(s.note, TEXT_MAX) ? { note: str(s.note, TEXT_MAX) } : {}) }]
        : [],
    )
    return [{ id: r.id.slice(0, 64), startedAt: num(r.startedAt) ?? 0, endedAt: num(r.endedAt) ?? 0, status: r.status === 'done' ? 'done' : 'stopped', steps, ...(str(r.by, 60) ? { by: str(r.by, 60) } : {}) }]
  })
  return runs.length ? runs : undefined
}

/** People's names as record keys: own keys only, so "constructor" is just a name. */
function cleanReactions(v: unknown): Record<string, string[]> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, string[]> = Object.create(null)
  for (const [emoji, who] of Object.entries(v)) {
    const names = arr(who).filter((n): n is string => typeof n === 'string').map((n) => n.slice(0, 60))
    if (names.length && emoji.length <= 16) out[emoji] = names
  }
  return Object.keys(out).length ? { ...out } : undefined
}

function cleanVotes(v: unknown): Record<string, Record<string, number>> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, Record<string, number>> = {}
  for (const [poll, byPerson] of Object.entries(v)) {
    if (!isObj(byPerson)) continue
    const counts: Record<string, number> = {}
    for (const [person, n] of Object.entries(byPerson)) if (num(n) !== undefined && (n as number) > 0) counts[person.slice(0, 60)] = Math.min(100, Math.floor(n as number))
    if (Object.keys(counts).length) out[poll] = counts
  }
  return Object.keys(out).length ? out : undefined
}

function cleanPoll(v: unknown): Poll | undefined {
  if (!isObj(v)) return undefined
  const options = arr(v.options).filter((o): o is number => num(o) !== undefined)
  return { options, each: Math.max(1, Math.min(10, Math.floor(num(v.each) ?? 1))), revealed: v.revealed === true, ...(v.ended === true ? { ended: true } : {}) }
}

/**
 * The item with every field checked: wrong types repaired or dropped, long
 * strings cut. Null when it can't be used at all (no id, unknown kind, no position).
 */
export function cleanItem(raw: unknown): Item | null {
  if (!isObj(raw)) return null
  const id = num(raw.id)
  const kind = raw.kind as Kind
  if (id === undefined || !Number.isInteger(id) || !KINDS.includes(kind)) return null
  const x = num(raw.x)
  const y = num(raw.y)
  const w = num(raw.w)
  const h = num(raw.h)
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null
  const out: Item = {
    id,
    kind,
    x,
    y,
    w: Math.max(0, w),
    h: Math.max(0, h),
    color: str(raw.color, 32) ?? defaultColor(kind),
    text: str(raw.text, TEXT_MAX) ?? '',
    fontSize: num(raw.fontSize) && (raw.fontSize as number) > 0 ? Math.min(400, raw.fontSize as number) : defaultFontSize(kind),
  }
  if (kind === 'pen') {
    out.points = arr(raw.points).flatMap((p) => (isObj(p) && num(p.x) !== undefined && num(p.y) !== undefined ? [{ x: p.x as number, y: p.y as number }] : []))
    // A drawing with no points is nothing to draw (and nothing to hit).
    if (!out.points.length) return null
    const sw = num(raw.strokeWidth)
    if (sw) out.strokeWidth = sw
  }
  const parent = num(raw.parent)
  if (parent !== undefined && parent !== id) out.parent = parent
  if (raw.side === 'left' || raw.side === 'right') out.side = raw.side
  if (isObj(raw.offset) && num(raw.offset.x) !== undefined && num(raw.offset.y) !== undefined) out.offset = { x: raw.offset.x as number, y: raw.offset.y as number }
  if (raw.collapsed === true) out.collapsed = true
  if (typeof raw.shape === 'string' && FLOW_SHAPES.includes(raw.shape)) out.shape = raw.shape as Item['shape']
  const description = str(raw.description, TEXT_MAX)
  if (description) out.description = description
  const notes = cleanNotes(raw.notes)
  if (notes) out.notes = notes
  const src = str(raw.src, 16 * 1024 * 1024)
  if (src) out.src = src
  const createdAt = num(raw.createdAt)
  if (createdAt !== undefined) out.createdAt = createdAt
  const runs = cleanRuns(raw.runs)
  if (runs) out.runs = runs
  if (kind === 'table') {
    const table = cleanTable(raw.table)
    if (table) out.table = table
  }
  if (kind === 'data') {
    const view = cleanView(raw.view)
    if (!view) return null
    out.view = view
  }
  if (kind === 'kanban') {
    const kanban = cleanKanban(raw.kanban)
    if (kanban) out.kanban = kanban
  }
  if (kind === 'timeline') {
    const timeline = cleanTimeline(raw.timeline)
    if (timeline) out.timeline = timeline
  }
  if (kind === 'link') {
    const link = cleanLink(raw.link)
    if (!link) return null
    out.link = link
  }
  const reactions = cleanReactions(raw.reactions)
  if (reactions) out.reactions = reactions
  const votes = cleanVotes(raw.votes)
  if (votes) out.votes = votes
  if (raw.poll !== undefined) {
    const poll = cleanPoll(raw.poll)
    if (poll) out.poll = poll
  }
  if (raw.locked === true) out.locked = true
  const group = str(raw.group, 64)
  if (group) out.group = group
  if (STATUSES.includes(raw.status as Status)) out.status = raw.status as Status
  for (const k of ['by', 'hiddenBy'] as const) {
    const v = str(raw[k], 60)
    if (v) out[k] = v
  }
  const hiddenRound = num(raw.hiddenRound)
  if (hiddenRound !== undefined) out.hiddenRound = hiddenRound
  if (typeof raw.back === 'string') out.back = raw.back.slice(0, TEXT_MAX)
  if (raw.flipped === true) out.flipped = true
  const lang = str(raw.lang, 32)
  if (lang) out.lang = lang
  if (isObj(raw.brainstorm)) out.brainstorm = { by: str(raw.brainstorm.by, 60) ?? '', ...(raw.brainstorm.revealed === true ? { revealed: true } : {}) }
  if (isObj(raw.wheel)) {
    const s = raw.wheel.spin
    if (isObj(s) && [s.at, s.from, s.to, s.result].every((n) => num(n) !== undefined)) {
      const label = str(s.label, 200)
      out.wheel = { spin: { at: s.at as number, from: s.from as number, to: s.to as number, result: Math.max(0, Math.floor(s.result as number)), ...(label ? { label } : {}) } }
    } else out.wheel = {}
  }
  return out
}

function cleanOption(v: unknown): SelectOption | null {
  return isObj(v) && typeof v.id === 'string' ? { id: v.id.slice(0, 64), name: str(v.name, NAME_MAX) ?? '', color: str(v.color, 32) ?? '#888888' } : null
}

function cleanField(v: unknown): Field | null {
  if (!isObj(v) || typeof v.id !== 'string' || !FIELD_TYPES.includes(v.type as string)) return null
  const f: Field = { id: v.id.slice(0, 64), name: str(v.name, NAME_MAX) ?? '', type: v.type as Field['type'] }
  if (f.type === 'select') f.options = arr(v.options).map(cleanOption).filter((o): o is SelectOption => !!o)
  return f
}

function cleanRecord(v: unknown): DataRecord | null {
  if (!isObj(v) || typeof v.id !== 'string') return null
  const values: Record<string, FieldValue> = {}
  if (isObj(v.values))
    for (const [k, val] of Object.entries(v.values)) {
      if (typeof val === 'string') values[k] = val.slice(0, TEXT_MAX)
      else if ((typeof val === 'number' && Number.isFinite(val)) || typeof val === 'boolean') values[k] = val
    }
  return { id: v.id.slice(0, 64), values }
}

/** A dataset with typed fields and plain values, or null if it has no usable fields. */
export function cleanDataset(v: unknown): Dataset | null {
  if (!isObj(v) || typeof v.id !== 'string') return null
  const fields = arr(v.fields).map(cleanField).filter((f): f is Field => !!f)
  if (!fields.length) return null
  return { id: v.id.slice(0, 64), name: str(v.name, NAME_MAX) ?? '', fields, records: arr(v.records).map(cleanRecord).filter((r): r is DataRecord => !!r) }
}

export function cleanConnector(v: unknown): Connector | null {
  if (!isObj(v)) return null
  const id = num(v.id)
  const from = num(v.from)
  const to = num(v.to)
  if (id === undefined || from === undefined || to === undefined) return null
  const c: Connector = { id, from, to, color: str(v.color, 32) ?? '#6e6e78' }
  const label = str(v.label, NAME_MAX)
  if (label) c.label = label
  if (v.style === 'straight' || v.style === 'elbow' || v.style === 'curved') c.style = v.style
  if (v.arrows === 'end' || v.arrows === 'both' || v.arrows === 'none') c.arrows = v.arrows
  if (v.dashed === true) c.dashed = true
  return c
}

/** A board icon worth keeping: a short string. */
export const cleanIcon = (v: unknown): string | undefined => (typeof v === 'string' && v && v.length <= 16 ? v : undefined)

/** The board with every item, connector and dataset checked and the icon validated. */
export function cleanBoard(b: Board): Board {
  const items = b.items.map(cleanItem).filter((i): i is Item => !!i)
  const out: Board = { ...b, items }
  const icon = cleanIcon(b.icon)
  if (icon) out.icon = icon
  else delete out.icon
  return out
}

/** Live-session patches checked the same way; patches that can't be used are dropped. */
export function cleanPatches(patches: readonly unknown[]): Patch[] {
  const out: Patch[] = []
  for (const raw of patches) {
    if (!isObj(raw)) continue
    const p = raw as Record<string, unknown>
    switch (p.k) {
      case 'item': {
        const id = num(p.id)
        if (id === undefined) break
        if (p.v === null) out.push({ k: 'item', id, v: null })
        else {
          // The object must say it's the one being changed: no smuggling a second copy of another id.
          const v = cleanItem(p.v)
          if (v && v.id === id) out.push({ k: 'item', id, v })
        }
        break
      }
      case 'conn': {
        const id = num(p.id)
        if (id === undefined) break
        if (p.v === null) out.push({ k: 'conn', id, v: null })
        else {
          const v = cleanConnector(p.v)
          if (v && v.id === id) out.push({ k: 'conn', id, v })
        }
        break
      }
      case 'title':
        if (typeof p.v === 'string') out.push({ k: 'title', v: p.v.slice(0, NAME_MAX) })
        break
      case 'icon':
        out.push({ k: 'icon', v: cleanIcon(p.v) ?? null })
        break
      case 'order':
        if (Array.isArray(p.v) && p.v.every((x) => num(x) !== undefined)) out.push({ k: 'order', v: p.v as number[] })
        break
      case 'ds': {
        if (typeof p.id !== 'string') break
        if (p.v === null) {
          out.push({ k: 'ds', id: p.id, v: null })
          break
        }
        const m = p.v
        if (!isObj(m) || m.id !== p.id || !Array.isArray(m.order) || !m.order.every((x) => typeof x === 'string')) break
        const fields = arr(m.fields).map(cleanField).filter((f): f is Field => !!f)
        if (fields.length) out.push({ k: 'ds', id: p.id, v: { id: p.id, name: str(m.name, NAME_MAX) ?? '', fields, order: m.order as string[] } })
        break
      }
      case 'rec': {
        if (typeof p.ds !== 'string' || typeof p.id !== 'string') break
        if (p.v === null) out.push({ k: 'rec', ds: p.ds, id: p.id, v: null })
        else {
          const v = cleanRecord(p.v)
          if (v && v.id === p.id) out.push({ k: 'rec', ds: p.ds, id: p.id, v })
        }
        break
      }
    }
  }
  return out
}
