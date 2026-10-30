import { describe, expect, it } from 'vitest'
import { addItem, connect, emptyBoard, getItem, newItem } from './board'
import { boardAfter, childBoard, MAX_TOPIC_UNITS, packUnits, parseTopics, planByFrame, planByKind, topicPrompt, topicUnits, unitsOf, type Unit } from './divide'
import { fromJson, toJson } from './serialize'
import type { Board, Id } from './types'

/**
 * A crowded board: a frame "Trip" with two notes; a flowchart of three steps; a mind map; a table;
 * three loose notes; a vote with its two options; a line from a loose note to a flowchart step.
 */
function setup() {
  let b: Board = emptyBoard('Crowded')
  const add = (kind: Parameters<typeof newItem>[0], x: number, y: number, extra: Parameters<typeof newItem>[2] = {}, w = 200, h = 100): Id => {
    let id: Id
    ;[b, id] = addItem(b, newItem(kind, { x, y, w, h }, extra))
    return id
  }
  const frame = add('frame', 0, 0, { text: 'Trip' }, 800, 600)
  const inA = add('sticky', 100, 100, { text: 'Tent' })
  const inB = add('sticky', 400, 100, { text: 'Stove' })
  const start = add('flow', 2000, 0, { text: 'Start', shape: 'terminator' })
  const step = add('flow', 2000, 300, { text: 'Book train', shape: 'process' })
  const end = add('flow', 2000, 600, { text: 'Go', shape: 'terminator' })
  b = connect(b, start, step)[0]
  b = connect(b, step, end)[0]
  const root = add('mind', 4000, 0, { text: 'Ideas' }, 120, 50)
  const idea = add('mind', 4300, 0, { text: 'Hike', parent: root, side: 'right' }, 120, 50)
  const table = add('table', 0, 2000, { text: 'Budget' }, 400, 300)
  const n1 = add('sticky', 3000, 3000, { text: 'Snacks' })
  const n2 = add('sticky', 3300, 3000, { text: 'Maps' })
  const n3 = add('sticky', 3600, 3000, { text: 'Torch' })
  const opt1 = add('sticky', 6000, 0, { text: 'Lake' })
  const opt2 = add('sticky', 6300, 0, { text: 'Hills' })
  const vote = add('comment', 6000, 300, { text: 'Where?', poll: { options: [opt1, opt2], each: 1, revealed: false } })
  b = connect(b, n1, step)[0]
  return { b, frame, inA, inB, start, step, end, root, idea, table, n1, n2, n3, opt1, opt2, vote }
}

const unitWith = (units: Unit[], id: Id) => units.find((u) => u.ids.includes(id))!

describe('units: what moves together', () => {
  it('keeps frames, flowcharts, mind maps and votes whole, and loose notes apart', () => {
    const s = setup()
    const units = unitsOf(s.b)
    expect(new Set(unitWith(units, s.frame).ids)).toEqual(new Set([s.frame, s.inA, s.inB]))
    expect(unitWith(units, s.frame)).toMatchObject({ kind: 'frame', holds: 'notes', title: 'Trip' })
    // The note with a line to the flowchart goes with it.
    expect(new Set(unitWith(units, s.start).ids)).toEqual(new Set([s.start, s.step, s.end, s.n1]))
    expect(unitWith(units, s.start)).toMatchObject({ kind: 'flowchart', title: 'Start' })
    expect(unitWith(units, s.idea)).toMatchObject({ kind: 'mindmap', title: 'Ideas', ids: [s.root, s.idea] })
    expect(new Set(unitWith(units, s.vote).ids)).toEqual(new Set([s.opt1, s.opt2, s.vote]))
    expect(unitWith(units, s.n2).ids).toEqual([s.n2])
    // Every object is in exactly one unit.
    expect(units.flatMap((u) => u.ids).sort((p, q) => p - q)).toEqual(s.b.items.map((i) => i.id).sort((p, q) => p - q))
  })
})

describe('plans', () => {
  it('by frame: a board per frame, the rest stays', () => {
    const s = setup()
    const plan = planByFrame(unitsOf(s.b))
    expect(plan.groups.map((g) => g.title)).toEqual(['Trip'])
    expect(plan.stays.flatMap((u) => u.ids)).not.toContain(s.inA)
  })

  it('by kind: flowcharts together, notes together; too few of a kind stays', () => {
    const s = setup()
    const plan = planByKind(unitsOf(s.b))
    expect(plan.groups.map((g) => g.title)).toEqual(['Flowcharts', 'Notes'])
    // The frame of notes goes with the notes; the lone mind map (2 objects) and table stay.
    expect(plan.groups[1].units.flatMap((u) => u.ids)).toEqual(expect.arrayContaining([s.frame, s.n2, s.n3, s.vote]))
    expect(plan.stays.flatMap((u) => u.ids).sort()).toEqual([s.root, s.idea, s.table].sort())
  })

  it('by kind: cards that open other boards stay', () => {
    let b = setup().b
    for (const k of [0, 1, 2, 3]) b = addItem(b, newItem('rect', { x: k * 400, y: -1000, w: 320, h: 130 }, { text: `📋 Part ${k}\nOn a board of its own`, linkTo: { board: `B${k}` } }))[0]
    const plan = planByKind(unitsOf(b))
    expect(plan.groups.map((g) => g.title)).toEqual(['Flowcharts', 'Notes'])
    expect(plan.stays.filter((u) => u.kind === 'card')).toHaveLength(4)
    expect(plan.stays.find((u) => u.kind === 'card')!.title).toBe('📋 Part 0')
  })

  it('by topic: the assistant’s answer, checked', () => {
    const s = setup()
    const units = unitsOf(s.b)
    const prompt = topicPrompt(units, s.b, 'Crowded')
    expect(prompt).toContain('frame "Trip"')
    expect(prompt).toContain('Book train')
    const key = (id: Id) => unitWith(units, id).key
    const reply = `Here you go:\n{"boards": [{"title": "Getting there", "units": ["${key(s.start)}", "nope", "${key(s.start)}"]}, {"title": "Kit", "units": ["${key(s.frame)}", "${key(s.n2)}"]}, {"title": "Empty", "units": []}], "keep": []}`
    const plan = parseTopics(reply, units)!
    expect(plan.groups.map((g) => [g.title, g.units.length])).toEqual([
      ['Getting there', 1],
      ['Kit', 2],
    ])
    // What it left out stays.
    expect(plan.stays).toContain(unitWith(units, s.table))
    expect(parseTopics('Sorry, I can’t.', units)).toBeNull()
    expect(parseTopics('{"boards": "x"}', units)).toBeNull()
  })

  it('by topic on a huge board: small loose notes near each other are sent together', () => {
    let b: Board = emptyBoard('Huge')
    for (let k = 0; k < 2000; k++) b = addItem(b, newItem('sticky', { x: (k % 50) * 220, y: Math.floor(k / 50) * 220, w: 200, h: 200 }, { text: `Note ${k}` }))[0]
    const few = topicUnits(unitsOf(b))
    expect(few.length).toBeLessThanOrEqual(MAX_TOPIC_UNITS)
    expect(few.reduce((n, u) => n + u.ids.length, 0)).toBe(2000)
  })
})

describe('making the child boards', () => {
  it('lays units out in rows, each keeping its shape, with the lines inside and a way back', () => {
    const s = setup()
    const plan = planByKind(unitsOf(s.b))
    const flows = plan.groups[0]
    const child = childBoard(s.b, flows, { key: 'CROWD', title: 'Crowded' })
    expect(child).toMatchObject({ title: 'Flowcharts', parent: { key: 'CROWD', title: 'Crowded' } })
    // The flowchart unit's top left goes to 0,0 and its steps keep their places relative to it.
    const start = getItem(child, s.start)!
    const step = getItem(child, s.step)!
    expect(step.x - start.x).toBe(0)
    expect(step.y - start.y).toBe(300)
    expect(child.connectors).toHaveLength(3)
    expect(child.items.find((i) => i.linkTo?.board === 'CROWD')).toBeDefined()
    // The parent survives saving and loading.
    expect(fromJson(toJson(child)).parent).toEqual({ key: 'CROWD', title: 'Crowded' })
  })

  it('packs many units into rows without overlaps', () => {
    const units: Unit[] = Array.from({ length: 30 }, (_, k) => ({ key: `u${k}`, ids: [k], kind: 'notes', holds: 'notes', box: { x: k * 37, y: k * 11, w: 300 + k * 10, h: 200 + (k % 4) * 50 }, title: '' }))
    const shift = packUnits(units)
    const placed = units.map((u) => ({ x: u.box.x + shift.get(u)!.dx, y: u.box.y + shift.get(u)!.dy, w: u.box.w, h: u.box.h }))
    for (const [k, p] of placed.entries())
      for (const q of placed.slice(k + 1)) expect(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y).toBe(true)
  })

  it('leaves cards in their place, and lines to what went end at its card', () => {
    const s = setup()
    const plan = planByKind(unitsOf(s.b))
    const { board, cards } = boardAfter(s.b, plan.groups, ['FLOWS', null])
    // Only the flowcharts went (the notes' key is missing).
    expect(getItem(board, s.start)).toBeUndefined()
    expect(getItem(board, s.n2)).toBeDefined()
    expect(cards).toHaveLength(1)
    const card = getItem(board, cards[0])!
    expect(card.linkTo).toEqual({ board: 'FLOWS', label: 'Flowcharts' })
    expect(card.text).toContain('4 objects')
    // Nothing that stays is under the card.
    const stays = board.items.filter((i) => i.id !== card.id)
    expect(stays.every((i) => card.x + card.w <= i.x || i.x + i.w <= card.x || card.y + card.h <= i.y || i.y + i.h <= card.y)).toBe(true)
    expect(board.connectors).toHaveLength(0)
    // A frame's card goes where the frame was, and a line from what stays now ends at the card.
    const byFrame = planByFrame(unitsOf(s.b))
    let b = s.b
    b = connect(b, s.n3, s.inA)[0]
    const after = boardAfter(b, byFrame.groups, ['TRIP'])
    const frameCard = getItem(after.board, after.cards[0])!
    expect(frameCard).toMatchObject({ x: 0, y: frameCard.y })
    expect(after.board.connectors.some((c) => c.from === s.n3 && c.to === frameCard.id)).toBe(true)
  })
})
