/**
 * How wide the list of pages on the left of a wiki is, set by each reader by dragging its edge
 * (kept in this browser, for every wiki): wider for long titles and deep trees, narrower for more
 * room to read.
 */

export const TREE_WIDTH = { usual: 270, min: 180, max: 640, step: 16 } as const

/** Room the page itself is always left, however wide the list is dragged. */
const PAGE_ROOM = 360

const KEY = 'braincraft:wiki-tree'

/** A width the list can be: within its limits, and leaving the page room in a window `windowWidth` wide. */
export function fitTreeWidth(width: number, windowWidth = Infinity): number {
  if (!Number.isFinite(width)) return TREE_WIDTH.usual
  const most = Math.max(TREE_WIDTH.min, Math.min(TREE_WIDTH.max, windowWidth - PAGE_ROOM))
  return Math.round(Math.min(most, Math.max(TREE_WIDTH.min, width)))
}

/** The width chosen in this browser (the usual one when none was, or it can't be read). */
export function loadTreeWidth(store: Pick<Storage, 'getItem'> | null = stored()): number {
  try {
    const kept = store?.getItem(KEY)
    return kept ? fitTreeWidth(Number(kept)) : TREE_WIDTH.usual
  } catch {
    return TREE_WIDTH.usual
  }
}

/** Remembers the width (the usual one is forgotten rather than kept). */
export function saveTreeWidth(width: number, store: Pick<Storage, 'setItem' | 'removeItem'> | null = stored()): void {
  try {
    if (width === TREE_WIDTH.usual) store?.removeItem(KEY)
    else store?.setItem(KEY, String(fitTreeWidth(width)))
  } catch {
    // Private browsing: it's the usual width next time.
  }
}

/** The width after a key on the edge: the arrows a step, Home and End the limits; null for other keys. */
export function treeWidthKey(key: string, width: number, windowWidth = Infinity): number | null {
  if (key === 'ArrowLeft') return fitTreeWidth(width - TREE_WIDTH.step, windowWidth)
  if (key === 'ArrowRight') return fitTreeWidth(width + TREE_WIDTH.step, windowWidth)
  if (key === 'Home') return TREE_WIDTH.min
  if (key === 'End') return fitTreeWidth(TREE_WIDTH.max, windowWidth)
  return null
}

function stored(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
