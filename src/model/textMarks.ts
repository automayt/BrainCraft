/**
 * Bold and italic in the words of a note, a shape, a text box, a comment block or a mind-map idea:
 * `**bold**`, `*italic*` and `***both***`, the same marks a wiki page uses. The marks are part of the
 * text, so what's stored is exactly what was typed; they're read where the text is drawn, measured
 * and searched.
 *
 * A mark opens at the start of a word and closes at the end of one, on the same line. Sums and
 * wildcards (`2*3*4`, `a * b`, `*.txt`) are left as they are.
 */

import type { Kind } from './types'

const MARKED = new Set<Kind>(['sticky', 'text', 'rect', 'ellipse', 'flow', 'comment', 'mind'])

/** Whether an object's words can be bold or italic. */
export const marksText = (k: Kind) => MARKED.has(k)

/** A stretch of text drawn one way. */
export interface TextRun {
  text: string
  b?: true
  i?: true
}

export type Mark = 'b' | 'i'
const STARS: Record<Mark, number> = { b: 2, i: 1 }
/** Whether a run of `n` stars carries `mark`: one is italic, two bold, three both. */
const carries = (n: number, mark: Mark) => n === 3 || n === STARS[mark]

const WORD = /[\p{L}\p{N}_]/u
const isWord = (c: string | undefined) => c !== undefined && WORD.test(c)
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)

interface Stars {
  at: number
  n: number
  open: boolean
  close: boolean
}

/** One line's runs. */
function lineRuns(line: string): TextRun[] {
  if (!line.includes('*')) return line ? [{ text: line }] : []
  const stars: Stars[] = []
  for (let k = 0; k < line.length; k++) {
    if (line[k] !== '*') continue
    let n = 1
    while (line[k + n] === '*') n++
    // Four or more in a row is a row of stars, not a mark.
    if (n <= 3) stars.push({ at: k, n, open: !isWord(line[k - 1]) && !isSpace(line[k + n]), close: !isSpace(line[k - 1]) && !isWord(line[k + n]) })
    k += n - 1
  }
  // Each closing run pairs with the nearest open run of its length; runs left open in between are just stars.
  const b = new Uint8Array(line.length)
  const i = new Uint8Array(line.length)
  const gone = new Uint8Array(line.length)
  const open: Stars[] = []
  for (const s of stars) {
    let match = -1
    if (s.close) for (let k = open.length - 1; k >= 0 && match < 0; k--) if (open[k].n === s.n) match = k
    if (match < 0) {
      if (s.open) open.push(s)
      continue
    }
    const from = open[match]
    open.length = match
    for (let k = 0; k < s.n; k++) gone[from.at + k] = gone[s.at + k] = 1
    for (let k = from.at + from.n; k < s.at; k++) {
      if (s.n >= 2) b[k] = 1
      if (s.n !== 2) i[k] = 1
    }
  }
  const out: TextRun[] = []
  for (let k = 0; k < line.length; k++) {
    if (gone[k]) continue
    const last = out[out.length - 1]
    if (last && !!last.b === !!b[k] && !!last.i === !!i[k]) last.text += line[k]
    else out.push({ text: line[k], ...(b[k] ? { b: true as const } : {}), ...(i[k] ? { i: true as const } : {}) })
  }
  return out
}

/** The text as it's drawn: stretches of plain, bold and italic words, the marks themselves gone. */
export function textRuns(text: string): TextRun[] {
  if (!text.includes('*')) return text ? [{ text }] : []
  const out: TextRun[] = []
  const add = (r: TextRun) => {
    const last = out[out.length - 1]
    if (last && !last.b && !last.i && !r.b && !r.i) last.text += r.text
    else out.push(r)
  }
  text.split('\n').forEach((line, k) => {
    if (k) add({ text: '\n' })
    lineRuns(line).forEach(add)
  })
  return out
}

/** The words without their marks, for searching, listing and reading aloud. */
export function unmarked(text: string): string {
  if (!text.includes('*')) return text
  return textRuns(text)
    .map((r) => r.text)
    .join('')
}

const starsBefore = (s: string, at: number) => {
  let n = 0
  while (s[at - 1 - n] === '*') n++
  return n
}
const starsFrom = (s: string, at: number) => {
  let n = 0
  while (s[at + n] === '*') n++
  return n
}

/**
 * The words a mark would go round, line by line, for the selection `from`..`to`: whole words (a
 * mark only works at a word's ends), without the spaces and stars at either end. With nothing
 * selected, the word the caret is in or beside (stars between them don't count).
 */
function spans(text: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = []
  const caret = from === to
  let start = 0
  for (const line of text.split('\n')) {
    const end = start + line.length
    let a = Math.max(from, start)
    let z = Math.min(to, end)
    if (a <= z && (a < z || caret)) {
      if (caret) {
        while (a > start && text[a - 1] === '*') a--
        while (z < end && text[z] === '*') z++
        while (a > start && !isSpace(text[a - 1]) && text[a - 1] !== '*') a--
        while (z < end && !isSpace(text[z]) && text[z] !== '*') z++
      }
      while (a < z && (isSpace(text[a]) || text[a] === '*')) a++
      while (z > a && (isSpace(text[z - 1]) || text[z - 1] === '*')) z--
      if (a < z) {
        while (a > start && isWord(text[a - 1])) a--
        while (z < end && isWord(text[z])) z++
        out.push([a, z])
      }
    }
    start = end + 1
  }
  return out
}

const marked = (text: string, [a, z]: [number, number], mark: Mark) => carries(Math.min(starsBefore(text, a), starsFrom(text, z)), mark)

/** Whether everything selected is already bold (or italic): what the key would take away. */
export function hasMark(text: string, from: number, to: number, mark: Mark): boolean {
  const all = spans(text, Math.min(from, to), Math.max(from, to))
  return all.length > 0 && all.every((s) => marked(text, s, mark))
}

/**
 * Ctrl B and Ctrl I: the selected words made bold (or italic), or plain again when they all were.
 * Each line gets its own marks. With the caret in a word, that word, and the caret stays put to go
 * on typing; beside no word, an empty pair of marks to type between (and the key again takes the
 * pair away). Returns the text and what to select in it: the words, inside their marks.
 */
export function toggleMark(text: string, from: number, to: number, mark: Mark): { text: string; from: number; to: number } {
  const [lo, hi] = [Math.min(from, to), Math.max(from, to)]
  const n = STARS[mark]
  const stars = '*'.repeat(n)
  const all = spans(text, lo, hi)
  if (!all.length) {
    if (lo !== hi) return { text, from, to }
    // An empty pair around the caret: taken away again.
    const [before, after] = [starsBefore(text, lo), starsFrom(text, lo)]
    if (before === after && carries(before, mark)) return { text: text.slice(0, lo - n) + text.slice(lo + n), from: lo - n, to: lo - n }
    return { text: text.slice(0, lo) + stars + stars + text.slice(lo), from: lo + n, to: lo + n }
  }
  const off = all.every((s) => marked(text, s, mark))
  // How far each line's words move: by its opening marks, added or taken away.
  const change = all.map((s) => (off ? -n : marked(text, s, mark) ? 0 : n))
  let out = text
  // From the end, so earlier places stay where they are.
  for (let k = all.length - 1; k >= 0; k--) {
    const [a, z] = all[k]
    if (change[k] > 0) out = out.slice(0, a) + stars + out.slice(a, z) + stars + out.slice(z)
    else if (change[k] < 0) out = out.slice(0, a - n) + out.slice(a, z) + out.slice(z + n)
  }
  const [a, z] = all[0]
  if (lo === hi) {
    const caret = Math.min(Math.max(lo, a), z) + change[0]
    return { text: out, from: caret, to: caret }
  }
  const earlier = change.slice(0, -1).reduce((sum, c) => sum + 2 * c, 0)
  return { text: out, from: a + change[0], to: all[all.length - 1][1] + earlier + change[change.length - 1] }
}

/** The whole of an object's words made bold (or italic), or plain again. */
export const toggleWhole = (text: string, mark: Mark) => (text.trim() ? toggleMark(text, 0, text.length, mark).text : text)
/** Whether the whole of an object's words is bold (or italic). */
export const wholeHas = (text: string, mark: Mark) => hasMark(text, 0, text.length, mark)
