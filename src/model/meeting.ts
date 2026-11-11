/**
 * Meeting notes: while a meeting is heard, the assistant takes notes on the board, and when it
 * ends everything the meeting made goes into one frame, titled for what it was about.
 */

import * as B from './board'
import type { Board, Id } from './types'

/**
 * What a meeting made: the objects that weren't on the board when it started, apart from ideas
 * added to a mind map that was there before (the map stays where it is, outside the frame).
 */
export function meetingItems(b: Board, before: ReadonlySet<Id>): Id[] {
  const hidden = B.hiddenIds(b)
  return b.items
    .filter((i) => {
      if (before.has(i.id) || hidden.has(i.id)) return false
      if (i.kind === 'mind' && i.parent !== undefined) {
        const root = B.rootOf(b, i.id)
        if (root && before.has(root.id)) return false
      }
      return true
    })
    .map((i) => i.id)
}

/** The title the assistant gave the meeting in its last words ("Title: Q3 launch plan"), if it gave one. */
export function meetingTitle(reply: string): string | null {
  const m = /^[\s>*_#-]*title\s*[:：]\s*(.+)$/im.exec(reply)
  if (!m) return null
  const t = m[1]
    .replace(/[*_`#"“”]+/g, '')
    .trim()
    .replace(/[.。]$/, '')
    .slice(0, 80)
    .trim()
  return t || null
}

/** A title for a meeting the assistant didn't name. */
export function untitledMeeting(at: number, locale?: string): string {
  return `Meeting, ${new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/** What to keep when a meeting ends: the ideas drawn out (flows, timelines…), a Kanban board of the actions, the notes. */
export interface MeetingPicks {
  collage: boolean
  kanban: boolean
  notes: boolean
}

export const ALL_PICKS: MeetingPicks = { collage: true, kanban: true, notes: true }

/**
 * What a meeting made, by what it's for: the notes (mind maps, the "Decisions and actions" table,
 * the agenda), Kanban boards, and the rest (the idea collage: flowcharts, sequences, timelines,
 * other tables and notes). `keep` (the transcript) is in none of them.
 */
export function meetingParts(b: Board, ids: readonly Id[], keep: ReadonlySet<Id> = new Set()): { notes: Id[]; kanban: Id[]; collage: Id[] } {
  const out = { notes: [] as Id[], kanban: [] as Id[], collage: [] as Id[] }
  for (const id of ids) {
    const i = B.getItem(b, id)
    if (!i || keep.has(id) || i.kind === 'frame') continue
    if (i.kind === 'mind' || (i.kind === 'table' && /^\s*(decisions|agenda)\b/i.test(i.text))) out.notes.push(id)
    else if (i.kind === 'kanban') out.kanban.push(id)
    else out.collage.push(id)
  }
  return out
}

/** The objects a meeting made that its picks leave out. */
export function unpicked(b: Board, ids: readonly Id[], picks: MeetingPicks, keep: ReadonlySet<Id> = new Set()): Id[] {
  const parts = meetingParts(b, ids, keep)
  return [...(picks.notes ? [] : parts.notes), ...(picks.kanban ? [] : parts.kanban), ...(picks.collage ? [] : parts.collage)]
}

/** One item of a meeting's agenda, and whether it's been talked about. */
export interface AgendaItem {
  text: string
  covered: boolean
}

/** The agenda the assistant put on the board for a meeting (a table titled "Agenda"), among `ids`. */
export function agendaOf(b: Board, ids: readonly Id[]): AgendaItem[] {
  for (const id of ids) {
    const i = B.getItem(b, id)
    if (i?.kind !== 'table' || !i.table || !/^\s*agenda\b/i.test(i.text)) continue
    const cols = i.table.columns.filter((c) => !c.hidden)
    const item = cols.find((c) => /item|topic|what/i.test(c.name)) ?? cols.find((c) => !/^#|no\.?$/i.test(c.name.trim())) ?? cols[0]
    const done = cols.find((c) => /covered|done|discussed|status/i.test(c.name))
    if (!item) return []
    return i.table.rows
      .filter((r) => !r.hidden && (r.cells[item.id] ?? '').trim())
      .slice(0, 12)
      .map((r) => {
        const mark = done ? (r.cells[done.id] ?? '').trim() : ''
        return { text: r.cells[item.id].trim(), covered: !!mark && !/^(no|not yet|-|–|—|open|todo|to do)$/i.test(mark) }
      })
  }
  return []
}

/** A line heard in a meeting: when (ms from its start), who said it (a voice number), and what. */
export interface MeetingLine {
  at: number
  voice?: number
  text: string
}

/** The few points the assistant summed a meeting up with: the list lines after its title. */
export function summaryPoints(reply: string): string[] {
  return reply
    .split('\n')
    .map((l) => /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(l)?.[1]?.trim() ?? '')
    .map((l) => l.replace(/[*_`]+/g, '').trim())
    .filter(Boolean)
    .slice(0, 12)
}

/** "4:05", or "1:02:09" past an hour. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`
}

/** How long a meeting went on, in words: "under a minute", "25 min", "1 h 05 min". */
export function howLong(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'under a minute'
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

/** A stretch of a meeting and what the assistant noted from it, for the transcript. */
export interface MeetingNoted {
  at: number
  text: string
}

/**
 * The transcript of a meeting, as written on its transcript card: the summary first, then every
 * line with when and who, and what the assistant noted from each stretch as it went.
 */
export function transcriptText(o: { lines: readonly MeetingLine[]; noted?: readonly MeetingNoted[]; summary?: readonly string[]; who: (voice: number) => string; max?: number }): string {
  const parts: string[] = []
  if (o.summary?.length) parts.push('Summary', ...o.summary.map((s) => `- ${s}`), '')
  parts.push('Transcript')
  const noted = [...(o.noted ?? [])].sort((a, b) => a.at - b.at)
  let n = 0
  let last = ''
  for (const l of o.lines) {
    while (n < noted.length && noted[n].at <= l.at) parts.push(`  → ${noted[n++].text}`)
    const who = l.voice !== undefined ? o.who(l.voice) : ''
    // The same person going on is one paragraph.
    const head = who && who !== last ? `${who}: ` : ''
    last = who || last
    parts.push(`[${clock(l.at)}] ${head}${l.text}`)
  }
  while (n < noted.length) parts.push(`  → ${noted[n++].text}`)
  const text = parts.join('\n')
  const max = o.max ?? 100_000
  return text.length <= max ? text : `${text.slice(0, max - 60).replace(/\n[^\n]*$/, '')}\n… (the rest is in the meeting’s replay)`
}
