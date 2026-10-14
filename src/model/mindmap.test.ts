import { describe, expect, it } from 'vitest'
import { getItem, hiddenIds, subtree } from './board'
import * as M from './mindmap'
import { fakeMeasure } from './test-helpers'
import { BRANCHES, type Board, type Item } from './types'
import { emptyBoard } from './board'

function map(): { b: Board; root: number; a: number; a1: number; a2: number; c: number } {
  let b = emptyBoard()
  let root: number, a: number, a1: number, a2: number, c: number
  ;[b, root] = M.createMap(b, { x: 0, y: 0 }, 'Root')
  ;[b, a] = M.addChild(b, root, undefined, 'A')
  ;[b, c] = M.addChild(b, root, undefined, 'C')
  ;[b, a1] = M.addChild(b, a, undefined, 'A1')
  ;[b, a2] = M.addChild(b, a, undefined, 'A2')
  return { b: M.layoutAll(b, fakeMeasure), root, a, a1, a2, c }
}

const node = (b: Board, id: number) => getItem(b, id)!
const cy = (i: Item) => i.y + i.h / 2

describe('mind map structure', () => {
  it('balances main branches across both sides with distinct colours', () => {
    const { b, a, c } = map()
    expect(node(b, a).side).toBe('right')
    expect(node(b, c).side).toBe('left')
    expect(node(b, a).color).toBe(BRANCHES[0][1])
    expect(node(b, c).color).toBe(BRANCHES[1][1])
  })

  it('children inherit their branch colour', () => {
    const { b, a, a1 } = map()
    expect(node(b, a1).color).toBe(node(b, a).color)
    expect(node(b, a1).side).toBeUndefined()
    expect(M.sideOf(b, a1)).toBe('right')
  })

  it('adds siblings right after the node, in order', () => {
    let { b, a1, a } = map()
    let s: number
    ;[b, s] = M.addSibling(b, a1, 'A1b')
    const kids = b.items.filter((i) => i.parent === a).map((i) => i.text)
    expect(kids).toEqual(['A1', 'A1b', 'A2'])
    expect(node(b, s).parent).toBe(a)
  })

  it('a sibling of the root is a child', () => {
    let { b, root } = map()
    let s: number
    ;[b, s] = M.addSibling(b, root)
    expect(node(b, s).parent).toBe(root)
  })
})

describe('mind map layout', () => {
  it('places branches beside the root on their side, children further out', () => {
    const { b, root, a, a1, c } = map()
    const r = node(b, root)
    expect(node(b, a).x).toBeGreaterThan(r.x + r.w)
    expect(node(b, c).x + node(b, c).w).toBeLessThan(r.x)
    expect(node(b, a1).x).toBeGreaterThan(node(b, a).x + node(b, a).w)
  })

  it('stacks siblings without overlap, centred on their parent', () => {
    const { b, a, a1, a2 } = map()
    const n1 = node(b, a1)
    const n2 = node(b, a2)
    expect(n1.y + n1.h).toBeLessThanOrEqual(n2.y)
    expect((cy(n1) + cy(n2)) / 2).toBeCloseTo(cy(node(b, a)))
  })

  it('sizes nodes from their text', () => {
    let { b, a1 } = map()
    const w = node(b, a1).w
    b = M.layoutAll({ ...b, items: b.items.map((i) => (i.id === a1 ? { ...i, text: 'A much longer idea' } : i)) }, fakeMeasure)
    expect(node(b, a1).w).toBeGreaterThan(w)
  })

  it('keeps the root centred when its text changes', () => {
    let { b, root } = map()
    const before = node(b, root)
    b = M.layoutAll({ ...b, items: b.items.map((i) => (i.id === root ? { ...i, text: 'A far longer root' } : i)) }, fakeMeasure)
    const after = node(b, root)
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2)
    expect(after.y + after.h / 2).toBeCloseTo(before.y + before.h / 2)
  })

  it('returns the same board when nothing moves', () => {
    const { b } = map()
    expect(M.layoutAll(b, fakeMeasure)).toBe(b)
  })

  it('follows the root when the map is moved', () => {
    const { b, root, a1 } = map()
    const moved = M.layoutAll(
      { ...b, items: b.items.map((i) => (i.id === root ? { ...i, x: i.x + 100 } : i)) },
      fakeMeasure,
    )
    expect(node(moved, a1).x).toBeCloseTo(node(b, a1).x + 100)
  })

  it('hides collapsed branches and closes the gap', () => {
    let { b, a, a1, c } = map()
    let extra: number
    ;[b, extra] = M.addChild(b, c, undefined, 'C1')
    b = M.layoutAll(b, fakeMeasure)
    b = M.layoutAll(M.toggleCollapsed(b, a), fakeMeasure)
    expect(hiddenIds(b)).toEqual(new Set([getItem(b, a1)!.id, b.items.find((i) => i.text === 'A2')!.id]))
    expect(node(b, a).collapsed).toBe(true)
    expect(extra).toBeGreaterThan(0)
    // Adding to a collapsed node opens it again.
    ;[b] = M.addChild(b, a, undefined, 'A3')
    expect(node(b, a).collapsed).toBe(false)
  })
})

describe('mind map editing', () => {
  it('reparents a branch with its subtree and recolours it', () => {
    let { b, a, a1, c } = map()
    let deep: number
    ;[b, deep] = M.addChild(b, a1, undefined, 'deep')
    b = M.reparent(b, a1, c)
    expect(node(b, a1).parent).toBe(c)
    expect(node(b, a1).color).toBe(node(b, c).color)
    expect(node(b, deep).color).toBe(node(b, c).color)
    expect(M.sideOf(b, deep)).toBe('left')
    expect(b.items.filter((i) => i.parent === a).map((i) => i.text)).toEqual(['A2'])
  })

  it('refuses to move a node into its own branch', () => {
    const { b, a, a1 } = map()
    expect(M.reparent(b, a, a1)).toBe(b)
  })

  it('moving to the root makes a main branch with its own colour and side', () => {
    let { b, root, a1 } = map()
    b = M.reparent(b, a1, root, 'left')
    expect(node(b, a1).side).toBe('left')
    expect(BRANCHES.map(([, c]) => c)).toContain(node(b, a1).color)
    expect(node(b, a1).color).not.toBe(BRANCHES[0][1])
  })

  it('reorders siblings', () => {
    let { b, a, a2 } = map()
    b = M.moveAmongSiblings(b, a2, -1)
    expect(b.items.filter((i) => i.parent === a).map((i) => i.text)).toEqual(['A2', 'A1'])
    expect(M.moveAmongSiblings(b, a2, -1)).toBe(b)
  })

  it('colours a whole branch', () => {
    let { b, a, a1, root } = map()
    b = M.setBranchColor(b, a, '#123456')
    expect(node(b, a1).color).toBe('#123456')
    expect(node(b, root).color).not.toBe('#123456')
  })

  it('picks a sensible node after deleting', () => {
    const { b, a, a1, a2, root } = map()
    expect(M.selectionAfterDelete(b, new Set([a2]))).toBe(a1)
    expect(M.selectionAfterDelete(b, new Set([a1]))).toBe(a)
    expect(M.selectionAfterDelete(b, subtree(b, a))).toBe(root)
  })
})

describe('mind map navigation', () => {
  it('moves outward, back and between siblings following the layout', () => {
    const { b, root, a, a1, a2, c } = map()
    expect(M.navigate(b, root, 'right')).toBe(a)
    expect(M.navigate(b, root, 'left')).toBe(c)
    expect(M.navigate(b, a, 'right')).toBeOneOf([a1, a2])
    expect(M.navigate(b, a1, 'left')).toBe(a)
    expect(M.navigate(b, a1, 'down')).toBe(a2)
    expect(M.navigate(b, a2, 'up')).toBe(a1)
    expect(M.navigate(b, a2, 'down')).toBeUndefined()
    expect(M.navigate(b, c, 'right')).toBe(root)
  })
})

describe('outlines', () => {
  it('exports a map as an indented list', () => {
    const { b, a1 } = map()
    expect(M.toOutline(b, a1)).toBe('- Root\n  - A\n    - A1\n    - A2\n  - C')
  })

  it('parses bullets, numbers, headings and plain indentation', () => {
    const tree = M.parseOutline('# Plan\n- Goals\n  1. Ship\n  2. Learn\n- Risks\n    * Time')!
    expect(tree.text).toBe('Plan')
    expect(tree.children.map((c) => c.text)).toEqual(['Goals', 'Risks'])
    expect(tree.children[0].children.map((c) => c.text)).toEqual(['Ship', 'Learn'])
    expect(tree.children[1].children[0].text).toBe('Time')
  })

  it('gives several top-level lines a shared root, and ignores single lines', () => {
    expect(M.parseOutline('one\ntwo')).toEqual({
      text: 'Mind map',
      children: [
        { text: 'one', children: [] },
        { text: 'two', children: [] },
      ],
    })
    expect(M.parseOutline('just one line')).toBeNull()
  })

  it('round-trips through a map', () => {
    const { b, root } = map()
    const outline = M.toOutline(b, root)
    const [b2, root2] = M.createMapFromOutline(emptyBoard(), M.parseOutline(outline)!, { x: 0, y: 0 })
    expect(M.toOutline(b2, root2)).toBe(outline)
  })
})
