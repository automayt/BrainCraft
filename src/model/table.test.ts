import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from '../api/ops'
import { diff } from '../collab/patch'
import { Editor } from '../editor/Editor'
import { addItem, emptyBoard, getItem, newItem, updateItem } from './board'
import { type Measure, layoutAll } from './mindmap'
import { fromJson, toJson } from './serialize'
import * as T from './table'
import { type Board, type Item, type TableData, WIDGET_TITLE_H } from './types'

/** Text measured as if every letter were 7px wide, words kept whole, lines 1.3 times the text's size. */
const measure: Measure = (text, fontSize, _weight, maxWidth) => {
  let lines = 0
  let widest = 0
  for (const para of text.split('\n')) {
    let line = 0
    lines++
    for (const word of para.split(' ')) {
      const w = word.length * 7
      if (line && line + 7 + w > maxWidth) {
        widest = Math.max(widest, line)
        lines++
        line = w
      } else line += (line ? 7 : 0) + w
    }
    widest = Math.max(widest, line)
  }
  return { w: Math.min(maxWidth, widest), h: lines * fontSize * 1.3 }
}

/** Twenty words of four letters: 99 letters and spaces, 693px on one line. */
const LONG = Array.from({ length: 20 }, () => 'word').join(' ')
/** Everything above a table's rows. */
const ABOVE = WIDGET_TITLE_H + T.TOOLBAR_H + T.HEAD_H

function notes(): TableData {
  return T.tableFromText(`Type\tWhat\tWho\nDecision\t${LONG}\tSam\nAction\tBook it\tPriya`)
}
const widths = (t: TableData) => t.columns.map((c) => c.width)
const onBoard = (t: TableData, more: Partial<Item> = {}): { board: Board; id: number } => {
  const [board, id] = addItem(emptyBoard(), newItem('table', { x: 100, y: 100, w: 1, h: 1 }, { text: 'Notes', table: t, ...more }))
  return { board, id }
}

describe('a table’s rows are as tall as their text', () => {
  it('wraps a long cell in its column, and the table is the size of all its rows', () => {
    const t = notes()
    // In a column 150 wide the text has 131px: three words to a line, so twenty words are seven lines.
    expect(T.rowHeights(t, measure)).toEqual([7 * 20 + 12, T.ROW_H])
    expect(T.tableSize(t, measure)).toEqual({ w: T.ROWNUM_W + 3 * 150 + 2, h: ABOVE + 152 + 32 + 2 })
    // Wider, it's fewer lines (eleven words to a line at 400); wide enough, one.
    expect(T.rowHeights(T.resizeColumn(t, t.columns[1].id, 400), measure)).toEqual([2 * 20 + 12, T.ROW_H])
    expect(T.rowHeights(T.resizeColumn(t, t.columns[1].id, 720), measure)).toEqual([T.ROW_H, T.ROW_H])
    // A line someone broke by hand is a line.
    expect(T.rowHeights(T.setCell(t, t.rows[1].id, t.columns[2].id, 'Priya\nand Sam'), measure)[1]).toBe(2 * 20 + 12)
    // With nothing to measure text with, each row is taken for one line.
    expect(T.tableSize(t)).toEqual({ w: T.ROWNUM_W + 3 * 150 + 2, h: ABOVE + 2 * 32 + 2 })
  })

  it('counts only what’s shown', () => {
    const t = notes()
    // The long text's column hidden: nothing left to wrap.
    const hiddenColumn = T.setColumnHidden(t, t.columns[1].id, true)
    expect(T.rowHeights(hiddenColumn, measure)).toEqual([T.ROW_H, T.ROW_H])
    // Its row hidden, or filtered out: one row, of one line.
    expect(T.rowHeights(T.setRowHidden(t, t.rows[0].id, true), measure)).toEqual([T.ROW_H])
    const filtered = T.setFilter(t, t.columns[0].id, 'action')
    expect(T.tableSize(filtered, measure).h).toBe(ABOVE + T.FILTER_H + 32 + 2)
    // No rows at all still leaves room to say so.
    expect(T.tableSize({ ...t, rows: [] }, measure).h).toBe(ABOVE + T.ROW_H + 2)
    // And one narrow column is still a table wide enough for its buttons.
    expect(T.tableSize(T.newTable(['A'], 1), measure).w).toBe(T.TABLE_MIN_W)
  })

  it('measures a table once, until it changes or text measures differently', () => {
    let calls = 0
    const counting: Measure = (...a) => {
      calls++
      return measure(...a)
    }
    const t = notes()
    T.tableSize(t, counting)
    const first = calls
    expect(first).toBeGreaterThan(0)
    T.tableSize(t, counting)
    T.rowHeights(t, counting)
    expect(calls).toBe(first)
    // Another way of measuring is another answer.
    expect(T.tableSize(t, () => ({ w: 10, h: 14 * 1.3 })).h).toBe(ABOVE + 2 * 32 + 2)
    // The fonts loaded: measured again.
    T.tableSize(t, counting)
    const second = calls
    T.forgetFits()
    T.tableSize(t, counting)
    expect(calls).toBeGreaterThan(second)
  })
})

describe('a table’s columns', () => {
  it('fit their text, up to where long text is better wrapped', () => {
    const t = notes()
    // "What" would need 693px on one line: it stops at the most, and wraps.
    expect(T.fitColumn(t, t.columns[1].id, measure).columns[1].width).toBe(T.FIT_MAX)
    // "Who": its longest cell is "Priya" (35px), its header "Who" and its buttons (21 + 48): the header decides.
    expect(T.fitColumn(t, t.columns[2].id, measure).columns[2].width).toBe(Math.max(90, 21 + 48 + 20))
    // A cell wider than the header decides instead.
    const named = T.setCell(t, t.rows[1].id, t.columns[2].id, 'Priya and the design studio')
    expect(T.fitColumn(named, t.columns[2].id, measure).columns[2].width).toBe(27 * 7 + 20)
    // A hidden row's text doesn't count: what's left is "Book it", narrower than the header "What" and its buttons.
    expect(T.fitColumn(T.setRowHidden(t, t.rows[0].id, true), t.columns[1].id, measure).columns[1].width).toBe(4 * 7 + 48 + 20)
    // No such column: as it was.
    expect(T.fitColumn(t, 'nope', measure)).toBe(t)
  })

  it('all fit at once, or only some, or only wider', () => {
    const t = notes()
    expect(widths(T.fitColumns(t, measure))).toEqual([96, T.FIT_MAX, 90])
    expect(widths(T.fitColumns(t, measure, { which: (c) => c.name === 'What' }))).toEqual([150, T.FIT_MAX, 150])
    expect(widths(T.fitColumns(t, measure, { widen: true }))).toEqual([150, T.FIT_MAX, 150])
    // Nothing to change: the same table.
    const fitted = T.fitColumns(t, measure)
    expect(T.fitColumns(fitted, measure)).toBe(fitted)
  })

  it('remember a width someone gave them, until they’re fitted to their text again', () => {
    const t = T.fitColumns(notes(), measure)
    expect(t.columns.some((c) => c.sized)).toBe(false)
    const id = t.columns[1].id
    // Its edge dragged: that one is sized.
    const dragged = T.resizeColumn(t, id, 300)
    expect(dragged.columns.map((c) => !!c.sized)).toEqual([false, true, false])
    // The table's side dragged: every column shown is.
    const stretched = T.scaleColumns(T.setColumnHidden(t, t.columns[0].id, true), 900)
    expect(stretched.columns.map((c) => !!c.sized)).toEqual([false, true, true])
    // Fitted to its text, it's nobody's width any more, even where that's the width it had.
    const back = T.fitColumn(T.resizeColumn(dragged, id, T.FIT_MAX), id, measure)
    expect(back.columns[1]).toEqual(t.columns[1])
    expect(T.fitColumns(stretched, measure).columns.some((c) => c.sized)).toBe(false)
    // A table with a sized column has a shape, whatever its widths.
    const plain = notes()
    expect(T.unsized(plain)).toBe(true)
    expect(T.unsized(T.resizeColumn(T.resizeColumn(plain, plain.columns[1].id, 300), plain.columns[1].id, 150))).toBe(false)
    // It comes back from a file as it was saved, and only "true" counts.
    const { board } = onBoard(dragged)
    const raw = JSON.parse(toJson(board)) as { items: { table?: { columns: Record<string, unknown>[] } }[] }
    raw.items.find((i) => i.table)!.table!.columns[0].sized = 'yes'
    expect(fromJson(JSON.stringify(raw)).items.find((i) => i.table)!.table!.columns.map((c) => c.sized)).toEqual([undefined, true, undefined])
  })

  it('keep to their limits when sized by hand', () => {
    const t = notes()
    const id = t.columns[0].id
    expect(T.resizeColumn(t, id, 10).columns[0].width).toBe(T.COL_MIN)
    expect(T.resizeColumn(t, id, 5000).columns[0].width).toBe(T.COL_MAX)
    expect(T.resizeColumn(t, id, 233.6).columns[0].width).toBe(234)
    // The same width: the same table (a drag that hasn't moved changes nothing).
    expect(T.resizeColumn(t, id, 150.2)).toBe(t)
    expect(T.resizeColumn(t, 'nope', 300)).toBe(t)
  })

  it('share a change in the table’s width', () => {
    const t = T.fitColumns(notes(), measure) // 96, 420, 90: 606 in all
    const total = (x: TableData) => T.viewColumns(x).reduce((s, c) => s + c.width, 0)
    const across = (w: number) => w - T.ROWNUM_W - 2
    // Wider by 200: each in proportion, and together exactly the new width.
    const wide = T.scaleColumns(t, T.tableSize(t).w + 200)
    expect(total(wide)).toBe(606 + 200)
    expect(widths(wide)).toEqual([128, 558, 120])
    expect(T.tableSize(wide).w).toBe(T.tableSize(t).w + 200)
    // Narrower than a table goes: as narrow as it and its columns go.
    const narrow = T.scaleColumns(t, 100)
    expect(widths(narrow)).toEqual([T.COL_MIN, 209, T.COL_MIN])
    expect(widths(T.scaleColumns(t, T.TABLE_MIN_W))).toEqual(widths(narrow))
    // No column narrower or wider than a column goes.
    const one = T.newTable(['A'], 1)
    expect(widths(T.scaleColumns(one, 5000))).toEqual([T.COL_MAX])
    const tiny = T.resizeColumn(T.resizeColumn(t, t.columns[0].id, 60), t.columns[2].id, 60)
    expect(Math.min(...widths(T.scaleColumns(tiny, 400)))).toBe(T.COL_MIN)
    // A hidden column keeps its width.
    const hidden = T.setColumnHidden(t, t.columns[1].id, true)
    const scaled = T.scaleColumns(hidden, 600)
    expect(scaled.columns[1].width).toBe(420)
    expect(total(scaled)).toBe(across(600))
    // The same width: the same table.
    expect(T.scaleColumns(t, T.tableSize(t).w)).toBe(t)
  })
})

describe('tables on a board', () => {
  it('are always the size of what’s in them', () => {
    const { board, id } = onBoard(notes())
    const laid = layoutAll(board, measure)
    expect(getItem(laid, id)).toMatchObject({ x: 100, y: 100, ...T.tableSize(notes(), measure) })
    // Already so: nothing changes, and it's the same board.
    expect(layoutAll(laid, measure)).toBe(laid)
    // The text gets longer: the table gets taller.
    const t = getItem(laid, id)!.table!
    const more = layoutAll({ ...laid, items: laid.items.map((i) => (i.id === id ? { ...i, table: T.setCell(t, t.rows[1].id, t.columns[1].id, LONG) } : i)) }, measure)
    expect(getItem(more, id)!.h).toBe(ABOVE + 152 + 152 + 2)
  })

  it('made before text wrapped are widened to their text when opened; ones someone shaped are left', () => {
    const old = onBoard(notes())
    const opened = T.widenUnsized(old.board, measure)
    expect(widths(getItem(opened, old.id)!.table!)).toEqual([150, T.FIT_MAX, 150])
    // Opened again: nothing more to do.
    expect(T.widenUnsized(opened, measure)).toBe(opened)
    // One column sized by hand: it's theirs.
    const t = notes()
    const shaped = onBoard(T.resizeColumn(t, t.columns[2].id, 120))
    expect(T.unsized(getItem(shaped.board, shaped.id)!.table!)).toBe(false)
    expect(T.widenUnsized(shaped.board, measure)).toBe(shaped.board)
    // So is one from before, sized with the buttons its columns had then (nothing says so but the width itself).
    const before = onBoard({ ...t, columns: t.columns.map((c, k) => (k === 2 ? { ...c, width: 200 } : c)) })
    expect(T.widenUnsized(before.board, measure)).toBe(before.board)
    // Nothing long in it: as it was.
    const short = onBoard(T.newTable())
    expect(T.widenUnsized(short.board, measure)).toBe(short.board)
  })

  it('arrive with widths a column can have', () => {
    const { board } = onBoard(notes())
    const raw = JSON.parse(toJson(board)) as { items: { table?: { columns: Record<string, unknown>[] } }[] }
    const cols = raw.items.find((i) => i.table)!.table!.columns
    cols[0].width = -40
    cols[1].width = 1e9
    cols[2].width = 'wide'
    const back = fromJson(JSON.stringify(raw))
    expect(widths(back.items.find((i) => i.table)!.table!)).toEqual([T.COL_MIN, T.COL_MAX, 160])
  })
})

describe('tables the assistant makes', () => {
  const ctx = { measure }
  const make = (ops: Op[], board = emptyBoard()) => applyOps(board, ops, ctx).board
  const table = (b: Board) => b.items.find((i) => i.kind === 'table')!

  it('have columns as wide as their text, and rows as tall', () => {
    const b = make([{ op: 'createTable', title: 'Decisions and actions', columns: ['Type', 'What', 'Who'], rows: [['Decision', LONG, 'Sam'], ['Action', 'Book it', 'Priya']] }])
    const i = table(b)
    expect(widths(i.table!)).toEqual([96, T.FIT_MAX, 90])
    // 420 wide leaves 401px for text: eleven words to a line, so twenty are two lines.
    expect(T.rowHeights(i.table!, measure)).toEqual([2 * 20 + 12, T.ROW_H])
    expect({ w: i.w, h: i.h }).toEqual(T.tableSize(i.table!, measure))
  })

  it('grow with what’s written in them as a meeting goes on', () => {
    // Made early, with little in it.
    const made = make([{ op: 'createTable', title: 'Notes', columns: ['Type', 'What'], rows: [['Action', 'Book it']] }])
    expect(widths(table(made).table!)).toEqual([96, 96])
    // Rewritten with more: the columns are as wide as the text needs now, not as they were made.
    const again = make([{ op: 'setTable', id: table(made).id, columns: ['Type', 'What'], rows: [['Action', 'Book it'], ['Decision', LONG]] }], made)
    expect(widths(table(again).table!)).toEqual([96, T.FIT_MAX])
    expect({ w: table(again).w, h: table(again).h }).toEqual(T.tableSize(table(again).table!, measure))
  })

  it('keep a width someone gave a column when rewritten, and fit the rest', () => {
    const made = make([{ op: 'createTable', title: 'Notes', columns: ['Type', 'What'], rows: [['Action', 'Book it']] }])
    const id = table(made).id
    // Someone drags "What" out to 300.
    const t = table(made).table!
    const shaped = updateItem(made, id, (i) => ({ ...i, table: T.resizeColumn(t, t.columns[1].id, 300) }))
    const again = make([{ op: 'setTable', id, columns: ['Type', 'What', 'Who'], rows: [['Decision', LONG, 'Priya and the design studio']] }], shaped)
    expect(widths(table(again).table!)).toEqual([96, 300, 27 * 7 + 20])
    expect(table(again).table!.columns.map((c) => !!c.sized)).toEqual([false, true, false])
    expect({ w: table(again).w, h: table(again).h }).toEqual(T.tableSize(table(again).table!, measure))
  })
})

describe('tables in the editor', () => {
  const editor = (t = T.fitColumns(notes(), measure)) => {
    const { board, id } = onBoard(t)
    const e = new Editor(board, measure)
    e.camera = { x: 0, y: 0, zoom: 1 }
    e.select([id])
    return { e, id, item: () => getItem(e.board, id)! }
  }
  const drag = (e: Editor, corner: 'e' | 'w' | 's' | 'se', from: { x: number; y: number }, by: { x: number; y: number }) => {
    e.pointerDown(from, 0, {}, { kind: 'resize', corner })
    e.pointerMove({ x: from.x + by.x / 2, y: from.y + by.y / 2 })
    e.pointerMove({ x: from.x + by.x, y: from.y + by.y })
    e.pointerUp({ x: from.x + by.x, y: from.y + by.y })
  }

  it('can be dragged wider by a side: the columns share it, and the other side stays put', () => {
    const { e, item } = editor()
    expect(e.resizable).toBe(item())
    const was = item()
    // The right side, 200 out.
    drag(e, 'e', { x: was.x + was.w, y: was.y + 50 }, { x: 200, y: 0 })
    expect(item()).toMatchObject({ x: was.x, w: was.w + 200 })
    expect(widths(item().table!)).toEqual([128, 558, 120])
    expect(item().h).toBe(T.tableSize(item().table!, measure).h)
    // One undo step.
    e.undo()
    expect(item()).toMatchObject({ x: was.x, w: was.w, h: was.h })
    expect(widths(item().table!)).toEqual(widths(was.table!))
    // The left side, 100 in: the right side stays where it was.
    drag(e, 'w', { x: was.x, y: was.y + 50 }, { x: 100, y: 0 })
    expect(item().w).toBe(was.w - 100)
    expect(item().x + item().w).toBe(was.x + was.w)
    // Narrower columns: the long text is on more lines, and the table is taller for it.
    expect(widths(item().table!)).toEqual([80, 351, 75])
    expect(item().h).toBe(ABOVE + 3 * 20 + 12 + 32 + 2)
    expect(item().h).toBeGreaterThan(was.h)
  })

  it('come back to the columns they had when a side is dragged out and back', () => {
    const { e, item } = editor()
    const was = item()
    const from = { x: was.x + was.w, y: was.y + 50 }
    e.pointerDown(from, 0, {}, { kind: 'resize', corner: 'e' })
    // In, as far as the columns go, and out again past where it began; then back to where it began.
    for (const dx of [-150, -400, -150, 90, 317, 0]) e.pointerMove({ x: from.x + dx, y: from.y })
    e.pointerUp(from)
    expect(widths(item().table!)).toEqual(widths(was.table!))
    expect(item()).toMatchObject({ x: was.x, w: was.w, h: was.h })
  })

  it('are as tall as their rows whatever is dragged', () => {
    const { e, item } = editor()
    const was = item()
    drag(e, 's', { x: was.x + 50, y: was.y + was.h }, { x: 0, y: 300 })
    expect(item()).toEqual(was)
    // A corner: only how far across counts.
    drag(e, 'se', { x: was.x + was.w, y: was.y + was.h }, { x: 200, y: 300 })
    expect(item()).toMatchObject({ x: was.x, y: was.y, w: was.w + 200, h: T.tableSize(item().table!, measure).h })
  })

  it('show a change made bit by bit as it goes, as one undo step', () => {
    const { e, id, item } = editor()
    const was = item()
    const col = was.table!.columns[1].id
    const widen = (to: number) => e.scrubTable(id, (t) => T.resizeColumn(t, col, to))
    widen(430)
    // Each step shows at once, the table sized to it.
    expect(item()).toMatchObject({ w: was.w + 10 })
    widen(480)
    widen(520)
    e.endScrub()
    expect(item().table!.columns[1].width).toBe(520)
    expect(item().w).toBe(was.w + 100)
    e.undo()
    expect(item().table!.columns[1].width).toBe(420)
    expect(item().w).toBe(was.w)
    // A drag that went nowhere is no step at all.
    e.redo()
    widen(520)
    e.endScrub()
    e.undo()
    expect(item().table!.columns[1].width).toBe(420)
  })

  it('size a changed table with its text wrapped', () => {
    const { e, id, item } = editor()
    const t = item().table!
    e.updateTable(id, (x) => T.setCell(x, t.rows[1].id, t.columns[1].id, LONG))
    expect(item().h).toBe(ABOVE + 52 + 52 + 2)
  })

  it('widen a table nobody shaped when a board is opened', () => {
    const { board, id } = onBoard(notes())
    const e = new Editor(emptyBoard(), measure)
    e.load(board)
    const i = getItem(e.board, id)!
    expect(widths(i.table!)).toEqual([150, T.FIT_MAX, 150])
    expect({ w: i.w, h: i.h }).toEqual(T.tableSize(i.table!, measure))
    // And when it's a board on a server, joined live.
    const live = new Editor(emptyBoard(), measure)
    live.resetFromRemote(board, { readOnly: false, idBase: 1000 })
    expect(widths(getItem(live.board, id)!.table!)).toEqual([150, T.FIT_MAX, 150])
    expect(getItem(live.board, id)!.h).toBe(T.tableSize(getItem(live.board, id)!.table!, measure).h)
  })

  it('size a table someone else changed, as it arrives', () => {
    const { e, id, item } = editor()
    const t = item().table!
    // Their change, sized as their own screen (or a script with nothing to measure text with) had it.
    const theirs = updateItem(e.board, id, (i) => ({ ...i, table: T.setCell(t, t.rows[1].id, t.columns[1].id, LONG), h: 10 }))
    e.applyRemote(diff(e.board, theirs))
    expect(item().table!.rows[1].cells[t.columns[1].id]).toBe(LONG)
    expect(item().h).toBe(ABOVE + 52 + 52 + 2)
  })
})
