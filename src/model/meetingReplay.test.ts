import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { emptyBoard } from './board'
import { type MeetingRecord, emptySnapshot, readRecord, replayBoard, snapshot, stepBetween, stepsBy } from './meetingReplay'
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
