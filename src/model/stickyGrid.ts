/**
 * Many sticky notes at once: a pasted list, one idea per line, becomes a tidy
 * grid of notes. Indented lists are left to mind maps, and prose that happens
 * to have line breaks stays one note.
 */

import { addItem, newItem } from './board'
import type { Vec } from './geom'
import { type Board, defaultSize, type Id } from './types'

const BULLET = /^(?:[-*•▪◦]|\d+[.)]|\[[ xX]?\])\s+/
const MAX_NOTES = 80

/** The ideas in `text` if it's a flat list of short lines (no indents, no headings), else null. */
export function listLines(text: string): string[] | null {
  const raw = text.replace(/\t/g, '    ').split(/\r?\n/).filter((l) => l.trim())
  if (raw.length < 2 || raw.length > MAX_NOTES) return null
  // Indents or headings mean structure: that's an outline, for a mind map.
  if (raw.some((l) => /^\s/.test(l) || /^#+\s/.test(l))) return null
  const lines = raw.map((l) => l.trim().replace(BULLET, '').trim()).filter(Boolean)
  // Long lines are a paragraph someone pasted, not a list of ideas.
  if (lines.length < 2 || lines.some((l) => l.length > 160)) return null
  return lines
}

/** Adds one sticky note per line in a grid centred on `at` (up to six across). */
export function stickyGrid(b: Board, lines: string[], at: Vec): [Board, Id[]] {
  const { w, h } = defaultSize('sticky')
  const gap = 24
  const cols = Math.min(6, Math.ceil(Math.sqrt(lines.length)))
  const rows = Math.ceil(lines.length / cols)
  const x0 = at.x - (cols * w + (cols - 1) * gap) / 2
  const y0 = at.y - (rows * h + (rows - 1) * gap) / 2
  const ids: Id[] = []
  lines.forEach((text, k) => {
    let id: Id
    ;[b, id] = addItem(b, newItem('sticky', { x: x0 + (k % cols) * (w + gap), y: y0 + Math.floor(k / cols) * (h + gap), w, h }, { text }))
    ids.push(id)
  })
  return [b, ids]
}
