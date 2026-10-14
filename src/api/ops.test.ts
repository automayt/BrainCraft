import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, getItem, newItem } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { toOutline } from '../model/mindmap'
import { type Op, OpError, applyOps, opsFromText } from './ops'

const ctx = { measure: fakeMeasure, now: 1_000 }
const run = (ops: Op[], board = emptyBoard()) => applyOps(board, ops, ctx)

describe('operations API', () => {
  it('creates every kind of object and links them by ref', () => {
    const { board, results } = run([
      { op: 'createNote', ref: 'idea', text: 'Ship faster', color: 'yellow' },
      { op: 'createMindMap', ref: 'map', outline: 'Goals\n  Speed\n  Quality' },
      { op: 'createFlowchart', ref: 'flow', mermaid: 'flowchart TD\n a([Start]) --> b[Build]' },
      { op: 'createTable', ref: 'tbl', columns: ['Task', 'Owner'], rows: [['Plan', 'Ana'], ['Build', 42]] },
      { op: 'createKanban', ref: 'kb', columns: [{ title: 'To do', cards: ['A', { title: 'B', due: '2026-10-20' }] }, { title: 'Done' }] },
      { op: 'createTimeline', lanes: [{ name: 'Q4', entries: [{ title: 'Beta', start: '2026-10-01', end: '2026-10-15' }] }], followKanban: ['kb'] },
      { op: 'createComment', text: 'Review on Friday' },
      { op: 'connect', from: 'idea', to: 'map', label: 'drives' },
      { op: 'addComment', id: 'tbl', text: 'Numbers are estimates', author: 'Ana' },
      { op: 'createFrame', title: 'Planning', around: ['idea', 'map'] },
    ])
    expect(results.map((r) => r.op)).toEqual([
      'createNote',
      'createMindMap',
      'createFlowchart',
      'createTable',
      'createKanban',
      'createTimeline',
      'createComment',
      'connect',
      'addComment',
      'createFrame',
    ])
    const note = getItem(board, results[0].id!)!
    expect(note).toMatchObject({ kind: 'sticky', color: '#fff9b1' })
    expect(toOutline(board, results[1].id!)).toBe('- Goals\n  - Speed\n  - Quality')
    expect(results[2].ids).toHaveLength(2)
    const table = getItem(board, results[3].id!)!.table!
    expect(table.rows[1].cells[table.columns[1].id]).toBe('42')
    expect(getItem(board, results[3].id!)!.notes).toMatchObject([{ text: 'Numbers are estimates', author: 'Ana', at: 1000 }])
    expect(getItem(board, results[4].id!)!.kanban!.columns[0].cards[1]).toMatchObject({ title: 'B', due: '2026-10-20' })
    expect(getItem(board, results[5].id!)!.timeline!.sources).toEqual([results[4].id])
    expect(board.connectors.find((c) => c.label === 'drives')).toBeTruthy()
    // The frame is sent to the back, around the note and mind map.
    expect(board.items[0].kind).toBe('frame')
  })

  it('stacks unplaced objects to the right of existing content without overlap', () => {
    let start = emptyBoard()
    ;[start] = addItem(start, newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }))
    const { board, results } = run(
      [
        { op: 'createNote', text: 'a' },
        { op: 'createNote', text: 'b', at: { x: -500, y: -500 } },
        { op: 'createNote', text: 'c' },
      ],
      start,
    )
    const [a, b, c] = results.map((r) => getItem(board, r.id!)!)
    expect(a.x).toBeGreaterThan(100)
    expect(b).toMatchObject({ x: -500, y: -500 })
    expect(c.x).toBe(a.x)
    expect(c.y).toBeGreaterThanOrEqual(a.y + a.h)
  })

  it('updates and deletes, removing whole mind-map branches', () => {
    const made = run([{ op: 'createMindMap', ref: 'm', outline: 'Root\n  Child\n    Grandchild' }, { op: 'createNote', ref: 'n', text: 'x' }])
    const root = made.results[0].id!
    const note = made.results[1].id!
    const { board } = run([{ op: 'update', id: note, text: 'y', x: 5 }, { op: 'delete', ids: [root] }], made.board)
    expect(getItem(board, note)).toMatchObject({ text: 'y', x: 5 })
    expect(board.items.filter((i) => i.kind === 'mind')).toHaveLength(0)
  })

  it('rejects bad batches with a clear message and changes nothing', () => {
    const board = emptyBoard()
    const bad = (ops: unknown[], message: RegExp) => expect(() => applyOps(board, ops as Op[], ctx)).toThrow(message)
    bad([{ op: 'createNote', text: 'a' }, { op: 'connect', from: 'nope', to: 1 }], /Operation 2 \(connect\): "from" refers to "nope"/)
    bad([{ op: 'explode' }], /unknown operation/)
    bad([{ op: 'createFlowchart', mermaid: 'pie' }], /Operation 1.*flowchart/)
    bad([{ op: 'createTimeline', lanes: [{ name: 'x', entries: [{ title: 't', start: 'soon' }] }] }], /date like/)
    bad([{ op: 'createTable', columns: [] }], /columns/)
    expect(() => applyOps(board, [{ op: 'createNote', text: 'a' }, { op: 'delete', ids: [99] }], ctx)).toThrow(OpError)
    expect(board.items).toHaveLength(0)
  })

  it('reads operations from pasted JSON', () => {
    expect(opsFromText('{"ops":[{"op":"createNote","text":"x"}]}')).toHaveLength(1)
    expect(opsFromText('[{"op":"createNote","text":"x"}]')).toHaveLength(1)
    expect(opsFromText('{"op":"createNote","text":"x"}')).toHaveLength(1)
    expect(opsFromText('{"hello":1}')).toBeNull()
    expect(opsFromText('not json')).toBeNull()
  })
})
