import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, getItem, newItem } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { toOutline } from '../model/mindmap'
import { type Op, OpError, applyOps, opsFromText } from './ops'
import { fromJson, toJson } from '../model/serialize'

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

describe('database operations', () => {
  it('creates linked views over one dataset and edits records by name', async () => {
    const { applyOps } = await import('./ops')
    const { emptyBoard } = await import('../model/board')
    const { fakeMeasure } = await import('../model/test-helpers')
    const D = await import('../model/dataset')
    let { board, results } = applyOps(
      emptyBoard(),
      [
        {
          op: 'createDatabase',
          ref: 'db',
          title: 'Roadmap',
          records: [
            { Feature: 'SSO', Status: 'Doing', Owner: 'Sam', Start: '2026-10-01', End: '2026-10-20', Points: 5 },
            { Feature: 'Exports', Status: 'To do', Owner: 'Jo', Start: '2026-10-15', End: '2026-11-02', Points: 3 },
            { Feature: 'Audit log', Status: 'To do', Owner: 'Sam', Start: '2026-11-01', End: '2026-11-30', Points: 8 },
          ],
          views: ['table', 'board', 'timeline'],
          groupBy: 'Status',
        },
        { op: 'addRecords', id: 'db', records: [{ Feature: 'Billing', Status: 'Blocked' }] },
        { op: 'updateRecord', id: 'db', record: 'sso', values: { Status: 'Done', Points: null } },
        { op: 'deleteRecords', id: 'db', records: ['Exports'] },
      ],
      { measure: fakeMeasure },
    )
    expect(results[0].ids).toHaveLength(3)
    expect(board.datasets).toHaveLength(1)
    const ds = board.datasets![0]
    expect(ds.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['Feature:text', 'Status:select', 'Owner:person', 'Start:date', 'End:date', 'Points:number'])
    expect(D.plainRecords(ds).map((r) => [r.Feature, r.Status, r.Points ?? null])).toEqual([
      ['SSO', 'Done', null],
      ['Audit log', 'To do', 8],
      ['Billing', 'Blocked', null],
    ])
    const views = board.items.filter((i) => i.kind === 'data')
    expect(views.map((v) => v.view!.type)).toEqual(['table', 'board', 'timeline'])
    expect(new Set(views.map((v) => v.view!.dataset)).size).toBe(1)
    expect(views[1].view!.groupBy).toBe(ds.fields[1].id)

    expect(() => applyOps(board, [{ op: 'addRecords', id: views[0].id, records: [{ Colour: 'red' }] }], { measure: fakeMeasure })).toThrow(/unknown field "Colour"\. Fields: Feature, Status/)
    ;({ board } = applyOps(board, [{ op: 'delete', ids: views.map((v) => v.id) }], { measure: fakeMeasure }))
    expect(board.datasets ?? []).toHaveLength(0)
  })

  it('makes a sample database when given nothing', async () => {
    const { applyOps } = await import('./ops')
    const { emptyBoard } = await import('../model/board')
    const { fakeMeasure } = await import('../model/test-helpers')
    const { board } = applyOps(emptyBoard(), [{ op: 'createDatabase', title: 'Work' }], { measure: fakeMeasure })
    expect(board.datasets![0].name).toBe('Work')
    expect(board.datasets![0].records.length).toBeGreaterThan(0)
  })
})

describe('operations with fields of the wrong type', () => {
  // A working example of each operation; every field is then swapped for junk.
  const base = () => {
    const b = run([{ op: 'createNote', text: 'one' }, { op: 'createNote', text: 'two' }]).board
    return run([{ op: 'createKanban', columns: [{ title: 'To do', cards: ['a'] }] }], b).board
  }
  const examples: Op[] = [
    { op: 'createNote', text: 'a', w: 100, h: 100, color: 'yellow', at: { x: 0, y: 0 } },
    { op: 'createText', text: 'a', fontSize: 20, w: 100 },
    { op: 'createShape', text: 'a', shape: 'rect', w: 100, h: 50, color: 'blue' },
    { op: 'createFrame', title: 'f', around: [1, 2] },
    { op: 'createMindMap', tree: { text: 'r', children: [{ text: 'c', children: [] }] } },
    { op: 'createTable', title: 't', columns: ['a', 'b'], rows: [['1', '2']] },
    { op: 'createKanban', title: 'k', columns: [{ title: 'c', cards: ['x', { title: 'y', due: '2026-10-10', color: 'red' }] }] },
    { op: 'createTimeline', title: 't', lanes: [{ name: 'l', entries: [{ title: 'e', start: '2026-01-01', color: 'red' }] }], followKanban: [3] },
    { op: 'createImage', src: 'https://example.com/a.png', w: 10, h: 10 },
    { op: 'createDatabase', title: 'd', fields: ['Name', { name: 'Stage', type: 'select', options: ['a'] }], records: [{ Name: 'x' }], views: ['table'], groupBy: 'Stage' },
    { op: 'update', id: 1, text: 'b', x: 5, y: 5, w: 50, h: 50, color: 'green', status: 'done' },
    { op: 'connect', from: 1, to: 2, label: 'l', style: 'elbow' },
  ] as unknown as Op[]
  const junk: unknown[] = ['x', 7, {}, null, Number.POSITIVE_INFINITY, [null], true]

  it('either names the mistake or makes objects that survive a save and reload', () => {
    const b = base()
    for (const example of examples)
      for (const field of Object.keys(example).filter((k) => k !== 'op'))
        for (const value of junk) {
          const op = { ...example, [field]: value } as Op
          let out: ReturnType<typeof run> | undefined
          try {
            out = run([op], b)
          } catch (err) {
            if (!(err instanceof OpError)) throw new Error(`${op.op}.${field} = ${JSON.stringify(value)} threw ${(err as Error).message}`)
            continue
          }
          // Exactly as made: what's kept here is what a reload (or a friend's screen) keeps.
          const back = fromJson(toJson(out.board))
          expect(back.items, `${op.op}.${field} = ${JSON.stringify(value)}`).toEqual(out.board.items)
          expect(back.connectors, `${op.op}.${field} = ${JSON.stringify(value)}`).toEqual(out.board.connectors)
        }
  })
})

describe('placing new objects', () => {
  it('never carries existing objects along with a new frame', () => {
    const start = run([{ op: 'createNote', text: 'Already here', at: { x: 0, y: 0 } }]).board
    const before = start.items[0]
    const { board } = run([{ op: 'createFrame', title: 'Slide A', w: 800, h: 600 }], start)
    expect(getItem(board, before.id)).toMatchObject({ x: before.x, y: before.y })
  })
})

describe('growing what is already there', () => {
  /** Pairs of objects (besides frames) whose boxes overlap. */
  const overlaps = (b: ReturnType<typeof emptyBoard>) => {
    const items = b.items.filter((i) => i.kind !== 'frame')
    const out: string[] = []
    for (let a = 0; a < items.length; a++)
      for (let z = a + 1; z < items.length; z++) {
        const [p, q] = [items[a], items[z]]
        if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) out.push(`${p.text} / ${q.text}`)
      }
    return out
  }

  it('grows a mind map idea by idea, as spoken: a real tree, coloured by branch, nothing on top of anything', () => {
    // "Start a mind map called infrastructure" (one line is enough).
    let b = run([{ op: 'createMindMap', outline: 'infrastructure' }]).board
    const root = b.items[0]
    expect(root).toMatchObject({ kind: 'mind', text: 'infrastructure' })
    // "Add Jason and Brian off of that."
    b = run([{ op: 'addIdeas', parent: root.id, ideas: 'Jason\nBrian' }], b).board
    const jason = b.items.find((i) => i.text === 'Jason')!
    const brian = b.items.find((i) => i.text === 'Brian')!
    expect(jason).toMatchObject({ kind: 'mind', parent: root.id })
    expect(brian).toMatchObject({ kind: 'mind', parent: root.id })
    expect(jason.color).not.toBe(brian.color)
    // "Under Jason, workstations and desktops, with what each involves; Brian has servers."
    b = run(
      [
        { op: 'addIdeas', parent: jason.id, ideas: 'Workstations\n  Hardware upgrades & repairs\n  OS updates & patching\nDesktops\n  Refresh cycle\n  Peripherals' },
        { op: 'addIdeas', parent: brian.id, ideas: ['Servers'] },
      ],
      b,
    ).board
    const servers = b.items.find((i) => i.text === 'Servers')!
    b = run([{ op: 'addIdeas', parent: servers.id, ideas: [{ text: 'Patching' }, 'Backups', 'Monitoring'] }], b).board
    expect(toOutline(b, root.id).replace(/- /g, '')).toBe(
      ['infrastructure', '  Jason', '    Workstations', '      Hardware upgrades & repairs', '      OS updates & patching', '    Desktops', '      Refresh cycle', '      Peripherals', '  Brian', '    Servers', '      Patching', '      Backups', '      Monitoring'].join('\n'),
    )
    // Everything is a mind-map idea, joined by parent rather than drawn lines, and laid out clear.
    expect(b.items.every((i) => i.kind === 'mind')).toBe(true)
    expect(b.connectors).toHaveLength(0)
    expect(b.items.find((i) => i.text === 'Patching')!.color).toBe(brian.color)
    expect(overlaps(b)).toEqual([])
  })

  it('moves an idea, replaces a whole map where it is, and refuses what would make a mess', () => {
    let b = run([{ op: 'createMindMap', outline: 'Launch\n  Website\n  Party\n    Budget' }]).board
    const id = (t: string) => b.items.find((i) => i.text === t)!.id
    b = run([{ op: 'moveIdea', id: id('Budget'), parent: id('Website') }], b).board
    expect(getItem(b, id('Budget'))!.parent).toBe(id('Website'))
    expect(() => run([{ op: 'moveIdea', id: id('Website'), parent: id('Budget') }], b)).toThrow(/own branch/)
    expect(() => run([{ op: 'addIdeas', parent: id('Launch'), ideas: [{ text: 'Two\nideas' }] }], b)).toThrow(/one idea per line/)
    const before = getItem(b, id('Launch'))!
    b = run([{ op: 'setMindMap', id: id('Party'), outline: 'Launch plan\n  Press\n  Dinner' }], b).board
    const root = b.items.find((i) => i.text === 'Launch plan')!
    expect(b.items.map((i) => i.text).sort()).toEqual(['Dinner', 'Launch plan', 'Press'])
    // Where the old map's centre was.
    expect(root.x + root.w / 2).toBeCloseTo(before.x + before.w / 2, 0)
    // A sticky can't take ideas: the error says how to start a map.
    const withNote = run([{ op: 'createNote', ref: 'n', text: 'infrastructure' }]).board
    expect(() => run([{ op: 'addIdeas', parent: withNote.items[0].id, ideas: 'Jason' }], withNote)).toThrow(/createMindMap/)
  })

  it('grows a flowchart step by step, with branches labelled, and replaces it where it is', () => {
    let b = run([{ op: 'createFlowchart', mermaid: 'flowchart TD\n a([Start]) --> b[Get request]' }]).board
    const id = (t: string) => b.items.find((i) => i.text === t)!.id
    b = run([{ op: 'addSteps', after: id('Get request'), steps: [{ text: 'Approved?', shape: 'decision' }, { text: 'Order the laptop', label: 'Yes' }, { text: 'Done', shape: 'end' }] }], b).board
    b = run([{ op: 'addSteps', after: id('Approved?'), steps: [{ text: 'Tell them why not', label: 'No' }] }], b).board
    expect(getItem(b, id('Approved?'))).toMatchObject({ kind: 'flow', shape: 'decision' })
    expect(getItem(b, id('Done'))).toMatchObject({ shape: 'terminator' })
    const label = (from: string, to: string) => b.connectors.find((c) => c.from === id(from) && c.to === id(to))?.label
    expect(label('Approved?', 'Order the laptop')).toBe('Yes')
    expect(label('Approved?', 'Tell them why not')).toBe('No')
    expect(overlaps(b)).toEqual([])
    const top = Math.min(...b.items.map((i) => i.y))
    b = run([{ op: 'setFlowchart', id: id('Done'), mermaid: 'flowchart TD\n s([Start]) --> r[Review] --> e([End])' }], b).board
    expect(b.items.map((i) => i.text).sort()).toEqual(['End', 'Review', 'Start'])
    expect(Math.min(...b.items.map((i) => i.y))).toBeCloseTo(top, 0)
  })

  it('replaces a Kanban board, table or timeline content, keeping what was already there', () => {
    let b = run([
      { op: 'createKanban', ref: 'k', columns: [{ title: 'To do', cards: [{ title: 'Book van', due: '2026-11-02', color: 'red' }, 'Flights'] }, { title: 'Done' }] },
      { op: 'createTable', ref: 't', columns: ['Name', 'Status'], rows: [['Venue', 'booked']] },
      { op: 'createTimeline', ref: 'l', lanes: [{ name: 'Trip', entries: [{ title: 'Fly out', start: '2026-11-03' }, { title: 'Stay', start: '2026-11-03', end: '2026-11-07' }] }] },
    ]).board
    const k = b.items.find((i) => i.kind === 'kanban')!
    const van = k.kanban!.columns[0].cards[0]
    b = run([{ op: 'setKanban', id: k.id, columns: [{ title: 'To do', cards: ['Flights'] }, { title: 'Doing', cards: ['Book van'] }, { title: 'Done' }] }], b).board
    const k2 = getItem(b, k.id)!.kanban!
    expect(k2.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done'])
    // Moved, not made again: its id, date and colour stay.
    expect(k2.columns[1].cards[0]).toEqual(van)
    const t = b.items.find((i) => i.kind === 'table')!
    b = run([{ op: 'setTable', id: t.id, columns: ['Name', 'Status', 'Owner'], rows: [['Venue', 'paid', 'Sam'], ['Food', 'open', 'Lee']] }], b).board
    const t2 = getItem(b, t.id)!.table!
    expect(t2.rows).toHaveLength(2)
    expect(t2.rows[0].id).toBe(t.table!.rows[0].id)
    expect(t2.columns.map((c) => t2.rows[1].cells[c.id])).toEqual(['Food', 'open', 'Lee'])
    const l = b.items.find((i) => i.kind === 'timeline')!
    b = run([{ op: 'setTimeline', id: l.id, lanes: [{ name: 'Trip', entries: [{ title: 'Stay', start: '2026-11-04', end: '2026-11-08' }] }, { name: 'Work', entries: [{ title: 'Off', start: '2026-11-04' }] }] }], b).board
    const l2 = getItem(b, l.id)!.timeline!
    expect(l2.lanes.map((x) => x.name)).toEqual(['Trip', 'Work'])
    expect(l2.entries.find((e) => e.title === 'Stay')).toMatchObject({ id: l.timeline!.entries[1].id, start: '2026-11-04', end: '2026-11-08' })
    expect(l2.entries.find((e) => e.title === 'Off')!.end).toBeUndefined()
    expect(() => run([{ op: 'setKanban', id: t.id, columns: [] }], b)).toThrow(/Kanban board/)
  })
})

describe('a database record as a page', () => {
  it('writes, keeps through a save and clears a record page', () => {
    let b = run([{ op: 'createDatabase', ref: 'db', title: 'Requests', fields: ['Request', 'Owner'], records: [{ Request: 'Laptop for Sam', Owner: 'Ana' }] }]).board
    const view = b.items.find((i) => i.kind === 'data')!.id
    b = run([{ op: 'updateRecord', id: view, record: 'Laptop for Sam', body: '## Spec\n- [ ] Order it' }], b).board
    const rec = () => b.datasets![0].records[0]
    expect(rec().body).toBe('## Spec\n- [ ] Order it')
    expect(rec().values).toEqual(expect.objectContaining({}))
    // Kept as a save and reload keeps it.
    expect(fromJson(toJson(b)).datasets![0].records[0].body).toBe('## Spec\n- [ ] Order it')
    b = run([{ op: 'updateRecord', id: view, record: 'Laptop for Sam', body: '' }], b).board
    expect(rec().body).toBeUndefined()
    expect(() => run([{ op: 'updateRecord', id: view, record: 'Laptop for Sam' }], b)).toThrow(/"values".*"body"/)
  })
})

describe('Kanban columns', () => {
  const titles = (ops: Op[]) => run(ops).board.items[0].kanban!.columns.map((c) => c.title)
  it('start as Not started, In progress, Completed, or a template’s', () => {
    expect(titles([{ op: 'createKanban' }])).toEqual(['Not started', 'In progress', 'Completed'])
    expect(titles([{ op: 'createKanban', template: 'bugs' }])).toEqual(['Reported', 'Confirmed', 'Fixing', 'Testing', 'Fixed'])
    // Columns given win.
    expect(titles([{ op: 'createKanban', template: 'bugs', columns: [{ title: 'Mine' }] }])).toEqual(['Mine'])
    expect(() => run([{ op: 'createKanban', template: 'nope' }])).toThrow(/template/)
  })
})
