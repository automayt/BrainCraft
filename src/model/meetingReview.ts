/**
 * A meeting's review: once it's over, the assistant reads the whole transcript and writes the
 * meeting down once, consolidated — who it really was that spoke, the complete ideas (each with
 * when, who, what it's about and how much it matters) and the outcomes (updates, decisions,
 * proposals, actions, blockers, questions). Every view in the meeting's frame (the overview, the
 * speaker timeline, the mind map, the decisions table, the Kanban of actions) is made from that one
 * record, so they agree, and each idea leads back to when it was said.
 */

import type { OutlineNode } from './mindmap'
import type { Item } from './types'

/** How much a view shows: the important ideas only, the usual amount, or everything. */
export type Detail = 1 | 2 | 3

export const DETAILS: readonly { level: Detail; name: string; hint: string }[] = [
  { level: 1, name: 'Important', hint: 'Only what matters most' },
  { level: 2, name: 'Normal', hint: 'The main points' },
  { level: 3, name: 'Verbose', hint: 'Every idea (the transcript always has every word)' },
]

/** A complete idea from the meeting: when it was said (ms in), by whom, what it's about, and how much it matters. */
export interface Idea {
  at: number
  who?: string
  /** What it's about, broadest first: a concept, then a topic within it ("Launch › Venue"). */
  path: string[]
  text: string
  weight: Detail
}

export type OutcomeKind = 'update' | 'decision' | 'proposal' | 'action' | 'blocker' | 'question'

/** Something the meeting came to. Proposals were put forward; decisions were agreed. */
export interface Outcome {
  kind: OutcomeKind
  text: string
  /** Who owns it (an action's owner, who proposed it…). */
  who?: string
  /** When it's due, as said. */
  when?: string
}

export interface Review {
  title?: string
  ideas: Idea[]
  outcomes: Outcome[]
  /** People found to be someone else: a voice named from what was said ("Voice 2" is "Sam"). */
  renames: { from: string; to: string }[]
  /** Lines whose speaker wasn't known, now worked out: the line at `at` ms was said by `who`. */
  lineWho: { at: number; who: string }[]
}

const KINDS: [RegExp, OutcomeKind][] = [
  [/^(updates?|news|status|progress)$/i, 'update'],
  [/^(decisions?|decided|agreed|agreement)$/i, 'decision'],
  [/^(proposals?|proposed|suggestions?|suggested|ideas?)$/i, 'proposal'],
  [/^(actions?|action items?|to ?dos?|tasks?)$/i, 'action'],
  [/^(blockers?|blocked|risks?|issues?)$/i, 'blocker'],
  [/^(questions?|open questions?|open)$/i, 'question'],
]

export const OUTCOME_NAMES: Record<OutcomeKind, string> = {
  update: 'Update',
  decision: 'Decision',
  proposal: 'Proposal',
  action: 'Action',
  blocker: 'Blocker',
  question: 'Question',
}

/** "4:05" or "1:02:09" → ms; null when it isn't a time. */
export function readClock(s: string): number | null {
  const m = /^\s*\[?(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]?\s*$/.exec(s)
  if (!m) return null
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000
}

/** A name, or nothing when it says nobody's known. */
const person = (s: string | undefined): string | undefined => {
  const t = (s ?? '').replace(/[[\]*_`]+/g, '').trim()
  return !t || /^(-|–|—|\?|none|nobody|n\/a|unknown|not sure( who)?|unclear)$/i.test(t) ? undefined : t.slice(0, 60)
}

const clean = (s: string) =>
  s
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Reads the review the assistant wrote:
 *
 *     Title: Q3 launch planning
 *     Outcomes:
 *     - Decision: Launch moves to May
 *     - Action: Book the venue | Brian | 20 Nov
 *     Ideas:
 *     - 4:05 | Brian | Launch > Venue | 1 | Three venues downtown are all under budget
 *     Speakers:
 *     - Voice 2 = Sam
 *     - 12:30 = Brian
 */
export function parseReview(text: string): Review {
  const out: Review = { ideas: [], outcomes: [], renames: [], lineWho: [] }
  let part: 'outcomes' | 'ideas' | 'speakers' | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const title = /^[#>*_\s-]*title\s*[:：]\s*(.+)$/i.exec(line)
    if (title && !out.title) {
      out.title = clean(title[1]).replace(/^["“]|["”]$/g, '').replace(/[.。]$/, '').slice(0, 80) || undefined
      continue
    }
    const head = /^[#*_\s]*(outcomes?|results?|ideas?|speakers?|people)\s*[:：]?[*_\s]*$/i.exec(line)
    if (head) {
      const h = head[1].toLowerCase()
      part = h.startsWith('outcome') || h.startsWith('result') ? 'outcomes' : h.startsWith('idea') ? 'ideas' : 'speakers'
      continue
    }
    const item = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line)?.[1]
    if (!item || !part) continue
    if (part === 'outcomes') {
      const m = /^([A-Za-z ]{3,20})\s*[:：]\s*(.+)$/.exec(item)
      const kind = m ? KINDS.find(([re]) => re.test(m[1].trim()))?.[1] : undefined
      if (!m || !kind) continue
      const [what, who, when] = m[2].split('|').map((s) => s.trim())
      const t = clean(what)
      if (!t) continue
      const w = person(who)
      const due = clean(when ?? '')
      out.outcomes.push({ kind, text: t.slice(0, 300), ...(w ? { who: w } : {}), ...(due && !/^(-|–|—|none|n\/a|\?)$/i.test(due) ? { when: due.slice(0, 40) } : {}) })
    } else if (part === 'ideas') {
      const cells = item.split('|').map((s) => s.trim())
      if (cells.length < 5) continue
      const at = readClock(cells[0])
      const t = clean(cells.slice(4).join(' | '))
      if (at === null || !t) continue
      const w = Number(cells[3])
      const path = cells[2]
        .split(/\s*(?:>|›|»|\/)\s*/)
        .map(clean)
        .filter(Boolean)
        .slice(0, 3)
      const who = person(cells[1])
      out.ideas.push({ at, ...(who ? { who } : {}), path: path.length ? path : ['Other'], text: t.slice(0, 300), weight: w === 1 || w === 3 ? w : 2 })
    } else {
      const m = /^(.+?)\s*(?:=|→|->|is)\s*(.+)$/.exec(item)
      if (!m) continue
      const to = person(m[2].replace(/\s*\(.*\)\s*$/, ''))
      const from = clean(m[1])
      if (!to || !from) continue
      const at = readClock(from)
      if (at !== null) out.lineWho.push({ at, who: to })
      else if (from.toLowerCase() !== to.toLowerCase()) out.renames.push({ from: from.slice(0, 60), to })
    }
  }
  out.ideas.sort((a, b) => a.at - b.at)
  return out
}

/** The ideas a view shows at a level of detail. */
export const ideasAt = (r: Review, detail: Detail) => r.ideas.filter((i) => i.weight <= detail)

/**
 * The mind map of a meeting at a level of detail: its subject in the middle, a branch for each
 * concept, topics within them, and the ideas under those, in the order they were said. `order`
 * gives the idea each node stands for (null for the subject and the groups), in the order the map's
 * nodes are made.
 */
export function mapTree(r: Review, detail: Detail, subject: string): { tree: OutlineNode; order: (Idea | null)[] } {
  const root: OutlineNode = { text: subject, children: [] }
  const groups = new Map<string, OutlineNode>()
  const ideaOf = new Map<OutlineNode, Idea>()
  for (const idea of ideasAt(r, detail)) {
    let at = root
    let key = ''
    for (const name of idea.path) {
      key += `\u0000${name.toLowerCase()}`
      let g = groups.get(key)
      if (!g) {
        g = { text: name, children: [] }
        groups.set(key, g)
        at.children.push(g)
      }
      at = g
    }
    const node: OutlineNode = { text: idea.text, children: [], ...(idea.who ? { who: [idea.who] } : {}) }
    ideaOf.set(node, idea)
    at.children.push(node)
  }
  const order: (Idea | null)[] = []
  const walk = (n: OutlineNode) => {
    order.push(ideaOf.get(n) ?? null)
    n.children.forEach(walk)
  }
  walk(root)
  return { tree: root, order }
}

/** One piece of a speaker timeline, placed from its top left corner. */
export interface TimelinePart {
  role: 'title' | 'lane' | 'name' | 'idea' | 'tick' | 'legend' | 'key'
  kind: 'text' | 'rect' | 'sticky'
  x: number
  y: number
  w: number
  h: number
  text: string
  color: string
  fontSize?: number
  idea?: Idea
}

/** Topic colours on the timeline: the sticky-note fills, in an order that keeps neighbours apart. */
export const TOPIC_FILLS = ['#aad2fa', '#ffcd82', '#cdeba5', '#f6b9e6', '#cdbcff', '#aaebe8', '#fff9b1', '#ffaaa5', '#e2e2e6']

const NOT_SURE = 'Not sure who'

/** Minutes between the times along the top: about eight of them. */
function tickEvery(length: number): number {
  const min = length / 60_000
  for (const step of [1, 2, 5, 10, 15, 20, 30, 60]) if (min / step <= 8) return step
  return 120
}

/**
 * A speaker timeline: a row for each person in the order they first spoke, their complete ideas
 * along it as cards in the order said (placed by when, nudged right so none overlap), coloured by
 * what they're about, with the minutes along the top and a key to the colours.
 */
export function speakerTimeline(r: Review, detail: Detail, length: number, title = 'Who said what, when'): { parts: TimelinePart[]; w: number; h: number } {
  const ideas = ideasAt(r, detail)
  const parts: TimelinePart[] = []
  const nameW = 170
  const card = { w: 210, gap: 14 }
  const laneH = 150
  const top = 110
  const end = Math.max(length, ideas.at(-1)?.at ?? 0, 60_000)
  const lanes: string[] = []
  for (const i of ideas) {
    const who = i.who ?? NOT_SURE
    if (!lanes.includes(who)) lanes.push(who)
  }
  // Wide enough that the busiest row's cards sit near when they were said.
  const busiest = Math.max(1, ...lanes.map((l) => ideas.filter((i) => (i.who ?? NOT_SURE) === l).length))
  const span = Math.max(1400, Math.min(busiest * (card.w + card.gap) * 1.15, 12_000))
  const xAt = (ms: number) => nameW + 20 + (ms / end) * span
  const topics: string[] = []
  for (const i of ideas) if (!topics.includes(i.path[0])) topics.push(i.path[0])
  const fill = (topic: string) => TOPIC_FILLS[topics.indexOf(topic) % TOPIC_FILLS.length]
  let right = xAt(end)
  lanes.forEach((who, k) => {
    const y = top + k * laneH
    let next = nameW + 20
    for (const i of ideas.filter((x) => (x.who ?? NOT_SURE) === who)) {
      const x = Math.max(xAt(i.at), next)
      next = x + card.w + card.gap
      right = Math.max(right, next)
      parts.push({ role: 'idea', kind: 'sticky', x, y: y + 12, w: card.w, h: laneH - 24, text: i.text, color: fill(i.path[0]), idea: i })
    }
  })
  const w = right + 20
  lanes.forEach((who, k) => {
    const y = top + k * laneH
    parts.unshift({ role: 'lane', kind: 'rect', x: 0, y, w, h: laneH, text: '', color: k % 2 ? '#ffffff' : '#e2e2e6' })
    // A filled label, so the name reads the same on the light rows in either theme.
    parts.push({ role: 'name', kind: 'rect', x: 10, y: y + 12, w: nameW - 10, h: laneH - 24, text: who, color: k % 2 ? '#ffffff' : '#e2e2e6', fontSize: 22 })
  })
  parts.unshift({ role: 'title', kind: 'text', x: 0, y: 0, w: Math.min(w, 900), h: 44, text: title, color: '#1e1e24', fontSize: 30 })
  const step = tickEvery(end)
  for (let m = 0; m * 60_000 <= end; m += step) parts.push({ role: 'tick', kind: 'text', x: xAt(m * 60_000) - 4, y: top - 40, w: 90, h: 30, text: `${m} min`, color: '#787882', fontSize: 18 })
  // The key: each topic's colour.
  const keyY = top + lanes.length * laneH + 30
  let kx = 0
  topics.forEach((t) => {
    const tw = Math.min(320, 40 + t.length * 11)
    parts.push({ role: 'key', kind: 'rect', x: kx, y: keyY, w: 28, h: 28, text: '', color: fill(t) })
    parts.push({ role: 'legend', kind: 'text', x: kx + 36, y: keyY - 2, w: tw, h: 32, text: t, color: '#1e1e24', fontSize: 18 })
    kx += tw + 50
  })
  return { parts, w: Math.max(w, kx), h: keyY + (topics.length ? 40 : 0) }
}

/** The overview: what the meeting came to, in a few lines, proposals kept apart from what was agreed. */
export function overviewText(o: { title: string; length: string; people: readonly string[]; outcomes: readonly Outcome[] }): string {
  const by = (k: OutcomeKind) => o.outcomes.filter((x) => x.kind === k)
  const lines: string[] = [`Overview: ${o.title}`, `${o.length}${o.people.length ? `, ${o.people.join(', ')}` : ''}`]
  const section = (name: string, list: Outcome[], line: (x: Outcome) => string) => {
    if (!list.length) return
    lines.push('', name, ...list.map((x) => `• ${line(x)}`))
  }
  const said = (x: Outcome) => `${x.text}${x.who ? ` (${x.who})` : ''}`
  section('Key updates', by('update'), said)
  section('Decided', by('decision'), (x) => x.text)
  section('Proposed, not yet agreed', by('proposal'), said)
  section('Actions', by('action'), (x) => `${x.text} — ${x.who ?? 'owner not agreed'}${x.when ? `, by ${x.when}` : ''}`)
  section('Blockers', by('blocker'), said)
  section('Open questions', by('question'), said)
  if (lines.length === 2) lines.push('', 'Nothing was decided or set to do.')
  return lines.join('\n')
}

/** The decisions-and-actions table's rows, from the outcomes (updates are in the overview only). */
export function outcomeRows(outcomes: readonly Outcome[]): string[][] {
  const order: OutcomeKind[] = ['decision', 'action', 'blocker', 'question', 'proposal']
  return order.flatMap((k) => outcomes.filter((x) => x.kind === k).map((x) => [OUTCOME_NAMES[k], x.text, x.who ?? (k === 'action' ? 'Not agreed' : ''), x.when ?? '']))
}

/** What's left from a meeting for the next one: actions, blockers, questions and proposals not yet settled. */
export function unfinished(outcomes: readonly Outcome[]): string[] {
  return outcomes.filter((x) => x.kind === 'action' || x.kind === 'blocker' || x.kind === 'question' || x.kind === 'proposal').map((x) => `${OUTCOME_NAMES[x.kind]}: ${x.text}${x.who ? ` (${x.who})` : ''}${x.when ? `, by ${x.when}` : ''}`)
}

/** Who spoke, from the review's ideas and the transcript, in the order they were first heard. */
export function peopleOf(r: Review | null, lines: readonly { who?: string }[]): string[] {
  const out: string[] = []
  for (const w of [...lines.map((l) => l.who), ...(r?.ideas.map((i) => i.who) ?? [])]) if (w && w !== NOT_SURE && !out.includes(w)) out.push(w)
  return out
}

// ----- names changed once, everywhere ----------------------------------------------------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Replaces a person's name as a whole word (never inside another word). */
export function swapName(text: string, from: string, to: string): string {
  if (!from.trim() || from === to) return text
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(from)}(?![\\p{L}\\p{N}])`, 'giu'), to)
}

/** An object with a person's name changed wherever it shows: its words, description, who it's for, its cells and cards. */
export function renameIn(i: Item, from: string, to: string): Item {
  const s = (t: string) => swapName(t, from, to)
  let out: Item = i
  const set = <K extends keyof Item>(k: K, v: Item[K]) => {
    if (out[k] !== v) out = { ...out, [k]: v }
  }
  set('text', s(i.text))
  if (i.description !== undefined) set('description', s(i.description))
  if (i.assignees) {
    const next = [...new Set(i.assignees.map((a) => (a.toLowerCase() === from.toLowerCase() ? to : a)))]
    if (next.join('\u0000') !== i.assignees.join('\u0000')) set('assignees', next)
  }
  if (i.table) {
    const rows = i.table.rows.map((r) => {
      const cells = Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, typeof v === 'string' ? s(v) : v]))
      return Object.entries(cells).some(([k, v]) => v !== r.cells[k]) ? { ...r, cells } : r
    })
    if (rows.some((r, k) => r !== i.table!.rows[k])) set('table', { ...i.table, rows })
  }
  if (i.kanban) {
    const columns = i.kanban.columns.map((c) => {
      const cards = c.cards.map((card) => (s(card.title) !== card.title ? { ...card, title: s(card.title) } : card))
      return cards.some((card, k) => card !== c.cards[k]) ? { ...c, cards } : c
    })
    if (columns.some((c, k) => c !== i.kanban!.columns[k])) set('kanban', { ...i.kanban, columns })
  }
  return out
}

/** A review with a person's name changed throughout. */
export function renameInReview(r: Review, from: string, to: string): Review {
  const same = (w: string | undefined) => (w && w.toLowerCase() === from.toLowerCase() ? to : w)
  return {
    ...r,
    ideas: r.ideas.map((i) => ({ ...i, who: same(i.who), text: swapName(i.text, from, to) })),
    outcomes: r.outcomes.map((o) => ({ ...o, who: same(o.who), text: swapName(o.text, from, to) })),
  }
}

// ----- telling hand edits from made ones -------------------------------------------------

/**
 * A fingerprint of what an object says (not where it is, nor whether a branch is folded): made
 * views keep the one they were made with, so a view someone has since changed by hand is left
 * as they made it.
 */
export function contentSig(i: Item): string {
  const what = JSON.stringify([i.kind, i.text, i.color, i.description ?? '', i.assignees ?? [], i.status ?? '', i.table ?? null, i.kanban ?? null, i.parent ?? null, i.locked ?? false])
  let h = 0x811c9dc5
  for (let k = 0; k < what.length; k++) {
    h ^= what.charCodeAt(k)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Changed by hand since it was made (or locked): a review leaves it as it is. */
export const handEdited = (i: Item) => !!i.locked || (i.meeting?.sig !== undefined && i.meeting.sig !== contentSig(i))

/** What was said around an idea, from the transcript: its line and the next ones, briefly. */
export function saidAround(lines: readonly { at: number; text: string; who?: string }[], at: number, max = 320): string {
  const from = lines.findIndex((l) => l.at >= at - 3000)
  if (from < 0) return ''
  let out = ''
  for (const l of lines.slice(from, from + 4)) {
    if (out.length > max) break
    out += `${out ? ' ' : ''}${l.text}`
  }
  return out.length > max ? `${out.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : out
}

/** A review read back from a meeting's record (a shared board's file): checked like anything else that arrives. */
export function cleanReview(raw: unknown): Review | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object').slice(0, 2000) : [])
  const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 1e9) : null)
  const kinds = new Set(Object.keys(OUTCOME_NAMES))
  const ideas: Idea[] = []
  for (const i of list(r.ideas)) {
    const at = time(i.at)
    const text = str(i.text, 300)
    if (at === null || !text) continue
    const path = Array.isArray(i.path) ? i.path.map((p) => str(p, 80)).filter((p): p is string => !!p).slice(0, 3) : []
    const who = str(i.who, 60)
    ideas.push({ at, text, path: path.length ? path : ['Other'], weight: i.weight === 1 || i.weight === 3 ? i.weight : 2, ...(who ? { who } : {}) })
  }
  const outcomes: Outcome[] = []
  for (const o of list(r.outcomes)) {
    const text = str(o.text, 300)
    if (!text || typeof o.kind !== 'string' || !kinds.has(o.kind)) continue
    const who = str(o.who, 60)
    const when = str(o.when, 40)
    outcomes.push({ kind: o.kind as OutcomeKind, text, ...(who ? { who } : {}), ...(when ? { when } : {}) })
  }
  const title = str(r.title, 80)
  return { ...(title ? { title } : {}), ideas, outcomes, renames: [], lineWho: [] }
}

/** "Voice 2", a voice not yet known by name. */
const unnamed = (who: string | undefined) => !who || /^voice \d+$/i.test(who) || who.toLowerCase() === NOT_SURE.toLowerCase()

/**
 * The transcript's speakers, corrected by the review: voices it worked out ("Voice 2" is Sam) and
 * single lines whose speaker it could tell from what was around them. Returns the lines and the
 * names that changed (to change on the board too).
 */
export function correctSpeakers<L extends { at: number; who?: string }>(lines: readonly L[], r: Review): { lines: L[]; renames: { from: string; to: string }[] } {
  const said = new Set(lines.map((l) => l.who?.toLowerCase()).filter(Boolean))
  const renames = r.renames.filter((x) => said.has(x.from.toLowerCase()) && x.from.toLowerCase() !== x.to.toLowerCase())
  const to = new Map(renames.map((x) => [x.from.toLowerCase(), x.to]))
  const out = lines.map((l) => {
    const who = l.who && to.get(l.who.toLowerCase())
    let next = who ? { ...l, who } : l
    if (unnamed(next.who)) {
      const fix = r.lineWho.find((x) => Math.abs(x.at - l.at) <= 1500)
      if (fix) next = { ...next, who: fix.who }
    }
    return next
  })
  return { lines: out, renames }
}

/** How much of a meeting's views show at first: the main points, or for a long meeting the important ones. */
export const firstDetail = (r: Review): Detail => (r.ideas.length > 80 ? 1 : 2)
