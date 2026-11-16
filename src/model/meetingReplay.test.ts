import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { emptyBoard } from './board'
import { type MeetingRecord, continuedRecord, emptySnapshot, readRecord, replayBoard, snapshot, snapshotAfter, stepBetween, stepsBy } from './meetingReplay'
import { parseReview } from './meetingReview'
import { fakeMeasure } from './test-helpers'

const ctx = { measure: fakeMeasure }

/** A meeting over a board with one note from before: a mind map made, grown, then a note taken away. */
function meeting() {
  const start = applyOps(emptyBoard(), [{ op: 'createNote', text: 'From before' }], ctx).board
  const before = new Set(start.items.map((i) => i.id))
  const links = new Set(start.connectors.map((c) => c.id))
  let snap = snapshot(start, before, links)
  const steps = []
  const one = applyOps(start, [{ op: 'createMindMap', outline: 'Launch' }, { op: 'createNote', text: 'Scratch' }], ctx)
  let now = snapshot(one.board, before, links)
  steps.push(stepBetween(snap, now, 10_000, 'Started the map.')!)
  snap = now
  const root = one.results[0].id!
  // The map linked to the note from before, too: a link made in the meeting.
  const two = applyOps(one.board, [{ op: 'addIdeas', parent: root, ideas: 'Venue' }, { op: 'delete', ids: [one.results[1].id!] }, { op: 'connect', from: root, to: start.items[0].id }], ctx)
  now = snapshot(two.board, before, links)
  steps.push(stepBetween(snap, now, 30_000, 'Added the venue.')!)
  const record: MeetingRecord = { v: 1, title: 'Launch', started: 0, length: 40_000, lines: [{ at: 5000, who: 'Jo', text: 'Launch first' }], steps }
  return { start, end: two.board, record }
}

describe('a meeting’s replay', () => {
  it('keeps only what changed at each step', () => {
    const { record } = meeting()
    const [a, b] = record.steps
    expect(a.put.map((i) => i.text).sort()).toEqual(['Launch', 'Scratch'])
    expect(a.gone).toEqual([])
    // The second: the new idea, the note taken away, and the link.
    expect(b.put.map((i) => i.text)).toContain('Venue')
    expect(b.put.map((i) => i.text)).not.toContain('Scratch')
    expect(b.gone).toHaveLength(1)
    expect(b.links.length).toBeGreaterThan(0)
    expect(stepBetween(emptySnapshot(), emptySnapshot(), 0)).toBeNull()
  })

  it('rebuilds the board as it was at each step, around what was there before', () => {
    const { end, record } = meeting()
    const texts = (n: number) => replayBoard(end, record, n).items.map((i) => i.text).sort()
    expect(texts(0)).toEqual(['From before'])
    expect(texts(1)).toEqual(['From before', 'Launch', 'Scratch'])
    expect(texts(2)).toEqual(['From before', 'Launch', 'Venue'])
    // Links only between what's there.
    const b1 = replayBoard(end, record, 1)
    expect(b1.connectors).toEqual([])
    expect(replayBoard(end, record, 2).connectors).toHaveLength(1)
  })

  it('leaves out the meeting’s frame until the end', () => {
    const { end, record } = meeting()
    const framed = applyOps(end, [{ op: 'createFrame', title: 'Launch', around: end.items.filter((i) => i.text !== 'From before').map((i) => i.id) }], ctx)
    const frame = framed.results[0].id!
    expect(replayBoard(framed.board, record, 2, frame).items.some((i) => i.id === frame)).toBe(false)
  })

  it('knows how many steps had happened by a moment', () => {
    const { record } = meeting()
    expect(stepsBy(record, 0)).toBe(0)
    expect(stepsBy(record, 10_000)).toBe(1)
    expect(stepsBy(record, 29_999)).toBe(1)
    expect(stepsBy(record, 40_000)).toBe(2)
  })

  it('reads back its file, checking what it would put on the board', () => {
    const { record } = meeting()
    const back = readRecord(JSON.stringify(record))!
    expect(back.steps).toHaveLength(2)
    expect(back.lines).toEqual(record.lines)
    // A step from someone else's file that would break the board.
    const bad = { ...record, steps: [{ at: 1, put: [{ id: 'x', kind: 'nope' }, null], gone: ['a', 5], links: [{}], unlinked: [] }] }
    const cleaned = readRecord(JSON.stringify(bad))!
    expect(cleaned.steps[0].put).toEqual([])
    expect(cleaned.steps[0].gone).toEqual([5])
    expect(cleaned.steps[0].links).toEqual([])
    expect(readRecord('not json')).toBeNull()
    expect(readRecord(JSON.stringify({ v: 2 }))).toBeNull()
    expect(readRecord(JSON.stringify({ ...record, steps: [{ at: 1 }] }))).toBeNull()
  })
})

describe('a meeting that carried on', () => {
  /** The meeting above, reviewed since it ended (its subject renamed, an idea taken out), then carried on: one more note. */
  function carriedOn() {
    const { start, end, record } = meeting()
    const before = new Set(start.items.map((i) => i.id))
    const links = new Set(start.connectors.map((c) => c.id))
    const root = end.items.find((i) => i.text === 'Launch')!
    const venue = end.items.find((i) => i.text === 'Venue')!
    const reviewed = applyOps(end, [{ op: 'update', id: root.id, text: 'Launch plan' }, { op: 'delete', ids: [venue.id] }], ctx).board
    const from = snapshot(reviewed, before, links)
    const more = applyOps(reviewed, [{ op: 'createNote', text: 'Second part' }], ctx).board
    const step = stepBetween(from, snapshot(more, before, links), 55_000, 'Noted the second part.')!
    const part = { length: 70_000, lines: [{ at: 50_000, who: 'Jo', text: 'And another thing' }], steps: [step], log: [{ at: 56_000, text: 'Noted the second part.' }], picks: { collage: true, kanban: false, notes: true }, from }
    return { record, part, more, root, venue }
  }

  it('knows what the meeting had made when its record ended', () => {
    const { end, record } = meeting()
    const after = snapshotAfter(record)
    const made = [...after.items.values()].map((j) => (JSON.parse(j) as { text: string }).text).sort()
    expect(made).toEqual(['Launch', 'Venue'])
    expect(after.links.size).toBe(end.connectors.length)
  })

  it('is one record: what was said, done and made goes on from where it stopped', () => {
    const { record, part } = carriedOn()
    const review = parseReview('Title: Launch\nOutcomes:\n- Decision: Go\nIdeas:\n')
    const all = continuedRecord({ ...record, review, log: [{ at: 12_000, text: 'Started the map.' }] }, part)
    expect(all).toMatchObject({ v: 2, title: 'Launch', started: 0, length: 70_000, picks: { collage: true, kanban: false, notes: true } })
    expect(all.lines.map((l) => l.text)).toEqual(['Launch first', 'And another thing'])
    expect(all.log!.map((l) => l.at)).toEqual([12_000, 56_000])
    // Its review stands until the whole is reviewed again.
    expect(all.review).toBe(review)
    // Without picks of its own, the earlier ones stay.
    expect(continuedRecord({ ...record, picks: { collage: false, kanban: true, notes: true } }, { ...part, picks: undefined }).picks).toEqual({ collage: false, kanban: true, notes: true })
    // Never shorter than it was, and nothing lands before where it stopped.
    const early = continuedRecord(record, { ...part, length: 1000, lines: [{ at: 10, text: 'Early' }], steps: [{ ...part.steps[0], at: 20 }], log: [{ at: 30, text: 'x' }] })
    expect(early.length).toBe(40_000)
    expect(early.lines.at(-1)).toEqual({ at: 40_000, text: 'Early' })
    expect(early.steps.at(-1)!.at).toBe(40_000)
    expect(early.log!.at(-1)!.at).toBe(40_000)
  })

  it('plays back through what it had become when it carried on', () => {
    const { record, part, more, root, venue } = carriedOn()
    const all = continuedRecord(record, part)
    // Its two steps, one for how the notes had changed since, then the new one.
    expect(all.steps).toHaveLength(4)
    const bridge = all.steps[2]
    expect(bridge).toMatchObject({ at: 40_000, noted: 'The meeting carried on' })
    expect(bridge.put.map((i) => i.text)).toContain('Launch plan')
    expect(bridge.gone).toEqual([venue.id])
    const texts = (upto: number) => replayBoard(more, all, upto).items.map((i) => i.text).sort()
    expect(texts(2)).toEqual(['From before', 'Launch', 'Venue'])
    expect(texts(3)).toEqual(['From before', 'Launch plan'])
    expect(texts(4)).toEqual(['From before', 'Launch plan', 'Second part'])
    expect(replayBoard(more, all, 3).items.find((i) => i.id === root.id)!.text).toBe('Launch plan')
    expect(stepsBy(all, 40_000)).toBe(3)
    // Nothing had changed since: the step only says it carried on.
    const same = continuedRecord(record, { ...part, from: snapshotAfter(record), steps: [] })
    expect(same.steps).toHaveLength(3)
    expect(same.steps[2]).toEqual({ at: 40_000, put: [], gone: [], links: [], unlinked: [], noted: 'The meeting carried on' })
  })
})
