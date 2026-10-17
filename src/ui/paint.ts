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

/** Dark or light text, whichever reads better on `hex`. */
export function textOn(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  if (Number.isNaN(n)) return '#ffffff'
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  // Whichever of white or near-black text has more contrast on this colour (WCAG ratios).
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const onWhite = 1.05 / (l + 0.05)
  const onDark = (l + 0.05) / 0.063
  return onDark > onWhite ? '#1e1e24' : '#ffffff'
}
