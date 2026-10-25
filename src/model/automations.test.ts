import { describe, expect, it } from 'vitest'
import { type Op, applyOps } from '../api/ops'
import { applyPatches, diff } from '../collab/patch'
import { describe as sentence, runAutomations } from './automations'
import { emptyBoard } from './board'
import * as D from './dataset'
import { fromJson, toJson } from './serialize'
import { fakeMeasure } from './test-helpers'
import type { Board } from './types'

const make = (ops: Op[], b: Board = emptyBoard()) => applyOps(b, ops, { measure: fakeMeasure, now: 1 }).board
const viewOf = (b: Board) => b.items.find((i) => i.kind === 'data')!.id

function requests(): Board {
  let b = make([
    {
      op: 'createDatabase',
      title: 'Requests',
      fields: ['Request', { name: 'Status', type: 'select', options: ['New', 'Approved', 'Done'] }, { name: 'Completed', type: 'date' }, { name: 'Owner', type: 'text' }],
      records: [{ Request: 'Laptop', Status: 'Approved' }],
    },
  ])
  b = make(
    [
      { op: 'addAutomation', id: viewOf(b), when: { field: 'Status', to: 'Done' }, then: [{ field: 'Completed', value: 'today' }] },
      { op: 'addAutomation', id: viewOf(b), when: { added: true }, then: [{ field: 'Status', value: 'New' }, { field: 'Owner', value: 'Front desk' }] },
    ],
    b,
  )
  return b
}
const rec = (b: Board, title: string) => {
  const ds = b.datasets![0]
  const r = ds.records.find((x) => D.recordTitle(ds, x) === title)!
  return Object.fromEntries(ds.fields.map((f) => [f.name, D.display(ds, f, r.values[f.id])]))
}

describe('automations', () => {
  it('reads as sentences', () => {
    const b = requests()
    expect(b.datasets![0].automations!.map((a) => sentence(b.datasets![0], a))).toEqual(['When Status becomes Done, set Completed to today', 'When a record is added, set Status to New and set Owner to Front desk'])
  })

  it('sets fields when a field changes to a value, and when a record is added', () => {
    let b = requests()
    b = make([{ op: 'updateRecord', id: viewOf(b), record: 'Laptop', values: { Status: 'Done' } }], b)
    expect(rec(b, 'Laptop').Completed).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    b = make([{ op: 'addRecords', id: viewOf(b), records: [{ Request: 'Monitor' }] }], b)
    expect(rec(b, 'Monitor')).toMatchObject({ Status: 'New', Owner: 'Front desk' })
  })

  it('stays quiet when nothing it watches changes, or when it is off', () => {
    const b = requests()
    const ds = b.datasets![0]
    const owner = ds.fields.find((f) => f.name === 'Owner')!.id
    const edited = D.setValue(ds, ds.records[0].id, owner, 'Sam')
    expect(runAutomations(ds, edited).records[0].values).toEqual(edited.records[0].values)
    const off = { ...ds, automations: ds.automations!.map((a) => ({ ...a, off: true })) }
    const status = ds.fields.find((f) => f.name === 'Status')!
    const done = D.setValue(off, ds.records[0].id, status.id, status.options!.find((o) => o.name === 'Done')!.id)
    expect(runAutomations(off, done)).toBe(done)
  })

  it('keeps its rules through a save and a live session', () => {
    const b = requests()
    expect(fromJson(toJson(b)).datasets![0].automations).toEqual(b.datasets![0].automations)
    // A friend's screen gets the rules with the change that made them.
    const before = make([{ op: 'createDatabase', title: 'Requests', fields: ['Request'] }])
    const withRule = make([{ op: 'addAutomation', id: viewOf(before), when: { added: true }, then: [{ field: 'Request', value: 'Untitled request' }] }], before)
    expect(applyPatches(before, diff(before, withRule)).datasets![0].automations).toEqual(withRule.datasets![0].automations)
  })

  it('says what is wrong with a rule', () => {
    const b = requests()
    expect(() => make([{ op: 'addAutomation', id: viewOf(b), when: { field: 'Nope' }, then: [{ field: 'Owner', value: 'x' }] }], b)).toThrow(/should name a field/)
    expect(() => make([{ op: 'addAutomation', id: viewOf(b), when: { field: 'Status', to: 'Lost' }, then: [{ field: 'Owner', value: 'x' }] }], b)).toThrow(/isn't a value "Status" can have/)
  })
})
