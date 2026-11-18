import { describe, expect, it } from 'vitest'
import * as B from './board'
const { emptyBoard } = B
import {
  cleanReview,
  contentSig,
  correctSpeakers,
  handEdited,
  mapTree,
  outcomeRows,
  overviewText,
  parseReview,
  readClock,
  renameIn,
  renameInReview,
  speakerTimeline,
  swapName,
  unfinished,
} from './meetingReview'
import type { Item } from './types'

const REVIEW = `Here's the review.
Title: **Q3 launch planning**
Speakers:
- Voice 2 = Sam
- 12:30 = Brian
- Voice 3 = Voice 3
Outcomes:
- Update: Beta is with 40 users | Sam
- Decision: Launch moves to May
- Proposal: Use the downtown venue | Brian
- Action: Book the venue | Brian | 2026-11-20
- Action: Send the invites | ? | next week
- Blocker: Legal review not done | Jo
- Question: Who writes the press kit?
- Mood: everyone happy
Ideas:
- 0:45 | Sam | Launch > Venue | 1 | Three venues downtown are all under budget
- 2:10 | Brian | Launch > Date | 2 | May avoids the conference clash
- 1:05 | ? | Budget | 3 | Catering can come out of marketing
- 3:00 | Brian | Launch | x | Not a weight
- nonsense | Brian | Launch | 1 | No time
`

describe('reading a meeting’s review', () => {
  const r = parseReview(REVIEW)

  it('takes the title, outcomes, ideas and speaker corrections', () => {
    expect(r.title).toBe('Q3 launch planning')
    expect(r.renames).toEqual([{ from: 'Voice 2', to: 'Sam' }])
    expect(r.lineWho).toEqual([{ at: 750_000, who: 'Brian' }])
    expect(r.outcomes).toHaveLength(7)
    expect(r.outcomes[3]).toEqual({ kind: 'action', text: 'Book the venue', who: 'Brian', when: '2026-11-20' })
    expect(r.outcomes[4]).toEqual({ kind: 'action', text: 'Send the invites', when: 'next week' })
  })

  it('takes the summary: after its heading or on its line, as prose, up to the next heading', () => {
    // After the lists, as it's asked for.
    const last = parseReview(`${REVIEW}Summary:\nThe launch moved to **June**, because legal needs three weeks.\nThe venue is still open.\n`)
    expect(last.summary).toBe('The launch moved to June, because legal needs three weeks. The venue is still open.')
    expect(last.ideas).toHaveLength(parseReview(REVIEW).ideas.length)
    // On the heading's own line, dressed up, with the lists after it: they're still read.
    const first = parseReview('Title: Launch\n**Summary:** It moved to June.\n- And the venue is open.\n\nOutcomes:\n- Decision: Launch moves to June\nIdeas:\n- 0:45 | Sam | Launch | 1 | June works\n')
    expect(first.summary).toBe('It moved to June. And the venue is open.')
    expect(first.outcomes).toEqual([{ kind: 'decision', text: 'Launch moves to June' }])
    expect(first.ideas).toHaveLength(1)
    // None written: none kept.
    expect(parseReview(REVIEW).summary).toBeUndefined()
    expect(parseReview('Summary:\nOutcomes:\n- Decision: Go').summary).toBeUndefined()
    // An outcome that happens to be called a summary isn't one, and what follows it is still read.
    const within = parseReview('Outcomes:\n- Summary: all fine\n- Decision: Go\n')
    expect(within.summary).toBeUndefined()
    expect(within.outcomes).toEqual([{ kind: 'decision', text: 'Go' }])
    // A model that goes on and on is cut short.
    expect(parseReview(`Summary:\n${'word '.repeat(600)}`).summary!.length).toBeLessThanOrEqual(1500)
  })

  it('keeps the summary through a name corrected and a file read back', () => {
    const r = parseReview(`${REVIEW}Summary:\nBrian will book the venue once Sam hears from finance.\n`)
    expect(renameInReview(r, 'Brian', 'Bryan').summary).toBe('Bryan will book the venue once Sam hears from finance.')
    expect(renameInReview(parseReview(REVIEW), 'Brian', 'Bryan').summary).toBeUndefined()
    expect(cleanReview(JSON.parse(JSON.stringify(r)))!.summary).toBe(r.summary)
    expect(cleanReview({ ideas: [], outcomes: [], summary: 42 })!.summary).toBeUndefined()
    expect(cleanReview({ ideas: [], outcomes: [], summary: 'x'.repeat(5000) })!.summary).toHaveLength(1500)
  })

  it('keeps ideas in the order said, with their topic path and weight (normal when it can’t tell)', () => {
    expect(r.ideas.map((i) => i.at)).toEqual([45_000, 65_000, 130_000, 180_000])
    expect(r.ideas[0]).toEqual({ at: 45_000, who: 'Sam', path: ['Launch', 'Venue'], weight: 1, text: 'Three venues downtown are all under budget' })
    expect(r.ideas[1].who).toBeUndefined()
    expect(r.ideas[3].weight).toBe(2)
  })

  it('reads clock times', () => {
    expect(readClock('4:05')).toBe(245_000)
    expect(readClock('[1:02:09]')).toBe(3_729_000)
    expect(readClock('soon')).toBeNull()
  })

  it('checks a review read back from a file', () => {
    expect(cleanReview({ ideas: [{ at: 5, text: 'x', path: ['A'], weight: 9, who: 3 }, { at: -1, text: 'y' }], outcomes: [{ kind: 'nope', text: 'z' }, { kind: 'decision', text: 'Yes' }] })).toEqual({
      ideas: [{ at: 5, text: 'x', path: ['A'], weight: 2 }],
      outcomes: [{ kind: 'decision', text: 'Yes' }],
      renames: [],
      lineWho: [],
    })
    expect(cleanReview('nope')).toBeNull()
  })
})

describe('views made from the review', () => {
  const r = parseReview(REVIEW)

  it('groups the mind map by concept, then topic, at each level of detail', () => {
    const all = mapTree(r, 3, 'Q3 launch')
    expect(all.tree.children.map((c) => c.text)).toEqual(['Launch', 'Budget'])
    const launch = all.tree.children[0]
    expect(launch.children.map((c) => c.text)).toEqual(['Venue', 'Date', 'Not a weight'])
    expect(launch.children[0].children[0]).toEqual({ text: 'Three venues downtown are all under budget', children: [], who: ['Sam'] })
    // Each node made, in order, and the idea it stands for.
    expect(all.order.filter(Boolean)).toHaveLength(4)
    expect(all.order[0]).toBeNull()
    const important = mapTree(r, 1, 'Q3 launch')
    expect(important.tree.children.map((c) => c.text)).toEqual(['Launch'])
    expect(important.order.filter(Boolean)).toHaveLength(1)
  })

  it('gives each person a row, ideas in order without overlapping, coloured by topic, with a key', () => {
    const t = speakerTimeline(r, 3, 240_000)
    const names = t.parts.filter((p) => p.role === 'name').map((p) => p.text)
    expect(names).toEqual(['Sam', 'Not sure who', 'Brian'])
    const ideas = t.parts.filter((p) => p.role === 'idea')
    expect(ideas).toHaveLength(4)
    const brian = ideas.filter((p) => p.idea?.who === 'Brian')
    expect(brian[1].x).toBeGreaterThanOrEqual(brian[0].x + brian[0].w)
    expect(new Set(ideas.filter((p) => p.idea!.path[0] === 'Launch').map((p) => p.color)).size).toBe(1)
    expect(ideas.find((p) => p.idea!.path[0] === 'Budget')!.color).not.toBe(ideas[0].color)
    expect(t.parts.filter((p) => p.role === 'legend').map((p) => p.text)).toEqual(['Launch', 'Budget'])
    expect(t.parts.some((p) => p.role === 'tick' && p.text === '0 min')).toBe(true)
    // Fewer at a lower level of detail.
    expect(speakerTimeline(r, 1, 240_000).parts.filter((p) => p.role === 'idea')).toHaveLength(1)
  })

  it('sums the meeting up with proposals apart from decisions, and every action’s owner', () => {
    const text = overviewText({ title: 'Q3 launch planning', length: '25 min', people: ['Sam', 'Brian'], outcomes: r.outcomes })
    expect(text.split('\n').slice(0, 2)).toEqual(['Overview: Q3 launch planning', '25 min, Sam, Brian'])
    expect(text).toContain('Decided\n• Launch moves to May')
    expect(text).toContain('Proposed, not yet agreed\n• Use the downtown venue (Brian)')
    expect(text).toContain('• Book the venue — Brian, by 2026-11-20')
    expect(text).toContain('• Send the invites — owner not agreed, by next week')
    expect(overviewText({ title: 'T', length: '1 min', people: [], outcomes: [] })).toContain('Nothing was decided or set to do.')
    expect(outcomeRows(r.outcomes)[0]).toEqual(['Decision', 'Launch moves to May', '', ''])
    expect(outcomeRows(r.outcomes).find((x) => x[1] === 'Send the invites')![2]).toBe('Not agreed')
  })

  it('opens the overview with the summary, when the review wrote one', () => {
    const r = parseReview(REVIEW)
    const o = { title: 'Q3 launch planning', length: '25 min', people: ['Sam', 'Brian'], outcomes: r.outcomes }
    const lines = overviewText({ ...o, summary: 'The launch moved to June. The venue is still open.' }).split('\n')
    expect(lines.slice(0, 5)).toEqual(['Overview: Q3 launch planning', '25 min, Sam, Brian', '', 'The launch moved to June. The venue is still open.', ''])
    // The rest is as it was without one.
    expect(lines.slice(5)).toEqual(overviewText(o).split('\n').slice(3))
    // With nothing decided, the summary is still there, and it still says so.
    expect(overviewText({ ...o, outcomes: [], summary: 'They only caught up.' }).split('\n')).toEqual(['Overview: Q3 launch planning', '25 min, Sam, Brian', '', 'They only caught up.', '', 'Nothing was decided or set to do.'])
    expect(overviewText({ ...o, outcomes: [] }).split('\n')).toEqual(['Overview: Q3 launch planning', '25 min, Sam, Brian', '', 'Nothing was decided or set to do.'])
  })

  it('leaves for the next meeting what wasn’t settled', () => {
    expect(unfinished(r.outcomes)).toEqual(['Proposal: Use the downtown venue (Brian)', 'Action: Book the venue (Brian), by 2026-11-20', 'Action: Send the invites, by next week', 'Blocker: Legal review not done (Jo)', 'Question: Who writes the press kit?'])
  })
})

describe('who spoke, corrected', () => {
  it('names voices and single lines the review worked out, leaving names already right alone', () => {
    const r = parseReview(REVIEW)
    const out = correctSpeakers(
      [
        { at: 1000, who: 'Voice 2', text: 'a' },
        { at: 750_500, who: 'Not sure who', text: 'b' },
        { at: 750_000, who: 'Jo', text: 'c' },
        { at: 800_000, text: 'd' },
      ],
      r,
    )
    expect(out.lines.map((l) => l.who)).toEqual(['Sam', 'Brian', 'Jo', undefined])
    expect(out.renames).toEqual([{ from: 'Voice 2', to: 'Sam' }])
  })

  it('changes a name as a whole word, everywhere it shows on an object', () => {
    expect(swapName('Sam said Samuel and sam.', 'Sam', 'Jo')).toBe('Jo said Samuel and Jo.')
    const i = { id: 1, kind: 'table', x: 0, y: 0, w: 1, h: 1, color: '', fontSize: 1, text: 'By Voice 2', assignees: ['Voice 2', 'Sam'], table: { columns: [{ id: 'a', name: 'Who' }], rows: [{ id: 'r', cells: { a: 'Voice 2' } }] } } as unknown as Item
    const out = renameIn(i, 'Voice 2', 'Sam')
    expect(out.text).toBe('By Sam')
    expect(out.assignees).toEqual(['Sam'])
    expect(out.table!.rows[0].cells.a).toBe('Sam')
    expect(renameIn(i, 'Nobody', 'X')).toBe(i)
  })
})

describe('telling hand edits from made ones', () => {
  it('fingerprints what an object says, not where it is', () => {
    const [b] = B.addItem(emptyBoard(), B.newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'Hi' }))
    const i = b.items[0]
    const tagged: Item = { ...i, meeting: { view: 'overview', sig: contentSig(i) } }
    expect(handEdited(tagged)).toBe(false)
    expect(handEdited({ ...tagged, x: 500, collapsed: true })).toBe(false)
    expect(handEdited({ ...tagged, text: 'Changed' })).toBe(true)
    expect(handEdited({ ...tagged, locked: true })).toBe(true)
  })

  const decisions = (): Item => {
    const table = { columns: [{ id: 'a', name: 'Type', width: 150 }, { id: 'b', name: 'What', width: 150 }], rows: [{ id: 'r1', cells: { a: 'Decision', b: 'Move the launch' } }, { id: 'r2', cells: { a: 'Action', b: 'Book it' } }] }
    return B.newItem('table', { x: 0, y: 0, w: 400, h: 200 }, { text: 'Decisions and actions', table }) as Item
  }

  it('takes shaping a table for what it is: not a change to what it says', () => {
    const i = decisions()
    const tagged: Item = { ...i, meeting: { view: 'outcomes', sig: contentSig(i) } }
    const t = tagged.table!
    // Columns made wider, one sized by hand, sorted, filtered, a row hidden: it says what it said.
    const shaped: Item = {
      ...tagged,
      w: 900,
      table: { ...t, columns: [{ ...t.columns[0], width: 96 }, { ...t.columns[1], width: 420, sized: true }], rows: [{ ...t.rows[0], hidden: true }, t.rows[1]], sort: { column: 'a', dir: 'asc' }, filters: { b: 'book' }, showFilters: true },
    }
    expect(handEdited(shaped)).toBe(false)
    // A cell's words changed, a column renamed, a row gone or added, or rows in another order: changed by hand.
    const cell: Item = { ...tagged, table: { ...t, rows: [t.rows[0], { ...t.rows[1], cells: { ...t.rows[1].cells, b: 'Book the venue' } }] } }
    expect(handEdited(cell)).toBe(true)
    expect(handEdited({ ...tagged, table: { ...t, columns: [t.columns[0], { ...t.columns[1], name: 'Which' }] } })).toBe(true)
    expect(handEdited({ ...tagged, table: { ...t, rows: [t.rows[0]] } })).toBe(true)
    expect(handEdited({ ...tagged, table: { ...t, rows: [t.rows[1], t.rows[0]] } })).toBe(true)
  })

  it('still knows a table from a meeting before tables could be shaped', () => {
    // The fingerprint as it was taken then: of the whole table, widths and all.
    const before = (i: Item) => {
      const what = JSON.stringify([i.kind, i.text, i.color, i.description ?? '', i.assignees ?? [], i.status ?? '', i.table ?? null, i.kanban ?? null, i.parent ?? null, i.locked ?? false])
      let h = 0x811c9dc5
      for (let k = 0; k < what.length; k++) {
        h ^= what.charCodeAt(k)
        h = Math.imul(h, 0x01000193)
      }
      return (h >>> 0).toString(36)
    }
    const i = decisions()
    const old: Item = { ...i, meeting: { view: 'outcomes', sig: before(i) } }
    expect(old.meeting!.sig).not.toBe(contentSig(i))
    expect(handEdited(old)).toBe(false)
    // Opened now, its columns are widened to their text (and can be sized by hand): still as the meeting made it.
    const t = old.table!
    expect(handEdited({ ...old, table: { ...t, columns: [t.columns[0], { ...t.columns[1], width: 420, sized: true }] } })).toBe(false)
    // But a cell changed by hand since then still shows.
    expect(handEdited({ ...old, table: { ...t, rows: [{ ...t.rows[0], cells: { ...t.rows[0].cells, b: 'Keep the date' } }, t.rows[1]] } })).toBe(true)
  })
})
