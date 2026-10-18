/**
 * Markdown for wiki pages, parsed into plain data that the page view turns into React elements
 * (never HTML strings). Headings get anchors, checklists know their line so they can be ticked,
 * and BrainCraft's own links and mentions (`[[Page]](page:id)`, `@[Note](#12)`) work inline.
 */

import { type MacroArgs, argText, countdown, macroInfo, parseArgs, parseDay, statusLook } from './macros'
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
  /** A macro inside a sentence: `{{status Done}}`, `{{countdown 2026-12-20}}`, `{{today}}`. */
  | { t: 'macro'; name: string; args: MacroArgs }

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
  /**
   * A macro on its own line (`{{tasks}}`), or around some lines (`{{expand Title}}` … `{{/expand}}`:
   * `children` holds what's inside; for `{{columns}}`, `columns` holds each column).
   */
  | { t: 'macro'; name: string; args: MacroArgs; children?: Block[]; columns?: Block[][]; line: number }
  /** `![[Label|height]](board:KEY#ID)`: a canvas object (or a whole board) shown in the page. */
  | { t: 'embed'; label: string; board: string; item?: Id; height?: number; line: number }

export type CalloutKind = 'note' | 'tip' | 'warning' | 'danger'
const CALLOUTS: readonly CalloutKind[] = ['note', 'tip', 'warning', 'danger']

/** Nesting deeper than this (lists in quotes in lists…) is shown flat. */
const MAX_DEPTH = 8
/** How far emphasis may run before its closing mark; past that the mark is just a character. */
const EMPHASIS_REACH = 2_000
/** A table wider or longer than this is read as text, past the cap: a page can't make millions of cells. */
const TABLE_COLS = 64
const TABLE_ROWS = 2_000

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
    if (ch === '{' && s[i + 1] === '{') {
      const m = INLINE_MACRO.exec(s.slice(i, i + 260))
      if (m && macroInfo(m[1])?.kind === 'inline') {
        push({ t: 'macro', name: m[1].toLowerCase(), args: parseArgs(m[2]) })
        i += m[0].length
        continue
      }
    }
    // An embed written inside a sentence shows as a plain link, without its "!".
    if (ch === '!' && s.startsWith('[[', i + 1) && tokenAt(s, i + 1)) {
      i++
      continue
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
        // A closing bracket stays when it closes one in the address (`…/Foo_(bar)`).
        let url = m[0]
        while (/[.,;:!?)\]'"]$/.test(url)) {
          if (url.endsWith(')') && url.split('(').length > url.split(')').length - 1) break
          url = url.slice(0, -1)
        }
        push({ t: 'a', href: url, c: [{ t: 'text', s: url }] })
        i += url.length
        continue
      }
    }
    const two = s.slice(i, i + 2)
    if (two === '**' || two === '__' || two === '~~') {
      const end = s.indexOf(two, i + 2)
      // Emphasis closes within a reasonable stretch; looking further on every star is what gets slow.
      if (end > i + 2 && end - i < EMPHASIS_REACH && s[i + 2] !== ' ' && s[end - 1] !== ' ') {
        push({ t: two === '~~' ? 's' : 'b', c: nest(s.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if ((ch === '*' || ch === '_') && s[i + 1] !== ch && s[i + 1] !== ' ' && s[i + 1] !== undefined) {
      // `_` only at word edges, so snake_case stays as it is.
      if (ch === '*' || i === 0 || !/\w/.test(s[i - 1])) {
        let end = s.indexOf(ch, i + 1)
        while (end > 0 && end - i < EMPHASIS_REACH && (s[end - 1] === ' ' || (ch === '_' && /\w/.test(s[end + 1] ?? '')) || s[end + 1] === ch)) end = s.indexOf(ch, end + (s[end + 1] === ch ? 2 : 1))
        if (end > i + 1 && end - i < EMPHASIS_REACH) {
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
        case 'macro':
          return macroText(x.name, x.args)
        default:
          return inlineText(x.c)
      }
    })
    .join('')
}

/** What an inline macro says, as plain words (for search, snippets and anchors). */
export function macroText(name: string, args: MacroArgs, today = new Date()): string {
  if (name === 'status') return statusLook(args).label
  if (name === 'today') return today.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  if (name === 'countdown') {
    const day = parseDay(args.pos[0])
    return day ? countdown(day, today) : argText(args)
  }
  return argText(args)
}

/** A heading's anchor: lower case, words joined by hyphens, in any alphabet. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 64) || 'section'
  )
}

// ----- blocks ----------------------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/
// Linear on purpose: a lazy group before trailing spaces and #s took minutes on one long line.
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/

/** A heading's words without the closing #s some people write (`## Plan ##`), scanned by hand. */
function headingText(raw: string): string {
  let end = raw.length
  while (end > 0 && (raw[end - 1] === ' ' || raw[end - 1] === '\t')) end--
  let hashes = end
  while (hashes > 0 && raw[hashes - 1] === '#') hashes--
  // Closing #s count only after a space (or as the whole text).
  if (hashes < end && (hashes === 0 || raw[hashes - 1] === ' ' || raw[hashes - 1] === '\t')) end = hashes
  return raw.slice(0, end).trim()
}
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^ {0,3}> ?(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
/** A macro on a line of its own: `{{name options}}`, and the line that closes one around others. */
const MACRO = /^\s*\{\{\s*([a-zA-Z][\w-]{0,30})(?:\s+([^{}\n]{0,300}?))?\s*\}\}\s*$/
const MACRO_END = /^\s*\{\{\s*\/([a-zA-Z][\w-]{0,30})\s*\}\}\s*$/
/** A macro inside a sentence. */
const INLINE_MACRO = /^\{\{\s*([a-zA-Z][\w-]{0,30})(?:\s+([^{}\n]{0,200}?))?\s*\}\}/

/** A line that is a macro block (not one that belongs in a sentence). */
const blockMacro = (line: string) => {
  const m = MACRO.exec(line)
  return m && macroInfo(m[1])?.kind !== 'inline' ? m : null
}

/**
 * Where each section macro closes: opening line → closing line, nested ones of the same name
 * allowed. One pass over the lines (looking ahead from every opening line was slow on long pages).
 */
function macroEnds(lines: string[]): Map<number, number> {
  const out = new Map<number, number>()
  const open = new Map<string, number[]>()
  lines.forEach((line, j) => {
    const m = MACRO.exec(line)
    if (m && macroInfo(m[1])?.kind === 'container') {
      const name = m[1].toLowerCase()
      const stack = open.get(name)
      if (stack) stack.push(j)
      else open.set(name, [j])
      return
    }
    const end = MACRO_END.exec(line)
    const start = end && open.get(end[1].toLowerCase())?.pop()
    if (start !== undefined && start !== null) out.set(start, j)
  })
  return out
}
const EMBED = /^\s*!\[\[([^[\]\n|]*)(?:\|(\d{2,4}))?\]\]\(board:([\w-]{1,64})(?:#(\d{1,16}))?\)\s*$/

/** The snapshot keys (`board` or `board#item`) of every embed in some page text. */
export function embedKeys(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const m = EMBED.exec(line)
    if (m) out.push(m[4] ? `${m[3]}#${m[4]}` : m[3])
  }
  return out
}

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
  EMBED.test(line) ||
  FENCE.test(line) || HEADING.test(line) || HR.test(line) || LIST.test(line) || QUOTE.test(line) || !!blockMacro(line) || MACRO_END.test(line) || (line.includes('|') && next !== undefined && TABLE_RULE.test(next) && next.includes('-'))

/** Parses a page's Markdown. `offset` is the line the text starts on (for nested blocks). */
export function parseMarkdown(text: string, offset = 0, depth = 0): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let ends: Map<number, number> | undefined
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
      const c = parseInline(headingText(h[2] ?? ''))
      out.push({ t: 'h', level: h[1].length, c, slug: slugify(inlineText(c)), line: at })
      i++
      continue
    }
    if (HR.test(line)) {
      out.push({ t: 'hr', line: at })
      i++
      continue
    }
    const embed = EMBED.exec(line)
    if (embed) {
      const height = embed[2] ? Math.max(120, Math.min(1200, Number(embed[2]))) : undefined
      out.push({ t: 'embed', label: embed[1].trim(), board: embed[3], ...(embed[4] ? { item: Number(embed[4]) } : {}), ...(height ? { height } : {}), line: at })
      i++
      continue
    }
    const macro = blockMacro(line)
    if (macro) {
      const name = macro[1].toLowerCase()
      const args = parseArgs(macro[2])
      if ((name === 'children' || name === 'toc') && !macro[2]) {
        out.push({ t: name, line: at })
        i++
        continue
      }
      const end = macroInfo(name)?.kind === 'container' ? ((ends ??= macroEnds(lines)).get(i) ?? -1) : -1
      if (end < 0) {
        // A block macro, an unknown one, or a container not closed (yet): just this line.
        out.push({ t: 'macro', name, args, line: at })
        i++
        continue
      }
      const inner = lines.slice(i + 1, end)
      const nested = depth < MAX_DEPTH
      if (name === 'columns') {
        // Split at {{column}} lines that belong to these columns (not to columns inside them).
        const parts: { from: number; lines: string[] }[] = [{ from: i + 1, lines: [] }]
        let open = 0
        inner.forEach((l, k) => {
          const m = MACRO.exec(l)
          if (m && m[1].toLowerCase() === 'columns') open++
          if (MACRO_END.exec(l)?.[1].toLowerCase() === 'columns') open--
          if (open === 0 && m && m[1].toLowerCase() === 'column') parts.push({ from: i + 2 + k, lines: [] })
          else parts.at(-1)!.lines.push(l)
        })
        const columns = parts.slice(0, 6).map((p) => (nested ? parseMarkdown(p.lines.join('\n'), offset + p.from, depth + 1) : []))
        out.push({ t: 'macro', name, args, columns, line: at })
      } else out.push({ t: 'macro', name, args, children: nested ? parseMarkdown(inner.join('\n'), at + 1, depth + 1) : [], line: at })
      i = end + 1
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
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-') && cells(line).length <= TABLE_COLS) {
      const head = cells(line)
      const align: Align[] = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null))
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && rows.length < TABLE_ROWS && lines[i].trim() && lines[i].includes('|')) {
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
      else if (b.t === 'macro') {
        if (b.children) walk(b.children)
        for (const c of b.columns ?? []) walk(c)
      }
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

/**
 * Gives repeated anchors a number, in place: the second "Budget" is `budget-2` (or `budget-3` if a
 * heading is already called "Budget 2").
 */
export function uniqueSlugs(list: { slug: string }[]) {
  const taken = new Set(list.map((h) => h.slug))
  const used = new Set<string>()
  for (const h of list) {
    if (used.has(h.slug)) {
      let n = 2
      while (taken.has(`${h.slug}-${n}`) || used.has(`${h.slug}-${n}`)) n++
      h.slug = `${h.slug}-${n}`
    }
    used.add(h.slug)
  }
}

/**
 * A page's words as plain text, for snippets and search: no heading or list marks, no tick boxes,
 * table cells side by side, links and embeds by their names.
 */
export function plainMarkdown(text: string): string {
  const out: string[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (TABLE_RULE.test(raw) && raw.includes('-')) continue
    if (blockMacro(raw) || MACRO_END.test(raw) || FENCE.test(raw) || HR.test(raw)) continue
    const embed = EMBED.exec(raw)
    if (embed) {
      out.push(embed[1])
      continue
    }
    let line = raw.replace(/^(?: {0,3}> ?)+/, '').replace(/^ {0,3}#{1,6}[ \t]+/, '').replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '').replace(/^\[!\w+\]\s*/, '')
    if (line.includes('|')) line = cells(line).filter(Boolean).join(' · ')
    out.push(line)
  }
  return inlineText(parseInline(out.join('\n').slice(0, BODY_PLAIN_MAX)))
    .replace(/\s+/g, ' ')
    .trim()
}
/** How much of a page {@link plainMarkdown} reads (snippets need the start; search the lot, up to here). */
const BODY_PLAIN_MAX = 250_000

/** Every checklist item in some blocks, nested lists, quotes, callouts and macros included, in reading order. */
export function taskItems(blocks: Block[]): ListItem[] {
  const out: ListItem[] = []
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.t === 'list') {
        const items = (l: ListItem[]) => {
          for (const it of l) {
            if (it.task !== undefined) out.push(it)
            if (it.sub?.t === 'list') items(it.sub.items)
          }
        }
        items(b.items)
      } else if (b.t === 'quote' || b.t === 'callout') walk(b.children)
      else if (b.t === 'macro') {
        if (b.children) walk(b.children)
        for (const c of b.columns ?? []) walk(c)
      }
    }
  }
  walk(blocks)
  return out
}

/** Ticks or unticks the checklist item on `line` (0-based). Returns the text unchanged if there isn't one. */
export function toggleTask(text: string, line: number): string {
  // Lines counted the way the page reads them (old Mac line endings too).
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const l = lines[line]
  if (l === undefined) return text
  // In a quote or callout too.
  const m = /^((?: {0,3}> ?)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\].*)$/.exec(l)
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
