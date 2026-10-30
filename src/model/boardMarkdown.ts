/**
 * A canvas board as text people can read anywhere: Markdown (frames as sections, everything in
 * reading order, mind maps as nested lists, tables and data as tables, flowcharts as Mermaid,
 * comments under what they're on), and tables or databases as CSV.
 */

import { maskFor } from './brainstorm'
import * as D from './dataset'
import { sceneText } from './excalidraw'
import { toMermaid } from './mermaid'
import { toOutline } from './mindmap'
import { plainNote } from './notes'
import { STATUSES } from './status'
import { toCsv } from './table'
import { toMermaidSequence } from './sequence'
import type { Board, Id, Item } from './types'

/** Markdown-safe text on one line (a table cell, a list item's first line). */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()
const cell = (s: unknown) => oneLine(String(s ?? '')).replace(/\|/g, '\\|')

function mdTable(head: string[], rows: unknown[][]): string {
  if (!head.length) return ''
  return [`| ${head.map(cell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${head.map((_, k) => cell(r[k])).join(' | ')} |`)].join('\n')
}

/** CSV of a record set: a header of field names, one row per record. */
export function recordsCsv(records: Record<string, unknown>[], fields: string[]): string {
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v)
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [fields.map(esc).join(','), ...records.map((r) => fields.map((f) => esc(r[f])).join(','))].join('\n')
}

/** A table or database view as CSV; null for anything else. */
export function itemCsv(b: Board, i: Item): string | null {
  if (i.kind === 'table' && i.table) return toCsv(i.table)
  if (i.kind === 'data' && i.view) {
    const stored = D.getDataset(b, i.view.dataset)
    const ds = stored && D.withComputed(b, stored)
    return ds ? recordsCsv(D.plainRecords(ds), ds.fields.map((f) => f.name)) : null
  }
  return null
}

const statusWord = (i: Item) => (i.status ? `[${STATUSES.find((s) => s.id === i.status)?.label ?? i.status}] ` : '')

/** One object's lines, or nothing for what has no words (a drawing with the pen, a line). */
function itemMarkdown(b: Board, i: Item): string {
  const comments = (i.notes ?? []).map((n) => `  - 💬 ${n.author ? `${n.author}: ` : ''}${oneLine(plainNote(n.text))}`)
  const description = i.description ? [`  - ${oneLine(plainNote(i.description))}`] : []
  const withNotes = (first: string) => [first, ...description, ...comments].join('\n')
  switch (i.kind) {
    case 'sticky':
    case 'text':
    case 'rect':
    case 'ellipse':
    case 'comment': {
      if (i.wheel) return withNotes(`- 🎡 Spinner wheel: ${i.text.split('\n').filter(Boolean).join(', ')}`)
      if (!i.text.trim()) return ''
      const [first, ...rest] = i.text.trim().split('\n')
      return withNotes([`- ${statusWord(i)}${first}`, ...rest.map((l) => `  ${l}`)].join('\n'))
    }
    case 'mind':
      // Only the centre of a map writes the whole map.
      if (i.parent !== undefined) return ''
      return withNotes(
        toOutline(b, i.id)
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => (/^\s*[-*] /.test(l) ? l : `${l.match(/^\s*/)![0]}- ${l.trim()}`))
          .join('\n'),
      )
    case 'table':
      return i.table ? [`### ${i.text || 'Table'}`, '', mdTable(i.table.columns.filter((c) => !c.hidden).map((c) => c.name), i.table.rows.map((r) => i.table!.columns.filter((c) => !c.hidden).map((c) => r.cells[c.id] ?? '')))].join('\n') : ''
    case 'kanban':
      return i.kanban
        ? [
            `### ${i.text || 'Kanban board'}`,
            '',
            ...i.kanban.columns.flatMap((c) => [`**${c.title}**`, '', ...(c.cards.length ? c.cards.map((card) => `- ${card.title}${card.due ? ` (due ${card.due})` : card.start ? ` (from ${card.start})` : ''}`) : ['- (empty)']), '']),
          ].join('\n')
        : ''
    case 'sequence':
      return i.sequence ? [`### ${i.text || 'Sequence diagram'}`, '', '```mermaid', toMermaidSequence(i.sequence), '```'].join('\n') : ''
    case 'timeline':
      return i.timeline
        ? [
            `### ${i.text || 'Timeline'}`,
            '',
            ...i.timeline.lanes.flatMap((l) => {
              const entries = i.timeline!.entries.filter((e) => e.lane === l.id).sort((a, z) => a.start.localeCompare(z.start))
              return [`**${l.name}**`, '', ...entries.map((e) => `- ${e.start}${e.end ? ` to ${e.end}` : ''}: ${e.title}${e.end ? '' : ' (milestone)'}`), '']
            }),
          ].join('\n')
        : ''
    case 'data': {
      const stored = i.view ? D.getDataset(b, i.view.dataset) : undefined
      const ds = stored && D.withComputed(b, stored)
      if (!ds) return ''
      // Each dataset once, however many views show it.
      if (D.viewsOf(b, ds.id)[0]?.id !== i.id) return ''
      const fields = ds.fields.map((f) => f.name)
      const records = D.plainRecords(ds)
      return [`### ${ds.name}`, '', mdTable(fields, records.map((r) => fields.map((f) => (r as Record<string, unknown>)[f])))].join('\n')
    }
    case 'code':
      return ['```' + (i.lang ?? ''), i.text, '```'].join('\n')
    case 'link':
      return i.link?.url ? withNotes(`- [${i.link.title || i.link.url}](${i.link.url})`) : ''
    case 'image':
      if (i.excalidraw) {
        const words = sceneText(i.excalidraw)
        return withNotes(`- ✏️ Excalidraw drawing${words ? `: ${oneLine(words)}` : ''}`)
      }
      return withNotes('- 🖼 A picture')
    default:
      return ''
  }
}

const inside = (f: Item, i: Item) => i.x >= f.x && i.y >= f.y && i.x + i.w <= f.x + f.w && i.y + i.h <= f.y + f.h

/**
 * The board as Markdown: its title, then each frame as a section with what's in it, then the rest;
 * flowcharts at the end as Mermaid. Hidden brainstorm notes stay blank.
 */
export function boardMarkdown(raw: Board): string {
  const b = maskFor(raw, '')
  const readingOrder = (a: Item, z: Item) => (Math.abs(a.y - z.y) > 40 ? a.y - z.y : a.x - z.x)
  const frames = b.items.filter((i) => i.kind === 'frame').sort(readingOrder)
  const placed = new Set<Id>()
  const section = (items: Item[]) =>
    items
      .filter((i) => i.kind !== 'frame' && i.kind !== 'flow' && !i.masked)
      .sort(readingOrder)
      .map((i) => itemMarkdown(b, i))
      .filter(Boolean)
      .join('\n\n')
  const out: string[] = [`# ${b.title || 'Untitled board'}`]
  for (const f of frames) {
    const items = b.items.filter((i) => i.id !== f.id && !placed.has(i.id) && inside(f, i))
    items.forEach((i) => placed.add(i.id))
    const body = section(items)
    out.push(`## ${f.text || 'Frame'}`, ...(f.description ? [plainNote(f.description)] : []), ...(body ? [body] : []))
  }
  const rest = section(b.items.filter((i) => !placed.has(i.id)))
  if (rest) out.push(...(frames.length ? ['## Elsewhere on the board'] : []), rest)
  const mermaid = b.items.some((i) => i.kind === 'flow') ? toMermaid(b) : ''
  if (mermaid.trim()) out.push('## Flowcharts', '```mermaid\n' + mermaid.trim() + '\n```')
  return `${out.join('\n\n')}\n`
}
