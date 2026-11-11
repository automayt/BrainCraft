import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import * as B from '../model/board'
import { ALL_PICKS } from '../model/meeting'
import { parseReview } from '../model/meetingReview'
import { fakeMeasure } from '../model/test-helpers'
import type { Board, Id } from '../model/types'
import { inFrame, polishMeeting, renameInFrame } from './meetingViews'

const ctx = { measure: fakeMeasure }

const review = parseReview(`Title: Q3 launch planning
Outcomes:
- Decision: Launch moves to May
- Action: Book the venue | Brian | 2026-11-20
Ideas:
- 0:45 | Sam | Launch > Venue | 1 | Three venues downtown are all under budget
- 2:10 | Brian | Launch > Date | 2 | May avoids the conference clash
- 3:05 | Sam | Budget | 3 | Catering can come out of marketing
`)

/** A meeting as it ends: a live mind map and decisions table, a transcript note, all in a frame. */
function meeting(): { b: Board; frame: Id } {
  let b = B.emptyBoard()
  const out = applyOps(
    b,
    [
      { op: 'createMindMap', outline: 'Launch\n- venue thing\n- yeah', at: { x: 0, y: 0 } },
      { op: 'createTable', title: 'Decisions and actions', columns: ['Type', 'What', 'Who', 'When'], rows: [['Decision', 'may', '', '']], at: { x: 0, y: 400 } },
      { op: 'createNote', text: 'Transcript: Meeting, 11 Nov 2026', color: 'white', at: { x: 700, y: 0 } },
    ],
    ctx,
  )
  b = out.board
  const note = out.results[2].id!
  b = B.updateItem(b, note, (i) => ({ ...i, meeting: { view: 'transcript' } }))
  const framed = applyOps(b, [{ op: 'createFrame', title: 'Meeting, 11 Nov 2026', around: b.items.map((i) => i.id) }], ctx)
  return { b: framed.board, frame: framed.results[0].id! }
}

const polish = (b: Board, frame: Id, more: Partial<Parameters<typeof polishMeeting>[1]> = {}) =>
  polishMeeting(b, { frame, title: 'Q3 launch planning', review, detail: 3, picks: ALL_PICKS, length: 240_000, howLong: '4 min', lines: [{ at: 45_000, text: 'There are three venues downtown.', who: 'Sam' }], people: ['Sam', 'Brian'], arrange: true, ...more }, fakeMeasure)

const views = (b: Board, frame: Id) => inFrame(b, frame).reduce<Record<string, number>>((n, i) => ((n[i.meeting?.view ?? 'none'] = (n[i.meeting?.view ?? 'none'] ?? 0) + 1), n), {})

describe('a meeting’s views, made from its review', () => {
  it('makes the overview, decisions, actions, mind map and speaker timeline inside the frame, named for the meeting', () => {
    const { b, frame } = meeting()
    const out = polish(b, frame)
    expect(out.kept).toEqual([])
    const f = B.getItem(out.board, frame)!
    expect(f.text).toBe('Q3 launch planning')
    expect(f.meeting?.detail).toBe(3)
    const v = views(out.board, frame)
    expect(v.overview).toBe(1)
    expect(v.outcomes).toBe(1)
    expect(v.actions).toBe(1)
    expect(v.transcript).toBe(1)
    // The live map, fragments and all, is replaced by the one made from the review.
    const map = inFrame(out.board, frame).filter((i) => i.kind === 'mind')
    expect(map.every((i) => i.meeting?.view === 'map')).toBe(true)
    expect(map.map((i) => i.text)).not.toContain('yeah')
    // Read like an outline, all on the right: its left edge is its subject, which stays put.
    const root = map.find((i) => i.parent === undefined)!
    expect(Math.min(...map.map((i) => i.x))).toBe(root.x)
    expect(root.x).toBe(f.x + 60)
    const idea = map.find((i) => i.text.startsWith('Three venues'))!
    expect(idea.meeting?.at).toBe(45_000)
    expect(idea.description).toBe('Said by Sam at 0:45: “There are three venues downtown.”')
    expect(v.timeline).toBeGreaterThan(5)
    // Every object is inside the frame.
    expect(inFrame(out.board, frame)).toHaveLength(out.board.items.length - 1)
    const table = inFrame(out.board, frame).find((i) => i.kind === 'table')!
    expect(table.table!.rows).toHaveLength(2)
  })

  it('updates the same objects when done again, never adding copies', () => {
    const { b, frame } = meeting()
    const once = polish(b, frame).board
    const twice = polish(once, frame, { arrange: false }).board
    expect(views(twice, frame)).toEqual(views(once, frame))
    expect(twice.items).toHaveLength(once.items.length)
  })

  it('leaves alone what someone changed by hand or locked, and says so', () => {
    const { b, frame } = meeting()
    let once = polish(b, frame).board
    const overview = inFrame(once, frame).find((i) => i.meeting?.view === 'overview')!
    once = B.updateItem(once, overview.id, (i) => ({ ...i, text: 'My own summary' }))
    const table = inFrame(once, frame).find((i) => i.meeting?.view === 'outcomes')!
    once = B.updateItem(once, table.id, (i) => ({ ...i, locked: true }))
    const again = polishMeeting(once, { frame, title: 'Q3', review: { ...review, outcomes: [] }, detail: 2, picks: ALL_PICKS, length: 240_000, howLong: '4 min', lines: [], people: [], arrange: false }, fakeMeasure)
    expect(again.kept).toEqual(['the overview', 'the decisions table'])
    expect(B.getItem(again.board, overview.id)!.text).toBe('My own summary')
    expect(B.getItem(again.board, table.id)!.table!.rows).toHaveLength(2)
  })

  it('keeps a live mind map someone worked on during the meeting', () => {
    const { b, frame } = meeting()
    const live = b.items.filter((i) => i.kind === 'mind').map((i) => i.id)
    const out = polish(b, frame, { touched: new Set([live[1]]) })
    expect(out.kept).toEqual(['the mind map'])
    expect(out.board.items.filter((i) => i.kind === 'mind').map((i) => i.text)).toContain('venue thing')
  })

  it('shows another level of detail in the mind map and timeline only', () => {
    const { b, frame } = meeting()
    const once = polish(b, frame).board
    const overview = inFrame(once, frame).find((i) => i.meeting?.view === 'overview')!
    const less = polish(once, frame, { detail: 1, arrange: false, only: ['map', 'timeline'] }).board
    const ideas = (bb: Board) => inFrame(bb, frame).filter((i) => i.meeting?.at !== undefined && i.kind === 'mind').length
    expect(ideas(once)).toBe(3)
    expect(ideas(less)).toBe(1)
    expect(B.getItem(less, overview.id)).toEqual(overview)
    expect(B.getItem(less, frame)!.meeting?.detail).toBe(1)
  })

  it('takes out what wasn’t picked to keep', () => {
    const { b, frame } = meeting()
    const out = polish(b, frame, { picks: { ...ALL_PICKS, timeline: false, kanban: false } }).board
    const v = views(out, frame)
    expect(v.timeline).toBeUndefined()
    expect(v.actions).toBeUndefined()
  })
})

describe('one correction for a whole meeting', () => {
  it('changes a name on everything in the frame, and what was untouched still counts as untouched', () => {
    const { b, frame } = meeting()
    const once = polish(b, frame).board
    const renamed = renameInFrame(once, frame, 'Brian', 'Bryan')
    const texts = inFrame(renamed, frame).map((i) => `${i.text} ${i.description ?? ''} ${(i.assignees ?? []).join(' ')}`)
    expect(texts.some((t) => /\bBrian\b/.test(t))).toBe(false)
    expect(texts.some((t) => /\bBryan\b/.test(t))).toBe(true)
    // Still made by the review, so the next review may update them.
    const again = polish(renamed, frame, { arrange: false })
    expect(again.kept).toEqual([])
  })
})
