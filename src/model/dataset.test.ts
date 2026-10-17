import { describe, expect, it } from 'vitest'
import * as D from './dataset'
import { fromDay, today } from './timeline'
import type { DataView, Dataset } from './types'

function sample() {
  const ds = D.newDataset('Projects', 20000)
  const [title, status, owner, start, due] = ds.fields
  return { ds, title, status, owner, start, due }
}

const names = (ds: Dataset, rows = ds.records) => rows.map((r) => D.recordTitle(ds, r))

describe('datasets', () => {
  it('starts with typed fields and sample records', () => {
    const { ds, status } = sample()
    expect(ds.fields.map((f) => f.type)).toEqual(['text', 'select', 'person', 'date', 'date'])
    expect(status.options!.map((o) => o.name)).toEqual(['To do', 'In progress', 'Done'])
    expect(names(ds)).toEqual(['Research', 'Design', 'Build', 'Launch'])
  })

  it('coerces values to the field type', () => {
    const { ds, status } = sample()
    let d = ds
    let points: string, flag: string
    ;[d, points] = D.addField(d, 'Points', 'number')
    ;[d, flag] = D.addField(d, 'Blocked', 'checkbox')
    const id = d.records[0].id
    d = D.setValue(d, id, points, '1,250')
    d = D.setValue(d, id, flag, 'yes')
    d = D.setValue(d, id, status.id, 'done')
    expect(d.records[0].values).toMatchObject({ [points]: 1250, [flag]: true, [status.id]: status.options![2].id })
    d = D.setValue(d, id, points, 'lots')
    expect(points in d.records[0].values).toBe(false)
  })

  it('keeps field names unique and the title field undeletable', () => {
    const { ds, title } = sample()
    const [d, id] = D.addField(ds, 'Status', 'text')
    expect(D.fieldById(d, id)!.name).toBe('Status 2')
    expect(D.deleteField(d, title.id)).toBe(d)
    expect(D.renameField(d, id, 'owner')).toBe(d)
  })

  it('converts a text field to choices made from its values', () => {
    const { ds, owner } = sample()
    const d = D.changeFieldType(ds, owner.id, 'select')
    const f = D.fieldById(d, owner.id)!
    expect(f.options!.map((o) => o.name)).toEqual(['Sam', 'Alex', 'Jo'])
    expect(D.display(d, f, d.records[3].values[owner.id])).toBe('Sam')
  })

  it('sorts and searches without changing the data', () => {
    const { ds, owner, due } = sample()
    const v: DataView = { dataset: ds.id, type: 'table', sort: { field: owner.id, dir: 'asc' } }
    expect(names(ds, D.viewRecords(ds, v))).toEqual(['Design', 'Build', 'Research', 'Launch'])
    expect(names(ds, D.viewRecords(ds, { ...v, sort: { field: due.id, dir: 'desc' } }))).toEqual(['Launch', 'Build', 'Design', 'Research'])
    expect(names(ds, D.viewRecords(ds, { ...v, sort: undefined, query: 'sam' }))).toEqual(['Research', 'Launch'])
    expect(names(ds)).toEqual(['Research', 'Design', 'Build', 'Launch'])
  })

  it('groups a board by a choice field and moves cards between columns', () => {
    const { ds, status } = sample()
    const v: DataView = { dataset: ds.id, type: 'board' }
    expect(D.groups(ds, v).map((g) => [g.name, names(ds, g.records)])).toEqual([
      ['To do', ['Build', 'Launch']],
      ['In progress', ['Design']],
      ['Done', ['Research']],
    ])
    const launch = ds.records[3].id
    const moved = D.moveToGroup(ds, v, launch, status.options![2].id, ds.records[0].id)
    expect(D.groups(moved, v).map((g) => names(moved, g.records))).toEqual([['Build'], ['Design'], ['Launch', 'Research']])
    const cleared = D.moveToGroup(ds, v, launch, null, null)
    expect(D.groups(cleared, v)[0]).toMatchObject({ key: null, name: 'No status' })
  })

  it('lays out timeline bars from date fields and shifts them', () => {
    const { ds, start, due } = sample()
    const v: DataView = { dataset: ds.id, type: 'timeline' }
    const { bars, undated } = D.bars(ds, v)
    expect(undated).toBe(0)
    expect(bars[0]).toMatchObject({ start: 19990, end: 19997, milestone: false })
    const id = ds.records[0].id
    let d = D.shiftDates(ds, v, id, 3)
    expect(d.records[0].values[start.id]).toBe(fromDay(19993))
    expect(d.records[0].values[due.id]).toBe(fromDay(20000))
    d = D.shiftDates(d, v, id, -20, 'end')
    // The end never goes before the start.
    expect(d.records[0].values[due.id]).toBe(d.records[0].values[start.id])
  })

  it('takes values by field name, adding new choices as needed', () => {
    const { ds, status } = sample()
    const { values, unknown, ds: d } = D.valuesByName(ds, { Name: 'Docs', Status: 'Blocked', Due: '2026-11-02', Colour: 'red' })
    expect(unknown).toEqual(['Colour'])
    expect(D.fieldById(d, status.id)!.options!.map((o) => o.name)).toContain('Blocked')
    expect(Object.keys(values)).toHaveLength(3)
  })

  it('builds datasets from tables, Kanban boards and timelines', () => {
    const ds = D.datasetFromColumns('Bugs', ['Bug', 'Severity', 'Points', 'Found', 'Fixed'], [
      ['Crash', 'High', '3', '2026-10-01', 'yes'],
      ['Typo', 'Low', '1', '2026-10-02', 'no'],
      ['Slow', 'High', '5', '2026-10-03', 'no'],
      ['Leak', 'Low', '8', '2026-10-04', 'yes'],
    ])
    expect(ds.fields.map((f) => f.type)).toEqual(['text', 'select', 'number', 'date', 'checkbox'])
    expect(D.toCsv(ds).split('\n')[1]).toBe('Crash,High,3,2026-10-01,Yes')

    const k = D.datasetFromKanban('Sprint', { columns: [{ id: 'a', title: 'To do', cards: [{ id: 'c', title: 'Spec', due: '2026-10-20' }] }, { id: 'b', title: 'Done', cards: [] }] })
    expect(D.plainRecords(k)).toEqual([{ id: k.records[0].id, Title: 'Spec', Status: 'To do', Due: '2026-10-20' }])

    const t = D.datasetFromTimeline('Plan', { lanes: [{ id: 'l', name: 'Build' }], entries: [{ id: 'e', lane: 'l', title: 'Beta', start: '2026-11-01', color: '#000' }] })
    expect(D.plainRecords(t)[0]).toMatchObject({ Title: 'Beta', Lane: 'Build', Start: '2026-11-01' })
  })

  it('infers column types', () => {
    expect(D.inferType(['1', '2.5', ''])).toBe('number')
    expect(D.inferType(['2026-01-01'])).toBe('date')
    expect(D.inferType(['a', 'b', 'a', 'b'])).toBe('select')
    expect(D.inferType(['one', 'two', 'three'])).toBe('text')
    expect(D.inferType(['Sam', 'Jo', 'Sam'], 'Owner')).toBe('person')
  })

  it('keeps today in local time', () => {
    expect(D.coerce({ id: 'x', name: 'd', type: 'date' }, 'not a date')).toBeUndefined()
    expect(typeof today()).toBe('number')
  })
})

describe('calendar and gallery views', () => {
  it('lays a month out in Monday-first weeks', async () => {
    const D = await import('./dataset')
    const { toDay } = await import('./timeline')
    const cells = D.monthGrid('2026-10')
    expect(cells).toHaveLength(42)
    // 1 October 2026 is a Thursday, so the grid starts on Monday 28 September.
    expect(cells[0].day).toBe(toDay('2026-09-28'))
    expect(cells[3]).toEqual({ day: toDay('2026-10-01'), inMonth: true })
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31)
    expect(D.addMonths('2026-12', 1)).toBe('2027-01')
    expect(D.addMonths('2026-01', -1)).toBe('2025-12')
  })

  it('puts records on every day they cover and moves them by their start', async () => {
    const D = await import('./dataset')
    const { toDay } = await import('./timeline')
    let ds = D.newDataset('Car', toDay('2026-10-10'))
    const v = D.newView(ds.id, 'calendar')
    const cells = D.monthGrid('2026-10')
    const byDay = D.recordsByDay(ds, v, cells)
    const research = ds.records[0]
    // "Research" runs from 10 days before to 3 days before the 10th.
    expect(byDay.get(toDay('2026-09-30'))?.map((b) => b.record.id)).toContain(research.id)
    expect(byDay.get(toDay('2026-10-07'))?.map((b) => b.record.id)).toContain(research.id)
    expect(byDay.get(toDay('2026-10-08'))?.map((b) => b.record.id) ?? []).not.toContain(research.id)
    ds = D.moveToDay(ds, v, research.id, toDay('2026-10-20'))
    const { start, end } = D.dateFields(ds, v)
    const moved = ds.records.find((r) => r.id === research.id)!
    expect([moved.values[start!.id], moved.values[end!.id]]).toEqual(['2026-10-20', '2026-10-27'])
  })

  it('finds a cover picture in a text field', async () => {
    const D = await import('./dataset')
    let ds = D.datasetFromColumns('Cars', ['Name', 'Photo'], [['240z', 'https://example.com/z.jpg?w=400'], ['Celica', 'not a picture']])
    expect(D.coverOf(ds, ds.records[0])).toBe('https://example.com/z.jpg?w=400')
    expect(D.coverOf(ds, ds.records[1])).toBeUndefined()
    ds = D.datasetFromColumns('Cars', ['Name'], [['x']])
    expect(D.coverOf(ds, ds.records[0])).toBeUndefined()
  })
})
