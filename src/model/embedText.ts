/**
 * Canvas objects inside wiki pages as text, kept in step with the board: a mind map as nested
 * bullets, a Kanban board as a checklist per column, a table as a table, a timeline as dated
 * lists, a flowchart as numbered steps. The text is always made from the board (never stored), so
 * it can't drift from it; editing it in the page writes back to the board with operations that
 * change it in place. Pure functions.
 */

import type { Op } from '../api/ops'
import * as B from './board'
import * as D from './dataset'
import { embedBoard, getSnap, snapBoard, snapKey } from './embed'
import { embedLine } from './markdown'
import { toMermaid } from './mermaid'
import { markdownOf, outlineOf } from './outlineSync'
import type { Board, Id, Item } from './types'

/** Kinds that read well as text, and are shown that way when embedded unless asked otherwise. */
export const TEXT_FIRST = new Set<Item['kind']>(['mind', 'kanban', 'table', 'timeline', 'data'])

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()
const isBranch = (item: Item) => item.parent !== undefined

/** A date as people read it ("3 Nov 2026"). */
function day(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** A flowchart's steps in reading order: from where it starts, following the lines. */
function flowSteps(b: Board, item: Item): { steps: Item[]; next: Map<Id, { to: Id; label?: string }[]> } {
  const flows = new Set<Id>()
  // The whole chart: every step joined to this one.
  const queue = [item.id]
  while (queue.length) {
    const id = queue.pop()!
    if (flows.has(id)) continue
    flows.add(id)
    for (const c of b.connectors) {
      const other = c.from === id ? c.to : c.to === id ? c.from : null
      if (other !== null && B.getItem(b, other)?.kind === 'flow' && !flows.has(other)) queue.push(other)
    }
  }
  const next = new Map<Id, { to: Id; label?: string }[]>()
  const into = new Map<Id, number>()
  for (const c of b.connectors) {
    if (!flows.has(c.from) || !flows.has(c.to)) continue
    next.set(c.from, [...(next.get(c.from) ?? []), { to: c.to, ...(c.label ? { label: c.label } : {}) }])
    into.set(c.to, (into.get(c.to) ?? 0) + 1)
  }
  const items = [...flows].map((id) => B.getItem(b, id)!).sort((a, z) => a.y - z.y || a.x - z.x)
  const starts = items.filter((i) => !into.get(i.id))
  const order: Item[] = []
  const seen = new Set<Id>()
  const visit = (i: Item) => {
    if (seen.has(i.id)) return
    seen.add(i.id)
    order.push(i)
    for (const n of next.get(i.id) ?? []) visit(B.getItem(b, n.to)!)
  }
  for (const s of starts.length ? starts : items.slice(0, 1)) visit(s)
  for (const i of items) visit(i)
  return { steps: order, next }
}

/** The object as Markdown, from the board as it is. */
export function embedMarkdown(b: Board, item: Item | undefined): string {
  if (!item) {
    // A whole board: what's written on it, top to bottom.
    const lines = b.items.filter((i) => i.text.trim() && i.kind !== 'comment').sort((a, z) => a.y - z.y || a.x - z.x)
    return lines.map((i) => `- ${oneLine(i.text)}`).join('\n')
  }
  switch (item.kind) {
    case 'mind': {
      // The central idea in bold, its ideas as nested bullets.
      const md = markdownOf(b, item.id, isBranch(item))
      return md.replace(/^# (.*)\n/, '**$1**\n')
    }
    case 'kanban': {
      const cols = item.kanban?.columns ?? []
      return cols
        .map((c, k) => {
          const done = k === cols.length - 1 && cols.length > 1
          const cards = c.cards.map((card) => `- [${done ? 'x' : ' '}] ${oneLine(card.title)}${card.due ? ` · due ${day(card.due)}` : ''}`)
          return [`**${oneLine(c.title)}** · ${c.cards.length}`, ...cards].join('\n')
        })
        .join('\n\n')
    }
    case 'table': {
      const t = item.table
      if (!t) return ''
      const cols = t.columns.filter((c) => !c.hidden)
      const rows = t.rows.filter((r) => !r.hidden)
      if (!cols.length) return ''
      return [`| ${cols.map((c) => cell(c.name)).join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${cols.map((c) => cell(r.cells[c.id] ?? '')).join(' | ')} |`)].join('\n')
    }
    case 'timeline': {
      const t = item.timeline
      if (!t) return ''
      return t.lanes
        .map((l) => {
          const entries = t.entries.filter((e) => e.lane === l.id).sort((a, z) => a.start.localeCompare(z.start))
          return [`**${oneLine(l.name)}**`, ...entries.map((e) => `- ${oneLine(e.title)} · ${day(e.start)}${e.end ? ` → ${day(e.end)}` : ''}`)].join('\n')
        })
        .join('\n\n')
    }
    case 'data': {
      const ds = item.view ? D.getDataset(b, item.view.dataset) : undefined
      if (!ds || !item.view) return ''
      const fields = D.shownFields(ds, item.view)
      return [`| ${fields.map((f) => cell(f.name)).join(' | ')} |`, `| ${fields.map(() => '---').join(' | ')} |`, ...D.viewRecords(ds, item.view).map((r) => `| ${fields.map((f) => cell(D.display(ds, f, r.values[f.id]))).join(' | ')} |`)].join('\n')
    }
    case 'flow': {
      const { steps, next } = flowSteps(b, item)
      const number = new Map(steps.map((s, k) => [s.id, k + 1]))
      return steps
        .map((s, k) => {
          const outs = next.get(s.id) ?? []
          const words = oneLine(s.text) || 'Step'
          // Where it goes, unless that's simply the next step down.
          const where = outs.length > 1 || outs.some((o) => o.label) ? ` → ${outs.map((o) => `${o.label ? `${oneLine(o.label)}: ` : ''}step ${number.get(o.to)}`).join(' · ')}` : outs.length === 1 && number.get(outs[0].to) !== k + 2 ? ` → step ${number.get(outs[0].to)}` : ''
          return `${k + 1}. ${words}${where}`
        })
        .join('\n')
    }
    case 'frame': {
      const inside = b.items.filter((i) => i.id !== item.id && i.text.trim() && i.kind !== 'comment').sort((a, z) => a.y - z.y || a.x - z.x)
      return [`**${oneLine(item.text) || 'Frame'}**`, ...inside.map((i) => `- ${oneLine(i.text)}`)].join('\n')
    }
    default:
      return oneLine(item.text)
  }
}

/** Whether the object can be edited as text from a page (and in what language). */
export function editable(item: Item | undefined): 'outline' | 'columns' | 'table' | 'lanes' | 'mermaid' | null {
  switch (item?.kind) {
    case 'mind':
      return 'outline'
    case 'kanban':
      return 'columns'
    case 'table':
      return 'table'
    case 'timeline':
      return 'lanes'
    case 'flow':
      return 'mermaid'
    default:
      return null
  }
}

/** The object as text to edit: an outline, columns of cards, a table, lanes of dates, or Mermaid. */
export function editText(b: Board, item: Item): string {
  switch (item.kind) {
    case 'mind':
      return outlineOf(b, item.id, isBranch(item))
    case 'kanban':
      return (item.kanban?.columns ?? []).map((c) => [`## ${oneLine(c.title)}`, ...c.cards.map((k) => `- ${oneLine(k.title)}`)].join('\n')).join('\n\n')
    case 'table':
      return embedMarkdown(b, item)
    case 'timeline': {
      const t = item.timeline
      if (!t) return ''
      return t.lanes.map((l) => [`## ${oneLine(l.name)}`, ...t.entries.filter((e) => e.lane === l.id).map((e) => `- ${oneLine(e.title)} ${e.start}${e.end ? `..${e.end}` : ''}`)].join('\n')).join('\n\n')
    }
    case 'flow': {
      const { steps } = flowSteps(b, item)
      return toMermaid(b, new Set(steps.map((s) => s.id)))
    }
    default:
      return ''
  }
}

/** Sections of `## Title` followed by `- item` lines. */
function sections(text: string): { title: string; lines: string[] }[] {
  const out: { title: string; lines: string[] }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const head = /^#+\s*(.+)$/.exec(line)
    if (head) out.push({ title: head[1].trim(), lines: [] })
    else {
      if (!out.length) out.push({ title: 'To do', lines: [] })
      out[out.length - 1].lines.push(line.replace(/^(?:[-*+•]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '').trim())
    }
  }
  return out.filter((s) => s.title)
}

/**
 * The operations that make the board match edited text (in place: ideas, cards, rows and entries
 * that keep their words keep their details), or why the text can't be used.
 */
export function editOps(item: Item, text: string): Op[] | string {
  switch (item.kind) {
    case 'mind':
      if (!text.trim()) return 'An outline needs at least its top idea.'
      return [{ op: 'setMindMap', id: item.id, outline: text, ...(isBranch(item) ? { branch: true } : {}) }]
    case 'kanban': {
      const cols = sections(text)
      if (!cols.length) return 'Give each column a "## Title" line, with its cards under it as "- " lines.'
      return [{ op: 'setKanban', id: item.id, columns: cols.map((c) => ({ title: c.title, cards: c.lines.filter(Boolean) })) }]
    }
    case 'table': {
      const rows = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !/^\|?\s*:?-{2,}/.test(l))
        .map((l) =>
          l
            .replace(/^\||\|$/g, '')
            .split(/(?<!\\)\|/)
            .map((c) => c.trim().replace(/\\\|/g, '|')),
        )
      if (!rows.length || !rows[0].some(Boolean)) return 'Keep the first line as the column names, like | Name | Status |.'
      return [{ op: 'setTable', id: item.id, columns: rows[0], rows: rows.slice(1) }]
    }
    case 'timeline': {
      const lanes = sections(text)
      if (!lanes.length) return 'Give each lane a "## Name" line, with its entries under it as "- Title 2026-11-03" or "- Title 2026-11-03..2026-11-07".'
      const bad: string[] = []
      const parsed = lanes.map((l) => ({
        name: l.title,
        entries: l.lines.flatMap((line) => {
          const m = /^(.*?)\s+(\d{4}-\d{2}-\d{2})(?:\s*(?:\.\.|→|–|—|to)\s*(\d{4}-\d{2}-\d{2}))?$/.exec(line)
          if (!m) {
            bad.push(line)
            return []
          }
          return [{ title: m[1].trim(), start: m[2], ...(m[3] ? { end: m[3] } : {}) }]
        }),
      }))
      if (bad.length) return `Each entry needs its date at the end, like "- ${bad[0]} 2026-11-03" (or 2026-11-03..2026-11-07 for a span).`
      return [{ op: 'setTimeline', id: item.id, lanes: parsed }]
    }
    case 'flow':
      if (!/^\s*(flowchart|graph)\b/i.test(text)) return 'Keep it as a Mermaid flowchart, starting with "flowchart TD".'
      return [{ op: 'setFlowchart', id: item.id, mermaid: text }]
    default:
      return 'This can’t be edited as text.'
  }
}

/**
 * Ticking or unticking a card in a Kanban board's text: ticked goes to the last column (done),
 * unticked back to the first. `line` counts the lines of `embedMarkdown`.
 */
export function kanbanTick(item: Item, line: number): Op[] | null {
  const cols = item.kanban?.columns
  if (!cols || cols.length < 2) return null
  let at = 0
  for (let k = 0; k < cols.length; k++) {
    at++ // the column's title line
    for (const card of cols[k].cards) {
      if (at === line) {
        const done = k === cols.length - 1
        const to = done ? 0 : cols.length - 1
        const columns = cols.map((c, j) => ({
          title: c.title,
          cards: [...c.cards.filter((x) => x.id !== card.id).map((x) => x.title), ...(j === to ? [card.title] : [])],
        }))
        return [{ op: 'setKanban', id: item.id, columns }]
      }
      at++
    }
    at++ // the blank line between columns
  }
  return null
}

/** Whether an embed line asks for text (`![[Label|text]](board:…)`). */
export const TEXT_MARK = 'text'

/** Kinds whose text has no title of its own, so the embed's label goes above it. */
const TITLED = new Set<Item['kind']>(['kanban', 'table', 'timeline', 'data', 'flow'])

/**
 * Page text with each text embed written out as the text it shows, for search, exports and
 * assistants reading the page: from `live` (the board as this browser has it) when given, else the
 * copy the wiki keeps. Embeds with neither stay as they are.
 */
export function expandTextEmbeds(wiki: Board, text: string, live?: (board: string) => Board | null | undefined): string {
  if (!text.includes('|text]]')) return text
  return text
    .split('\n')
    .map((line) => {
      const e = embedLine(line)
      if (!e?.asText) return line
      const source = live?.(e.board)
      const snap = getSnap(wiki, snapKey(e.board, e.item))
      const part = source ? embedBoard(source, e.item) : snap ? snapBoard(snap) : null
      if (!part) return line
      const item = e.item !== undefined ? B.getItem(part, e.item) : undefined
      if (e.item !== undefined && !item) return line
      const md = embedMarkdown(part, item)
      if (!md) return line
      const label = item && TITLED.has(item.kind) && e.label ? `**${e.label}**\n\n` : ''
      return `\n${label}${md}\n`
    })
    .join('\n')
}
