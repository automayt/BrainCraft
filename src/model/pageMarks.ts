/**
 * How a page's Markdown looks while it's written in place: which lines are headings, which words
 * are bold, and which of the Markdown steps aside. The text itself is never changed, so what's
 * stored is exactly what was typed. Works from the page parser's own results, so writing can't
 * disagree with reading.
 */

import { type Block, HEADING, type InlineSpan, LIST, QUOTE, parseInline, parseMarkdown } from './markdown'

/** The look of a whole line. */
export type LineLook = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'note' | 'tip' | 'warning' | 'danger' | 'list' | 'done' | 'gap'

export interface PageMarks {
  lines: { at: number; look: LineLook }[]
  /** Stretches of words with a look of their own. */
  words: { from: number; to: number; look: 'b' | 'i' | 's' | 'code' | 'a' }[]
  /** Markdown hidden unless the caret is between `show[0]` and `show[1]` (both included). */
  hides: { from: number; to: number; show: [number, number] }[]
  /** Links, mentions and inline macros, shown by name and moved past as one. */
  chips: { from: number; to: number; label: string }[]
  /** The mark starting a bulleted or checklist line; `task` is whether a checklist item is ticked. */
  bullets: { from: number; to: number; task?: boolean }[]
  /** Blocks drawn as they read. `fixed` ones (embeds, pictures) never show their Markdown here. */
  blocks: { from: number; to: number; block: Block; fixed: boolean }[]
}

const DRAWN = new Set<Block['t']>(['code', 'table', 'hr', 'macro', 'embed', 'image', 'children', 'toc'])
const FIXED = new Set<Block['t']>(['embed', 'image', 'children', 'toc'])

/** Works out the marks for a page's text. Positions are offsets into `text` as given. */
export function pageMarks(text: string): PageMarks {
  const marks: PageMarks = { lines: [], words: [], hides: [], chips: [], bullets: [], blocks: [] }
  const raw = text.split('\n')
  const starts: number[] = []
  let at = 0
  for (const line of raw) {
    starts.push(at)
    at += line.length + 1
  }
  const lineOf = (n: number) => raw[n]?.replace(/\r$/, '') ?? ''

  const inline = (s: string, base: number) => {
    const spans: InlineSpan[] = []
    parseInline(s, 0, spans, base)
    for (const x of spans) {
      if (x.t === 'chip') marks.chips.push({ from: x.from, to: x.to, label: x.label ?? '' })
      else {
        if (x.t !== 'mark') marks.words.push({ from: x.from, to: x.to, look: x.t })
        const show: [number, number] = [x.from + 1, x.to - 1]
        if (x.open) marks.hides.push({ from: x.from, to: x.from + x.open, show })
        if (x.close) marks.hides.push({ from: x.to - x.close, to: x.to, show })
      }
    }
  }
  /** Markdown at the start of a line: back in view only with the caret in it. */
  const lead = (from: number, length: number) => {
    if (length) marks.hides.push({ from, to: from + length, show: [from, from + length - 1] })
  }

  const heading = (n: number) => {
    const line = lineOf(n)
    const m = HEADING.exec(line)
    if (!m) return inline(line, starts[n])
    const before = line.length - (m[2]?.length ?? 0)
    marks.lines.push({ at: starts[n], look: `h${m[1].length}` as LineLook })
    lead(starts[n], before)
    if (m[2]) inline(m[2], starts[n] + before)
  }

  const listLine = (n: number) => {
    const line = lineOf(n)
    const m = LIST.exec(line)
    const from = starts[n]
    if (!m) {
      marks.lines.push({ at: from, look: 'list' })
      return inline(line, from)
    }
    const box = /^\[([ xX])\]\s+/.exec(m[3])
    const body = line.length - m[3].length
    const task = box ? box[1] !== ' ' : undefined
    marks.lines.push({ at: from, look: task ? 'done' : 'list' })
    const mark = from + m[1].length
    const words = from + body + (box?.[0].length ?? 0)
    if (box || !/\d/.test(m[2])) marks.bullets.push({ from: mark, to: words, ...(task !== undefined ? { task } : {}) })
    inline(line.slice(words - from), words)
  }

  const quoteLines = (first: number, last: number) => {
    let look: LineLook = 'quote'
    for (let n = first; n <= last; n++) {
      const line = lineOf(n)
      const m = QUOTE.exec(line)
      if (!m) continue
      let before = line.length - m[1].length
      if (n === first) {
        const kind = /^\[!(note|tip|warning|danger)\]\s*/i.exec(m[1])
        if (kind) {
          look = kind[1].toLowerCase() as LineLook
          before += kind[0].length
        }
      }
      marks.lines.push({ at: starts[n], look })
      lead(starts[n], before)
      inline(line.slice(before), starts[n] + before)
    }
  }

  const blocks = parseMarkdown(text)
  let next = 0
  const gaps = (upTo: number) => {
    for (; next < upTo; next++) if (!lineOf(next).trim()) marks.lines.push({ at: starts[next], look: 'gap' })
  }
  blocks.forEach((b, k) => {
    gaps(Math.min(b.line, raw.length))
    let last = (k + 1 < blocks.length ? blocks[k + 1].line : raw.length) - 1
    while (last > b.line && !lineOf(last).trim()) last--
    next = last + 1
    if (DRAWN.has(b.t)) {
      marks.blocks.push({ from: starts[b.line], to: starts[last] + (raw[last]?.length ?? 0), block: b, fixed: FIXED.has(b.t) })
      return
    }
    if (b.t === 'quote' || b.t === 'callout') return quoteLines(b.line, last)
    for (let n = b.line; n <= last; n++) {
      if (!lineOf(n).trim()) marks.lines.push({ at: starts[n], look: 'gap' })
      else if (b.t === 'h') heading(n)
      else if (b.t === 'list') listLine(n)
      else inline(lineOf(n), starts[n])
    }
  })
  gaps(raw.length)
  return marks
}
