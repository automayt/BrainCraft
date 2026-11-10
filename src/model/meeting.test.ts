import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { emptyBoard } from './board'
import { meetingItems, meetingTitle, untitledMeeting } from './meeting'
import { fakeMeasure } from './test-helpers'

const ctx = { measure: fakeMeasure }

describe('what a meeting made', () => {
  it('is what wasn’t there when it started', () => {
    let { board } = applyOps(emptyBoard(), [{ op: 'createNote', text: 'From before' }], ctx)
    const before = new Set(board.items.map((i) => i.id))
    const made = applyOps(board, [{ op: 'createMindMap', outline: 'Launch\n  Venue\n  Dates' }, { op: 'createNote', text: 'Decided: May' }], ctx)
    board = made.board
    const ids = meetingItems(board, before)
    expect(ids).toHaveLength(4)
    expect(ids.some((id) => before.has(id))).toBe(false)
  })

  it('leaves out ideas added to a mind map that was there before, so the frame doesn’t reach over it', () => {
    const first = applyOps(emptyBoard(), [{ op: 'createMindMap', outline: 'Plan' }], ctx)
    const before = new Set(first.board.items.map((i) => i.id))
    const root = first.results[0].id!
    const { board } = applyOps(first.board, [{ op: 'addIdeas', parent: root, ideas: 'Budget' }, { op: 'createNote', text: 'New' }], ctx)
    const ids = meetingItems(board, before)
    expect(ids.map((id) => board.items.find((i) => i.id === id)!.text)).toEqual(['New'])
  })

  it('goes in one frame around it all', () => {
    const start = applyOps(emptyBoard(), [{ op: 'createNote', text: 'Old', at: { x: 0, y: 0 } }], ctx)
    const before = new Set(start.board.items.map((i) => i.id))
    const { board } = applyOps(start.board, [{ op: 'createNote', text: 'A' }, { op: 'createTable', title: 'Decisions and actions', columns: ['Type', 'What', 'Who', 'When'] }], ctx)
    const ids = meetingItems(board, before)
    const framed = applyOps(board, [{ op: 'createFrame', title: 'Launch planning', around: ids }], ctx).board
    const frame = framed.items.find((i) => i.kind === 'frame')!
    expect(frame.text).toBe('Launch planning')
    for (const id of ids) {
      const i = framed.items.find((x) => x.id === id)!
      expect(i.x >= frame.x && i.y >= frame.y && i.x + i.w <= frame.x + frame.w && i.y + i.h <= frame.y + frame.h).toBe(true)
    }
    // What was there before stays outside.
    const old = framed.items.find((i) => i.text === 'Old')!
    expect(old.x + old.w <= frame.x || old.y + old.h <= frame.y).toBe(true)
  })
})

describe('the meeting’s title', () => {
  it('is read from the assistant’s last words', () => {
    expect(meetingTitle('Title: Q3 launch planning\nAdded a summary.')).toBe('Q3 launch planning')
    expect(meetingTitle('**Title:** “Hiring plan for the data team”.')).toBe('Hiring plan for the data team')
    expect(meetingTitle('Done.\n\ntitle: Budget review')).toBe('Budget review')
  })

  it('is nothing when it gave none', () => {
    expect(meetingTitle('Tidied the notes and added a summary.')).toBeNull()
    expect(meetingTitle('Title:   ')).toBeNull()
  })

  it('says the day when there’s no other', () => {
    expect(untitledMeeting(Date.UTC(2026, 10, 10, 12), 'en-GB')).toBe('Meeting, 10 Nov 2026')
  })
})
