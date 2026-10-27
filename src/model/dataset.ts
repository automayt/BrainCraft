/**
 * Linked data: a dataset of typed records, kept once on the board and shown by any number of
 * `data` items as a table, a board (Kanban, grouped by a field) or a timeline (by date fields).
 * Edit a record anywhere and every view shows the change.
 */

import { FormulaError, type FormulaValue, compile } from './formula'
import { formatDuration } from './duration'
import { fromDay, isIsoDay, toDay, today } from './timeline'
import { uid } from './uid'
import {
  BRANCHES,
  type RollupFn,
  type Board,
  type DataRecord,
  type DataView,
  type DataViewType,
  type Dataset,
  type Field,
  type FieldType,
  type FieldValue,
  type Item,
  type KanbanData,
  type SelectOption,
  type TableData,
  type TimelineData,
} from './types'

export const FIELD_TYPES: { type: FieldType; label: string; icon: string }[] = [
  { type: 'text', label: 'Text', icon: 'Aa' },
  { type: 'number', label: 'Number', icon: '#' },
  { type: 'date', label: 'Date', icon: '◷' },
  { type: 'select', label: 'Choice', icon: '◉' },
  { type: 'person', label: 'Person', icon: '☺' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑' },
  { type: 'relation', label: 'Relation', icon: '↗' },
  { type: 'rollup', label: 'Rollup', icon: 'Σ' },
  { type: 'formula', label: 'Formula', icon: 'ƒ' },
  { type: 'tracked', label: 'Time tracked', icon: '⏱' },
]

/** Fields worked out from others, never typed into (or stored). */
/** Worked out, never set: rollups, formulas, and the time tracked on each record (in hours). */
export const isComputed = (f: Field) => f.type === 'rollup' || f.type === 'formula' || f.type === 'tracked'

/** The record ids a relation value links to. */
export const relIds = (v: FieldValue | undefined): string[] => (typeof v === 'string' && v ? v.split(',').filter(Boolean) : [])
export const relValue = (ids: readonly string[]) => [...new Set(ids)].join(',')

export const ROLLUP_FNS: { fn: RollupFn; label: string }[] = [
  { fn: 'count', label: 'Count' },
  { fn: 'filled', label: 'Count filled in' },
  { fn: 'sum', label: 'Sum' },
  { fn: 'average', label: 'Average' },
  { fn: 'min', label: 'Smallest' },
  { fn: 'max', label: 'Largest' },
  { fn: 'earliest', label: 'Earliest date' },
  { fn: 'latest', label: 'Latest date' },
  { fn: 'percentDone', label: 'Percent ticked' },
  { fn: 'list', label: 'List them' },
]

export const VIEW_TYPES: { type: DataViewType; label: string }[] = [
  { type: 'table', label: 'Table' },
  // "Kanban": "board" already means the whole canvas.
  { type: 'board', label: 'Kanban' },
  { type: 'timeline', label: 'Timeline' },
  { type: 'calendar', label: 'Calendar' },
  { type: 'gallery', label: 'Gallery' },
  { type: 'form', label: 'Form' },
]

/** Colours handed to new choices, in order. */
export const OPTION_COLORS = BRANCHES.map(([, c]) => c)

const field = (name: string, type: FieldType, options?: string[]): Field => ({
  id: uid(),
  name,
  type,
  ...(options ? { options: options.map((o, k) => ({ id: uid(), name: o, color: OPTION_COLORS[k % OPTION_COLORS.length] })) } : {}),
})

// ----- datasets on the board ------------------------------------------------------------

export function getDataset(b: Board, id: string | undefined): Dataset | undefined {
  return id ? b.datasets?.find((d) => d.id === id) : undefined
}

export function addDataset(b: Board, ds: Dataset): Board {
  return { ...b, datasets: [...(b.datasets ?? []), ds] }
}

export function updateDataset(b: Board, id: string, f: (d: Dataset) => Dataset): Board {
  const ds = getDataset(b, id)
  if (!ds) return b
  const next = f(ds)
  return next === ds ? b : { ...b, datasets: b.datasets!.map((d) => (d.id === id ? next : d)) }
}

/** Datasets no view shows any more (after views are deleted). */
export function dropUnusedDatasets(b: Board): Board {
  if (!b.datasets?.length) return b
  const used = new Set(b.items.flatMap((i) => (i.view ? [i.view.dataset] : [])))
  const kept = b.datasets.filter((d) => used.has(d.id))
  return kept.length === b.datasets.length ? b : { ...b, datasets: kept }
}

/** Every view of a dataset. */
export const viewsOf = (b: Board, dataset: string): Item[] => b.items.filter((i) => i.view?.dataset === dataset)

// ----- fields ---------------------------------------------------------------------------

export const titleField = (ds: Dataset): Field => ds.fields[0]
export const fieldById = (ds: Dataset, id: string | undefined) => (id ? ds.fields.find((f) => f.id === id) : undefined)
export const fieldByName = (ds: Dataset, name: string) => ds.fields.find((f) => f.name.toLowerCase() === name.trim().toLowerCase())

export function addField(ds: Dataset, name: string, type: FieldType): [Dataset, string] {
  let n = name.trim() || FIELD_TYPES.find((t) => t.type === type)!.label
  // Keep names unique so operations can refer to fields by name.
  for (let k = 2; fieldByName(ds, n); k++) n = `${name.trim() || 'Field'} ${k}`
  const f = field(n, type, type === 'select' ? [] : undefined)
  return [{ ...ds, fields: [...ds.fields, f] }, f.id]
}

/** Changes a field's settings (a formula, what a relation links to, how a rollup sums up). */
export function setFieldConfig(ds: Dataset, id: string, patch: Pick<Field, 'formula' | 'relation' | 'rollup'>): Dataset {
  return { ...ds, fields: ds.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }
}

export function renameField(ds: Dataset, id: string, name: string): Dataset {
  const n = name.trim()
  if (!n || ds.fields.some((f) => f.id !== id && f.name.toLowerCase() === n.toLowerCase())) return ds
  return { ...ds, fields: ds.fields.map((f) => (f.id === id ? { ...f, name: n } : f)) }
}

/** Removes a field and its values. The first (title) field stays. */
export function deleteField(ds: Dataset, id: string): Dataset {
  if (ds.fields[0]?.id === id) return ds
  return {
    ...ds,
    fields: ds.fields.filter((f) => f.id !== id),
    records: ds.records.map((r) => {
      if (!(id in r.values)) return r
      const values = { ...r.values }
      delete values[id]
      return { ...r, values }
    }),
  }
}

const TRUE = /^(true|yes|y|x|✓|✔|done|1)$/i

/** Turns a value into what a field of `type` holds, or undefined when it can't. */
export function coerce(f: Field, v: FieldValue | null | undefined): FieldValue | undefined {
  if (v === null || v === undefined || v === '') return undefined
  switch (f.type) {
    case 'number': {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''))
      return Number.isFinite(n) ? n : undefined
    }
    case 'date': {
      const s = String(v).trim()
      if (isIsoDay(s)) return s
      const d = new Date(s)
      return Number.isNaN(d.getTime()) ? undefined : fromDay(today(d))
    }
    case 'checkbox':
      return typeof v === 'boolean' ? v : TRUE.test(String(v).trim())
    case 'rollup':
    case 'formula':
      return undefined
    case 'relation': {
      const ids = relValue(String(v).split(',').map((s) => s.trim()).filter(Boolean))
      return ids || undefined
    }
    case 'select': {
      // Option ids pass through; names are looked up.
      const s = String(v).trim()
      const opt = f.options?.find((o) => o.id === s) ?? f.options?.find((o) => o.name.toLowerCase() === s.toLowerCase())
      return opt?.id
    }
    default:
      return String(v)
  }
}

/** Changes a field's type, converting what it can (choices are made from distinct texts). */
export function changeFieldType(ds: Dataset, id: string, type: FieldType): Dataset {
  const old = fieldById(ds, id)
  if (!old || old.type === type) return ds
  // Links, formulas and rollups start afresh: nothing typed converts into them.
  if (type === 'relation' || isComputed({ ...old, type })) {
    const next: Field = { id: old.id, name: old.name, type, ...(type === 'formula' ? { formula: '' } : {}), ...(type === 'rollup' ? { rollup: { relation: '', fn: 'count' as const } } : {}) }
    return {
      ...ds,
      fields: ds.fields.map((f) => (f.id === id ? next : f)),
      records: ds.records.map((r) => {
        if (!(id in r.values)) return r
        const values = { ...r.values }
        delete values[id]
        return { ...r, values }
      }),
    }
  }
  const texts = ds.records.map((r) => display(ds, old, r.values[id]))
  let next: Field = { ...old, type }
  delete next.options
  if (type === 'select') {
    const names = [...new Set(texts.filter(Boolean))]
    next = { ...next, options: names.map((n, k) => ({ id: uid(), name: n, color: OPTION_COLORS[k % OPTION_COLORS.length] })) }
  }
  return {
    ...ds,
    fields: ds.fields.map((f) => (f.id === id ? next : f)),
    records: ds.records.map((r, k) => {
      const v = coerce(next, texts[k])
      const values = { ...r.values }
      if (v === undefined) delete values[id]
      else values[id] = v
      return { ...r, values }
    }),
  }
}

export function addOption(ds: Dataset, fieldId: string, name: string): [Dataset, string | null] {
  const f = fieldById(ds, fieldId)
  const n = name.trim()
  if (!f || f.type !== 'select' || !n) return [ds, null]
  const existing = f.options?.find((o) => o.name.toLowerCase() === n.toLowerCase())
  if (existing) return [ds, existing.id]
  const opt: SelectOption = { id: uid(), name: n, color: OPTION_COLORS[(f.options?.length ?? 0) % OPTION_COLORS.length] }
  return [{ ...ds, fields: ds.fields.map((x) => (x.id === fieldId ? { ...x, options: [...(x.options ?? []), opt] } : x)) }, opt.id]
}

export function updateOption(ds: Dataset, fieldId: string, optionId: string, change: Partial<Omit<SelectOption, 'id'>>): Dataset {
  return {
    ...ds,
    fields: ds.fields.map((f) => (f.id === fieldId ? { ...f, options: f.options?.map((o) => (o.id === optionId ? { ...o, ...change } : o)) } : f)),
  }
}

/** Removes a choice; records that had it are left without a value. */
export function deleteOption(ds: Dataset, fieldId: string, optionId: string): Dataset {
  return {
    ...ds,
    fields: ds.fields.map((f) => (f.id === fieldId ? { ...f, options: f.options?.filter((o) => o.id !== optionId) } : f)),
    records: ds.records.map((r) => {
      if (r.values[fieldId] !== optionId) return r
      const values = { ...r.values }
      delete values[fieldId]
      return { ...r, values }
    }),
  }
}

// ----- records --------------------------------------------------------------------------

/** Adds a record (after `after`, or at the end); values are keyed by field id. */
export function addRecord(ds: Dataset, values: Record<string, FieldValue> = {}, after?: string): [Dataset, string] {
  const r: DataRecord = { id: uid(), values }
  const at = after ? ds.records.findIndex((x) => x.id === after) + 1 : 0
  const records = ds.records.slice()
  records.splice(at > 0 ? at : records.length, 0, r)
  return [{ ...ds, records }, r.id]
}

export function setValue(ds: Dataset, recordId: string, fieldId: string, value: FieldValue | null | undefined): Dataset {
  const f = fieldById(ds, fieldId)
  if (!f) return ds
  const v = coerce(f, value)
  return {
    ...ds,
    records: ds.records.map((r) => {
      if (r.id !== recordId || r.values[fieldId] === v) return r
      const values = { ...r.values }
      if (v === undefined) delete values[fieldId]
      else values[fieldId] = v
      return { ...r, values }
    }),
  }
}

/** Sets a record's page (empty removes it). */
export function setBody(ds: Dataset, recordId: string, text: string): Dataset {
  return {
    ...ds,
    records: ds.records.map((r) => {
      if (r.id !== recordId || (r.body ?? '') === text) return r
      const next = { ...r }
      if (text.trim()) next.body = text
      else delete next.body
      return next
    }),
  }
}

export function deleteRecord(ds: Dataset, recordId: string): Dataset {
  return { ...ds, records: ds.records.filter((r) => r.id !== recordId) }
}

/** Moves a record to sit just before `before` (or last). */
export function moveRecord(ds: Dataset, recordId: string, before: string | null): Dataset {
  const r = ds.records.find((x) => x.id === recordId)
  if (!r || recordId === before) return ds
  const rest = ds.records.filter((x) => x.id !== recordId)
  const at = before ? rest.findIndex((x) => x.id === before) : -1
  rest.splice(at < 0 ? rest.length : at, 0, r)
  return { ...ds, records: rest }
}

/** Values keyed by field name (as people and AI assistants write them) → keyed by field id. */
export function valuesByName(ds: Dataset, named: Record<string, unknown>, link?: (f: Field, raw: unknown) => string | undefined): { values: Record<string, FieldValue>; unknown: string[]; ds: Dataset } {
  const values: Record<string, FieldValue> = {}
  const unknown: string[] = []
  let next = ds
  for (const [name, raw] of Object.entries(named)) {
    const f = fieldByName(next, name)
    if (!f) {
      unknown.push(name)
      continue
    }
    if (raw === null || raw === undefined || raw === '') continue
    // Worked out, never set.
    if (isComputed(f)) continue
    if (f.type === 'relation') {
      const v = link ? link(f, raw) : coerce(f, raw as FieldValue)
      if (v) values[f.id] = v
      continue
    }
    if (f.type === 'select') {
      // New choices are added as they're used.
      const [withOpt, opt] = addOption(next, f.id, String(raw))
      next = withOpt
      if (opt) values[f.id] = opt
      continue
    }
    const v = coerce(f, raw as FieldValue)
    if (v !== undefined) values[f.id] = v
  }
  return { values, unknown, ds: next }
}

// ----- showing values -------------------------------------------------------------------

export const optionOf = (f: Field, v: FieldValue | undefined) => (f.type === 'select' && typeof v === 'string' ? f.options?.find((o) => o.id === v) : undefined)

export function display(_ds: Dataset, f: Field, v: FieldValue | undefined): string {
  if (v === undefined || v === '') return ''
  switch (f.type) {
    case 'select':
      return optionOf(f, v)?.name ?? ''
    case 'checkbox':
      return v ? 'Yes' : ''
    case 'relation': {
      // Titles come with a dataset made ready to show (withComputed); otherwise how many.
      const titles = (f as ShownField).titles
      const ids = relIds(v)
      return titles ? ids.map((x) => titles[x] ?? '').filter(Boolean).join(', ') : `${ids.length} linked`
    }
    case 'tracked':
      return typeof v === 'number' && v > 0 ? formatDuration(v * 3_600_000) : ''
    case 'rollup':
    case 'formula':
      if (typeof v === 'boolean') return v ? '✓' : ''
      if (typeof v === 'number') return f.rollup?.fn === 'percentDone' ? `${Math.round(v)}%` : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
      return String(v)
    case 'number':
      return typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(v)
    default:
      return String(v)
  }
}

export const recordTitle = (ds: Dataset, r: DataRecord) => display(ds, titleField(ds), r.values[titleField(ds).id]) || 'Untitled'

/** Fields a view shows (the title field always). */
export const shownFields = (ds: Dataset, v: DataView) => ds.fields.filter((f, k) => k === 0 || !v.hidden?.includes(f.id))

function compare(f: Field, a: FieldValue | undefined, z: FieldValue | undefined): number {
  if (a === undefined && z === undefined) return 0
  // Empty values sort last either way.
  if (a === undefined) return 1
  if (z === undefined) return -1
  switch (f.type) {
    case 'number':
      return Number(a) - Number(z)
    case 'checkbox':
      return Number(z) - Number(a)
    case 'select': {
      const order = f.options?.map((o) => o.id) ?? []
      return order.indexOf(String(a)) - order.indexOf(String(z))
    }
    default:
      return String(a).localeCompare(String(z), undefined, { numeric: true, sensitivity: 'base' })
  }
}

/** The records a view shows: matching its search, in its sort order (or the dataset's order). */
export function viewRecords(ds: Dataset, v: DataView): DataRecord[] {
  let rows = ds.records
  const q = v.query?.trim().toLowerCase()
  if (q) {
    const fields = shownFields(ds, v)
    rows = rows.filter((r) => fields.some((f) => display(ds, f, r.values[f.id]).toLowerCase().includes(q)))
  }
  const sortField = fieldById(ds, v.sort?.field)
  if (sortField) {
    const dir = v.sort!.dir === 'desc' ? -1 : 1
    rows = [...rows].sort((a, z) => {
      const c = compare(sortField, a.values[sortField.id], z.values[sortField.id])
      // Keep empties last in both directions.
      return a.values[sortField.id] === undefined || z.values[sortField.id] === undefined ? c : c * dir
    })
  }
  return rows
}

// ----- board and timeline views -----------------------------------------------------------

/** The field a board groups by: the view's choice, else the first choice or person field. */
export function groupField(ds: Dataset, v: DataView): Field | undefined {
  const chosen = fieldById(ds, v.groupBy)
  if (chosen && (chosen.type === 'select' || chosen.type === 'person')) return chosen
  return ds.fields.find((f) => f.type === 'select') ?? ds.fields.find((f) => f.type === 'person')
}

export interface Group {
  /** Option id (select), person name, or null for records without a value. */
  key: string | null
  name: string
  color?: string
  records: DataRecord[]
}

export function groups(ds: Dataset, v: DataView): Group[] {
  const f = groupField(ds, v)
  const rows = viewRecords(ds, v)
  if (!f) return [{ key: null, name: 'All', records: rows }]
  const keys: Group[] =
    f.type === 'select'
      ? (f.options ?? []).map((o) => ({ key: o.id, name: o.name, color: o.color, records: [] }))
      : [...new Set(ds.records.map((r) => r.values[f.id]).filter((x): x is string => typeof x === 'string' && !!x))]
          .sort((a, z) => a.localeCompare(z))
          .map((p) => ({ key: p, name: p, records: [] }))
  const none: Group = { key: null, name: `No ${f.name.toLowerCase()}`, records: [] }
  for (const r of rows) {
    const val = r.values[f.id]
    const g = keys.find((k) => k.key === val) ?? none
    g.records.push(r)
  }
  return none.records.length ? [none, ...keys] : keys
}

/** Moves a record into a board column (setting the grouped field) before `before`. */
export function moveToGroup(ds: Dataset, v: DataView, recordId: string, key: string | null, before: string | null): Dataset {
  const f = groupField(ds, v)
  let next = f ? setValue(ds, recordId, f.id, key) : ds
  // A sorted view decides its own order; otherwise the drop position is the order.
  if (!v.sort) next = moveRecord(next, recordId, before)
  return next
}

export function dateFields(ds: Dataset, v: DataView): { start?: Field; end?: Field } {
  const dates = ds.fields.filter((f) => f.type === 'date')
  const start = fieldById(ds, v.start) ?? dates[0]
  const end = fieldById(ds, v.end) ?? dates.find((f) => f.id !== start?.id)
  return { start: start?.type === 'date' ? start : undefined, end: end?.type === 'date' && end.id !== start?.id ? end : undefined }
}

export interface Bar {
  record: DataRecord
  start: number
  /** Inclusive last day; equal to `start` for one-day items and milestones. */
  end: number
  milestone: boolean
}

/** Records with dates, as bars in days; plus how many have no start date. */
export function bars(ds: Dataset, v: DataView): { bars: Bar[]; undated: number } {
  const { start, end } = dateFields(ds, v)
  if (!start) return { bars: [], undated: ds.records.length }
  const out: Bar[] = []
  let undated = 0
  for (const r of viewRecords(ds, v)) {
    const s = r.values[start.id]
    const e = end ? r.values[end.id] : undefined
    if (typeof s !== 'string' || !isIsoDay(s)) {
      // A record with only an end date shows as a milestone on that day.
      if (typeof e === 'string' && isIsoDay(e)) out.push({ record: r, start: toDay(e), end: toDay(e), milestone: true })
      else undated++
      continue
    }
    const a = toDay(s)
    const z = typeof e === 'string' && isIsoDay(e) ? Math.max(a, toDay(e)) : a
    out.push({ record: r, start: a, end: z, milestone: !end || typeof e !== 'string' })
  }
  return { bars: out, undated }
}

/** Shifts a record's dates by whole days (both ends, or just one edge). */
export function shiftDates(ds: Dataset, v: DataView, recordId: string, days: number, edge?: 'start' | 'end'): Dataset {
  if (!days) return ds
  const { start, end } = dateFields(ds, v)
  const r = ds.records.find((x) => x.id === recordId)
  if (!r || !start) return ds
  let next = ds
  const move = (f: Field | undefined) => {
    const val = f ? r.values[f.id] : undefined
    if (f && typeof val === 'string' && isIsoDay(val)) next = setValue(next, recordId, f.id, fromDay(toDay(val) + days))
  }
  if (edge !== 'end') move(start)
  if (edge !== 'start') move(end)
  // Never let the end come before the start.
  if (start && end) {
    const rr = next.records.find((x) => x.id === recordId)!
    const s = rr.values[start.id]
    const e = rr.values[end.id]
    if (typeof s === 'string' && typeof e === 'string' && toDay(e) < toDay(s)) next = setValue(next, recordId, edge === 'start' ? start.id : end.id, edge === 'start' ? e : s)
  }
  return next
}

// ----- calendar and gallery ----------------------------------------------------------------

/** "2026-10" for a day number. */
export const monthOf = (day: number) => fromDay(day).slice(0, 7)

/** A real month written YYYY-MM. */
export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

/** The month `delta` months from `month` (YYYY-MM). */
export function addMonths(month: string, delta: number): string {
  if (!isMonth(month)) month = monthOf(today())
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The 6 weeks shown for a month, Monday first: day numbers, and whether each is in the month. */
export function monthGrid(month: string): { day: number; inMonth: boolean }[] {
  // Anything that isn't a real month shows this month instead of failing.
  if (!isMonth(month)) month = monthOf(today())
  const first = toDay(`${month}-01`)
  // 1970-01-01 (day 0) was a Thursday; Monday-based weekday of the 1st:
  const weekday = (((first + 3) % 7) + 7) % 7
  const start = first - weekday
  return Array.from({ length: 42 }, (_, k) => ({ day: start + k, inMonth: monthOf(start + k) === month }))
}

/** Records by the days they cover (from `start` to `end`) within `days`. */
export function recordsByDay(ds: Dataset, v: DataView, days: { day: number }[]): Map<number, Bar[]> {
  const out = new Map<number, Bar[]>()
  if (!days.length) return out
  const lo = days[0].day
  const hi = days[days.length - 1].day
  for (const b of bars(ds, v).bars) {
    for (let d = Math.max(lo, b.start); d <= Math.min(hi, b.end); d++) out.set(d, [...(out.get(d) ?? []), b])
  }
  return out
}

/** Moves a record so it starts on `day` (keeping its length). */
export function moveToDay(ds: Dataset, v: DataView, recordId: string, day: number): Dataset {
  const b = bars(ds, v).bars.find((x) => x.record.id === recordId)
  const { start } = dateFields(ds, v)
  if (!start) return ds
  if (!b) return setValue(ds, recordId, start.id, fromDay(day))
  return shiftDates(ds, v, recordId, day - b.start)
}

const PICTURE = /^(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?\S*)?|data:image\/[\w+.-]+;base64,\S+)$/i

/** A record's cover picture for the gallery: the first field holding a picture's address. */
export function coverOf(ds: Dataset, r: DataRecord): string | undefined {
  for (const f of ds.fields) {
    const v = r.values[f.id]
    if (f.type === 'text' && typeof v === 'string' && PICTURE.test(v.trim())) return v.trim()
  }
  return undefined
}

// ----- making datasets --------------------------------------------------------------------

export function newDataset(name = 'Projects', now = today()): Dataset {
  const fields = [field('Name', 'text'), field('Status', 'select', ['To do', 'In progress', 'Done']), field('Owner', 'person'), field('Start', 'date'), field('Due', 'date')]
  const [title, status, owner, start, due] = fields
  const opt = (k: number) => status.options![k].id
  const rec = (t: string, s: number, o: string, a: number, z: number): DataRecord => ({
    id: uid(),
    values: { [title.id]: t, [status.id]: opt(s), [owner.id]: o, [start.id]: fromDay(now + a), [due.id]: fromDay(now + z) },
  })
  return {
    id: uid(),
    name,
    fields,
    records: [rec('Research', 2, 'Sam', -10, -3), rec('Design', 1, 'Alex', -2, 6), rec('Build', 0, 'Jo', 5, 20), rec('Launch', 0, 'Sam', 21, 21)],
  }
}

export function newView(dataset: string, type: DataViewType = 'table'): DataView {
  return { dataset, type }
}

const CHOICE_NAME = /^(status|state|stage|phase|priority|severity|type|kind|category|tag|team|lane|area|size|tier|level)$/i
const PERSON_NAME = /^(owner|assignee|assigned( to)?|person|people|who|lead|author|reporter|responsible|dri)$/i

/** Guesses a column's type from its values (and, for people, its name). */
export function inferType(values: string[], name = ''): FieldType {
  const filled = values.map((v) => v.trim()).filter(Boolean)
  if (PERSON_NAME.test(name.trim()) && !filled.some((v) => /^-?\d/.test(v))) return 'person'
  if (!filled.length) return 'text'
  if (filled.every((v) => /^-?[\d,]*\.?\d+$/.test(v))) return 'number'
  if (filled.every((v) => isIsoDay(v))) return 'date'
  if (filled.every((v) => /^(true|false|yes|no|y|n|x|✓|✔)$/i.test(v))) return 'checkbox'
  const distinct = new Set(filled.map((v) => v.toLowerCase()))
  const short = filled.every((v) => v.length <= 30)
  if (short && CHOICE_NAME.test(name.trim()) && distinct.size <= 20) return 'select'
  // Few distinct short values that repeat look like categories.
  if (short && filled.length >= 3 && distinct.size < filled.length && distinct.size <= Math.max(2, Math.min(12, Math.ceil(filled.length * 0.6)))) return 'select'
  return 'text'
}

/** Builds a dataset from columns of text, guessing each column's type. */
export function datasetFromColumns(name: string, columns: string[], rows: string[][]): Dataset {
  let ds: Dataset = { id: uid(), name, fields: [], records: [] }
  const fieldIds: string[] = []
  columns.forEach((c, k) => {
    const type = k === 0 ? 'text' : inferType(rows.map((r) => r[k] ?? ''), c)
    let id: string
    ;[ds, id] = addField(ds, c || `Column ${k + 1}`, type)
    fieldIds.push(id)
  })
  for (const row of rows) {
    const named: Record<string, string> = {}
    columns.forEach((_, k) => (named[ds.fields[k].name] = row[k] ?? ''))
    const { values, ds: withOpts } = valuesByName(ds, named)
    ds = addRecord(withOpts, values)[0]
  }
  return ds
}

export function datasetFromTable(name: string, t: TableData): Dataset {
  return datasetFromColumns(
    name,
    t.columns.map((c) => c.name),
    t.rows.map((r) => t.columns.map((c) => r.cells[c.id] ?? '')),
  )
}

export function datasetFromKanban(name: string, k: KanbanData): Dataset {
  let ds: Dataset = { id: uid(), name, fields: [field('Title', 'text'), field('Status', 'select', k.columns.map((c) => c.title || 'Untitled')), field('Start', 'date'), field('Due', 'date')], records: [] }
  const [title, status, start, due] = ds.fields
  k.columns.forEach((c, n) => {
    for (const card of c.cards) {
      const values: Record<string, FieldValue> = { [title.id]: card.title, [status.id]: status.options![n].id }
      if (card.start) values[start.id] = card.start
      if (card.due) values[due.id] = card.due
      ds = addRecord(ds, values)[0]
    }
  })
  return ds
}

export function datasetFromTimeline(name: string, t: TimelineData): Dataset {
  let ds: Dataset = { id: uid(), name, fields: [field('Title', 'text'), field('Lane', 'select', t.lanes.map((l) => l.name || 'Lane')), field('Start', 'date'), field('End', 'date')], records: [] }
  const [title, lane, start, end] = ds.fields
  for (const e of t.entries) {
    const n = t.lanes.findIndex((l) => l.id === e.lane)
    const values: Record<string, FieldValue> = { [title.id]: e.title, [start.id]: e.start }
    if (n >= 0) values[lane.id] = lane.options![n].id
    if (e.end) values[end.id] = e.end
    ds = addRecord(ds, values)[0]
  }
  return ds
}

/** The dataset as CSV in a view's order and fields (for copying out and for AI assistants). */
export function toCsv(ds: Dataset, v?: DataView): string {
  const fields = v ? shownFields(ds, v) : ds.fields
  const rows = v ? viewRecords(ds, v) : ds.records
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return [fields.map((f) => cell(f.name)), ...rows.map((r) => fields.map((f) => cell(display(ds, f, r.values[f.id]))))].map((l) => l.join(',')).join('\n')
}

/** The dataset as plain records keyed by field name (for AI assistants). */
export function plainRecords(ds: Dataset): Record<string, string | number | boolean>[] {
  return ds.records.map((r) => {
    const out: Record<string, string | number | boolean> = { id: r.id }
    for (const f of ds.fields) {
      const v = r.values[f.id]
      if (v === undefined) continue
      out[f.name] = f.type === 'select' || f.type === 'relation' ? display(ds, f, v) : v
    }
    return out
  })
}

const FIELD_W: Record<FieldType, number> = { text: 220, number: 96, date: 132, select: 140, person: 128, checkbox: 76, relation: 180, rollup: 110, formula: 140, tracked: 110 }

/** A good size for a new view of `ds`. */
export function viewSize(ds: Dataset, type: DataViewType): { w: number; h: number } {
  if (type === 'timeline') {
    const lanes = groupField(ds, { dataset: ds.id, type }) ? groups(ds, { dataset: ds.id, type }).length : 0
    return { w: 960, h: Math.min(600, Math.max(300, 150 + ds.records.length * 30 + lanes * 26)) }
  }
  if (type === 'board') return { w: Math.max(620, Math.min(1400, groups(ds, { dataset: ds.id, type }).length * 248 + 40)), h: 440 }
  if (type === 'calendar') return { w: 860, h: 640 }
  if (type === 'form') return { w: 520, h: Math.min(820, 190 + ds.fields.filter((f) => !isComputed(f) && f.type !== 'relation').length * 78) }
  if (type === 'gallery') return { w: Math.max(560, Math.min(1100, Math.ceil(Math.sqrt(ds.records.length + 1)) * 236 + 40)), h: Math.min(720, Math.max(360, Math.ceil((ds.records.length + 1) / 4) * 250 + 110)) }
  const w = 36 + 40 + ds.fields.reduce((sum, f) => sum + FIELD_W[f.type], 0)
  return { w: Math.max(560, Math.min(1200, w + 2)), h: Math.min(560, Math.max(260, 120 + ds.records.length * 34)) }
}

/** A data item's dataset id, for quick lookups. */
export const datasetOf = (i: Item | undefined): string | undefined => i?.view?.dataset


// ----- worked-out values: relations, rollups and formulas -------------------------------

/** A field as shown: a relation carries the titles of the records it can link to. */
export type ShownField = Field & { titles?: Record<string, string>; problem?: string }

/** What a formula sees for a field's value: words for choices and links, true or false for a tick. */
function plain(ds: Dataset, f: Field, v: FieldValue | undefined): FormulaValue {
  if (v === undefined || v === '') return null
  if (f.type === 'select' || f.type === 'relation') return display(ds, f, v) || null
  return v
}

function rollUp(fn: RollupFn, values: (FieldValue | undefined)[], target: Field | undefined, ds: Dataset | undefined): FieldValue | undefined {
  const filled = values.filter((v) => v !== undefined && v !== '')
  const nums = filled.map((v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : Number(String(v).replace(/[,\s]/g, '')))).filter((n) => Number.isFinite(n))
  const days = filled.filter((v): v is string => typeof v === 'string' && isIsoDay(v)).sort()
  switch (fn) {
    case 'count':
      return values.length
    case 'filled':
      return filled.length
    case 'sum':
      return nums.reduce((a, z) => a + z, 0)
    case 'average':
      return nums.length ? nums.reduce((a, z) => a + z, 0) / nums.length : undefined
    case 'min':
      return nums.length ? Math.min(...nums) : undefined
    case 'max':
      return nums.length ? Math.max(...nums) : undefined
    case 'earliest':
      return days[0]
    case 'latest':
      return days[days.length - 1]
    case 'percentDone':
      return values.length ? (100 * values.filter((v) => v === true).length) / values.length : undefined
    case 'list':
      return target && ds ? filled.map((v) => display(ds, target, v)).filter(Boolean).join(', ') : filled.join(', ')
  }
}

/**
 * The dataset ready to show: relations carry the titles they link to, and every rollup and formula
 * is worked out for each record (in field order, so a formula can use a rollup or an earlier
 * formula). Only for showing, sorting, searching and copying out; changes go to the dataset itself.
 */
export function withComputed(b: Board, ds: Dataset, now = new Date()): Dataset {
  if (!ds.fields.some((f) => f.type === 'relation' || isComputed(f))) return ds
  const others = new Map<string, Dataset>()
  const other = (id: string | undefined) => {
    if (!id) return undefined
    if (id === ds.id) return ds
    if (!others.has(id)) {
      const raw = getDataset(b, id)
      // Rollups of a linked dataset's own formulas: worked out one level deep.
      others.set(id, raw ? withComputed({ ...b, datasets: b.datasets?.filter((d) => d.id !== ds.id) }, raw, now) : (undefined as unknown as Dataset))
    }
    return others.get(id)
  }
  const fields: ShownField[] = ds.fields.map((f) => {
    if (f.type !== 'relation') return f
    const target = other(f.relation?.dataset)
    return { ...f, titles: Object.fromEntries((target?.records ?? []).map((r) => [r.id, recordTitle(target!, r)])) }
  })
  const shown: Dataset = { ...ds, fields }
  // Hours tracked on each record, running timers up to now.
  const tracked = new Map<string, number>()
  if (fields.some((f) => f.type === 'tracked'))
    for (const e of b.time ?? [])
      if (e.on && 'record' in e.on && e.on.dataset === ds.id) tracked.set(e.on.record, (tracked.get(e.on.record) ?? 0) + Math.max(0, (e.end ?? Math.max(now.getTime(), e.start)) - e.start))
  const records = ds.records.map((r) => {
    const values: Record<string, FieldValue> = { ...r.values }
    for (const f of fields) {
      if (f.type === 'tracked') {
        const ms = tracked.get(r.id)
        if (ms) values[f.id] = Math.round((ms / 3_600_000) * 100) / 100
        else delete values[f.id]
      } else if (f.type === 'rollup') {
        const rel = fields.find((x) => x.id === f.rollup?.relation)
        const target = other(rel?.relation?.dataset)
        if (!rel || !target || !f.rollup) continue
        const linked = relIds(r.values[rel.id])
          .map((id) => target.records.find((x) => x.id === id))
          .filter((x): x is DataRecord => !!x)
        const tf = f.rollup.field ? target.fields.find((x) => x.id === f.rollup!.field) : undefined
        const v = rollUp(f.rollup.fn, linked.map((x) => (tf ? x.values[tf.id] : x.id)), tf, target)
        if (v === undefined) delete values[f.id]
        else values[f.id] = v
      } else if (f.type === 'formula') {
        const compiled = compile(f.formula ?? '')
        if (compiled instanceof FormulaError) {
          f.problem = compiled.message
          continue
        }
        try {
          const out = compiled.run((name) => {
            const g = fieldByName(shown, name)
            if (!g) throw new FormulaError(`There's no field called {${name}}`)
            return plain(shown, g, values[g.id])
          }, now)
          if (out === null || out === '' || (typeof out === 'number' && !Number.isFinite(out))) delete values[f.id]
          else values[f.id] = out
        } catch (err) {
          f.problem = (err as Error).message
          values[f.id] = '⚠'
        }
      }
    }
    return { ...r, values }
  })
  return { ...shown, records }
}
