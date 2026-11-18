/**
 * Every object's parts are each their own. A board is made of objects, and most objects of parts
 * told apart by an id (a table's rows, a Kanban board's cards, a timeline's spans, a database's
 * records, a sequence's messages, a mind map's ideas). Two parts sharing an id show double, and
 * change as one; a part that points at one that isn't there draws nothing or breaks. These tests
 * put every kind of object through the ways it's made and rewritten, with names and titles that
 * repeat, and check the whole board each time.
 */

import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from '../api/ops'
import { Editor } from '../editor/Editor'
import { tourBoard } from '../store/guide'
import { approxMeasure } from './approxMeasure'
import { emptyBoard } from './board'
import { layoutAll } from './mindmap'
import { fromJson, toJson } from './serialize'
import { TEMPLATES, boardFromTemplate } from './templates'
import type { Board, Id } from './types'

const measure = approxMeasure
const ctx = { measure, now: Date.parse('2026-11-17T10:00:00Z') }

/** What's wrong with a board's parts, in words; nothing when all is well. */
export function partProblems(b: Board): string[] {
  const out: string[] = []
  const twice = (ids: readonly (string | number)[]) => [...new Set(ids.filter((x, k) => ids.indexOf(x) !== k))]
  const own = (what: string, ids: readonly (string | number)[]) => {
    const again = twice(ids)
    if (again.length) out.push(`${what}: ${again.length} id${again.length > 1 ? 's' : ''} shared (${again.slice(0, 3).join(', ')})`)
  }
  const items = new Map(b.items.map((i) => [i.id, i]))
  own('objects', b.items.map((i) => i.id))
  own('lines', b.connectors.map((c) => c.id))
  const most = Math.max(0, ...b.items.map((i) => i.id), ...b.connectors.map((c) => c.id))
  if (b.nextId <= most) out.push(`the next id (${b.nextId}) is one already used (up to ${most})`)
  for (const c of b.connectors) if (!items.has(c.from) || !items.has(c.to)) out.push(`line ${c.id} joins an object that isn't there`)
  own('databases', (b.datasets ?? []).map((d) => d.id))
  for (const d of b.datasets ?? []) {
    own(`database "${d.name}" fields`, d.fields.map((f) => f.id))
    own(`database "${d.name}" records`, d.records.map((r) => r.id))
    for (const f of d.fields) if (f.options) own(`database "${d.name}" field "${f.name}" choices`, f.options.map((o) => o.id))
    for (const r of d.records) for (const k of Object.keys(r.values)) if (!d.fields.some((f) => f.id === k)) out.push(`database "${d.name}": a record has a value for a field that isn't there`)
    for (const a of d.automations ?? []) {
      const fields = ['field' in a.when ? a.when.field : undefined, ...a.set.map((s) => s.field)].filter((x): x is string => !!x)
      for (const f of fields) if (!d.fields.some((x) => x.id === f)) out.push(`database "${d.name}": a rule is about a field that isn't there`)
    }
  }
  for (const i of b.items) {
    const name = `${i.kind} ${i.id} "${i.text.slice(0, 24)}"`
    if (i.kind === 'mind' && i.parent !== undefined) {
      if (items.get(i.parent)?.kind !== 'mind') out.push(`${name}: its parent idea isn't there`)
      const seen = new Set<Id>([i.id])
      for (let p = i.parent as Id | undefined; p !== undefined; p = items.get(p)?.parent) {
        if (seen.has(p)) {
          out.push(`${name}: its ideas go round in a ring`)
          break
        }
        seen.add(p)
      }
    }
    if (i.table) {
      own(`${name} columns`, i.table.columns.map((c) => c.id))
      own(`${name} rows`, i.table.rows.map((r) => r.id))
      if (i.table.sort && !i.table.columns.some((c) => c.id === i.table!.sort!.column)) out.push(`${name}: sorted by a column that isn't there`)
      for (const k of Object.keys(i.table.filters ?? {})) if (!i.table.columns.some((c) => c.id === k)) out.push(`${name}: filtered by a column that isn't there`)
    }
    if (i.kanban) {
      own(`${name} columns`, i.kanban.columns.map((c) => c.id))
      own(`${name} cards`, i.kanban.columns.flatMap((c) => c.cards.map((x) => x.id)))
    }
    if (i.timeline) {
      const t = i.timeline
      own(`${name} lanes`, t.lanes.map((l) => l.id))
      own(`${name} spans`, t.entries.map((e) => e.id))
      for (const e of t.entries) {
        if (!t.lanes.some((l) => l.id === e.lane)) out.push(`${name}: "${e.title}" is in a lane that isn't there`)
        for (const a of e.after ?? []) if (!t.entries.some((x) => x.id === a)) out.push(`${name}: "${e.title}" waits for a span that isn't there`)
      }
      for (const s of t.sources ?? []) if (items.get(s)?.kind !== 'kanban') out.push(`${name}: shows the cards of a Kanban board that isn't there`)
    }
    if (i.sequence) {
      const s = i.sequence
      own(`${name} lanes`, s.lanes.map((l) => l.id))
      own(`${name} messages`, s.steps.map((x) => x.id))
      own(`${name} boxes`, (s.boxes ?? []).map((x) => x.id))
      for (const x of s.steps) if (!s.lanes.some((l) => l.id === x.from) || !s.lanes.some((l) => l.id === x.to)) out.push(`${name}: "${x.text}" goes to or from a lane that isn't there`)
      for (const box of s.boxes ?? []) for (const at of [box.first, box.last, ...(box.elses ?? []).map((e) => e.before)]) if (!s.steps.some((x) => x.id === at)) out.push(`${name}: a box is round a message that isn't there`)
    }
    if (i.view) {
      const d = b.datasets?.find((x) => x.id === i.view!.dataset)
      if (!d) out.push(`${name}: shows a database that isn't there`)
      else for (const f of [i.view.groupBy, i.view.start, i.view.end, i.view.sort?.field, ...(i.view.hidden ?? [])]) if (f && !d.fields.some((x) => x.id === f)) out.push(`${name}: uses a field that isn't there`)
    }
  }
  return out
}

/** A board checked every way: its parts, that reading it back changes nothing, and that laying it out again does nothing. */
function sound(b: Board, what: string) {
  expect(partProblems(b), what).toEqual([])
  const back = fromJson(toJson(b))
  expect(back.items, `${what}: read back`).toEqual(b.items)
  expect(back.datasets ?? [], `${what}: read back`).toEqual(b.datasets ?? [])
  expect(back.connectors, `${what}: read back`).toEqual(b.connectors)
  expect(layoutAll(b, measure), `${what}: laid out again`).toBe(b)
}

const run = (ops: Op[], board = emptyBoard()) => applyOps(board, ops, ctx)
const idOf = (b: Board, kind: string, text?: string) => b.items.find((i) => i.kind === kind && (text === undefined || i.text === text))!.id

describe('the checker itself', () => {
  it('sees parts that share an id, and parts that point nowhere', () => {
    const { board } = run([
      { op: 'createTable', title: 'T', columns: ['A', 'B'], rows: [['1', '2'], ['3', '4']] },
      { op: 'createKanban', title: 'K', columns: [{ title: 'To do', cards: ['a', 'b'] }] },
      { op: 'createTimeline', title: 'L', lanes: [{ name: 'Sam', entries: [{ title: 'x', start: '2026-11-17' }, { title: 'y', start: '2026-11-18' }] }] },
    ] as Op[])
    expect(partProblems(board)).toEqual([])
    const broken: Board = {
      ...board,
      items: board.items.map((i) => {
        if (i.table) return { ...i, table: { ...i.table, rows: i.table.rows.map((r) => ({ ...r, id: 'same' })), sort: { column: 'gone', dir: 'asc' as const } } }
        if (i.kanban) return { ...i, kanban: { columns: i.kanban.columns.map((c) => ({ ...c, cards: c.cards.map((x) => ({ ...x, id: 'same' })) })) } }
        if (i.timeline) return { ...i, timeline: { ...i.timeline, entries: i.timeline.entries.map((e) => ({ ...e, lane: 'gone', after: ['nobody'] })), sources: [999] } }
        return i
      }),
      nextId: 1,
    }
    const found = partProblems(broken).join('\n')
    for (const word of ['rows: 1 id shared', 'sorted by a column that isn\'t there', 'cards: 1 id shared', 'in a lane that isn\'t there', 'waits for a span that isn\'t there', 'Kanban board that isn\'t there', 'the next id']) expect(found).toContain(word)
  })
})

describe('boards the app makes itself are sound', () => {
  it('the tour board', () => {
    sound(layoutAll(tourBoard(measure, ctx.now).board, measure), 'tour')
  })

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('the %s template', (_id, t) => {
    sound(boardFromTemplate(t, measure), t.id)
  })
})

describe('every kind of object keeps its parts apart, however alike they’re called', () => {
  it('a table made and rewritten with rows and columns that repeat', () => {
    let { board } = run([{ op: 'createTable', title: 'T', columns: ['Type', 'What', 'What'], rows: [['Action', 'a', 'x'], ['Action', 'a', 'x'], ['Action', 'b', ''], ['', '', '']] }] as Op[])
    sound(board, 'made')
    const id = idOf(board, 'table')
    for (const rows of [[['Action', 'a', 'x'], ['Action', 'a', 'x'], ['Action', 'a', 'x']], [['', '', ''], ['', '', '']], [], [['Action', 'b', ''], ['Action', 'a', 'x']]]) {
      board = run([{ op: 'setTable', id, columns: ['What', 'Type', 'What', 'Type'], rows }] as Op[], board).board
      sound(board, `rewritten with ${rows.length} rows`)
      expect(board.items.find((i) => i.id === id)!.table!.rows).toHaveLength(rows.length)
    }
  })

  it('a Kanban board made and rewritten with cards and columns that repeat', () => {
    let { board } = run([{ op: 'createKanban', title: 'K', columns: [{ title: 'To do', cards: ['Follow up', 'Follow up', { title: 'Follow up', due: '2026-11-20' }] }, { title: 'To do', cards: ['Follow up'] }, { title: 'Done' }] }] as Op[])
    sound(board, 'made')
    const id = idOf(board, 'kanban')
    for (const columns of [
      [{ title: 'Done', cards: ['Follow up', 'Follow up'] }, { title: 'To do', cards: ['Follow up', 'Follow up', 'Follow up'] }, { title: 'To do' }],
      [{ title: 'Only', cards: ['Follow up'] }],
      [{ title: 'A' }, { title: 'A' }, { title: 'A', cards: ['x', 'x', 'x', 'x'] }],
    ]) {
      board = run([{ op: 'setKanban', id, columns }] as Op[], board).board
      sound(board, 'rewritten')
      const cards = board.items.find((i) => i.id === id)!.kanban!.columns.flatMap((c) => c.cards)
      expect(cards).toHaveLength(columns.reduce((n, c) => n + ((c as { cards?: unknown[] }).cards?.length ?? 0), 0))
    }
  })

  it('a timeline made and rewritten with lanes and spans that repeat', () => {
    const span = (title: string, day: number, more: object = {}) => ({ title, start: `2026-11-${10 + day}`, end: `2026-11-${12 + day}`, ...more })
    let { board } = run([{ op: 'createTimeline', title: 'L', lanes: [{ name: 'Sam', entries: [span('Prep', 1, { hours: 8 }), span('Prep', 3), span('Prep', 5)] }, { name: 'Sam', entries: [span('Prep', 1)] }, { name: 'Priya' }] }] as Op[])
    sound(board, 'made')
    const id = idOf(board, 'timeline')
    for (const lanes of [
      [{ name: 'Priya', entries: [span('Prep', 1), span('Prep', 2)] }, { name: 'Sam', entries: [span('Prep', 1), span('Prep', 1), span('Prep', 1), span('Prep', 1)] }],
      [{ name: 'Sam' }, { name: 'Sam' }, { name: 'Sam', entries: [span('Prep', 1)] }],
      [{ name: 'New', entries: [span('Prep', 4), span('Other', 4)] }],
    ]) {
      board = run([{ op: 'setTimeline', id, lanes }] as Op[], board).board
      sound(board, 'rewritten')
      expect(board.items.find((i) => i.id === id)!.timeline!.entries).toHaveLength(lanes.reduce((n, l) => n + ((l as { entries?: unknown[] }).entries?.length ?? 0), 0))
    }
  })

  it('a database made, added to and changed, with fields, choices and records that repeat', () => {
    let { board } = run([
      { op: 'createDatabase', title: 'D', fields: ['Name', { name: 'Stage', type: 'select', options: ['To do', 'To do', 'Done'] }, 'Name'], records: [{ Name: 'Venue', Stage: 'To do' }, { Name: 'Venue', Stage: 'Done' }, { Name: 'Venue' }], views: ['table', 'board', 'timeline'], groupBy: 'Stage' },
    ] as Op[])
    sound(board, 'made')
    const id = idOf(board, 'data')
    board = run([{ op: 'addRecords', id, records: [{ Name: 'Venue', Stage: 'New stage' }, { Name: 'Venue' }] }, { op: 'addField', id, field: { name: 'Stage', type: 'select', options: ['A', 'A'] } }, { op: 'addField', id, field: { name: 'Notes' } }] as Op[], board).board
    sound(board, 'added to')
    const ds = board.datasets![0]
    expect(ds.records).toHaveLength(5)
    // Changing or deleting "Venue" by name is about one record, not all five.
    board = run([{ op: 'updateRecord', id, record: 'Venue', values: { Notes: 'changed' } }] as Op[], board).board
    sound(board, 'one changed')
    const notes = board.datasets![0].fields.find((f) => f.name === 'Notes')!.id
    expect(board.datasets![0].records.filter((r) => r.values[notes] === 'changed')).toHaveLength(1)
    board = run([{ op: 'deleteRecords', id, records: ['Venue'] }] as Op[], board).board
    sound(board, 'one deleted')
    expect(board.datasets![0].records).toHaveLength(4)
  })

  it('a sequence made and rewritten with people and messages that repeat', () => {
    const text = (n: number) => ['sequenceDiagram', 'participant A as Sam', 'participant B as Sam', ...Array.from({ length: n }, () => 'A->>B: Hello'), 'loop Again', 'B-->>A: Hello', 'end'].join('\n')
    let { board } = run([{ op: 'createSequence', mermaid: text(3) }] as Op[])
    sound(board, 'made')
    const id = idOf(board, 'sequence')
    for (const n of [5, 1, 0, 4]) {
      board = run([{ op: 'setSequence', id, mermaid: text(n) }] as Op[], board).board
      sound(board, `rewritten with ${n}`)
      expect(board.items.find((i) => i.id === id)!.sequence!.steps).toHaveLength(n + 1)
    }
  })

  it('a mind map made and rewritten with ideas that repeat', () => {
    let { board } = run([{ op: 'createMindMap', outline: 'Launch\n  Risks\n    Cost\n    Cost\n  Risks\n    Cost\n  Risks' }] as Op[])
    sound(board, 'made')
    expect(board.items.filter((i) => i.kind === 'mind')).toHaveLength(7)
    const root = board.items.find((i) => i.kind === 'mind' && i.parent === undefined)!.id
    for (const [outline, count] of [
      ['Launch\n  Risks\n    Cost\n  Risks\n    Cost\n    Cost\n    Cost', 7],
      ['Launch\n  Cost\n  Cost\n  Cost', 4],
      ['Launch', 1],
      ['Launch\n  Risks\n    Risks\n      Risks\n        Risks', 5],
    ] as const) {
      board = run([{ op: 'setMindMap', id: root, outline }] as Op[], board).board
      sound(board, 'rewritten')
      expect(board.items.filter((i) => i.kind === 'mind')).toHaveLength(count)
    }
    board = run([{ op: 'addIdeas', parent: root, ideas: 'Risks\nRisks\n  Cost\n  Cost' }] as Op[], board).board
    sound(board, 'added to')
  })

  it('a flowchart made, added to and rewritten with steps that repeat', () => {
    const chart = (n: number) => ['flowchart TD', 'A[Check] --> B{OK?}', 'B -->|Yes| C[Check]', 'B -->|No| D[Check]', ...Array.from({ length: n }, (_, k) => `D --> E${k}[Check]`)].join('\n')
    let { board } = run([{ op: 'createFlowchart', mermaid: chart(2) }] as Op[])
    sound(board, 'made')
    for (const n of [4, 0, 3]) {
      // Rewritten, a chart is new shapes: any one of those there now says which chart.
      board = run([{ op: 'setFlowchart', id: board.items.find((i) => i.kind === 'flow')!.id, mermaid: chart(n) }] as Op[], board).board
      sound(board, `rewritten with ${n}`)
      expect(board.items.filter((i) => i.kind === 'flow')).toHaveLength(4 + n)
      expect(board.connectors).toHaveLength(3 + n)
    }
    const any = board.items.find((i) => i.kind === 'flow')!.id
    board = run([{ op: 'addSteps', after: any, steps: ['Check', 'Check', { text: 'Check', shape: 'decision' }] }] as Op[], board).board
    sound(board, 'added to')
  })

  it('everything else: notes, shapes, frames, votes, spinners, links, code, comments, lines', () => {
    const { board } = run([
      { op: 'createNote', ref: 'a', text: 'Same' },
      { op: 'createNote', ref: 'b', text: 'Same' },
      { op: 'createShape', ref: 'c', text: 'Same' },
      { op: 'createText', text: 'Same' },
      { op: 'createFrame', title: 'Same', around: ['a', 'b'] },
      { op: 'createFrame', title: 'Same', around: ['a', 'b'] },
      { op: 'createSpinner', options: ['Same', 'Same', 'Same'] },
      { op: 'createVote', options: ['a', 'b', 'a'], question: 'Same' },
      { op: 'createLink', url: 'https://example.org/' },
      { op: 'createLink', url: 'https://example.org/' },
      { op: 'createCode', code: 'same()', lang: 'js' },
      { op: 'createComment', text: 'Same' },
      { op: 'connect', from: 'a', to: 'b' },
      { op: 'connect', from: 'c', to: 'a', label: 'Same' },
      { op: 'connect', from: 'c', to: 'b', label: 'Same' },
      { op: 'addComment', id: 'a', text: 'Same' },
      { op: 'addComment', id: 'a', text: 'Same' },
    ] as Op[])
    sound(board, 'made')
    // Deleting what lines are joined to takes the lines too, and leaves the rest sound.
    const gone = run([{ op: 'delete', ids: [board.items.find((i) => i.text === 'Same' && i.kind === 'sticky')!.id] }] as Op[], board).board
    sound(gone, 'one deleted')
  })
})

describe('copies are their own objects', () => {
  const all: Op[] = [
    { op: 'createTable', title: 'T', columns: ['A'], rows: [['1'], ['1']] },
    { op: 'createKanban', ref: 'k', title: 'K', columns: [{ title: 'To do', cards: [{ title: 'x', due: '2026-11-20' }, 'x'] }] },
    { op: 'createTimeline', title: 'L', lanes: [{ name: 'Sam', entries: [{ title: 'x', start: '2026-11-17', end: '2026-11-19' }, { title: 'y', start: '2026-11-20' }] }] },
    { op: 'createDatabase', title: 'D', fields: ['Name', { name: 'Stage', type: 'select', options: ['To do', 'Done'] }], records: [{ Name: 'Venue', Stage: 'To do' }], views: ['table', 'board'], groupBy: 'Stage' },
    { op: 'createSequence', mermaid: 'sequenceDiagram\nA->>B: Hello\nB-->>A: Hi' },
    { op: 'createMindMap', outline: 'Launch\n  Risks\n    Cost\n  Risks' },
    { op: 'createFlowchart', mermaid: 'flowchart TD\nA[Start] --> B[End]' },
    { op: 'createNote', ref: 'n', text: 'Note' },
    { op: 'createFrame', title: 'Frame', around: ['n'] },
  ] as Op[]

  it('duplicating everything on a board leaves it sound, twice over', () => {
    const e = new Editor(run(all).board, measure)
    const before = e.board.items.length
    e.selectAll()
    e.duplicate()
    sound(e.board, 'duplicated')
    expect(e.board.items.length).toBe(before * 2)
    e.selectAll()
    e.duplicate()
    sound(e.board, 'duplicated again')
    e.undo()
    e.undo()
    sound(e.board, 'undone')
    expect(e.board.items.length).toBe(before)
  })

  it('copying and pasting everything, onto the same board and onto another, leaves both sound', () => {
    const e = new Editor(run(all).board, measure)
    e.selectAll()
    const clip = e.copyText()!
    e.pasteText(clip)
    sound(e.board, 'pasted here')
    const other = new Editor(run([{ op: 'createNote', text: 'Already here' }, { op: 'createTable', title: 'T', columns: ['A'], rows: [['1']] }] as Op[]).board, measure)
    other.pasteText(clip)
    other.pasteText(clip)
    sound(other.board, 'pasted there twice')
  })
})
