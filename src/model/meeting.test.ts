import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { emptyBoard } from './board'
import { agendaOf, clock, glossaryOf, joinFragments, meetingItems, meetingParts, meetingTitle, summaryPoints, transcriptText, unpicked, untitledMeeting } from './meeting'
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

describe('what to keep when a meeting ends', () => {
  const made = () => {
    const { board, results } = applyOps(
      emptyBoard(),
      [
        { op: 'createMindMap', outline: 'Launch\n  Venue' },
        { op: 'createTable', title: 'Decisions and actions', columns: ['Type', 'What'], rows: [['Action', 'Book it']] },
        { op: 'createTable', title: 'Agenda', columns: ['Item', 'Why now', 'Covered'], rows: [['Venue', 'Due Friday', '✓'], ['Budget', 'Over', '']] },
        { op: 'createKanban', title: 'Actions', columns: [{ title: 'To do', cards: ['Book it'] }] },
        { op: 'createTimeline', title: 'Plan' },
        { op: 'createNote', text: 'Transcript' },
      ],
      ctx,
    )
    return { board, ids: board.items.map((i) => i.id), transcript: results[5].id! }
  }

  it('sorts what it made into the notes, the Kanban and the collage', () => {
    const { board, ids, transcript } = made()
    const parts = meetingParts(board, ids, new Set([transcript]))
    const kinds = (list: number[]) => list.map((id) => board.items.find((i) => i.id === id)!.kind)
    expect(kinds(parts.notes)).toEqual(['mind', 'mind', 'table', 'table'])
    expect(kinds(parts.kanban)).toEqual(['kanban'])
    expect(kinds(parts.collage)).toEqual(['timeline'])
  })

  it('takes away only what wasn’t picked, never the transcript', () => {
    const { board, ids, transcript } = made()
    expect(unpicked(board, ids, { collage: true, kanban: true, notes: true, timeline: true }, new Set([transcript]))).toEqual([])
    const drop = unpicked(board, ids, { collage: false, kanban: true, notes: false, timeline: false }, new Set([transcript]))
    expect(drop.map((id) => board.items.find((i) => i.id === id)!.kind).sort()).toEqual(['mind', 'mind', 'table', 'table', 'timeline'])
    expect(drop).not.toContain(transcript)
  })

  it('reads the agenda, and what’s been covered', () => {
    const { board, ids } = made()
    expect(agendaOf(board, ids)).toEqual([
      { text: 'Venue', covered: true },
      { text: 'Budget', covered: false },
    ])
    expect(agendaOf(board, [])).toEqual([])
  })
})

describe('a meeting’s transcript', () => {
  it('takes the summary from the list after the title', () => {
    expect(summaryPoints('Title: Launch\n- Moved to **May**\n* Brian books the venue\nThen some words.\n1. Budget open')).toEqual(['Moved to May', 'Brian books the venue', 'Budget open'])
  })

  it('has every line with when and who said it, and people’s words only', () => {
    const text = transcriptText({
      lines: [
        { at: 1000, who: 'Jo', text: 'Shall we move it?' },
        { at: 4000, who: 'Jo', text: 'To May, I mean.' },
        { at: 65_000, who: 'Brian', text: 'Yes.' },
        { at: 70_000, text: 'Who said that?' },
      ],
    })
    expect(text).toBe(['Transcript', '[0:01] Jo: Shall we move it?', '[0:04] To May, I mean.', '[1:05] Brian: Yes.', '[1:10] Who said that?'].join('\n'))
  })

  it('puts back together lines a pause cut mid-sentence', () => {
    const lines = joinFragments([
      { at: 0, voice: 1, text: 'We should move the launch' },
      { at: 2000, voice: 1, text: 'To May because of the venue.' },
      { at: 4000, voice: 1, text: 'Agreed?' },
      { at: 5000, voice: 2, text: 'I think' },
      { at: 30_000, voice: 2, text: 'so, later.' },
      { at: 31_000, voice: 1, text: 'And the budget' },
      { at: 32_000, voice: 2, text: 'is fine.' },
    ])
    expect(lines.map((l) => l.text)).toEqual(['We should move the launch to May because of the venue.', 'Agreed?', 'I think', 'so, later.', 'And the budget', 'is fine.'])
    expect(lines[0].at).toBe(0)
  })

  it('stops short of what a note can hold', () => {
    const lines = Array.from({ length: 500 }, (_, k) => ({ at: k * 1000, text: 'words '.repeat(20) }))
    const text = transcriptText({ lines, max: 5000 })
    expect(text.length).toBeLessThanOrEqual(5000)
    expect(text.endsWith('(the rest is in the meeting’s replay)')).toBe(true)
  })

  it('tells the time like a clock', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(65_400)).toBe('1:05')
    expect(clock(3_725_000)).toBe('1:02:05')
  })
})

describe('the words in use, for speech to text', () => {
  it('takes people’s names and the names of things, not common words, keys or sentence starts', () => {
    const b = applyOps(
      emptyBoard(),
      [
        { op: 'createNote', text: 'Press Ctrl K to open Your boards' },
        { op: 'createNote', text: 'Move the Kubernetes cluster to AWS before Q3.\nThe GraphQL gateway stays' },
        { op: 'createNote', text: '• Decided\n• Launch with Acme Corp' },
      ],
      ctx,
    ).board
    expect(glossaryOf(b, ['Sam', 'Voice 2'])).toEqual(['Sam', 'Kubernetes', 'AWS', 'Q3', 'GraphQL', 'Acme', 'Corp'])
  })
})
