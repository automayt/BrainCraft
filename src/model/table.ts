/** Tables: a small spreadsheet with sorting, filtering and hidden rows/columns. */

import type { Measure } from './mindmap'
import { uid } from './uid'
import { type Board, type TableColumn, type TableData, type TableRow, WIDGET_TITLE_H } from './types'

export const TOOLBAR_H = 36
export const HEAD_H = 34
export const FILTER_H = 32
/** A row of one line of text; a row with more is taller. */
export const ROW_H = 32
export const ROWNUM_W = 44
/** A column as it's made. */
export const COL_W = 150
/** The narrowest and the widest a column goes. */
export const COL_MIN = 60
export const COL_MAX = 900
/** The narrowest a table is, however few or narrow its columns. */
export const TABLE_MIN_W = 360
/** Fitted to its text, a column stops here: longer text goes onto more lines instead. */
export const FIT_MAX = 420
const FIT_MIN = 90
/** A cell's text as styles.css sets it: its size, the height of a line, and the room around it. */
const CELL_FONT = 14
const CELL_LINE = 20
const CELL_PAD_X = 8
const CELL_PAD_Y = 6
/** What a column's header has beside its name: the buttons to sort it and for more. */
const HEAD_EXTRA = 48

export function newTable(columns = ['Name', 'Status', 'Owner'], rows = 3): TableData {
  const cols = columns.map((name) => ({ id: uid(), name, width: COL_W }))
  return { columns: cols, rows: Array.from({ length: rows }, () => ({ id: uid(), cells: {} })) }
}

export function viewColumns(t: TableData): TableColumn[] {
  return t.showHidden ? t.columns : t.columns.filter((c) => !c.hidden)
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Rows as shown: hidden ones dropped (unless shown), filters applied, then sorted. */
export function viewRows(t: TableData): TableRow[] {
  let rows = t.showHidden ? t.rows : t.rows.filter((r) => !r.hidden)
  for (const [col, q] of Object.entries(t.filters ?? {})) {
    const needle = q.trim().toLowerCase()
    if (needle) rows = rows.filter((r) => (r.cells[col] ?? '').toLowerCase().includes(needle))
  }
  if (t.sort) {
    const { column, dir } = t.sort
    const sign = dir === 'asc' ? 1 : -1
    rows = [...rows].sort((a, z) => {
      const x = (a.cells[column] ?? '').trim()
      const y = (z.cells[column] ?? '').trim()
      // Empty cells always go last.
      if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1)
      return sign * collator.compare(x, y)
    })
  }
  return rows
}

/** The size of a table whose rows come to `rows` high in all. */
function sized(t: TableData, rows: number): { w: number; h: number } {
  // + 2 for the widget's border, or the last pixels scroll (and bring a second scrollbar with them).
  const w = ROWNUM_W + viewColumns(t).reduce((s, c) => s + c.width, 0) + 2
  const h = WIDGET_TITLE_H + TOOLBAR_H + HEAD_H + (t.showFilters ? FILTER_H : 0) + Math.max(ROW_H, rows) + 2
  return { w: Math.max(w, TABLE_MIN_W), h }
}

/**
 * The room a column's text has to wrap in: a hair less than it's drawn with, so a line that only
 * just fits is never counted as one and drawn as two.
 */
const textWidth = (c: TableColumn) => Math.max(8, c.width - 2 * CELL_PAD_X - 1 - 2)

interface Fit {
  measure: Measure
  made: number
  heights: number[]
  w: number
  h: number
}

/** Each table as last measured (tables are never changed in place: a changed one is another object). */
const fits = new WeakMap<TableData, Fit>()
let made = 0

/** Text measures differently now (the fonts have loaded): every table is measured afresh. */
export function forgetFits() {
  made++
}

/** A table measured: how tall each row shown is with its text wrapped, and the size that fits them all. */
function fit(t: TableData, measure: Measure): Fit {
  const hit = fits.get(t)
  if (hit && hit.measure === measure && hit.made === made) return hit
  const cols = viewColumns(t)
  const widths = cols.map(textWidth)
  let total = 0
  const heights = viewRows(t).map((r) => {
    let lines = 1
    for (const [k, c] of cols.entries()) {
      const text = r.cells[c.id]
      if (text) lines = Math.max(lines, Math.round(measure(text, CELL_FONT, 400, widths[k]).h / (CELL_FONT * 1.3)))
    }
    const h = Math.max(ROW_H, lines * CELL_LINE + 2 * CELL_PAD_Y)
    total += h
    return h
  })
  const out = { measure, made, heights, ...sized(t, total) }
  fits.set(t, out)
  return out
}

/**
 * The widget size that fits the table exactly. With a way to measure text, rows are as tall as
 * their longest cell wrapped in its column; without, each is taken for one line.
 */
export function tableSize(t: TableData, measure?: Measure): { w: number; h: number } {
  if (!measure) return sized(t, viewRows(t).length * ROW_H)
  const { w, h } = fit(t, measure)
  return { w, h }
}

/** How tall each row shown is, with its text wrapped in its column. */
export function rowHeights(t: TableData, measure: Measure): readonly number[] {
  return fit(t, measure).heights
}

/** The width a column needs for its name and every cell on one line, up to where long text is better wrapped. */
function fittedWidth(t: TableData, c: TableColumn, measure: Measure): number {
  let w = measure(c.name, CELL_FONT, 600, 1e6).w + HEAD_EXTRA
  for (const r of t.rows) {
    const text = r.cells[c.id]
    if (r.hidden || !text) continue
    w = Math.max(w, measure(text, CELL_FONT, 400, 1e6).w)
    if (w >= FIT_MAX) break
  }
  return Math.min(FIT_MAX, Math.max(FIT_MIN, Math.ceil(w + 2 * CELL_PAD_X + 4)))
}

/** A column made as wide as its text needs. */
export function fitColumn(t: TableData, id: string, measure: Measure): TableData {
  return fitColumns(t, measure, { which: (c) => c.id === id })
}

/**
 * Every column made as wide as its text needs (or only those `which` picks), and no longer a width
 * someone gave it. `widen`: never narrower than it is.
 */
export function fitColumns(t: TableData, measure: Measure, o: { which?: (c: TableColumn) => boolean; widen?: boolean } = {}): TableData {
  let changed = false
  const columns = t.columns.map((c) => {
    if (o.which && !o.which(c)) return c
    const fitted = fittedWidth(t, c, measure)
    const width = o.widen ? Math.max(c.width, fitted) : fitted
    if (width === c.width && !c.sized) return c
    changed = true
    const { sized: _was, ...rest } = c
    return { ...rest, width }
  })
  return changed ? { ...t, columns } : t
}

/** A table nobody has given a shape: every column still as wide as it was made. */
export const unsized = (t: TableData) => t.columns.every((c) => !c.sized && c.width === COL_W)

/**
 * Tables from before text wrapped, or that nobody has shaped since: their columns widened to what
 * their text needs, so a long line reads across rather than down. Ones someone has shaped are theirs.
 */
export function widenUnsized(b: Board, measure: Measure): Board {
  let changed = false
  const items = b.items.map((i) => {
    if (i.kind !== 'table' || !i.table || !unsized(i.table)) return i
    const table = fitColumns(i.table, measure, { widen: true })
    if (table === i.table) return i
    changed = true
    return { ...i, table }
  })
  return changed ? { ...b, items } : b
}

/**
 * The columns stretched or squeezed together so the table comes to `width` (each within its
 * limits): what dragging a table's side does.
 */
export function scaleColumns(t: TableData, width: number): TableData {
  const cols = viewColumns(t)
  let room = cols.reduce((s, c) => s + c.width, 0)
  let left = Math.round(Math.max(width, TABLE_MIN_W) - ROWNUM_W - 2)
  if (!cols.length || room <= 0 || left === room) return t
  // Each takes its share of what's left, so neither rounding nor a limit leaves a gap at the end.
  const next = new Map<string, number>()
  for (const c of cols) {
    const w = Math.max(COL_MIN, Math.min(COL_MAX, Math.round((left * c.width) / room)))
    next.set(c.id, w)
    left -= w
    room -= c.width
  }
  if (cols.every((c) => next.get(c.id) === c.width)) return t
  // The whole table was given its shape: every column shown keeps the width it comes to.
  return { ...t, columns: t.columns.map((c) => (next.has(c.id) ? { ...c, width: next.get(c.id)!, sized: true as const } : c)) }
}

export function setCell(t: TableData, row: string, col: string, value: string): TableData {
  return { ...t, rows: t.rows.map((r) => (r.id === row ? { ...r, cells: { ...r.cells, [col]: value } } : r)) }
}

/** Inserts an empty row after `after` (or at the end). */
export function addRow(t: TableData, after?: string, before = false): [TableData, string] {
  const row: TableRow = { id: uid(), cells: {} }
  const rows = [...t.rows]
  const k = after === undefined ? -1 : rows.findIndex((r) => r.id === after)
  rows.splice(k < 0 ? rows.length : before ? k : k + 1, 0, row)
  return [{ ...t, rows }, row.id]
}

export function addColumn(t: TableData, after?: string, name?: string, before = false): [TableData, string] {
  const col: TableColumn = { id: uid(), name: name ?? `Column ${t.columns.length + 1}`, width: COL_W }
  const columns = [...t.columns]
  const k = after === undefined ? -1 : columns.findIndex((c) => c.id === after)
  columns.splice(k < 0 ? columns.length : before ? k : k + 1, 0, col)
  return [{ ...t, columns }, col.id]
}

export function deleteRow(t: TableData, id: string): TableData {
  return { ...t, rows: t.rows.filter((r) => r.id !== id) }
}

export function deleteColumn(t: TableData, id: string): TableData {
  const filters = { ...t.filters }
  delete filters[id]
  return {
    ...t,
    columns: t.columns.filter((c) => c.id !== id),
    rows: t.rows.map((r) => {
      const cells = { ...r.cells }
      delete cells[id]
      return { ...r, cells }
    }),
    filters,
    sort: t.sort?.column === id ? undefined : t.sort,
  }
}

export function renameColumn(t: TableData, id: string, name: string): TableData {
  return { ...t, columns: t.columns.map((c) => (c.id === id ? { ...c, name } : c)) }
}

/** A column given a width by hand, within what a column can be. */
export function resizeColumn(t: TableData, id: string, width: number): TableData {
  const w = Math.max(COL_MIN, Math.min(COL_MAX, Math.round(width)))
  const c = t.columns.find((x) => x.id === id)
  if (!c || c.width === w) return t
  return { ...t, columns: t.columns.map((x) => (x === c ? { ...x, width: w, sized: true as const } : x)) }
}

export function setRowHidden(t: TableData, id: string, hidden: boolean): TableData {
  return { ...t, rows: t.rows.map((r) => (r.id === id ? { ...r, hidden: hidden || undefined } : r)) }
}

export function setColumnHidden(t: TableData, id: string, hidden: boolean): TableData {
  return { ...t, columns: t.columns.map((c) => (c.id === id ? { ...c, hidden: hidden || undefined } : c)) }
}

export function hiddenCount(t: TableData): { rows: number; columns: number } {
  return { rows: t.rows.filter((r) => r.hidden).length, columns: t.columns.filter((c) => c.hidden).length }
}

export function unhideAll(t: TableData): TableData {
  return {
    ...t,
    showHidden: false,
    rows: t.rows.map((r) => (r.hidden ? { ...r, hidden: undefined } : r)),
    columns: t.columns.map((c) => (c.hidden ? { ...c, hidden: undefined } : c)),
  }
}

/** Cycles a column's sort: ascending → descending → off. */
export function cycleSort(t: TableData, col: string): TableData {
  if (t.sort?.column !== col) return { ...t, sort: { column: col, dir: 'asc' } }
  if (t.sort.dir === 'asc') return { ...t, sort: { column: col, dir: 'desc' } }
  return { ...t, sort: undefined }
}

export function setSort(t: TableData, col: string | null, dir: 'asc' | 'desc' = 'asc'): TableData {
  return { ...t, sort: col ? { column: col, dir } : undefined }
}

export function setFilter(t: TableData, col: string, text: string): TableData {
  const filters = { ...t.filters, [col]: text }
  if (!text) delete filters[col]
  return { ...t, filters, showFilters: true }
}

export function activeFilters(t: TableData): number {
  return Object.values(t.filters ?? {}).filter((v) => v.trim()).length
}

// ----- text in and out -------------------------------------------------------------

/** Splits CSV/TSV text into cells, honouring quoted fields. */
export function parseDelimited(text: string): string[][] {
  const sep = text.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let k = 0; k < text.length; k++) {
    const ch = text[k]
    if (quoted) {
      if (ch === '"' && text[k + 1] === '"') {
        cell += '"'
        k++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[k + 1] === '\n') k++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

/** Whether pasted text looks like spreadsheet cells (tab-separated, at least two rows). */
export function looksTabular(text: string): boolean {
  const lines = text.trim().split(/\r?\n/)
  return lines.length >= 2 && lines.every((l) => l.includes('\t'))
}

/** A table from delimited text; the first row becomes the column names. */
export function tableFromText(text: string): TableData {
  const [head = [], ...body] = parseDelimited(text)
  const width = Math.max(head.length, ...body.map((r) => r.length))
  const columns = Array.from({ length: width }, (_, k) => ({ id: uid(), name: head[k]?.trim() || `Column ${k + 1}`, width: COL_W }))
  const rows = body.map((r) => ({ id: uid(), cells: Object.fromEntries(columns.map((c, k) => [c.id, r[k] ?? ''])) }))
  return { columns, rows }
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** The table as CSV, as currently shown (filters, sort and hidden rows/columns applied). */
export function toCsv(t: TableData): string {
  const cols = t.columns.filter((c) => !c.hidden)
  const rows = viewRows({ ...t, showHidden: false })
  return [cols.map((c) => csvCell(c.name)), ...rows.map((r) => cols.map((c) => csvCell(r.cells[c.id] ?? '')))]
    .map((r) => r.join(','))
    .join('\n')
}
