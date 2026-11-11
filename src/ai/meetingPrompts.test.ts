import { describe, expect, it } from 'vitest'
import { askedLast } from '../ui/Flowstate'
import { meetingEnd } from './assistant'

describe('the end of a meeting, as the assistant is told it', () => {
  it('asks for a title and a summary, and finishes what was picked', () => {
    const all = meetingEnd({ collage: true, kanban: true, notes: true })
    expect(all).toContain('"Title: "')
    expect(all).toContain('"- "')
    expect(all).toContain('Decisions and actions')
    expect(all).toContain('A Kanban board titled "Actions"')
    expect(all).toContain('The idea collage')
    expect(all).not.toContain('They don\'t want')
  })

  it('says what not to make', () => {
    const some = meetingEnd({ collage: false, kanban: true, notes: false })
    expect(some).toContain('A Kanban board titled "Actions"')
    expect(some).not.toContain('The idea collage:')
    expect(some).toContain("They don't want the notes (the mind map and its tables), or the flowcharts, sequences, timelines and other drawings")
  })

  it('changes nothing when only the transcript is kept', () => {
    const none = meetingEnd({ collage: false, kanban: false, notes: false })
    expect(none).toContain('change nothing on the board')
    expect(none).not.toContain('Then call propose_changes')
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
