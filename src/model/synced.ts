/**
 * Synced sections in a wiki: words kept once and shown on every page that names them. One page
 * holds the section, `{{synced "Team contacts"}}` … `{{/synced}}`; any other page shows it with
 * the line `{{synced "Team contacts"}}` alone. Changing it from any of those pages changes it in
 * the page that holds it, so every page shows the same words (and the change is in that page's
 * history). Pure functions.
 */

import { argText, parseArgs } from './macros'
import { pageOrder, pageText } from './wiki'
import type { Board } from './types'

const OPEN = /^\s*\{\{\s*synced\b([^}]*)\}\}\s*$/i
const CLOSE = /^\s*\{\{\s*\/\s*synced\s*\}\}\s*$/i

const nameOf = (args: string) => argText(parseArgs(args)) || parseArgs(args).named.name || ''
const same = (a: string, z: string) => a.trim().toLowerCase() === z.trim().toLowerCase()

export interface SyncedSource {
  /** The page that holds it. */
  page: string
  /** Its opening and closing lines there. */
  open: number
  close: number
  /** Its words. */
  text: string
}

/** Where a page holds sections: name, opening and closing line. */
function holds(text: string): { name: string; open: number; close: number }[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: { name: string; open: number; close: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i])
    if (!m) continue
    const close = lines.findIndex((l, j) => j > i && CLOSE.test(l))
    if (close < 0) continue
    // A line naming a section before another one closes it is just showing that one.
    if (lines.slice(i + 1, close).some((l) => OPEN.test(l))) continue
    out.push({ name: nameOf(m[1]), open: i, close })
    i = close
  }
  return out
}

/** The section called `name`: the first page (in page order) that holds it. */
export function findSynced(b: Board, name: string): SyncedSource | null {
  if (!name.trim()) return null
  for (const p of pageOrder(b)) {
    const text = pageText(b, p.id)
    if (!/\{\{\s*synced/i.test(text)) continue
    const hit = holds(text).find((h) => same(h.name, name))
    if (hit) return { page: p.id, open: hit.open, close: hit.close, text: text.replace(/\r\n?/g, '\n').split('\n').slice(hit.open + 1, hit.close).join('\n') }
  }
  return null
}

/** The page text with the section's words replaced by `words` (null when nothing holds it). */
export function withSynced(b: Board, name: string, words: string): { page: string; text: string } | null {
  const src = findSynced(b, name)
  if (!src) return null
  const lines = pageText(b, src.page).replace(/\r\n?/g, '\n').split('\n')
  lines.splice(src.open + 1, src.close - src.open - 1, ...words.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n'))
  return { page: src.page, text: lines.join('\n') }
}

/** The pages that show the section (the one holding it included). */
export function syncedPages(b: Board, name: string): string[] {
  return pageOrder(b)
    .filter((p) => {
      const text = pageText(b, p.id)
      return /\{\{\s*synced/i.test(text) && text.split(/\r?\n/).some((l) => OPEN.test(l) && same(nameOf(OPEN.exec(l)![1]), name))
    })
    .map((p) => p.id)
}

/** Page text with each line that only names a section written out as its words (for search and exports). */
export function expandSynced(b: Board, text: string): string {
  if (!/\{\{\s*synced/i.test(text)) return text
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const held = new Set(holds(text).flatMap((h) => [h.open, h.close]))
  return lines
    .map((l, k) => {
      const m = !held.has(k) && OPEN.exec(l)
      if (!m) return l
      const src = findSynced(b, nameOf(m[1]))
      return src ? `\n${src.text}\n` : l
    })
    .join('\n')
}
