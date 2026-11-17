import { type KeyboardEvent, type PointerEvent, useContext, useRef, useState } from 'react'
import * as T from '../../model/table'
import type { Item, TableColumn, TableData } from '../../model/types'
import { EditorContext } from '../useEditor'
import { Menu, Widget } from './Widget'

type OpenMenu = { kind: 'col' | 'row'; id: string } | null

/** Moves focus to the cell at (row, col) inside this table, if it exists. */
function focusCell(root: HTMLElement | null, row: number, col: number) {
  const el = root?.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${row}:${col}"]`)
  el?.focus()
  el?.select()
}

/**
 * A cell to type in. Its text wraps, and the cell grows with it as it's typed: the text is drawn
 * twice, once unseen to take up the room and once to type in, laid over it.
 */
function Cell({ value, at, label, onCommit, onKey }: { value: string; at: string; label: string; onCommit: (text: string) => void; onKey: (e: KeyboardEvent<HTMLTextAreaElement>, reset: () => void) => void }) {
  const [text, setText] = useState(value)
  return (
    <div className="cell-grow" data-text={`${text}\u200b`}>
      <textarea
        rows={1}
        data-cell={at}
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text)}
        onKeyDown={(e) => {
          // Alt+Enter: a new line in the cell, as in a spreadsheet.
          if (e.key === 'Enter' && e.altKey) {
            e.preventDefault()
            const el = e.currentTarget
            const from = el.selectionStart
            setText(`${text.slice(0, from)}\n${text.slice(el.selectionEnd)}`)
            requestAnimationFrame(() => el.setSelectionRange(from + 1, from + 1))
            return
          }
          onKey(e, () => setText(value))
        }}
      />
    </div>
  )
}

export function TableView({ item, live, editingTitle }: { item: Item; live: boolean; editingTitle: boolean }) {
  const editor = useContext(EditorContext)!
  const t = item.table!
  const [menu, setMenu] = useState<OpenMenu>(null)
  const update = (f: (t: TableData) => TableData) => editor.updateTable(item.id, f)
  const cols = T.viewColumns(t)
  const rows = T.viewRows(t)
  const hidden = T.hiddenCount(t)
  const filters = T.activeFilters(t)
  const sortCol = t.sort && t.columns.find((c) => c.id === t.sort!.column)

  const heights = T.rowHeights(t, editor.measure)

  const onCellKey = (e: KeyboardEvent<HTMLTextAreaElement>, r: number, c: number, rowId: string, reset: () => void) => {
    const el = e.currentTarget
    const root = el.closest<HTMLElement>('.widget')
    // While a word is being composed (an input method), Enter is part of writing it.
    if (e.nativeEvent.isComposing) return
    // In text of several lines the arrows move through it first: they leave the cell from its end, or its start.
    const atEnd = el.selectionEnd === el.value.length
    const atStart = el.selectionStart === 0
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEnd)) {
      e.preventDefault()
      el.blur()
      if (e.key === 'Enter' && r === rows.length - 1 && !e.shiftKey) {
        // Enter on the last row adds a new one, like a spreadsheet.
        update((x) => T.addRow(x, rowId)[0])
        requestAnimationFrame(() => focusCell(root, r + 1, c))
      } else focusCell(root, e.shiftKey ? r - 1 : r + 1, c)
    } else if (e.key === 'ArrowUp' && atStart) {
      e.preventDefault()
      focusCell(root, r - 1, c)
    } else if (e.key === 'Escape') {
      reset()
      requestAnimationFrame(() => el.blur())
    }
  }

  // A column's edge, dragged: the column is as wide as it's dragged while it's held, and it's one undo step.
  const grip = useRef<{ col: string; x: number; width: number } | null>(null)
  const startGrip = (e: PointerEvent<HTMLElement>, c: TableColumn) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    grip.current = { col: c.id, x: e.clientX, width: c.width }
  }
  const moveGrip = (e: PointerEvent<HTMLElement>) => {
    const g = grip.current
    if (!g) return
    const width = g.width + (e.clientX - g.x) / editor.camera.zoom
    editor.scrubTable(item.id, (x) => T.resizeColumn(x, g.col, width))
  }
  const endGrip = () => {
    if (!grip.current) return
    grip.current = null
    editor.endScrub()
  }

  const actions = (
    <>
      <button title="Add a row" onClick={() => update((x) => T.addRow(x)[0])}>
        + Row
      </button>
      <button title="Add a column" onClick={() => update((x) => T.addColumn(x)[0])}>
        + Column
      </button>
      <button title="Fit every column to its text (long text goes onto more lines)" aria-label="Fit every column to its text" onClick={() => update((x) => T.fitColumns(x, editor.measure))}>
        Fit
      </button>
      <button className={t.showFilters ? 'on' : ''} title="Show filters" onClick={() => update((x) => ({ ...x, showFilters: !x.showFilters }))}>
        Filter{filters ? ` (${filters})` : ''}
      </button>
      {hidden.rows + hidden.columns > 0 && (
        <button
          className={t.showHidden ? 'on' : ''}
          title="Show hidden rows and columns so you can restore them"
          onClick={() => update((x) => ({ ...x, showHidden: !x.showHidden }))}
        >
          Hidden ({hidden.rows + hidden.columns})
        </button>
      )}
      <button
        title="Copy as CSV (what's shown)"
        aria-label="Copy as CSV"
        onClick={() =>
          navigator.clipboard?.writeText(T.toCsv(t)).then(
            () => editor.setStatus('Copied table as CSV'),
            () => editor.setStatus('Clipboard unavailable'),
          )
        }
      >
        CSV
      </button>
    </>
  )

  return (
    <Widget item={item} live={live} editingTitle={editingTitle} actions={actions}>
      <div className="table-status">
        {sortCol ? (
          <span>
            Sorted by <strong>{sortCol.name}</strong> {t.sort!.dir === 'asc' ? '↑' : '↓'}
            {live && (
              <button className="link" onClick={() => update((x) => T.setSort(x, null))}>
                clear
              </button>
            )}
          </span>
        ) : (
          <span className="muted">{live ? 'Drag a column’s edge to size it · ↕ sorts · ⋯ for more' : `${t.rows.length} row${t.rows.length === 1 ? '' : 's'}`}</span>
        )}
        {filters > 0 && <span className="muted">{rows.length} of {t.rows.length} rows match</span>}
      </div>
      <div className="table-grid" role="table" style={{ gridTemplateColumns: `${T.ROWNUM_W}px ${cols.map((c) => `${c.width}px`).join(' ')}` }}>
        <div className="th corner" role="columnheader" />
        {cols.map((c, ci) => (
          <div key={c.id} role="columnheader" className={`th${c.hidden ? ' hidden-col' : ''}`}>
            {live ? (
              <input
                className="col-name"
                defaultValue={c.name}
                key={c.name}
                aria-label="Column name"
                onBlur={(e) => e.target.value !== c.name && update((x) => T.renameColumn(x, c.id, e.target.value || c.name))}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <span className="col-name">{c.name}</span>
            )}
            {live && (
              <button className="sort" title="Sort" aria-label={`Sort by ${c.name}`} onClick={() => update((x) => T.cycleSort(x, c.id))}>
                {t.sort?.column === c.id ? (t.sort.dir === 'asc' ? '↑' : '↓') : '↕'}
              </button>
            )}
            {!live && t.sort?.column === c.id && <span className="sort">{t.sort.dir === 'asc' ? '↑' : '↓'}</span>}
            {live && (
              <button className="more" title="Column options" aria-label={`Options for ${c.name}`} onClick={() => setMenu({ kind: 'col', id: c.id })}>
                ⋯
              </button>
            )}
            {menu?.kind === 'col' && menu.id === c.id && (
              <Menu
                onClose={() => setMenu(null)}
                items={[
                  ['Sort A → Z', () => update((x) => T.setSort(x, c.id, 'asc'))],
                  ['Sort Z → A', () => update((x) => T.setSort(x, c.id, 'desc'))],
                  ['Filter this column', () => update((x) => ({ ...x, showFilters: true }))],
                  null,
                  ['Insert column left', () => update((x) => T.addColumn(x, c.id, undefined, true)[0])],
                  ['Insert column right', () => update((x) => T.addColumn(x, c.id)[0])],
                  ['Fit to its text', () => update((x) => T.fitColumn(x, c.id, editor.measure))],
                  ['Wider', () => update((x) => T.resizeColumn(x, c.id, c.width + 50))],
                  ['Narrower', () => update((x) => T.resizeColumn(x, c.id, c.width - 50))],
                  null,
                  c.hidden ? ['Unhide column', () => update((x) => T.setColumnHidden(x, c.id, false))] : ['Hide column', () => update((x) => T.setColumnHidden(x, c.id, true))],
                  ['Delete column', () => update((x) => T.deleteColumn(x, c.id))],
                ]}
              />
            )}
            {live && (
              <span
                className={`col-grip${ci === cols.length - 1 ? ' last' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label={`Width of ${c.name}`}
                title="Drag to make the column wider or narrower · double-click to fit its text"
                onPointerDown={(e) => startGrip(e, c)}
                onPointerMove={moveGrip}
                onPointerUp={endGrip}
                onPointerCancel={endGrip}
                onLostPointerCapture={endGrip}
                onDoubleClick={() => update((x) => T.fitColumn(x, c.id, editor.measure))}
              />
            )}
          </div>
        ))}
        {t.showFilters && (
          <>
            <div className="tf corner">
              {live && filters > 0 && (
                <button className="link" title="Clear filters" aria-label="Clear filters" onClick={() => update((x) => ({ ...x, filters: {} }))}>
                  ×
                </button>
              )}
            </div>
            {cols.map((c) => (
              <div key={c.id} className="tf">
                <input
                  placeholder="Filter…"
                  value={t.filters?.[c.id] ?? ''}
                  disabled={!live}
                  aria-label={`Filter ${c.name}`}
                  onChange={(e) => {
                    const v = e.target.value
                    update((x) => T.setFilter(x, c.id, v))
                  }}
                />
              </div>
            ))}
          </>
        )}
        {rows.map((row, r) => (
          <div key={row.id} className={`tr${row.hidden ? ' hidden-row' : ''}`} role="row" style={{ display: 'contents' }}>
            <div className="td rownum" style={{ minHeight: heights[r] }}>
              {live ? (
                <button title="Row options" aria-label="Row options" onClick={() => setMenu({ kind: 'row', id: row.id })}>
                  {t.rows.indexOf(row) + 1}
                </button>
              ) : (
                <span>{t.rows.indexOf(row) + 1}</span>
              )}
              {menu?.kind === 'row' && menu.id === row.id && (
                <Menu
                  onClose={() => setMenu(null)}
                  items={[
                    ['Insert row above', () => update((x) => T.addRow(x, row.id, true)[0])],
                    ['Insert row below', () => update((x) => T.addRow(x, row.id)[0])],
                    null,
                    row.hidden ? ['Unhide row', () => update((x) => T.setRowHidden(x, row.id, false))] : ['Hide row', () => update((x) => T.setRowHidden(x, row.id, true))],
                    ['Delete row', () => update((x) => T.deleteRow(x, row.id))],
                  ]}
                />
              )}
            </div>
            {cols.map((c, ci) => {
              const value = row.cells[c.id] ?? ''
              return (
                <div key={c.id} className={`td${c.hidden ? ' hidden-col' : ''}`} role="cell">
                  {live ? (
                    <Cell
                      key={value}
                      value={value}
                      at={`${r}:${ci}`}
                      label={`${c.name}, row ${r + 1}`}
                      onCommit={(text) => update((x) => T.setCell(x, row.id, c.id, text))}
                      onKey={(e, reset) => onCellKey(e, r, ci, row.id, reset)}
                    />
                  ) : (
                    <span>{value}</span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="td empty-row" style={{ gridColumn: `1 / span ${cols.length + 1}` }}>
            {t.rows.length ? 'No rows match the filters' : 'No rows yet'}
          </div>
        )}
      </div>
    </Widget>
  )
}
