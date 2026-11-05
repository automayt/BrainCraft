/**
 * The top bar gives way a step at a time as the window narrows: the search box loses its words,
 * the rarer buttons move into ⋯, and Ask AI loses its label. Measured rather than set by window
 * size, because what else is up there varies (a long list of people, a child board's parent).
 */

/** What goes, first to last. */
export const FOLDS = ['search', 'help', 'present', 'comments', 'ask', 'share'] as const
export type Fold = (typeof FOLDS)[number]

export const isFolded = (what: Fold, level: number) => FOLDS.indexOf(what) < level

/**
 * The level to be at, given how wide the bar is now at `level`. `widths` remembers how wide it was
 * at each level, so it only comes back out when it will fit.
 */
export function refold(level: number, width: number, room: number, widths: number[]): number {
  widths[level] = width
  if (width > room) return Math.min(level + 1, FOLDS.length)
  return level > 0 && widths[level - 1] !== undefined && widths[level - 1] <= room ? level - 1 : level
}
