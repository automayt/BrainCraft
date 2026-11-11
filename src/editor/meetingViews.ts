/**
 * The views in a meeting's frame, made from its review (see model/meetingReview.ts): the overview,
 * the decisions table, the Kanban of actions, the mind map and the speaker timeline. Each is
 * tagged with the view it is and a fingerprint of what it said when made, so reviewing again (or
 * showing another level of detail) changes the same objects in place instead of adding copies, and
 * leaves alone any that someone has changed by hand or locked.
 */

import { applyOps } from '../api/ops'
import * as B from '../model/board'
import { clock } from '../model/meeting'
import type { MeetingPicks } from '../model/meeting'
import { type Detail, type Review, contentSig, handEdited, mapTree, outcomeRows, overviewText, renameIn, saidAround, speakerTimeline } from '../model/meetingReview'
import { layoutAll, type Measure } from '../model/mindmap'
import { isIsoDay } from '../model/timeline'
import type { Rect } from '../model/geom'
import type { Board, Id, Item, MeetingView } from '../model/types'

/** The objects in a frame: those whose middle is inside it (a mind map by its central idea, with its branches). */
export function inFrame(b: Board, frame: Id): Item[] {
  const f = B.getItem(b, frame)
  if (!f) return []
  const box = B.itemBounds(f)
  const inside = (i: Item) => {
    const cx = i.x + i.w / 2
    const cy = i.y + i.h / 2
    return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h
  }
  const roots = new Set(b.items.filter((i) => i.kind === 'mind' && i.parent === undefined && inside(i)).map((i) => i.id))
  return b.items.filter((i) => i.id !== frame && (i.kind === 'mind' ? roots.has(B.rootOf(b, i.id)?.id ?? i.id) : inside(i)))
}

/** Tags an object as part of a view, with what it says now. */
const tag = (i: Item, view: MeetingView, at?: number): Item => {
  const t: Item = { ...i, meeting: { view, ...(at !== undefined ? { at } : {}) } }
  return { ...t, meeting: { ...t.meeting, sig: contentSig(t) } }
}

export interface Polish {
  frame: Id
  title: string
  review: Review
  detail: Detail
  picks: MeetingPicks & { timeline?: boolean }
  /** How long the meeting went on (ms), and how long that is in words. */
  length: number
  howLong: string
  /** What was said, for each idea's source. */
  lines: readonly { at: number; text: string; who?: string }[]
  people: readonly string[]
  /** The transcript as it now reads (speakers corrected), for the transcript note's comments. */
  transcript?: string
  /** Objects changed by hand while the meeting went on (they have no fingerprint yet). */
  touched?: ReadonlySet<Id>
  /** The first review: everything is laid out afresh in the frame. */
  arrange: boolean
  /** Only these views are made again (showing another level of detail). */
  only?: readonly MeetingView[]
}

const VIEW_NAMES: Record<MeetingView, string> = {
  overview: 'the overview',
  map: 'the mind map',
  timeline: 'the speaker timeline',
  outcomes: 'the decisions table',
  actions: 'the Actions board',
  transcript: 'the transcript',
  made: 'the notes',
}

/**
 * Makes or updates a meeting's views from its review. Returns the board and the views left as
 * they were because someone changed them by hand.
 */
export function polishMeeting(board: Board, o: Polish, measure: Measure): { board: Board; kept: string[] } {
  let b = board
  const frame = B.getItem(b, o.frame)
  if (!frame) return { board, kept: [] }
  const kept: string[] = []
  const wants = (v: MeetingView) => !o.only || o.only.includes(v)
  const edited = (i: Item) => handEdited(i) || !!o.touched?.has(i.id)
  const members = () => inFrame(b, o.frame)
  const ofView = (v: MeetingView) => members().filter((i) => i.meeting?.view === v)
  /** Where something new goes before it's laid out: under what's in the frame. */
  const below = (): { x: number; y: number } => {
    const f = B.getItem(b, o.frame)!
    return { x: f.x + 60, y: f.y + f.h + 40 }
  }
  const made: Id[] = []
  const run = (ops: Parameters<typeof applyOps>[1]) => {
    const out = applyOps(b, ops, { measure })
    b = out.board
    return out.results
  }
  /** Every object of a view made or updated here: laid out with the frame, wherever it was put. */
  const views = new Set<Id>()
  const retag = (id: Id, view: MeetingView, at?: number) => {
    views.add(id)
    b = B.updateItem(b, id, (i) => tag(i, view, at))
  }

  // The overview: what the meeting came to.
  if (o.picks.notes && wants('overview')) {
    const text = overviewText({ title: o.title, length: o.howLong, people: o.people, outcomes: o.review.outcomes })
    const h = Math.min(1400, 70 + text.split('\n').length * 30)
    const was = ofView('overview')[0]
    if (was && edited(was)) kept.push(VIEW_NAMES.overview)
    else if (was) b = B.updateItem(b, was.id, (i) => tag({ ...i, text, h: Math.max(i.h, h) }, 'overview'))
    else {
      const [r] = run([{ op: 'createNote', text, color: 'white', w: 560, h, at: below() }])
      if (r?.id !== undefined) {
        retag(r.id, 'overview')
        made.push(r.id)
      }
    }
  }

  // The decisions table: decisions, actions, blockers, questions and proposals, each with who and when.
  if (o.picks.notes && wants('outcomes')) {
    const rows = outcomeRows(o.review.outcomes)
    const was = ofView('outcomes')[0] ?? members().find((i) => i.kind === 'table' && !i.meeting?.view && /^\s*decisions\b/i.test(i.text))
    const spec = { title: 'Decisions and actions', columns: ['Type', 'What', 'Who', 'When'], rows }
    if (was && edited(was)) kept.push(VIEW_NAMES.outcomes)
    else if (was && rows.length) {
      run([{ op: 'setTable', id: was.id, ...spec }])
      retag(was.id, 'outcomes')
    }
    else if (!was && rows.length) {
      const [r] = run([{ op: 'createTable', ...spec, at: below() }])
      if (r?.id !== undefined) {
        retag(r.id, 'outcomes')
        made.push(r.id)
      }
    }
  }

  // The Kanban of actions: a card for each, saying who.
  if (o.picks.kanban && wants('actions')) {
    const actions = o.review.outcomes.filter((x) => x.kind === 'action')
    const cards = actions.map((a) => ({ title: `${a.text}${a.who ? ` (${a.who})` : ''}`, ...(a.when && isIsoDay(a.when) ? { due: a.when } : {}) }))
    const was = ofView('actions')[0] ?? members().find((i) => i.kind === 'kanban' && !i.meeting?.view && /^\s*actions\b/i.test(i.text))
    if (was && edited(was)) kept.push(VIEW_NAMES.actions)
    else if (was && cards.length) {
      // Cards already moved along keep their column.
      const where = new Map(was.kanban!.columns.flatMap((c, k) => c.cards.map((card) => [card.title.toLowerCase(), k] as const)))
      const names = was.kanban!.columns.map((c) => c.title)
      const columns = (names.length ? names : ['To do', 'Doing', 'Done']).map((title, k) => ({ title, cards: cards.filter((c) => (where.get(c.title.toLowerCase()) ?? 0) === k) }))
      run([{ op: 'setKanban', id: was.id, title: 'Actions', columns }])
      retag(was.id, 'actions')
    } else if (!was && cards.length) {
      const [r] = run([{ op: 'createKanban', title: 'Actions', columns: [{ title: 'To do', cards }, { title: 'Doing' }, { title: 'Done' }], at: below() }])
      if (r?.id !== undefined) {
        retag(r.id, 'actions')
        made.push(r.id)
      }
    }
  }

  // The mind map: concepts, topics within them, and the complete ideas, at this level of detail.
  if (o.picks.notes && wants('map') && o.review.ideas.length) {
    const tagged = ofView('map').filter((i) => i.parent === undefined)
    const live = tagged.length ? [] : members().filter((i) => i.kind === 'mind' && i.parent === undefined && !i.meeting?.view)
    const old = [...tagged, ...live]
    const nodes = old.flatMap((r) => [...B.subtree(b, r.id)].map((id) => B.getItem(b, id)!).filter(Boolean))
    if (nodes.some(edited)) kept.push(VIEW_NAMES.map)
    else {
      const box = old.length ? B.bounds(b, new Set(nodes.map((n) => n.id))) : null
      if (old.length) b = B.remove(b, new Set(nodes.map((n) => n.id)))
      const { tree, order } = mapTree(o.review, o.detail, o.title)
      const [r] = run([{ op: 'createMindMap', tree, at: box ? { x: box.x, y: box.y } : below() }])
      const ids = (r as { ids?: Id[] } | undefined)?.ids ?? []
      // All on the right, read like an outline: its left edge is the subject and stays put inside
      // the frame however wide the ideas turn out once drawn.
      const root = r?.id
      if (root !== undefined) {
        const at = B.getItem(b, root)!
        b = B.updateItems(b, new Set(b.items.filter((i) => i.parent === root).map((i) => i.id)), (i) => ({ ...i, side: 'right' }))
        b = layoutAll(b, measure)
        const moved = B.getItem(b, root)!
        if (moved.x !== at.x || moved.y !== at.y) b = B.translate(b, B.subtree(b, root), at.x - moved.x, at.y - moved.y)
        b = layoutAll(b, measure)
      }
      ids.forEach((id, k) => {
        const idea = order[k]
        if (idea) b = B.updateItem(b, id, (i) => ({ ...i, description: source(idea.at, idea.who, o.lines) }))
        retag(id, 'map', idea?.at)
      })
      if (!box && r?.id !== undefined) made.push(r.id)
    }
  }

  // The speaker timeline: a row for each person, their ideas in order, coloured by topic.
  if (o.picks.timeline && wants('timeline') && o.review.ideas.length) {
    const old = ofView('timeline')
    if (old.some(edited)) kept.push(VIEW_NAMES.timeline)
    else {
      const box = old.length ? B.bounds(b, new Set(old.map((i) => i.id))) : null
      if (old.length) b = B.remove(b, new Set(old.map((i) => i.id)))
      const at = box ? { x: box.x, y: box.y } : below()
      const group = `meeting-${o.frame}-timeline`
      const t = speakerTimeline(o.review, o.detail, o.length)
      for (const p of t.parts) {
        const kind = p.kind === 'sticky' ? 'sticky' : p.kind === 'rect' ? 'rect' : 'text'
        const item = B.newItem(kind, { x: at.x + p.x, y: at.y + p.y, w: p.w, h: p.h }, { text: p.text, color: p.color, group, ...(p.fontSize ? { fontSize: p.fontSize } : {}), ...(p.idea ? { description: source(p.idea.at, p.idea.who, o.lines) } : {}) })
        let id: Id
        ;[b, id] = B.addItem(b, item)
        retag(id, 'timeline', p.idea?.at)
        if (!box && p.role === 'title') made.push(id)
      }
    }
  }

  // The transcript keeps every word; its title follows the meeting's.
  const transcript = ofView('transcript')[0]
  if (transcript && !edited(transcript) && !o.only)
    b = B.updateItem(b, transcript.id, (i) => tag({ ...i, text: i.text.replace(/^Transcript: [^\n]*/, `Transcript: ${o.title}`), ...(o.transcript ? { description: o.transcript } : {}) }, 'transcript'))

  b = layoutAll(b, measure)
  // What was made goes in the frame (it was put just under it), and the first time it's all laid out.
  b = growFrame(b, o.frame, made)
  if (o.arrange) b = arrange(b, o.frame, views)
  // Everything else the meeting made is fingerprinted too, so later reviews know what's been changed by hand.
  if (o.arrange) for (const i of members()) if (!i.meeting) b = B.updateItem(b, i.id, (x) => (o.touched?.has(x.id) ? x : tag(x, 'made')))
  b = B.updateItem(b, o.frame, (f) => ({ ...f, text: o.title, meeting: { ...f.meeting, detail: o.detail } }))
  return { board: b, kept }
}

/** Where an idea came from: who said it, when, and their words. */
function source(at: number, who: string | undefined, lines: Polish['lines']): string {
  const words = saidAround(lines, at)
  return `Said${who ? ` by ${who}` : ''} at ${clock(at)}${words ? `: “${words}”` : ''}`
}

/** The frame made big enough for what was just put under it. */
function growFrame(b: Board, frame: Id, ids: readonly Id[]): Board {
  const f = B.getItem(b, frame)
  if (!f) return b
  const all = ids.flatMap((id) => {
    const i = B.getItem(b, id)
    if (!i) return []
    return [i.kind === 'mind' ? B.bounds(b, B.subtree(b, id))! : i.kind === 'text' && i.group ? B.bounds(b, new Set(b.items.filter((x) => x.group === i.group).map((x) => x.id)))! : B.itemBounds(i)]
  })
  if (!all.length) return b
  const box = all.reduce(union)
  const pad = 60
  const left = Math.min(f.x, box.x - pad)
  const right = Math.max(f.x + f.w, box.x + box.w + pad)
  const bottom = Math.max(f.y + f.h, box.y + box.h + pad)
  return B.updateItem(b, frame, (x) => ({ ...x, x: left, w: right - left, h: bottom - f.y }))
}

const union = (a: Rect, z: Rect): Rect => {
  const x = Math.min(a.x, z.x)
  const y = Math.min(a.y, z.y)
  return { x, y, w: Math.max(a.x + a.w, z.x + z.w) - x, h: Math.max(a.y + a.h, z.y + z.h) - y }
}

/**
 * Lays a meeting's frame out afresh: the overview, transcript, decisions and actions along the top,
 * the speaker timeline under them, then the mind map, then everything else the meeting made (kept
 * as it was arranged); the frame fits around it all. `also`: objects that belong in it wherever they are now.
 */
export function arrange(b: Board, frame: Id, also: ReadonlySet<Id> = new Set()): Board {
  const f = B.getItem(b, frame)
  if (!f) return b
  const inside = inFrame(b, frame)
  const members = [...inside, ...b.items.filter((i) => also.has(i.id) && !inside.includes(i))]
  /** The blocks to place: each a set of objects moved together. */
  const block = (pred: (i: Item) => boolean) => new Set(members.filter(pred).map((i) => i.id))
  const view = (v: MeetingView) => (i: Item) => i.meeting?.view === v
  const top = [block(view('overview')), block(view('transcript')), block(view('outcomes')), block(view('actions'))].filter((s) => s.size)
  const timeline = block(view('timeline'))
  const map = block(view('map'))
  const placed = new Set([...top, timeline, map].flatMap((s) => [...s]))
  const rest = block((i) => !placed.has(i.id))
  const pad = 60
  let y = f.y + 90
  const x0 = f.x + pad
  const put = (ids: ReadonlySet<Id>, x: number, at: number): Rect | null => {
    const box = B.bounds(b, ids)
    if (!box) return null
    b = B.translate(b, ids, x - box.x, at - box.y)
    return { ...box, x, y: at }
  }
  let x = x0
  let rowH = 0
  for (const s of top) {
    const r = put(s, x, y)
    if (!r) continue
    x += r.w + 50
    rowH = Math.max(rowH, r.h)
  }
  if (rowH) y += rowH + 70
  for (const s of [timeline, map, rest]) {
    if (!s.size) continue
    const r = put(s, x0, y)
    if (r) y += r.h + 70
  }
  const all = B.bounds(b, new Set(members.map((i) => i.id)))
  if (!all) return b
  return B.updateItem(b, frame, (x) => ({ ...x, x: all.x - pad, y: all.y - 90, w: all.w + 2 * pad, h: all.h + 90 + pad }))
}

/**
 * One correction, everywhere in a meeting's frame: a person's name changed on every object (the
 * transcript too). Objects that still said what they were made with keep counting as untouched.
 */
export function renameInFrame(b: Board, frame: Id, from: string, to: string): Board {
  const ids = new Set(inFrame(b, frame).map((i) => i.id))
  return B.updateItems(b, ids, (i) => {
    const clean = i.meeting?.sig !== undefined && !handEdited(i)
    const next = renameIn(i, from, to)
    if (next === i) return i
    return clean ? { ...next, meeting: { ...next.meeting, sig: contentSig(next) } } : next
  })
}
