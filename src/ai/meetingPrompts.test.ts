import { describe, expect, it } from 'vitest'
import { askedLast } from '../ui/Flowstate'
import { MEETING_REVIEW } from './assistant'
import { parseReview } from '../model/meetingReview'

describe('the review of a meeting, as the assistant is asked for it', () => {
  it('asks for the form the review is read in', () => {
    for (const part of ['Title:', 'Speakers:', 'Outcomes:', 'Ideas:', 'Voice 2 = Sam', '12:30 = Brian', '| 1 |']) expect(MEETING_REVIEW).toContain(part)
    // Proposals are kept apart from what was agreed, and only what's clear names a voice.
    expect(MEETING_REVIEW).toContain('a Decision is only what was agreed')
    expect(MEETING_REVIEW).toContain('never guess')
  })

  it('reads back the example it gives', () => {
    const example = MEETING_REVIEW.slice(MEETING_REVIEW.indexOf('Title:'), MEETING_REVIEW.indexOf('\n\nSpeakers:'))
    const r = parseReview(example)
    expect(r.title).toBe('a few words saying what the meeting was about')
    expect(r.renames).toEqual([{ from: 'Voice 2', to: 'Sam' }])
    expect(r.lineWho).toEqual([{ at: 750_000, who: 'Brian' }])
    expect(r.outcomes.map((o) => o.kind)).toEqual(['update', 'decision', 'proposal', 'action', 'blocker', 'question'])
    expect(r.ideas).toEqual([{ at: 245_000, who: 'Brian', path: ['Launch', 'Venue'], weight: 1, text: 'Three venues downtown are all under budget' }])
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
