/**
 * Nothing new takes the identity of something that's there, and nothing done to one thing lands on
 * another: the faults a review of every kind of object turned up, each as it was found.
 */

import { describe, expect, it } from 'vitest'
import { applyOps, type Op, OpError } from '../api/ops'
import { applyPatches, diff } from '../collab/patch'
import { ID_BLOCK, type ServerMessage } from '../collab/protocol'
import { Room, slotAfter } from '../collab/room'
import { Editor } from '../editor/Editor'
import { approxMeasure } from './approxMeasure'
import * as B from './board'
import * as D from './dataset'
import * as K from './kanban'
import { keepTicks } from './meeting'
import { fromJson, toJson } from './serialize'
import * as TL from './timeline'
import type { Board, Dataset, Item } from './types'
import { uid } from './uid'

const measure = approxMeasure
const ctx = { measure }
const run = (ops: Op[], board = B.emptyBoard()) => applyOps(board, ops, ctx).board
const note = (text: string) => B.newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text })
const texts = (b: Board) => b.items.map((i) => i.text).sort()

describe('ids on a board that is live', () => {
  const room = (board: Board, nextSlot = 1) => new Room({ id: 'r', board, version: 0, editKey: 'e', viewKey: 'v', nextSlot, created: 0, updated: 0 }, measure)
  const join = (r: Room) => {
    let hello: Extract<ServerMessage, { t: 'hello' }> | undefined
    r.join({ id: uid(), role: 'edit', send: (m) => m.t === 'hello' && (hello = m) })
    return hello!
  }

  it('gives the next editor a block past every id the board already has', () => {
    // A board that was live before: its objects are in the block its editor had then.
    const [was] = B.addItem({ ...B.emptyBoard(), nextId: ID_BLOCK + 7 }, note('From before'))
    expect(was.items[0].id).toBe(ID_BLOCK + 7)
    expect(slotAfter(was)).toBe(2)
    expect(slotAfter(B.emptyBoard())).toBe(1)
    expect(slotAfter(run([{ op: 'createNote', text: 'Never live' }]))).toBe(1)
    // Shared again as a new room, its first editor doesn't start where those objects are.
    const hello = join(room(was))
    expect(hello.you.idBase).toBe(2 * ID_BLOCK)
    const e = new Editor(B.emptyBoard(), measure)
    e.resetFromRemote(hello.board, { readOnly: false, idBase: hello.you.idBase })
    e.edit((b) => B.addItem(b, note('New'))[0])
    expect(texts(e.board)).toEqual(['From before', 'New'])
    expect(new Set(e.board.items.map((i) => i.id)).size).toBe(2)
    // A room already past them keeps counting from where it was.
    expect(join(room(was, 9)).you.idBase).toBe(9 * ID_BLOCK)
  })

  it('starts past anything already in its own block', () => {
    const [was] = B.addItem({ ...B.emptyBoard(), nextId: ID_BLOCK }, note('Here already'))
    const e = new Editor(B.emptyBoard(), measure)
    e.resetFromRemote(was, { readOnly: false, idBase: ID_BLOCK })
    e.edit((b) => B.addItem(b, note('New'))[0])
    expect(texts(e.board)).toEqual(['Here already', 'New'])
    expect(e.board.items.map((i) => i.id)).toEqual([ID_BLOCK, ID_BLOCK + 1])
  })
})

describe('what the assistant proposed, applied later', () => {
  const proposal = (before: Board, ops: Op[]) => {
    const after = run(ops, before)
    const had = new Set([...before.items, ...before.connectors].map((o) => o.id))
    const patches = diff(before, after)
    return { patches, made: patches.flatMap((p) => ((p.k === 'item' || p.k === 'conn') && p.v && !had.has(p.id) ? [p.id] : [])) }
  }

  it('doesn’t replace what was made in the meantime', () => {
    const start = run([{ op: 'createNote', text: 'Here already' }])
    const e = new Editor(start, measure)
    const p = proposal(e.board, [{ op: 'createNote', ref: 'a', text: 'Risks' }, { op: 'createNote', ref: 'b', text: 'Costs' }, { op: 'connect', from: 'a', to: 'b' }])
    // Before it's applied, two notes are drawn by hand: they get the ids the proposal's notes were given.
    e.edit((b) => B.addItem(b, note('Mine'))[0])
    e.edit((b) => B.addItem(b, note('Mine too'))[0])
    expect(e.applyAi('p1', 'Adds two notes', p.patches, undefined, p.made)).toBe(true)
    expect(texts(e.board)).toEqual(['Costs', 'Here already', 'Mine', 'Mine too', 'Risks'])
    expect(new Set(e.board.items.map((i) => i.id)).size).toBe(5)
    // Its line still joins its own two notes.
    const [line] = e.board.connectors
    expect([B.getItem(e.board, line.from)!.text, B.getItem(e.board, line.to)!.text]).toEqual(['Risks', 'Costs'])
    // And the next thing made is its own too.
    e.edit((b) => B.addItem(b, note('After'))[0])
    expect(new Set([...e.board.items, ...e.board.connectors].map((o) => o.id)).size).toBe(7)
  })

  it('two proposals made against the same board both land', () => {
    const e = new Editor(run([{ op: 'createNote', text: 'Here already' }]), measure)
    const one = proposal(e.board, [{ op: 'createMindMap', outline: 'Plan\n  First\n  Second' }])
    const two = proposal(e.board, [{ op: 'createNote', text: 'Other' }])
    // The note first: the map's ideas are then the ones given new ids, and each still knows its parent.
    e.applyAi('p2', 'A note', two.patches, undefined, two.made)
    e.applyAi('p1', 'A map', one.patches, undefined, one.made)
    expect(texts(e.board)).toEqual(['First', 'Here already', 'Other', 'Plan', 'Second'])
    // The map's ideas still hang from its centre.
    const plan = e.board.items.find((i) => i.text === 'Plan')!
    expect(e.board.items.filter((i) => i.parent === plan.id).map((i) => i.text).sort()).toEqual(['First', 'Second'])
  })

  it('applied straight away, changes nothing about it', () => {
    const e = new Editor(run([{ op: 'createNote', text: 'Here already' }]), measure)
    const p = proposal(e.board, [{ op: 'createNote', text: 'Risks' }])
    e.applyAi('p1', 'A note', p.patches, undefined, p.made)
    expect(e.board.items.find((i) => i.text === 'Risks')!.id).toBe(p.made[0])
  })

  it('undone with Ctrl Z, then undone from History, leaves alone what was made since', () => {
    const e = new Editor(run([{ op: 'createNote', text: 'Here already' }]), measure)
    const p = proposal(e.board, [{ op: 'createNote', text: 'Risks' }])
    e.applyAi('p1', 'A note', p.patches, undefined, p.made)
    e.undo()
    expect(texts(e.board)).toEqual(['Here already'])
    // What's made next doesn't get the undone note's id…
    e.edit((b) => B.addItem(b, note('Mine'))[0])
    expect(e.board.items.find((i) => i.text === 'Mine')!.id).not.toBe(p.made[0])
    // …so History taking the assistant's note away (it reads as applied) takes nothing of yours.
    e.toggleAiChange('p1')
    expect(texts(e.board)).toEqual(['Here already', 'Mine'])
  })
})

describe('copies', () => {
  const editor = (ops: Op[]) => new Editor(run(ops), measure)
  const dup = (e: Editor, pick: (i: Item) => boolean) => {
    const before = new Set(e.board.items.map((i) => i.id))
    e.select(e.board.items.filter(pick).map((i) => i.id))
    e.duplicate()
    return e.board.items.filter((i) => !before.has(i.id))
  }

  it('of a group are a group of their own', () => {
    const e = editor([{ op: 'createShape', text: 'A' }, { op: 'createShape', text: 'B' }])
    e.selectAll()
    e.group()
    const group = e.board.items[0].group
    expect(group).toBeTruthy()
    const copies = dup(e, () => true)
    expect(copies).toHaveLength(2)
    expect(copies[0].group).toBe(copies[1].group)
    expect(copies[0].group).not.toBe(group)
    expect(e.board.items.filter((i) => i.group === group)).toHaveLength(2)
  })

  it('of a vote and what it’s on are a vote on the copies; of the vote alone, no vote', () => {
    const e = editor([{ op: 'createNote', ref: 'a', text: 'A' }, { op: 'createNote', ref: 'b', text: 'B' }, { op: 'createVote', options: ['a', 'b'] }])
    const options = e.board.items.find((i) => i.poll)!.poll!.options
    const copies = dup(e, () => true)
    const card = copies.find((i) => i.poll)!
    expect(card.poll!.options).toEqual(copies.filter((i) => !i.poll).map((i) => i.id))
    expect(card.poll!.options.some((o) => options.includes(o))).toBe(false)
    const alone = dup(e, (i) => i === e.board.items.find((x) => x.poll))
    expect(alone).toHaveLength(1)
    expect(alone[0].poll).toBeUndefined()
  })

  it('of a timeline and the Kanban board it shows follow the copy; elsewhere, nothing that isn’t there', () => {
    const e = editor([{ op: 'createKanban', ref: 'k', title: 'K', columns: [{ title: 'To do', cards: [{ title: 'x', due: '2026-11-20' }] }] }, { op: 'createTimeline', title: 'L', lanes: [{ name: 'Sam' }], followKanban: ['k'] } as Op])
    const kanban = e.board.items.find((i) => i.kind === 'kanban')!.id
    const both = dup(e, () => true)
    expect(both.find((i) => i.timeline)!.timeline!.sources).toEqual([both.find((i) => i.kanban)!.id])
    // The timeline alone, on the same board: still the Kanban board it showed.
    const alone = dup(e, (i) => i.kind === 'timeline' && i.timeline!.sources![0] === kanban)
    expect(alone[0].timeline!.sources).toEqual([kanban])
    // Pasted onto another board, where that number is something else or nothing: it shows none.
    e.select([alone[0].id])
    const other = new Editor(run([{ op: 'createNote', text: 'Elsewhere' }, { op: 'createNote', text: 'Elsewhere too' }]), measure)
    other.pasteText(e.copyText()!)
    expect(other.board.items.find((i) => i.timeline)!.timeline!.sources).toBeUndefined()
  })
})

describe('mind maps with an idea left hanging', () => {
  const map = () => run([{ op: 'createMindMap', outline: 'Plan\n  Pricing\n    Tiers\n      Free' }])
  const id = (b: Board, text: string) => b.items.find((i) => i.text === text)!.id

  it('an idea whose parent is taken away by a change becomes a centre of its own', () => {
    const b = map()
    const without = applyPatches(b, [{ k: 'item', id: id(b, 'Pricing'), v: null }])
    const tiers = without.items.find((i) => i.text === 'Tiers')!
    expect(tiers.parent).toBeUndefined()
    expect(tiers.side).toBeUndefined()
    // What hangs from it still does.
    expect(without.items.find((i) => i.text === 'Free')!.parent).toBe(tiers.id)
    // A change that leaves ideas alone leaves the list as it was.
    expect(B.healMinds(b.items)).toBe(b.items)
  })

  it('ideas whose parents go round in a ring are cut out of it, here and from a file', () => {
    const b = map()
    const ring = { ...b, items: b.items.map((i) => (i.text === 'Pricing' ? { ...i, parent: id(b, 'Free') } : i)) }
    const healed = B.healMinds(ring.items)
    const roots = healed.filter((i) => i.kind === 'mind' && i.parent === undefined).map((i) => i.text).sort()
    expect(roots).toHaveLength(2)
    expect(roots).toContain('Plan')
    // Every idea reaches a centre.
    for (const i of healed) expect(B.rootOf({ ...b, items: healed }, i.id)?.parent).toBeUndefined()
    expect(fromJson(toJson(ring)).items.filter((i) => i.parent === undefined)).toHaveLength(2)
  })

  it('rewriting a map from an idea whose parent has gone comes back', () => {
    const b = map()
    // As it could be before such ideas were put right: Tiers pointing at nothing.
    const orphaned = { ...b, items: b.items.filter((i) => i.text !== 'Pricing') }
    const out = run([{ op: 'setMindMap', id: id(b, 'Free'), outline: 'Tiers\n  Free\n  Paid' }], orphaned)
    expect(out.items.filter((i) => i.kind === 'mind').map((i) => i.text).sort()).toEqual(['Free', 'Paid', 'Plan', 'Tiers'])
  })
})

describe('parts told apart by an id', () => {
  it('get ids long enough not to land on each other', () => {
    const ids = Array.from({ length: 2000 }, uid)
    expect(new Set(ids).size).toBe(2000)
    for (const x of ids.slice(0, 20)) expect(x).toMatch(/^[0-9a-f]{12}$/)
  })

  it('a database’s fields, choices, records and rules that arrive sharing one get their own', () => {
    const b = run([{ op: 'createDatabase', title: 'D', fields: ['Name', { name: 'Stage', type: 'select', options: ['To do', 'Done'] }], records: [{ Name: 'A', Stage: 'To do' }, { Name: 'B', Stage: 'Done' }, { Name: 'C' }], views: ['table'] }])
    const raw = JSON.parse(toJson(b)) as { datasets: { id: string; fields: { id: string; options?: { id: string }[] }[]; records: { id: string }[] }[] }
    const d = raw.datasets[0]
    d.records[1].id = d.records[0].id
    d.records[2].id = d.records[0].id
    d.fields[1].options![1].id = d.fields[1].options![0].id
    raw.datasets.push({ ...d, id: d.id })
    const back = fromJson(JSON.stringify(raw))
    expect(back.datasets).toHaveLength(1)
    const ds = back.datasets![0]
    expect(new Set(ds.records.map((r) => r.id)).size).toBe(3)
    expect(ds.records[0].id).toBe(d.records[0].id)
    expect(new Set(ds.fields[1].options!.map((o) => o.id)).size).toBe(2)
    // Then changing one record changes one.
    const name = ds.fields[0].id
    expect(D.setValue(ds, ds.records[1].id, name, 'Changed').records.map((r) => r.values[name])).toEqual(['A', 'Changed', 'C'])
    // Read again: the same ids.
    expect(fromJson(JSON.stringify(raw)).datasets).toEqual(back.datasets)
  })

  it('lines that arrive sharing one: the first is kept', () => {
    const b = run([{ op: 'createNote', ref: 'a', text: 'A' }, { op: 'createNote', ref: 'b', text: 'B' }, { op: 'createNote', ref: 'c', text: 'C' }, { op: 'connect', from: 'a', to: 'b' }, { op: 'connect', from: 'b', to: 'c' }])
    const raw = JSON.parse(toJson(b)) as { connectors: { id: number }[] }
    raw.connectors[1].id = raw.connectors[0].id
    expect(fromJson(JSON.stringify(raw)).connectors).toHaveLength(1)
  })
})

describe('votes, ticks and what a timeline shows', () => {
  it('a vote lists each object once', () => {
    const b = run([{ op: 'createNote', ref: 'a', text: 'A' }, { op: 'createNote', ref: 'b', text: 'B' }])
    const [a, z] = b.items.map((i) => i.id)
    const voted = run([{ op: 'createVote', options: [a, z, a, z] }], b)
    expect(voted.items.find((i) => i.poll)!.poll!.options).toEqual([a, z])
    expect(() => run([{ op: 'createVote', options: [a, a] }], b)).toThrow(OpError)
    // And one that arrives listing an object twice is put right.
    const raw = JSON.parse(toJson(voted)) as { items: { poll?: { options: number[] } }[] }
    raw.items.find((i) => i.poll)!.poll!.options = [a, a, z]
    expect(fromJson(JSON.stringify(raw)).items.find((i) => i.poll)!.poll!.options).toEqual([a, z])
  })

  it('a tick stays on its own row when two rows say the same', () => {
    const made = run([{ op: 'createTable', title: 'Agenda', columns: ['Item', 'Covered'], rows: [['Break', '✓'], ['Budget', ''], ['Break', '']] }])
    const now = made.items[0]
    // Rewritten by the assistant with no ticks of its own, and a new row on top.
    const next = run([{ op: 'setTable', id: now.id, columns: ['Item', 'Covered'], rows: [['Welcome', ''], ['Break', ''], ['Budget', ''], ['Break', '']] }], made).items[0]
    const kept = keepTicks(now, next).table!
    expect(kept.rows.map((r) => `${r.cells[kept.columns[0].id]}${r.cells[kept.columns[1].id] ? ' ✓' : ''}`)).toEqual(['Welcome', 'Break ✓', 'Budget', 'Break'])
    // Rows that are new rows altogether (made afresh, not rewritten): each tick still goes to one row.
    const fresh = run([{ op: 'createTable', title: 'Agenda', columns: ['Item', 'Covered'], rows: [['Break', ''], ['Break', ''], ['Budget', '']] }]).items[0]
    const again = keepTicks(now, fresh).table!
    expect(again.rows.filter((r) => r.cells[again.columns[1].id]).length).toBe(1)
  })

  it('a timeline shows a Kanban board once, keeps its spans in lanes that are there, and forgets what went with a lane', () => {
    const b = run([{ op: 'createKanban', ref: 'k', title: 'K', columns: [{ title: 'To do' }] }, { op: 'createTimeline', title: 'L', lanes: [{ name: 'Sam', entries: [{ title: 'a', start: '2026-11-17' }] }, { name: 'Priya', entries: [{ title: 'b', start: '2026-11-18' }] }], followKanban: ['k', 'k'] } as Op])
    const item = b.items.find((i) => i.timeline)!
    expect(item.timeline!.sources).toHaveLength(1)
    const raw = JSON.parse(toJson(b)) as { items: { timeline?: { sources: number[]; entries: { lane: string }[] } }[] }
    const t = raw.items.find((i) => i.timeline)!.timeline!
    t.sources = [t.sources[0], t.sources[0]]
    t.entries[1].lane = 'nowhere'
    const back = fromJson(JSON.stringify(raw)).items.find((i) => i.timeline)!.timeline!
    expect(back.sources).toHaveLength(1)
    expect(back.entries.map((e) => e.lane)).toEqual([back.lanes[0].id, back.lanes[0].id])
    // b waits for a; a's lane is deleted: b waits for nothing.
    const [a, bb] = item.timeline!.entries
    const waiting = TL.updateEntry(item.timeline!, bb.id, { after: [a.id] })
    const left = TL.deleteLane(waiting, a.lane)
    expect(left.entries).toHaveLength(1)
    expect(left.entries[0].after).toBeUndefined()
  })

  it('a Kanban card moved to a column that isn’t there stays where it is', () => {
    const k = run([{ op: 'createKanban', title: 'K', columns: [{ title: 'To do', cards: ['x', 'y'] }, { title: 'Done' }] }]).items[0].kanban!
    const card = k.columns[0].cards[0].id
    expect(K.moveCard(k, card, 'a-column-of-another-board', 0)).toBe(k)
    expect(K.moveCard(k, card, k.columns[1].id, 0).columns.map((c) => c.cards.length)).toEqual([1, 1])
  })
})

describe('a formula put right', () => {
  it('no longer says what was wrong with it', () => {
    let b = run([{ op: 'createDatabase', title: 'D', fields: ['Name', { name: 'Price', type: 'number' }], records: [{ Name: 'A', Price: 4 }], views: ['table'] }])
    const edit = (f: (d: Dataset) => Dataset) => (b = { ...b, datasets: [f(b.datasets![0])] })
    let total = ''
    edit((d) => {
      const [next, id] = D.addField(d, 'Total', 'formula')
      total = id
      return next
    })
    const shown = () => D.withComputed(b, b.datasets![0]).fields.find((f) => f.id === total) as D.ShownField
    // Empty: it says so, but not on the field as it's kept.
    expect(shown().problem).toBeTruthy()
    expect((b.datasets![0].fields.find((f) => f.id === total) as D.ShownField).problem).toBeUndefined()
    edit((d) => D.setFieldConfig(d, total, { formula: '{Price} * 2' }))
    expect(shown().problem).toBeUndefined()
    expect(D.withComputed(b, b.datasets![0]).records[0].values[total]).toBe(8)
    // One that was written on the field before this (a board from then) is forgotten too.
    b = { ...b, datasets: [{ ...b.datasets![0], fields: b.datasets![0].fields.map((f) => (f.id === total ? ({ ...f, problem: 'The formula is empty' } as D.ShownField) : f)) }] }
    expect(shown().problem).toBeUndefined()
  })
})
