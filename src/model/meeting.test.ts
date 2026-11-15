import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import * as B from './board'
import { emptyBoard } from './board'
import {
  IDEAS_TITLE,
  agendaOf,
  clock,
  glossaryOf,
  ideasOf,
  ideasTableOf,
  joinFragments,
  keepIdeas,
  keepTicks,
  meetingItems,
  meetingParts,
  meetingTitle,
  settleIdeas,
  summaryPoints,
  tickRow,
  transcriptText,
  unpicked,
  untitledMeeting,
} from './meeting'
import type { Board } from './types'
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
    expect(agendaOf(board, ids).map((a) => [a.text, a.covered])).toEqual([
      ['Venue', true],
      ['Budget', false],
    ])
    expect(agendaOf(board, [])).toEqual([])
  })

  it('ticks an agenda item by hand, and takes the tick away', () => {
    const { board, ids } = made()
    const budget = agendaOf(board, ids)[1]
    const ticked = tickRow(board, budget.table, budget.row, true)
    expect(agendaOf(ticked, ids).map((a) => a.covered)).toEqual([true, true])
    expect(agendaOf(tickRow(ticked, budget.table, budget.row, false), ids).map((a) => a.covered)).toEqual([true, false])
    // A row that isn't there changes nothing.
    expect(tickRow(board, budget.table, 'no-such-row', true)).toBe(board)
  })

  it('keeps a tick on the agenda when the assistant writes the table again without it', () => {
    const { board, ids } = made()
    const table = agendaOf(board, ids)[0].table
    const now = B.getItem(board, table)!
    // The assistant gives every row again: the venue's tick left out, the budget's added.
    const next = B.getItem(applyOps(board, [{ op: 'setTable', id: table, columns: ['Item', 'Why now', 'Covered'], rows: [['Venue', 'Due Friday', ''], ['Budget', 'Over', '✓']] }], ctx).board, table)!
    const kept = B.updateItem(board, table, () => keepTicks(now, next))
    expect(agendaOf(kept, ids).map((a) => a.covered)).toEqual([true, true])
  })
})

describe('ideas to bring up', () => {
  /** A board with the list as the assistant is asked to make it. */
  const listed = (rows: string[][], title = IDEAS_TITLE, board: Board = emptyBoard()) => {
    const out = applyOps(board, [{ op: 'createTable', title, columns: ['Idea', 'Why', 'Raised'], rows }], ctx)
    return { board: out.board, table: out.results[0].id! }
  }
  const three = () =>
    listed([
      ['Who signs off the budget?', 'Nobody was named', ''],
      ['Check the venue’s parking', 'Came up last time', '✓'],
      ['Tell support before launch', 'They take the calls', ''],
    ])
  const read = (b: Board) => ideasOf(b).map((i) => [i.text, i.raised])

  it('are read from the list, with why and whether they’ve been raised', () => {
    const { board, table } = three()
    expect(ideasOf(board).map(({ text, why, raised }) => ({ text, why, raised }))).toEqual([
      { text: 'Who signs off the budget?', why: 'Nobody was named', raised: false },
      { text: 'Check the venue’s parking', why: 'Came up last time', raised: true },
      { text: 'Tell support before launch', why: 'They take the calls', raised: false },
    ])
    expect(ideasOf(board).every((i) => i.table === table)).toBe(true)
    expect(ideasOf(emptyBoard())).toEqual([])
  })

  it('come from every list on the board, each idea once', () => {
    const first = three()
    const { board } = listed([['who signs off the budget', 'Again', ''], ['Book the photographer', 'Nobody has', '']], 'Ideas to bring up', first.board)
    expect(read(board).map(([text]) => text)).toEqual(['Who signs off the budget?', 'Check the venue’s parking', 'Tell support before launch', 'Book the photographer'])
    expect(ideasTableOf(board)).toBe(first.table)
  })

  it('are ticked by hand, in a list with or without a column for it', () => {
    const { board, table } = three()
    const idea = ideasOf(board)[0]
    expect(read(tickRow(board, table, idea.row, true))[0]).toEqual(['Who signs off the budget?', true])
    // A list someone made by hand, with only the ideas: it gets its column.
    const plain = applyOps(emptyBoard(), [{ op: 'createTable', title: 'Ideas to bring up', columns: ['Idea'], rows: [['Ask about parking']] }], ctx)
    const row = ideasOf(plain.board)[0].row
    const ticked = tickRow(plain.board, plain.results[0].id!, row, true)
    expect(read(ticked)).toEqual([['Ask about parking', true]])
    expect(B.getItem(ticked, plain.results[0].id!)!.table!.columns.map((c) => c.name)).toEqual(['Idea', 'Raised'])
  })

  it('stay on the list whatever the assistant writes: it only adds ideas and ticks them', () => {
    const { board, table } = three()
    const now = B.getItem(board, table)!
    // The assistant gives every row again, but drops one, clears a tick, ticks another, and adds one.
    const rewritten = applyOps(board, [{ op: 'setTable', id: table, columns: ['Idea', 'Why', 'Raised'], rows: [['Check the venue’s parking', '', ''], ['Tell support before launch', '', '✓'], ['Agree who presents', 'Two people think they are', '']] }], ctx).board
    const kept = B.updateItem(board, table, () => keepIdeas(now, B.getItem(rewritten, table)!))
    expect(read(kept)).toEqual([
      ['Who signs off the budget?', false],
      ['Check the venue’s parking', true],
      ['Tell support before launch', true],
      ['Agree who presents', false],
    ])
    expect(ideasOf(kept)[3].why).toBe('Two people think they are')
    // Their words and reasons are as they were.
    expect(ideasOf(kept)[1].why).toBe('Came up last time')
    // Tall enough for the row it gained.
    expect(B.getItem(kept, table)!.h).toBeGreaterThan(now.h)
  })

  it('is left as it was when the assistant changes nothing, or makes it something else', () => {
    const { board, table } = three()
    const now = B.getItem(board, table)!
    expect(keepIdeas(now, now)).toBe(now)
    expect(keepIdeas(now, { ...now, kind: 'sticky', table: undefined })).toBe(now)
  })

  it('takes no more than a couple of dozen open ideas', () => {
    const { board, table } = listed(Array.from({ length: 23 }, (_, k) => [`Idea ${k}`, '', '']))
    const now = B.getItem(board, table)!
    const more = applyOps(board, [{ op: 'setTable', id: table, columns: ['Idea', 'Why', 'Raised'], rows: [['One more', '', ''], ['And another', '', ''], ['Already talked about', '', '✓']] }], ctx).board
    const kept = keepIdeas(now, B.getItem(more, table)!)
    const texts = kept.table!.rows.map((r) => Object.values(r.cells)[0])
    expect(texts).toContain('One more')
    expect(texts).not.toContain('And another')
    // One that's been raised doesn't count against the open ones.
    expect(texts).toContain('Already talked about')
  })

  it('that were raised go when the meeting ends; the rest are kept', () => {
    const { board, table } = three()
    const settled = settleIdeas(board)
    expect(settled.table).toBe(table)
    expect(read(settled.board)).toEqual([
      ['Who signs off the budget?', false],
      ['Tell support before launch', false],
    ])
    expect(B.getItem(settled.board, table)!.h).toBeLessThan(B.getItem(board, table)!.h)
  })

  it('end up in one list when the assistant made a second', () => {
    const first = three()
    const second = listed([['Book the photographer', 'Nobody has', ''], ['Who signs off the budget?', '', ''], ['Done already', '', '✓']], 'Ideas to bring up', first.board)
    const settled = settleIdeas(second.board)
    expect(settled.table).toBe(first.table)
    expect(settled.board.items.filter((i) => i.kind === 'table')).toHaveLength(1)
    expect(ideasOf(settled.board).map((i) => [i.text, i.why])).toEqual([
      ['Who signs off the budget?', 'Nobody was named'],
      ['Tell support before launch', 'They take the calls'],
      ['Book the photographer', 'Nobody has'],
    ])
  })

  it('leave no list behind once every one has been raised', () => {
    const { board } = listed([['Ask about parking', '', '✓'], ['Tell support', '', 'done']])
    const settled = settleIdeas(board)
    expect(settled.table).toBeNull()
    expect(settled.board.items).toHaveLength(0)
    // And a board without a list is left as it is.
    expect(settleIdeas(emptyBoard()).table).toBeNull()
  })

  it('in a locked list are left alone', () => {
    const { board, table } = three()
    const locked = B.updateItem(board, table, (i) => ({ ...i, locked: true }))
    expect(settleIdeas(locked).board).toBe(locked)
    expect(ideasTableOf(locked)).toBeNull()
    // They're still shown.
    expect(ideasOf(locked)).toHaveLength(3)
  })

  it('are kept whatever was picked to keep from the meeting', () => {
    const { board, table } = three()
    const parts = meetingParts(board, [table])
    expect([...parts.notes, ...parts.kanban, ...parts.collage]).toEqual([])
    expect(unpicked(board, [table], { collage: false, kanban: false, notes: false, timeline: false })).toEqual([])
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
