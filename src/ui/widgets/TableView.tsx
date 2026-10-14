import { type KeyboardEvent, useContext, useState } from 'react'
import * as T from '../../model/table'
import type { Item, TableData } from '../../model/types'
import { EditorContext } from '../useEditor'
import { Menu, Widget } from './Widget'

type OpenMenu = { kind: 'col' | 'row'; id: string } | null

/** Moves focus to the cell input at (row, col) inside this table, if it exists. */
function focusCell(root: HTMLElement | null, row: number, col: number) {
  const el = root?.querySelector<HTMLInputElement>(`input[data-cell="${row}:${col}"]`)
  el?.focus()
  el?.select()
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

  const onCellKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number, rowId: string) => {
    const root = (e.currentTarget as HTMLElement).closest<HTMLElement>('.widget')
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      ;(e.currentTarget as HTMLInputElement).blur()
      if (e.key === 'Enter' && r === rows.length - 1 && !e.shiftKey) {
        // Enter on the last row adds a new one, like a spreadsheet.
        update((x) => T.addRow(x, rowId)[0])
        requestAnimationFrame(() => focusCell(root, r + 1, c))
      } else focusCell(root, e.shiftKey ? r - 1 : r + 1, c)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusCell(root, r - 1, c)
    } else if (e.key === 'Escape') {
      const input = e.currentTarget as HTMLInputElement
      input.value = rows[r].cells[cols[c].id] ?? ''
      input.blur()
    }
  }

  const actions = (
    <>
      <button title="Add a row" onClick={() => update((x) => T.addRow(x)[0])}>
        + Row
      </button>
      <button title="Add a column" onClick={() => update((x) => T.addColumn(x)[0])}>
        + Column
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
        onClick={() =>
          navigator.clipboard?.writeText(T.toCsv(t)).then(
            () => editor.setStatus('Copied table as CSV'),
            () => editor.setStatus('Clipboard unavailable'),
          )
        }
      >
        Copy CSV
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
          <span className="muted">{live ? 'Click a header to sort · ⋯ for more' : `${t.rows.length} row${t.rows.length === 1 ? '' : 's'}`}</span>
        )}
        {filters > 0 && <span className="muted">{rows.length} of {t.rows.length} rows match</span>}
      </div>
      <div className="table-grid" role="table" style={{ gridTemplateColumns: `${T.ROWNUM_W}px ${cols.map((c) => `${c.width}px`).join(' ')}` }}>
        <div className="th corner" role="columnheader" />
        {cols.map((c) => (
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
              <button className="sort" title="Sort" onClick={() => update((x) => T.cycleSort(x, c.id))}>
                {t.sort?.column === c.id ? (t.sort.dir === 'asc' ? '↑' : '↓') : '↕'}
              </button>
            )}
            {!live && t.sort?.column === c.id && <span className="sort">{t.sort.dir === 'asc' ? '↑' : '↓'}</span>}
            {live && (
              <button className="more" title="Column options" onClick={() => setMenu({ kind: 'col', id: c.id })}>
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
                  ['Wider', () => update((x) => T.resizeColumn(x, c.id, c.width + 50))],
                  ['Narrower', () => update((x) => T.resizeColumn(x, c.id, c.width - 50))],
                  null,
                  c.hidden ? ['Unhide column', () => update((x) => T.setColumnHidden(x, c.id, false))] : ['Hide column', () => update((x) => T.setColumnHidden(x, c.id, true))],
                  ['Delete column', () => update((x) => T.deleteColumn(x, c.id))],
                ]}
              />
            )}
          </div>
        ))}
        {t.showFilters && (
          <>
            <div className="tf corner">
              {live && filters > 0 && (
                <button className="link" title="Clear filters" onClick={() => update((x) => ({ ...x, filters: {} }))}>
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
            <div className="td rownum">
              {live ? (
                <button title="Row options" onClick={() => setMenu({ kind: 'row', id: row.id })}>
                  {t.rows.indexOf(row) + 1}
                </button>
              ) : (
                t.rows.indexOf(row) + 1
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
                    <input
                      data-cell={`${r}:${ci}`}
                      defaultValue={value}
                      key={value}
                      aria-label={`${c.name}, row ${r + 1}`}
                      onBlur={(e) => e.target.value !== value && update((x) => T.setCell(x, row.id, c.id, e.target.value))}
                      onKeyDown={(e) => onCellKey(e, r, ci, row.id)}
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
