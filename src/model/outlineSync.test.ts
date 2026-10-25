import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { addItem, emptyBoard, getItem, newItem } from './board'
import { applyOutline, markdownOf, outlineOf, parseLines } from './outlineSync'
import { fakeMeasure } from './test-helpers'
import type { Board } from './types'

const map = (outline: string) => applyOps(emptyBoard(), [{ op: 'createMindMap', outline }], { measure: fakeMeasure }).board
const idOf = (b: Board, t: string) => b.items.find((i) => i.text === t)!.id
const edit = (b: Board, text: string) => applyOutline(b, b.items[0].id, text, fakeMeasure)

describe('a mind map and its outline', () => {
  const start = 'infrastructure\n  Jason\n    Workstations\n    Desktops\n  Brian\n    Servers'

  it('reads a map as an outline, and as simple Markdown', () => {
    const b = map(start)
    expect(outlineOf(b, idOf(b, 'Servers'))).toBe(start)
    expect(markdownOf(b, b.items[0].id)).toBe('# infrastructure\n\n- Jason\n  - Workstations\n  - Desktops\n- Brian\n  - Servers\n')
  })

  it('reads lines with any indent, bullets or tabs', () => {
    expect(parseLines('# Root\n- A\n\t- B\n    - C\nD')).toEqual([
      { text: 'Root', depth: 0 },
      { text: 'A', depth: 1 },
      { text: 'B', depth: 2 },
      { text: 'C', depth: 3 },
      { text: 'D', depth: 1 },
    ])
  })

  it('adds, renames and removes ideas in place, keeping the others as they were', () => {
    const b = map(start)
    const jason = getItem(b, idOf(b, 'Jason'))!
    const desktops = idOf(b, 'Desktops')
    const next = edit(b, 'infrastructure\n  Jason\n    Workstations\n      Hardware\n    Laptops\n  Brian\n  Ana')
    expect(outlineOf(next, next.items[0].id)).toBe('infrastructure\n  Jason\n    Workstations\n      Hardware\n    Laptops\n  Brian\n  Ana')
    // Jason is the same idea, with its colour; Desktops was renamed to Laptops (same idea); Servers went.
    expect(getItem(next, jason.id)).toMatchObject({ text: 'Jason', color: jason.color })
    expect(getItem(next, desktops)!.text).toBe('Laptops')
    expect(next.items.some((i) => i.text === 'Servers')).toBe(false)
    expect(next.items.every((i) => i.kind === 'mind')).toBe(true)
  })

  it('moves a branch pasted under another idea, with what is under it, and reorders siblings', () => {
    const b = map(start)
    const ws = idOf(b, 'Workstations')
    const brian = getItem(b, idOf(b, 'Brian'))!
    const next = edit(b, 'infrastructure\n  Brian\n    Servers\n    Workstations\n  Jason\n    Desktops')
    expect(getItem(next, ws)!.parent).toBe(brian.id)
    // Moving to another main branch takes that branch's colour.
    expect(getItem(next, ws)!.color).toBe(brian.color)
    expect(outlineOf(next, next.items[0].id)).toBe('infrastructure\n  Brian\n    Servers\n    Workstations\n  Jason\n    Desktops')
  })

  it('swaps a parent and child without losing either', () => {
    const b = map('Root\n  A\n    B')
    const [a, bb] = [idOf(b, 'A'), idOf(b, 'B')]
    const next = edit(b, 'Root\n  B\n    A')
    expect(getItem(next, bb)!.parent).toBe(next.items[0].id)
    expect(getItem(next, a)!.parent).toBe(bb)
  })

  it('keeps ideas with the same words apart by where they are', () => {
    const b = map('Root\n  Workstations\n    Patching\n  Desktops\n    Patching')
    const ids = b.items.filter((i) => i.text === 'Patching').map((i) => i.id)
    const next = edit(b, 'Root\n  Workstations\n    Patching\n    Imaging\n  Desktops\n    Patching')
    expect(next.items.filter((i) => i.text === 'Patching').map((i) => i.id).sort()).toEqual(ids.sort())
  })

  it('changes nothing for an empty outline, and leaves other things on the board alone', () => {
    let b = map(start)
    ;[b] = addItem(b, newItem('sticky', { x: 2000, y: 0, w: 200, h: 200 }, { text: 'Note' }))
    expect(edit(b, '   \n')).toBe(b)
    const next = edit(b, 'infrastructure\n  Jason')
    expect(next.items.find((i) => i.text === 'Note')).toEqual(b.items.find((i) => i.text === 'Note'))
  })

  it('round-trips its own Markdown', () => {
    const b = map(start)
    expect(outlineOf(edit(b, markdownOf(b, b.items[0].id)), b.items[0].id)).toBe(start)
  })
})
