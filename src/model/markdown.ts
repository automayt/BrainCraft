/**
 * Markdown for wiki pages, parsed into plain data that the page view turns into React elements
 * (never HTML strings). Headings get anchors, checklists know their line so they can be ticked,
 * and BrainCraft's own links and mentions (`[[Page]](page:id)`, `@[Note](#12)`) work inline.
 */

import { type LinkTarget, tokenAt } from './notes'
import type { Id } from './types'

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'b' | 'i' | 's'; c: Inline[] }
  | { t: 'code'; s: string }
  /** An ordinary link to a web address (only http, https and mailto are kept). */
  | { t: 'a'; href: string; c: Inline[] }
  /** A BrainCraft link; `to` is null for a `[[Name]]` typed by hand. */
  | { t: 'link'; to: LinkTarget | null; label: string }
  | { t: 'mention'; id: Id; label: string }
  | { t: 'br' }

export interface ListItem {
  c: Inline[]
  /** A checklist item: whether it's ticked. */
  task?: boolean
  /** The line it starts on, so a tick can change just that line. */
  line: number
  /** A nested list under it. */
  sub?: Block
}

export type Align = 'left' | 'center' | 'right' | null

export type Block =
  | { t: 'h'; level: number; c: Inline[]; slug: string; line: number }
  | { t: 'p'; c: Inline[]; line: number }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[]; line: number }
  | { t: 'quote'; children: Block[]; line: number }
  | { t: 'callout'; kind: CalloutKind; title: Inline[]; children: Block[]; line: number }
  | { t: 'code'; lang: string; code: string; line: number }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][]; line: number }
  | { t: 'hr'; line: number }
  /** `{{children}}`: this page's sub-pages; `{{toc}}`: its headings. */
  | { t: 'children' | 'toc'; line: number }

export type CalloutKind = 'note' | 'tip' | 'warning' | 'danger'
const CALLOUTS: readonly CalloutKind[] = ['note', 'tip', 'warning', 'danger']

/** Nesting deeper than this (lists in quotes in lists…) is shown flat. */
const MAX_DEPTH = 8

// ----- inline ----------------------------------------------------------------------------------

/** Only ordinary web links leave the app; anything else (javascript:, data:…) stays text. */
export function safeHref(url: string): string | null {
  const u = url.trim()
  return /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(u) ? u : null
}

const PUNCT_ESCAPE = /[\\`*_{}[\]()#+\-.!|~>@]/

/** Inline Markdown: emphasis, code, links, BrainCraft links and mentions, line breaks. */
export function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ t: 'text', s: text })
    text = ''
  }
  const push = (x: Inline) => {
    flush()
    out.push(x)
  }
  // Emphasis inside emphasis is only followed so deep; past that it stays as typed.
  const nest = (inner: string) => (depth < MAX_DEPTH ? parseInline(inner, depth + 1) : [{ t: 'text' as const, s: inner }])
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length && PUNCT_ESCAPE.test(s[i + 1])) {
      text += s[i + 1]
      i += 2
      continue
    }
    if (ch === '\n') {
      push({ t: 'br' })
      i++
      continue
    }
    if (ch === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i + 1) {
        push({ t: 'code', s: s.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (ch === '@' || ch === '[') {
      const tok = tokenAt(s, i)
      if (tok && !('text' in tok.part)) {
        const p = tok.part
        push('mention' in p ? { t: 'mention', id: p.mention, label: p.label } : { t: 'link', to: p.link, label: p.label })
        i += tok.length
        continue
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]\n]*)\]\(([^)\s]+)\)/.exec(s.slice(i, i + 2100))
      if (m) {
        const href = safeHref(m[2])
        if (href) push({ t: 'a', href, c: nest(m[1] || href) })
        else text += m[1] || m[2]
        i += m[0].length
        continue
      }
    }
    if ((ch === 'h' || ch === 'm') && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      const m = /^(?:https?:\/\/|mailto:)[^\s<>"']+/i.exec(s.slice(i, i + 2100))
      if (m) {
        // Trailing punctuation belongs to the sentence, not the address.
        const url = m[0].replace(/[.,;:!?)\]'"]+$/, '')
        push({ t: 'a', href: url, c: [{ t: 'text', s: url }] })
        i += url.length
        continue
      }
    }
    const two = s.slice(i, i + 2)
    if (two === '**' || two === '__' || two === '~~') {
      const end = s.indexOf(two, i + 2)
      if (end > i + 2 && s[i + 2] !== ' ' && s[end - 1] !== ' ') {
        push({ t: two === '~~' ? 's' : 'b', c: nest(s.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if ((ch === '*' || ch === '_') && s[i + 1] !== ch && s[i + 1] !== ' ' && s[i + 1] !== undefined) {
      // `_` only at word edges, so snake_case stays as it is.
      if (ch === '*' || i === 0 || !/\w/.test(s[i - 1])) {
        let end = s.indexOf(ch, i + 1)
        while (end > 0 && (s[end - 1] === ' ' || (ch === '_' && /\w/.test(s[end + 1] ?? '')) || s[end + 1] === ch)) end = s.indexOf(ch, end + (s[end + 1] === ch ? 2 : 1))
        if (end > i + 1) {
          push({ t: 'i', c: nest(s.slice(i + 1, end)) })
          i = end + 1
          continue
        }
      }
    }
    text += ch
    i++
  }
  flush()
  return out
}

/** The words of some inline Markdown, for anchors, titles and search. */
export function inlineText(c: Inline[]): string {
  return c
    .map((x) => {
      switch (x.t) {
        case 'text':
        case 'code':
          return x.s
        case 'br':
          return ' '
        case 'link':
        case 'mention':
          return x.label
        default:
          return inlineText(x.c)
      }
    })
    .join('')
}

/** A heading's anchor: lower case, words joined by hyphens. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 64) || 'section'
  )
}

// ----- blocks ----------------------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^ {0,3}> ?(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const MACRO = /^\s*\{\{\s*(children|toc)\s*\}\}\s*$/i

const indentOf = (line: string) => {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

const cells = (line: string) => {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

const startsBlock = (line: string, next: string | undefined) =>
  FENCE.test(line) || HEADING.test(line) || HR.test(line) || LIST.test(line) || QUOTE.test(line) || MACRO.test(line) || (line.includes('|') && next !== undefined && TABLE_RULE.test(next) && next.includes('-'))

/** Parses a page's Markdown. `offset` is the line the text starts on (for nested blocks). */
export function parseMarkdown(text: string, offset = 0, depth = 0): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const at = offset + i
    const fence = FENCE.exec(line)
    if (fence) {
      const mark = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`).test(lines[i])) body.push(lines[i++])
      i++
      out.push({ t: 'code', lang: fence[2].toLowerCase(), code: body.join('\n'), line: at })
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      const c = parseInline(h[2] ?? '')
      out.push({ t: 'h', level: h[1].length, c, slug: slugify(inlineText(c)), line: at })
      i++
      continue
    }
    if (HR.test(line)) {
      out.push({ t: 'hr', line: at })
      i++
      continue
    }
    const macro = MACRO.exec(line)
    if (macro) {
      out.push({ t: macro[1].toLowerCase() as 'children' | 'toc', line: at })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1])
      const callout = /^\[!(\w+)\]\s*(.*)$/.exec(body[0] ?? '')
      const kind = callout && CALLOUTS.includes(callout[1].toLowerCase() as CalloutKind) ? (callout[1].toLowerCase() as CalloutKind) : null
      const inner = kind ? body.slice(1) : body
      const children = depth < MAX_DEPTH ? parseMarkdown(inner.join('\n'), at + (kind ? 1 : 0), depth + 1) : [{ t: 'p' as const, c: [{ t: 'text' as const, s: inner.join('\n') }], line: at }]
      out.push(kind ? { t: 'callout', kind, title: parseInline(callout![2]), children, line: at } : { t: 'quote', children, line: at })
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line)
      const align: Align[] = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null))
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const row = cells(lines[i++])
        rows.push(head.map((_, k) => parseInline(row[k] ?? '')))
      }
      out.push({ t: 'table', align: head.map((_, k) => align[k] ?? null), head: head.map((c) => parseInline(c)), rows, line: at })
      continue
    }
    if (LIST.test(line)) {
      const [list, next] = parseList(lines, i, offset, depth)
      out.push(list)
      i = next
      continue
    }
    // A paragraph: lines up to a blank one or the start of another block.
    const body: string[] = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) body.push(lines[i++].trim())
    out.push({ t: 'p', c: parseInline(body.join('\n')), line: at })
  }
  // Anchors are unique across the whole page: the second "Budget" is `budget-2`.
  if (depth === 0) uniqueSlugs(headingBlocks(out))
  return out
}

function headingBlocks(blocks: Block[]): Extract<Block, { t: 'h' }>[] {
  const out: Extract<Block, { t: 'h' }>[] = []
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.t === 'h') out.push(b)
      else if (b.t === 'quote' || b.t === 'callout') walk(b.children)
    }
  }
  walk(blocks)
  return out
}

/** A list starting at line `start`, with lists nested by indent; returns it and the line after it. */
function parseList(lines: string[], start: number, offset: number, depth: number): [Block, number] {
  const first = LIST.exec(lines[start])!
  const base = indentOf(first[1])
  const ordered = /\d/.test(first[2])
  const items: ListItem[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      // A blank line ends the list unless more of it follows, indented or as another item.
      const after = lines[i + 1]
      if (after !== undefined && after.trim() && (indentOf(after) > base || (LIST.test(after) && indentOf(after) === base))) {
        i++
        continue
      }
      break
    }
    const m = LIST.exec(line)
    const indent = indentOf(line)
    // Switching between bullets and numbers starts a new list.
    if (m && indent === base && /\d/.test(m[2]) !== ordered) break
    if (m && indent === base) {
      let content = m[3]
      let task: boolean | undefined
      const box = /^\[([ xX])\]\s+(.*)$/.exec(content)
      if (box) {
        task = box[1] !== ' '
        content = box[2]
      }
      items.push({ c: [], task, line: offset + i, raw: [content] } as ListItem & { raw: string[] })
      i++
      continue
    }
    if (indent > base && items.length) {
      const last = items[items.length - 1] as ListItem & { raw: string[] }
      if (m && depth < MAX_DEPTH) {
        // A list under the last item.
        const [sub, next] = parseList(lines, i, offset, depth + 1)
        if (!last.sub) last.sub = sub
        else if (sub.t === 'list' && last.sub.t === 'list') last.sub.items.push(...sub.items)
        i = next
        continue
      }
      last.raw.push(line.trim())
      i++
      continue
    }
    if (m && indent < base) break
    if (m) break
    // A plain line right under an item continues it (no blank line between).
    if (items.length && !startsBlock(line, lines[i + 1])) {
      ;(items[items.length - 1] as ListItem & { raw: string[] }).raw.push(line.trim())
      i++
      continue
    }
    break
  }
  for (const item of items as (ListItem & { raw?: string[] })[]) {
    item.c = parseInline(item.raw!.join('\n'))
    delete item.raw
  }
  return [{ t: 'list', ordered, start: ordered ? Number.parseInt(first[2], 10) || 1 : 1, items, line: offset + start }, i]
}

// ----- helpers for the page view and editor ----------------------------------------------------

export interface Heading {
  level: number
  text: string
  slug: string
}

/** A page's headings in order, with their (unique) anchors. */
export function headings(blocks: Block[]): Heading[] {
  return headingBlocks(blocks).map((b) => ({ level: b.level, text: inlineText(b.c), slug: b.slug }))
}

/** Gives repeated anchors a number, in place: the second "Budget" is `budget-2`. */
export function uniqueSlugs(list: { slug: string }[]) {
  const seen = new Map<string, number>()
  for (const h of list) {
    const n = (seen.get(h.slug) ?? 0) + 1
    seen.set(h.slug, n)
    if (n > 1) h.slug = `${h.slug}-${n}`
  }
}

/** Ticks or unticks the checklist item on `line` (0-based). Returns the text unchanged if there isn't one. */
export function toggleTask(text: string, line: number): string {
  const lines = text.split('\n')
  const l = lines[line]
  if (l === undefined) return text
  const m = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\].*)$/.exec(l)
  if (!m) return text
  lines[line] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}`
  return lines.join('\n')
}

/**
 * Enter at the end of a list item: the next item starts with the same marker (a new box for a
 * checklist, the next number for a numbered list). Enter on an empty item ends the list.
 * Returns the new text and caret, or null to let the textarea do its usual thing.
 */
export function continueList(text: string, caret: number): { text: string; caret: number } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const lineEnd = text.indexOf('\n', caret)
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd)
  const m = /^(\s*)([-*+]|(\d{1,9})([.)]))\s+(\[[ xX]\]\s+)?(.*)$/.exec(line)
  if (!m || caret < lineStart + line.length - m[6].length) return null
  if (!m[6].trim()) {
    // An empty item: end the list (remove the marker).
    const next = text.slice(0, lineStart) + text.slice(lineStart + line.length)
    return { text: next, caret: lineStart }
  }
  const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2]
  const insert = `\n${m[1]}${marker} ${m[5] ? '[ ] ' : ''}`
  return { text: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length }
}
