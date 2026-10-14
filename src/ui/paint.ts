/**
 * Board colours that follow the theme. Content colours chosen by the user
 * stay as they are, but the defaults (black ink, grey lines, white frames,
 * the dark mind-map centre) would vanish on a dark canvas, so they render
 * through theme variables instead.
 */

import { INKS, MIND_ROOT_COLOR } from '../model/types'

const DEFAULT_INK = INKS[0][1].toLowerCase()
const DEFAULT_LINE = INKS[1][1].toLowerCase()

/** Text, drawing and line colours. */
export function ink(color: string): string {
  const c = color.toLowerCase()
  if (c === DEFAULT_INK) return 'var(--ink)'
  if (c === DEFAULT_LINE) return 'var(--line)'
  return color
}

/** Frame backgrounds. */
export function frameFill(color: string): string {
  return color.toLowerCase() === '#ffffff' ? 'var(--frame-fill)' : color
}

/** A mind map's central node. */
export function mindRootFill(color: string): string {
  return color.toLowerCase() === MIND_ROOT_COLOR.toLowerCase() ? 'var(--mind-root)' : color
}

export function mindRootText(color: string): string {
  return color.toLowerCase() === MIND_ROOT_COLOR.toLowerCase() ? 'var(--mind-root-text)' : '#ffffff'
}

export const ACCENT = 'var(--accent)'
