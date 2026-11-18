/**
 * MeetingNotes: while a meeting is heard, the assistant takes notes on the board, and when it
 * ends everything the meeting made goes into one frame, titled for what it was about. Alongside
 * the agenda it keeps a list of ideas to bring up, which outlives the meeting: an idea stays on
 * it, from one meeting to the next, until it has been raised.
 */

import * as B from './board'
import { addColumn, addRow, setCell, tableSize } from './table'
import type { Board, Id, Item, TableData, TableRow } from './types'

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

/**
 * What to keep when a meeting ends: the ideas drawn out (flows, timelines…), a Kanban board of the
 * actions, the notes (overview, decisions table, mind map), and a timeline of who said what.
 */
export interface MeetingPicks {
  collage: boolean
  kanban: boolean
  notes: boolean
  timeline: boolean
}

export const ALL_PICKS: MeetingPicks = { collage: true, kanban: true, notes: true, timeline: true }

/**
 * What a meeting made, by what it's for: the notes (mind maps, the "Decisions and actions" table,
 * the agenda), Kanban boards, and the rest (the idea collage: flowcharts, sequences, timelines,
 * other tables and notes). `keep` (the transcript) is in none of them.
 */
export function meetingParts(b: Board, ids: readonly Id[], keep: ReadonlySet<Id> = new Set()): { notes: Id[]; kanban: Id[]; collage: Id[] } {
  const out = { notes: [] as Id[], kanban: [] as Id[], collage: [] as Id[] }
  for (const id of ids) {
    const i = B.getItem(b, id)
    // The ideas to bring up are kept whatever was picked: they're for the next meeting too.
    if (!i || keep.has(id) || i.kind === 'frame' || isIdeasTable(i)) continue
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

/** One item of a meeting's agenda, whether it's been talked about, and the row of the table it is. */
export interface AgendaItem {
  text: string
  covered: boolean
  table: Id
  row: string
}

/** A cell that says a row is done: anything but nothing, or a word for "not yet". */
const ticked = (mark: string | undefined) => {
  const m = (mark ?? '').trim()
  return !!m && !/^(no|not yet|-|–|—|open|todo|to do)$/i.test(m)
}

/** The columns of a list a meeting ticks off (the agenda, the ideas to bring up): what each row is, why, and whether it's done. */
function listColumns(t: TableData) {
  const cols = t.columns.filter((c) => !c.hidden)
  const item = cols.find((c) => /item|topic|what|idea/i.test(c.name)) ?? cols.find((c) => !/^#|no\.?$/i.test(c.name.trim())) ?? cols[0]
  const done = cols.find((c) => c !== item && /covered|done|discussed|raised|status/i.test(c.name))
  const why = cols.find((c) => c !== item && c !== done && /why|reason/i.test(c.name))
  return { item, done, why }
}

/** A meeting's agenda: a table with that title. */
export const isAgendaTable = (i: Item | undefined): i is Item & { table: TableData } => i?.kind === 'table' && !!i.table && /^\s*agenda\b/i.test(i.text)

/** The agenda the assistant put on the board for a meeting (a table titled "Agenda"), among `ids`. */
export function agendaOf(b: Board, ids: readonly Id[]): AgendaItem[] {
  for (const id of ids) {
    const i = B.getItem(b, id)
    if (!isAgendaTable(i)) continue
    const { item, done } = listColumns(i.table)
    if (!item) return []
    return i.table.rows
      .filter((r) => !r.hidden && (r.cells[item.id] ?? '').trim())
      .slice(0, 12)
      .map((r) => ({ text: r.cells[item.id].trim(), covered: !!done && ticked(r.cells[done.id]), table: i.id, row: r.id }))
  }
  return []
}

// ----- ideas to bring up ------------------------------------------------------------------

/** What the list of ideas to bring up is called. There's one for the board, kept from meeting to meeting. */
export const IDEAS_TITLE = 'Ideas to bring up'

/** A list of ideas to bring up: a table with that title. */
export const isIdeasTable = (i: Item | undefined): i is Item & { table: TableData } => i?.kind === 'table' && !!i.table && /^\s*ideas to (bring up|raise)\b/i.test(i.text)

/** An idea worth bringing up, why, whether it has been raised, and the row of the list it is. */
export interface IdeaToRaise {
  text: string
  why: string
  raised: boolean
  table: Id
  row: string
}

/** Two ways of writing the same thing: capitals, punctuation and spacing aside. */
const same = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The lists of ideas a meeting can add to and tick: on the board, in view, and not locked. */
function ideasTables(b: Board): (Item & { table: TableData })[] {
  const hidden = B.hiddenIds(b)
  return b.items.filter((i): i is Item & { table: TableData } => isIdeasTable(i) && !hidden.has(i.id))
}

/** The list of ideas a meeting adds to (the first, when the assistant made more than one), unless it's locked. */
export function ideasTableOf(b: Board): Id | null {
  return ideasTables(b).find((i) => !i.locked)?.id ?? null
}

/** The ideas to bring up, from wherever they are on the board (a meeting's own, and those left from earlier ones). */
export function ideasOf(b: Board): IdeaToRaise[] {
  const out: IdeaToRaise[] = []
  const seen = new Set<string>()
  for (const i of ideasTables(b)) {
    const { item, done, why } = listColumns(i.table)
    if (!item) continue
    for (const r of i.table.rows) {
      const text = (r.cells[item.id] ?? '').trim()
      if (r.hidden || !text || seen.has(same(text))) continue
      seen.add(same(text))
      out.push({ text, why: why ? (r.cells[why.id] ?? '').trim() : '', raised: !!done && ticked(r.cells[done.id]), table: i.id, row: r.id })
    }
  }
  return out
}

/** Ticks a row of the agenda or of the ideas to bring up, or takes its tick away. A list with nowhere for ticks gets a column for them. */
export function tickRow(b: Board, table: Id, row: string, on: boolean): Board {
  const i = B.getItem(b, table)
  if (i?.kind !== 'table' || !i.table || !i.table.rows.some((r) => r.id === row)) return b
  const done = listColumns(i.table).done
  if (done) return B.updateItem(b, table, (x) => ({ ...x, table: setCell(i.table!, row, done.id, on ? '✓' : '') }))
  if (!on) return b
  const [wider, made] = addColumn(i.table, undefined, isIdeasTable(i) ? 'Raised' : 'Covered')
  const t = setCell(wider, row, made, '✓')
  return B.updateItem(b, table, (x) => ({ ...x, table: t, w: Math.max(x.w, tableSize(t).w) }))
}

/**
 * A ticked list as the assistant rewrote it, with the ticks it had: the assistant may tick a row
 * (once it's been talked about), but never takes a tick away, whoever made it.
 */
export function keepTicks(now: Item, next: Item): Item {
  if (!now.table || !next.table) return next
  const was = listColumns(now.table)
  const will = listColumns(next.table)
  if (!was.item || !was.done || !will.item || !will.done) return next
  // Each tick goes to one row. Rows that say the same are taken in order: the first "Break" then is
  // the first "Break" now, so two rows saying "Break", one covered, aren't both covered.
  const marks = new Map<string, string[]>()
  for (const r of now.table.rows) {
    const key = same(r.cells[was.item!.id] ?? '')
    const mark = r.cells[was.done!.id]
    marks.set(key, [...(marks.get(key) ?? []), ticked(mark) ? mark : ''])
  }
  let changed = false
  const rows = next.table.rows.map((r) => {
    const mark = marks.get(same(r.cells[will.item!.id] ?? ''))?.shift()
    if (!mark || ticked(r.cells[will.done!.id])) return r
    changed = true
    return { ...r, cells: { ...r.cells, [will.done!.id]: mark } }
  })
  return changed ? { ...next, table: { ...next.table, rows } } : next
}

/** No more ideas than this are kept open at once: past it, new ones wait until some are raised. */
const MOST_IDEAS = 24

/**
 * The list of ideas as the assistant rewrote it, kept whole: it may add ideas and tick those that
 * were talked about, but every idea already there stays as it was (its words, its place and its
 * tick), whoever put it there.
 */
export function keepIdeas(now: Item, next: Item): Item {
  if (!now.table || !next.table) return now
  const was = listColumns(now.table)
  const will = listColumns(next.table)
  if (!was.item || !will.item) return now
  const theirs = new Map<string, TableRow>()
  for (const r of next.table.rows) {
    const key = same(r.cells[will.item.id] ?? '')
    if (key && !theirs.has(key)) theirs.set(key, r)
  }
  let t = now.table
  let done = was.done?.id
  const tick = (row: string) => {
    if (!done) [t, done] = addColumn(t, undefined, 'Raised')
    t = setCell(t, row, done, '✓')
  }
  const raised = (r: TableRow) => !!will.done && ticked(r.cells[will.done.id])
  const have = new Set<string>()
  for (const r of now.table.rows) {
    const key = same(r.cells[was.item.id] ?? '')
    have.add(key)
    const their = theirs.get(key)
    if (their && raised(their) && !(done && ticked(r.cells[done]))) tick(r.id)
  }
  let open = now.table.rows.filter((r) => !(done && ticked(r.cells[done]))).length
  for (const [key, r] of theirs) {
    if (have.has(key) || (!raised(r) && open >= MOST_IDEAS)) continue
    let id: string
    ;[t, id] = addRow(t)
    t = setCell(t, id, was.item.id, (r.cells[will.item.id] ?? '').trim())
    if (was.why && will.why) t = setCell(t, id, was.why.id, (r.cells[will.why.id] ?? '').trim())
    if (raised(r)) tick(id)
    else open++
  }
  if (t === now.table) return now
  const size = tableSize(t)
  return { ...now, table: t, w: Math.max(now.w, size.w), h: size.h }
}

/**
 * When a meeting ends: the ideas that were raised go (they're in its notes), and those that
 * weren't are kept, as one list, for the next meeting. Returns the list that's left, if any.
 * A locked list is left as it is.
 */
export function settleIdeas(b: Board): { board: Board; table: Id | null } {
  const tables = ideasTables(b).filter((i) => !i.locked)
  const keeper = tables[0]
  if (!keeper) return { board: b, table: null }
  const cols = listColumns(keeper.table)
  if (!cols.item) return { board: b, table: keeper.id }
  const seen = new Set<string>()
  const fresh = (text: string) => {
    if (!text || seen.has(same(text))) return false
    seen.add(same(text))
    return true
  }
  // Its own rows not yet raised, as they are (rows hidden by hand stay hidden).
  let t: TableData = { ...keeper.table, rows: keeper.table.rows.filter((r) => !(cols.done && ticked(r.cells[cols.done.id])) && fresh((r.cells[cols.item!.id] ?? '').trim())) }
  // Any other list's (the assistant made a second one), folded in.
  for (const other of tables.slice(1)) {
    const from = listColumns(other.table)
    if (!from.item) continue
    for (const r of other.table.rows) {
      const text = (r.cells[from.item.id] ?? '').trim()
      if (r.hidden || (from.done && ticked(r.cells[from.done.id])) || !fresh(text)) continue
      let id: string
      ;[t, id] = addRow(t)
      t = setCell(t, id, cols.item.id, text)
      if (cols.why && from.why) t = setCell(t, id, cols.why.id, (r.cells[from.why.id] ?? '').trim())
    }
  }
  const gone = new Set(tables.slice(1).map((i) => i.id))
  // Nothing left to bring up: no list.
  if (!t.rows.length) return { board: B.remove(b, new Set([...gone, keeper.id])), table: null }
  const board = B.updateItem(gone.size ? B.remove(b, gone) : b, keeper.id, (i) => ({ ...i, table: t, h: tableSize(t).h }))
  return { board, table: keeper.id }
}

/** What the people on a call go by, as one, until someone says who they are: when their voices can't be told apart. */
export const CALL_NAME = 'The call'

/** A voice nobody has named yet: "Voice 2", or the call as a whole. */
export const unnamedVoice = (name: string) => /^voice \d+$/i.test(name.trim()) || name.trim().toLowerCase() === CALL_NAME.toLowerCase()

/** A line heard in a meeting: when (ms from its start), who said it (a voice number), and what. */
export interface MeetingLine {
  at: number
  voice?: number
  text: string
  /** Speech to text wasn't sure of some of it (marked "[unclear: …]" in the text). */
  unclear?: true
}

/** Ends a sentence (closing quotes and brackets allowed after). */
const ENDED = /[.!?…。！？]["”’)\]]*$/

/**
 * Lines cut at a pause mid-sentence, put back together: a line that doesn't end a sentence,
 * followed soon by more from the same person, becomes one line with it.
 */
export function joinFragments<L extends { at: number; text: string; voice?: number; who?: string; unclear?: true }>(lines: readonly L[], gapMs = 8000): L[] {
  const out: L[] = []
  let lastAt = -Infinity
  for (const l of lines) {
    const prev = out.at(-1)
    const next = l.text.trim()
    if (prev && prev.voice === l.voice && prev.who === l.who && !ENDED.test(prev.text.trim()) && l.at - lastAt <= gapMs && prev.text.length + next.length < 1500) {
      // Cut mid-sentence by a pause, the rest was written as a new sentence.
      const go = /^[A-Z][a-z]/.test(next) && !/^I\b/.test(next) ? next[0].toLowerCase() + next.slice(1) : next
      out[out.length - 1] = { ...prev, text: `${prev.text.trim()} ${go}`, ...(l.unclear ? { unclear: true as const } : {}) }
    } else out.push({ ...l, text: next })
    lastAt = l.at
  }
  return out
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
 * The transcript of a meeting, as written on its transcript card: every line with when and who
 * said it, people's words only (what the assistant did is kept apart, in the meeting's record).
 */
export function transcriptText(o: { lines: readonly { at: number; text: string; who?: string }[]; max?: number }): string {
  const parts: string[] = ['Transcript']
  let last = ''
  for (const l of o.lines) {
    const who = l.who ?? ''
    // The same person going on is one paragraph.
    const head = who && who !== last ? `${who}: ` : ''
    last = who || last
    parts.push(`[${clock(l.at)}] ${head}${l.text}`)
  }
  const text = parts.join('\n')
  const max = o.max ?? 100_000
  return text.length <= max ? text : `${text.slice(0, max - 60).replace(/\n[^\n]*$/, '')}\n… (the rest is in the meeting’s replay)`
}

/**
 * The names and terms in use on a board, for speech to text to spell right: people's names, then
 * words that stand out in what's written (names of things, acronyms, words with numbers in them).
 */
export function glossaryOf(b: Board, names: readonly string[] = [], max = 40): string[] {
  const out = new Map<string, string>()
  const add = (w: string) => {
    const t = w.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (t.length < 2 || t.length > 40 || out.has(t.toLowerCase())) return
    out.set(t.toLowerCase(), t)
  }
  for (const n of names) if (!unnamedVoice(n)) add(n)
  for (const i of b.items) for (const a of i.assignees ?? []) add(a)
  for (const i of b.items) {
    if (out.size >= max) break
    if (!i.text || i.kind === 'pen' || i.kind === 'image') continue
    // Words written with a capital mid-sentence, in capitals, or with digits: the names of things.
    for (const line of i.text.split('\n')) {
      const words = line.split(/\s+/).filter(Boolean)
      words.forEach((w, k) => {
        const clean = w.replace(/[^\p{L}\p{N}'’-]/gu, '')
        const first = k === 0 || /[.!?:•]$/.test(words[k - 1] ?? '') || /^[-•*]$/.test(words[k - 1] ?? '')
        if (COMMON.has(clean.toLowerCase()) || /^(ctrl|alt|shift|cmd|esc|tab|enter)/i.test(clean)) return
        if (/^\p{Lu}{2,}\d*$/u.test(clean) || /\p{L}\d|\d\p{L}/u.test(clean) || (!first && /^\p{Lu}\p{Ll}/u.test(clean)) || /\p{Ll}\p{Lu}/u.test(clean)) add(clean)
      })
    }
  }
  return [...out.values()].slice(0, max)
}

/** Words written with a capital for emphasis or as a label, that speech to text spells right anyway. */
const COMMON = new Set(
  'the a an and or but if of to in on at by for with from up out new your you our we they it this that these those my me is are was be been not no yes all any some more most other one two three first last next here there what when where who why how help open close save edit add delete done todo to-do key keys note notes item items page pages board boards wiki map mind idea ideas see show hide decided proposed actions action question questions blockers updates update overview summary transcript every alt monday tuesday wednesday thursday friday saturday sunday today tomorrow yesterday week month year january february march april may june july august september october november december'.split(
    ' ',
  ),
)
