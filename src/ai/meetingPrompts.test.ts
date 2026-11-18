import { describe, expect, it } from 'vitest'
import { askedLast } from '../ui/Flowstate'
import { applyOps } from '../api/ops'
import { emptyBoard } from '../model/board'
import { IDEAS_TITLE, agendaOf, ideasOf } from '../model/meeting'
import { fakeMeasure } from '../model/test-helpers'
import { MEETING_AGENDA, MEETING_NOTE, MEETING_REVIEW } from './assistant'
import { parseReview } from '../model/meetingReview'

describe('the agenda and the ideas to bring up, as the assistant is asked for them', () => {
  it('are asked for by the names and columns they’re read by', () => {
    for (const prompt of [MEETING_AGENDA, MEETING_NOTE]) {
      expect(prompt).toContain(`"${IDEAS_TITLE}"`)
      expect(prompt).toContain('Idea, Why and Raised')
    }
    expect(MEETING_AGENDA).toContain('Item, Why now and Covered')
    // Tables made the way they're asked for read back as the agenda and the ideas.
    const { board } = applyOps(
      emptyBoard(),
      [
        { op: 'createTable', title: 'Agenda', columns: ['Item', 'Why now', 'Covered'], rows: [['Venue', 'Left from last time', '✓']] },
        { op: 'createTable', title: IDEAS_TITLE, columns: ['Idea', 'Why', 'Raised'], rows: [['Who signs off the budget?', 'Nobody was named', '']] },
      ],
      { measure: fakeMeasure },
    )
    expect(agendaOf(board, board.items.map((i) => i.id)).map((a) => [a.text, a.covered])).toEqual([['Venue', true]])
    expect(ideasOf(board).map((i) => [i.text, i.why, i.raised])).toEqual([['Who signs off the budget?', 'Nobody was named', false]])
  })

  it('say the ideas are kept from meeting to meeting, and never taken off the list', () => {
    expect(MEETING_NOTE).toContain('Never take a row out of it or clear a tick')
    expect(MEETING_NOTE).toContain('kept from meeting to meeting')
    expect(MEETING_AGENDA).toContain('make no second one')
  })
})

describe('the review of a meeting, as the assistant is asked for it', () => {
  it('asks for the form the review is read in', () => {
    for (const part of ['Title:', 'Speakers:', 'Outcomes:', 'Ideas:', 'Summary:', 'Voice 2 = Sam', '12:30 = Brian', '| 1 |']) expect(MEETING_REVIEW).toContain(part)
    // Proposals are kept apart from what was agreed, and only what's clear names a voice.
    expect(MEETING_REVIEW).toContain('a Decision is only what was agreed')
    expect(MEETING_REVIEW).toContain('never guess')
    // The summary makes sense of the whole meeting, and isn't the lists over again.
    expect(MEETING_REVIEW).toContain('for someone who wasn\'t there')
    expect(MEETING_REVIEW).toContain('its start as much as its end')
    expect(MEETING_REVIEW).toContain('don\'t list them again')
    // Written last: after the ideas in the form.
    expect(MEETING_REVIEW.indexOf('\nSummary:\n')).toBeGreaterThan(MEETING_REVIEW.indexOf('\nIdeas:\n'))
  })

  it('reads back the example it gives', () => {
    const example = MEETING_REVIEW.slice(MEETING_REVIEW.indexOf('Title:'), MEETING_REVIEW.indexOf('\n\nSpeakers:'))
    const r = parseReview(example)
    expect(r.title).toBe('a few words saying what the meeting was about')
    expect(r.renames).toEqual([{ from: 'Voice 2', to: 'Sam' }])
    expect(r.lineWho).toEqual([{ at: 750_000, who: 'Brian' }])
    expect(r.outcomes.map((o) => o.kind)).toEqual(['update', 'decision', 'proposal', 'action', 'blocker', 'question'])
    expect(r.ideas).toEqual([{ at: 245_000, who: 'Brian', path: ['Launch', 'Venue'], weight: 1, text: 'Three venues downtown are all under budget' }])
    expect(r.summary).toBe('three to six sentences making sense of the meeting for someone who wasn\'t there')
  })
})

describe('the question a guide asks', () => {
  it('is the last question in its latest words', () => {
    const turns = [
      { role: 'assistant', text: 'What are we planning?' },
      { role: 'user', text: 'A trip' },
      { role: 'assistant', text: 'Added **the trip**. Two questions on the map.\nWho is going? And when do you leave?' },
    ]
    expect(askedLast(turns)).toBe('And when do you leave?')
  })

  it('looks past a last line without one', () => {
    expect(askedLast([{ role: 'assistant', text: 'Is it for kids?\nAdded three ideas.' }])).toBe('Is it for kids?')
  })

  it('is nothing when nothing was asked', () => {
    expect(askedLast([{ role: 'assistant', text: 'Added the venue.' }])).toBeNull()
    expect(askedLast([])).toBeNull()
  })
})
