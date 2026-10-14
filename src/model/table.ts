/** Tables: a small spreadsheet with sorting, filtering and hidden rows/columns. */

import { uid } from './uid'
import { type TableColumn, type TableData, type TableRow, WIDGET_TITLE_H } from './types'

export const TOOLBAR_H = 36
export const HEAD_H = 34
export const FILTER_H = 32
export const ROW_H = 32
export const ROWNUM_W = 44
export const COL_W = 150

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

/** The widget size that fits the table exactly. */
export function tableSize(t: TableData): { w: number; h: number } {
  const w = ROWNUM_W + viewColumns(t).reduce((s, c) => s + c.width, 0)
  const h = WIDGET_TITLE_H + TOOLBAR_H + HEAD_H + (t.showFilters ? FILTER_H : 0) + Math.max(1, viewRows(t).length) * ROW_H + 2
  return { w: Math.max(w, 360), h }
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

export function resizeColumn(t: TableData, id: string, width: number): TableData {
  return { ...t, columns: t.columns.map((c) => (c.id === id ? { ...c, width: Math.max(60, Math.min(600, width)) } : c)) }
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
