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
})
