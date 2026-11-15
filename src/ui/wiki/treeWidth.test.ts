import { describe, expect, it } from 'vitest'
import { TREE_WIDTH, fitTreeWidth, loadTreeWidth, saveTreeWidth, treeWidthKey } from './treeWidth'

const store = () => {
  const kept = new Map<string, string>()
  return { kept, getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) }
}

describe('how wide a wiki’s list of pages is', () => {
  it('stays within its limits', () => {
    expect(fitTreeWidth(50)).toBe(TREE_WIDTH.min)
    expect(fitTreeWidth(5000)).toBe(TREE_WIDTH.max)
    expect(fitTreeWidth(333.4)).toBe(333)
    expect(fitTreeWidth(Number.NaN)).toBe(TREE_WIDTH.usual)
  })

  it('leaves the page room in a small window', () => {
    // 900 wide: the list can take 540, leaving 360 for the page.
    expect(fitTreeWidth(600, 900)).toBe(540)
    // Too small a window for both: the list is as narrow as it goes.
    expect(fitTreeWidth(400, 400)).toBe(TREE_WIDTH.min)
  })

  it('is remembered in the browser, and the usual width is not kept', () => {
    const s = store()
    expect(loadTreeWidth(s)).toBe(TREE_WIDTH.usual)
    saveTreeWidth(412, s)
    expect(loadTreeWidth(s)).toBe(412)
    saveTreeWidth(TREE_WIDTH.usual, s)
    expect(s.kept.size).toBe(0)
  })

  it('is the usual width when what was kept can’t be read', () => {
    const s = store()
    s.kept.set('braincraft:wiki-tree', 'wide')
    expect(loadTreeWidth(s)).toBe(TREE_WIDTH.usual)
    s.kept.set('braincraft:wiki-tree', '99999')
    expect(loadTreeWidth(s)).toBe(TREE_WIDTH.max)
    expect(loadTreeWidth(null)).toBe(TREE_WIDTH.usual)
    const blocked = () => {
      throw new Error('blocked')
    }
    expect(loadTreeWidth({ getItem: blocked })).toBe(TREE_WIDTH.usual)
    expect(() => saveTreeWidth(300, { setItem: blocked, removeItem: blocked })).not.toThrow()
  })

  it('moves a step with the arrow keys, and to its limits with Home and End', () => {
    expect(treeWidthKey('ArrowRight', 270)).toBe(286)
    expect(treeWidthKey('ArrowLeft', 270)).toBe(254)
    expect(treeWidthKey('ArrowLeft', TREE_WIDTH.min)).toBe(TREE_WIDTH.min)
    expect(treeWidthKey('Home', 400)).toBe(TREE_WIDTH.min)
    expect(treeWidthKey('End', 400)).toBe(TREE_WIDTH.max)
    expect(treeWidthKey('End', 400, 900)).toBe(540)
    expect(treeWidthKey('Enter', 400)).toBeNull()
  })
})
