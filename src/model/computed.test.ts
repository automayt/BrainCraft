import { describe, expect, it } from 'vitest'
import { type Op, applyOps } from '../api/ops'
import { emptyBoard } from './board'
import * as D from './dataset'
import { fromJson, toJson } from './serialize'
import { fakeMeasure } from './test-helpers'
import type { Board, Dataset } from './types'

const make = (ops: Op[], b: Board = emptyBoard()) => applyOps(b, ops, { measure: fakeMeasure, now: 1 }).board
const named = (b: Board, name: string) => b.datasets!.find((d) => d.name === name)!
/** Each record's shown values, by field name. */
const shown = (b: Board, ds: Dataset) => {
  const c = D.withComputed(b, ds, new Date(2026, 9, 25))
  return c.records.map((r) => Object.fromEntries(c.fields.map((f) => [f.name, D.display(c, f, r.values[f.id])])))
}

/** Tasks, then projects that link to them, roll them up, and work out a few things. */
function projectBoard(): Board {
  let b = make([
    {
      op: 'createDatabase',
      title: 'Tasks',
      fields: ['Task', { name: 'Hours', type: 'number' }, { name: 'Done', type: 'checkbox' }, { name: 'Due', type: 'date' }],
      records: [
        { Task: 'Design', Hours: 6, Done: true, Due: '2026-11-02' },
        { Task: 'Build', Hours: 10, Done: false, Due: '2026-11-20' },
        { Task: 'Write up', Hours: 2, Done: true, Due: '2026-10-30' },
      ],
    },
  ])
  b = make(
    [
      {
        op: 'createDatabase',
        title: 'Projects',
        fields: [
          'Project',
          { name: 'Rate', type: 'number' },
          { name: 'Tasks', type: 'relation', to: 'Tasks' },
          { name: 'Task count', type: 'rollup', relation: 'Tasks' },
          { name: 'Hours', type: 'rollup', relation: 'Tasks', field: 'Hours', fn: 'sum' },
          { name: 'Progress', type: 'rollup', relation: 'Tasks', field: 'Done', fn: 'percentDone' },
          { name: 'Last due', type: 'rollup', relation: 'Tasks', field: 'Due', fn: 'latest' },
          { name: 'Cost', type: 'formula', formula: '{Hours} * {Rate}' },
          { name: 'Status', type: 'formula', formula: 'if({Progress} = 100, "Done", daysUntil({Last due}) + " days left")' },
        ],
        records: [
          { Project: 'Website', Rate: 50, Tasks: ['Design', 'Build'] },
          { Project: 'Report', Rate: 40, Tasks: 'Write up' },
        ],
      },
    ],
    b,
  )
  return b
}

describe('relations, rollups and formulas', () => {
  it('links records, sums them up and works things out from them', () => {
    const b = projectBoard()
    expect(shown(b, named(b, 'Projects'))).toEqual([
      { Project: 'Website', Rate: '50', Tasks: 'Design, Build', 'Task count': '2', Hours: '16', Progress: '50%', 'Last due': '2026-11-20', Cost: '800', Status: '26 days left' },
      { Project: 'Report', Rate: '40', Tasks: 'Write up', 'Task count': '1', Hours: '2', Progress: '100%', 'Last due': '2026-10-30', Cost: '80', Status: 'Done' },
    ])
  })

  it('follows changes to the linked records at once, and stores only the links', () => {
    let b = projectBoard()
    const tasks = make([{ op: 'updateRecord', id: b.items.find((i) => i.text === 'Tasks')!.id, record: 'Build', values: { Done: true, Hours: 12 } }], b)
    b = tasks
    const website = shown(b, named(b, 'Projects'))[0]
    expect(website).toMatchObject({ Hours: '18', Progress: '100%', Cost: '900', Status: 'Done' })
    // Only the links are kept; rollups and formulas are worked out when shown.
    const raw = named(b, 'Projects')
    const fieldId = (n: string) => raw.fields.find((f) => f.name === n)!.id
    expect(Object.keys(raw.records[0].values).sort()).toEqual([fieldId('Project'), fieldId('Rate'), fieldId('Tasks')].sort())
    // And they come back the same after a save.
    expect(shown(fromJson(toJson(b)), named(fromJson(toJson(b)), 'Projects'))[0]).toEqual(website)
  })

  it('adds a field to an existing database, and says what is wrong', () => {
    let b = projectBoard()
    const view = b.items.find((i) => i.text === 'Projects')!.id
    b = make([{ op: 'addField', id: view, field: { name: 'Big', type: 'formula', formula: 'if({Cost} > 100, "big", "small")' } }], b)
    expect(shown(b, named(b, 'Projects')).map((r) => r.Big)).toEqual(['big', 'small'])
    // A broken formula shows a mark rather than breaking the view.
    b = make([{ op: 'addField', id: view, field: { name: 'Broken', type: 'formula', formula: '{Nope} * 2' } }], b)
    const c = D.withComputed(b, named(b, 'Projects'))
    expect(c.records.every((r) => r.values[c.fields.find((f) => f.name === 'Broken')!.id] === '⚠')).toBe(true)
    expect((c.fields.find((f) => f.name === 'Broken') as D.ShownField).problem).toMatch(/no field called \{Nope\}/)
    expect(() => make([{ op: 'addRecords', id: view, records: [{ Project: 'X', Tasks: ['Missing task'] }] }], b)).toThrow(/no record is called "Missing task"/)
    expect(() => make([{ op: 'addField', id: view, field: { name: 'R', type: 'rollup', relation: 'Rate' } }], b)).toThrow(/relation field/)
  })

  it('links records within the same database', () => {
    const b = make([
      {
        op: 'createDatabase',
        title: 'People',
        fields: ['Name', { name: 'Reports to', type: 'relation', to: 'People' }],
        records: [{ Name: 'Ana', 'Reports to': 'Lee' }, { Name: 'Lee' }],
      },
    ])
    expect(shown(b, named(b, 'People'))[0]['Reports to']).toBe('Lee')
  })
})
