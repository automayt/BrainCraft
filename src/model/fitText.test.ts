import { describe, expect, it } from 'vitest'
import { approxMeasure } from './approxMeasure'
import { addItem, emptyBoard, newItem } from './board'
import { MAX_FIT_FONT, MIN_FONT, fitFontSize, fitToContent, itemFontSize, kanbanFit, sameSize } from './fitText'
import { KANBAN_COL_W, addCard, addColumn, newKanban } from './kanban'
import { layoutAll } from './mindmap'
import { cleanBoard } from './sanitize'
import { textRect } from './shapes'
import type { Board, Item, Kind } from './types'

const item = (kind: Kind, text: string, extra: Partial<Item> = {}): Item => ({ id: 1, ...newItem(kind, { x: 0, y: 0, w: 170, h: 84 }, { text, ...extra }) }) as Item

/** Whether text at a size fits an object's text area. */
const fits = (i: Item, size: number) => {
  const r = textRect(i)
  const m = approxMeasure(i.text, size, 400, r.w - 2, !!i.sketch)
  return m.w <= r.w && m.h <= r.h
}

describe('text that fits its shape', () => {
  it('finds the largest size that fits, and the smallest when nothing does', () => {
    const box = { w: 100, h: 40 }
    const s = fitFontSize(approxMeasure, 'A few words to fit in', box, 40)
    expect(approxMeasure('A few words to fit in', s, 400, 98).h).toBeLessThanOrEqual(40)
    expect(approxMeasure('A few words to fit in', s + 1, 400, 98).h).toBeGreaterThan(40)
    expect(fitFontSize(approxMeasure, 'word '.repeat(500), box, 40)).toBe(MIN_FONT)
    // No text: the size it would have.
    expect(fitFontSize(approxMeasure, '  ', box, 40)).toBe(40)
  })

  it('shrinks a flowchart step’s long text to fit, and grows a short one', () => {
    const long = item('flow', 'Check the customer account standing and every outstanding invoice before approving the order', { shape: 'process' })
    const size = itemFontSize(long, approxMeasure)
    expect(size).toBeLessThan(long.fontSize)
    expect(fits(long, size)).toBe(true)
    const short = item('flow', 'Start', { shape: 'terminator' })
    expect(itemFontSize(short, approxMeasure)).toBeGreaterThan(short.fontSize)
    expect(itemFontSize(short, approxMeasure)).toBeLessThanOrEqual(MAX_FIT_FONT)
    // A bigger shape, bigger text.
    expect(itemFontSize({ ...short, w: 400, h: 200 }, approxMeasure)).toBeGreaterThan(itemFontSize(short, approxMeasure))
  })

  it('fits every flowchart symbol, rectangle and ellipse, however small', () => {
    const text = 'Is the overdue balance more than thirty days old?'
    for (const [kind, shape] of [['flow', 'process'], ['flow', 'decision'], ['flow', 'data'], ['flow', 'document'], ['flow', 'database'], ['flow', 'terminator'], ['flow', 'subroutine'], ['rect'], ['ellipse']] as [Kind, Item['shape']?][]) {
      for (const [w, h] of [[170, 84], [110, 60], [400, 50]]) {
        const i = { ...item(kind, text, shape ? { shape } : {}), w, h }
        const size = itemFontSize(i, approxMeasure)
        expect(fits(i, size), `${kind} ${shape ?? ''} ${w}×${h} at ${size}`).toBe(true)
      }
    }
  })

  it('keeps a size given with the text buttons, shrinking only to fit', () => {
    const fixed = item('rect', 'Hi', { fontSize: 20, fontFixed: true })
    expect(itemFontSize(fixed, approxMeasure)).toBe(20)
    const crowded = { ...fixed, text: 'A great deal more to say than this little shape can hold at that size' }
    expect(itemFontSize(crowded, approxMeasure)).toBeLessThan(20)
  })

  it('never grows a sticky note’s text, but shrinks it rather than spill', () => {
    const note = { ...item('sticky', 'Hi'), w: 200, h: 200 }
    expect(itemFontSize(note, approxMeasure)).toBe(note.fontSize)
    const full = { ...note, text: 'word '.repeat(120) }
    const size = itemFontSize(full, approxMeasure)
    expect(size).toBeLessThan(note.fontSize)
    expect(fits(full, size)).toBe(true)
  })

  it('leaves other objects’ text alone', () => {
    expect(itemFontSize(item('text', 'word '.repeat(200), { fontSize: 28 }), approxMeasure)).toBe(28)
  })

  it('keeps a given size through a save, and nothing but true', () => {
    const b = cleanBoard({ ...emptyBoard(), items: [{ ...item('flow', 'x'), fontFixed: true }, { ...item('flow', 'y'), id: 2, fontFixed: 'yes' }] } as unknown as Board)
    expect(b.items.map((i) => i.fontFixed)).toEqual([true, undefined])
  })
})

describe('long words', () => {
  it('count the lines they break over', () => {
    const word = 'Supercalifragilisticexpialidociousnessandmore'
    const one = approxMeasure('Short', 18, 400, 200)
    const long = approxMeasure(word, 18, 400, 200)
    expect(long.w).toBeLessThanOrEqual(200)
    expect(long.h).toBeGreaterThan(one.h)
    // After other words, the long one starts a line of its own.
    expect(approxMeasure(`Hi ${word}`, 18, 400, 200).h).toBeGreaterThan(long.h)
  })

  it('make a mind map idea taller instead of spilling out', () => {
    let [b, root] = addItem(emptyBoard(), newItem('mind', { x: 0, y: 0, w: 0, h: 0 }, { text: 'Root' }))
    let short: number
    let long: number
    ;[b, short] = addItem(b, newItem('mind', { x: 0, y: 0, w: 0, h: 0 }, { text: 'Short', parent: root, side: 'right' }))
    ;[b, long] = addItem(b, newItem('mind', { x: 0, y: 0, w: 0, h: 0 }, { text: 'Supercalifragilisticexpialidociousnessandmore', parent: root, side: 'right' }))
    b = layoutAll(b, approxMeasure)
    const h = (id: number) => b.items.find((i) => i.id === id)!.h
    expect(h(long)).toBeGreaterThan(h(short))
  })
})

describe('fit to content', () => {
  const board = (...items: Item[]): Board => ({ ...emptyBoard(), items, nextId: items.length + 1 })

  it('shrinks or grows a shape around its text, keeping its centre, so the text fits at its size', () => {
    for (const [kind, shape] of [['flow', 'process'], ['flow', 'decision'], ['flow', 'data'], ['flow', 'terminator'], ['flow', 'database'], ['rect'], ['ellipse']] as [Kind, Item['shape']?][]) {
      for (const text of ['Yes', 'Check the customer account standing and every outstanding invoice before approving']) {
        const i = { ...item(kind, text, shape ? { shape } : {}), x: 100, y: 100, w: 600, h: 400 }
        const r = fitToContent(board(i), i, approxMeasure)!
        const fitted = { ...i, ...r }
        expect(itemFontSize(fitted, approxMeasure), `${kind} ${shape ?? ''} “${text}”`).toBeGreaterThanOrEqual(i.fontSize)
        expect(r.w).toBeLessThan(600)
        expect(r.x + r.w / 2).toBeCloseTo(400, -1)
        expect(r.y + r.h / 2).toBeCloseTo(300, -1)
      }
    }
  })

  it('puts an empty shape back to its usual size instead of shrinking it away', () => {
    const empty = { ...item('flow', '', { shape: 'decision' }), w: 20, h: 10 }
    expect(fitToContent(board(empty), empty, approxMeasure)).toMatchObject({ w: 180, h: 110 })
    const rect = { ...item('rect', '  '), w: 900, h: 900 }
    expect(fitToContent(board(rect), rect, approxMeasure)).toMatchObject({ w: 220, h: 140 })
  })

  it('keeps a sticky note square', () => {
    const note = { ...item('sticky', 'word '.repeat(60)), w: 120, h: 120 }
    const r = fitToContent(board(note), note, approxMeasure)!
    expect(r.w).toBe(r.h)
    expect(r.w).toBeGreaterThan(120)
    expect(itemFontSize({ ...note, ...r }, approxMeasure)).toBe(note.fontSize)
  })

  it('wraps a frame around what’s in it, strays included, and leaves an empty one be', () => {
    const frame: Item = { ...item('frame', 'Plan'), id: 1, x: 0, y: 0, w: 1000, h: 800 }
    const a: Item = { ...item('sticky', 'a'), id: 2, x: 100, y: 100, w: 200, h: 200 }
    // Mostly inside, poking out of the bottom.
    const b: Item = { ...item('sticky', 'b'), id: 3, x: 400, y: 700, w: 200, h: 200 }
    // Outside.
    const c: Item = { ...item('sticky', 'c'), id: 4, x: 2000, y: 0, w: 200, h: 200 }
    expect(fitToContent(board(frame, a, b, c), frame, approxMeasure)).toEqual({ x: 60, y: 60, w: 580, h: 880 })
    expect(fitToContent(board(frame, c), frame, approxMeasure)).toBeNull()
    // A frame around it isn't something in it.
    const outer: Item = { ...frame, id: 5, x: -500, y: -500, w: 3000, h: 3000 }
    expect(fitToContent(board(outer, frame, a), frame, approxMeasure)).toEqual({ x: 60, y: 60, w: 280, h: 280 })
  })

  it('fits a text box to its lines', () => {
    const t = { ...item('text', 'One line\nand a much longer second line', { fontSize: 20 }), w: 900, h: 300 }
    const r = fitToContent(board(t), t, approxMeasure)!
    expect(r).toMatchObject({ x: t.x, y: t.y })
    expect(r.w).toBeLessThan(900)
    expect(r.h).toBeLessThan(100)
  })

  it('makes shapes one size, the largest, each about its centre', () => {
    const a = { ...item('flow', 'a'), id: 1, x: 0, y: 0, w: 100, h: 50 }
    const b = { ...item('flow', 'b'), id: 2, x: 300, y: 0, w: 200, h: 40 }
    const r = sameSize([a, b])
    expect(r.get(1)).toEqual({ x: -50, y: 0, w: 200, h: 50 })
    expect(r.get(2)).toEqual({ x: 300, y: -5, w: 200, h: 50 })
  })
})

describe('fitting a Kanban board', () => {
  it('grows with its columns and its longest column of cards', () => {
    let k = newKanban()
    const empty = kanbanFit(k, approxMeasure)
    ;[k] = addCard(k, k.columns[1].id, 'A card')
    const one = kanbanFit(k, approxMeasure)
    expect(one.h).toBeGreaterThan(empty.h - 60)
    for (let n = 0; n < 6; n++) [k] = addCard(k, k.columns[1].id, `Card ${n} with a title long enough to wrap onto a second line of the card`)
    const many = kanbanFit(k, approxMeasure)
    expect(many.h).toBeGreaterThan(one.h + 6 * 50)
    expect(many.w).toBe(empty.w)
    expect(kanbanFit(addColumn(k)[0], approxMeasure).w).toBe(empty.w + KANBAN_COL_W + 12)
  })
})
