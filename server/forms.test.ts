import { describe, expect, it } from 'vitest'
import { applyOps } from '../src/api/ops'
import { Room, type RoomData } from '../src/collab/room'
import { emptyBoard } from '../src/model/board'
import * as D from '../src/model/dataset'
import { fakeMeasure } from '../src/model/test-helpers'
import type { Board } from '../src/model/types'
import { answerForm, readForm } from './forms'

const roomOf = (board: Board) => new Room({ id: 'b', board, version: 0, editKey: 'e'.repeat(24), viewKey: 'v'.repeat(24), nextSlot: 1, created: 0, updated: 0 } as RoomData, fakeMeasure)

/** A board with a private table of last year's records and a form that adds to it. */
function board(shared: boolean) {
  let b = applyOps(
    emptyBoard(),
    [
      {
        op: 'createDatabase',
        title: 'Requests',
        views: ['form'],
        fields: ['Request', { name: 'Status', type: 'select', options: ['New', 'Done'] }, { name: 'Secret', type: 'text' }],
        records: [{ Request: 'Old private request', Secret: 'hush' }],
      },
    ],
    { measure: fakeMeasure },
  ).board
  const item = b.items.find((i) => i.view?.type === 'form')!
  const ds = D.getDataset(b, item.view!.dataset)!
  const status = D.fieldByName(ds, 'Status')!
  // New requests start as New, by an automation the form's answers go through.
  b = D.updateDataset(b, ds.id, (d) => ({ ...d, automations: [{ id: 'a', when: { added: true }, set: [{ field: status.id, value: status.options![0].id }] }] }))
  b = { ...b, items: b.items.map((i) => (i.id === item.id ? { ...i, view: { ...i.view!, hidden: [D.fieldByName(ds, 'Secret')!.id], form: { shared, required: [D.fieldByName(ds, 'Request')!.id] } } } : i)) }
  return { room: roomOf(b), item: String(item.id), field: (n: string) => D.fieldByName(ds, n)!.id, ds: ds.id }
}

describe('shared forms', () => {
  it('shows only the questions, never the records', () => {
    const { room, item } = board(true)
    const r = readForm(room, item)
    expect(r.status).toBe(200)
    const text = JSON.stringify(r.body)
    expect(text).toContain('"Request"')
    expect(text).not.toContain('Old private request')
    expect(text).not.toContain('Secret')
  })

  it('adds an answer as a record, through the database’s automations', () => {
    const { room, item, field, ds } = board(true)
    const r = answerForm(room, item, JSON.stringify({ answers: { [field('Request')]: 'A new desk', [field('Secret')]: 'sneaky' } }))
    expect(r).toMatchObject({ status: 201, body: { ok: true } })
    const records = D.getDataset(room.data.board, ds)!.records
    expect(records).toHaveLength(2)
    const added = records[1]
    expect(added.values[field('Request')]).toBe('A new desk')
    // A hidden field can't be filled from outside; the automation set the status.
    expect(added.values[field('Secret')]).toBeUndefined()
    expect(added.values[field('Status')]).toBeTruthy()
    expect(room.data.version).toBe(1)
  })

  it('turns away unshared forms, bad paths and bad answers', () => {
    expect(readForm(board(false).room, board(false).item).status).toBe(404)
    const { room, item, field } = board(false)
    expect(answerForm(room, item, JSON.stringify({ answers: { [field('Request')]: 'x' } })).status).toBe(404)
    const open = board(true)
    expect(readForm(open.room, '999').status).toBe(404)
    expect(readForm(open.room, 'abc').status).toBe(404)
    expect(readForm(null, open.item).status).toBe(404)
    expect(answerForm(open.room, open.item, 'not json').status).toBe(400)
    expect(answerForm(open.room, open.item, JSON.stringify({ answers: {} }))).toMatchObject({ status: 422, body: { error: '“Request” needs an answer' } })
    expect(open.room.data.version).toBe(0)
  })
})
