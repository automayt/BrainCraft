import { describe, expect, it } from 'vitest'
import { addDependency, deleteEntry, dependencies, lineUp, removeDependency, wouldLoop } from './timeline'
import type { TimelineData } from './types'

const t0: TimelineData = {
  lanes: [{ id: 'l', name: 'Car' }],
  entries: [
    { id: 'clamps', lane: 'l', title: 'Order clamps', start: '2026-10-01', end: '2026-10-05', color: '#000' },
    { id: 'frame', lane: 'l', title: 'Make subframe', start: '2026-10-03', end: '2026-10-08', color: '#000' },
    { id: 'fit', lane: 'l', title: 'Fit subframe', start: '2026-10-10', end: '2026-10-11', color: '#000' },
    { id: 'drive', lane: 'l', title: 'First drive', start: '2026-10-11', color: '#000' },
  ],
}

describe('timeline dependencies', () => {
  it('links entries, flags clashes and refuses loops', () => {
    let t = addDependency(t0, 'clamps', 'frame')
    t = addDependency(t, 'frame', 'fit')
    expect(dependencies(t)).toEqual([
      { from: 'clamps', to: 'frame', late: true },
      { from: 'frame', to: 'fit', late: false },
    ])
    expect(wouldLoop(t, 'fit', 'clamps')).toBe(true)
    expect(addDependency(t, 'fit', 'clamps')).toBe(t)
    expect(addDependency(t, 'fit', 'fit')).toBe(t)
    expect(addDependency(t, 'clamps', 'frame')).toBe(t)
    t = removeDependency(t, 'clamps', 'frame')
    expect(dependencies(t).map((d) => d.from)).toEqual(['frame'])
  })

  it('lets something start on a milestone’s day, but not on a span’s last day', () => {
    let t = addDependency(t0, 'fit', 'drive')
    expect(dependencies(t)[0].late).toBe(true)
    t = { ...t, entries: t.entries.map((e) => (e.id === 'fit' ? { ...e, end: undefined } : e)) }
    expect(dependencies(t)[0].late).toBe(false)
  })

  it('lines up a chain so each starts after what it waits for', () => {
    let t = addDependency(t0, 'clamps', 'frame')
    t = addDependency(t, 'frame', 'fit')
    t = addDependency(t, 'fit', 'drive')
    t = lineUp(t)
    const at = (id: string) => t.entries.find((e) => e.id === id)!
    expect([at('frame').start, at('frame').end]).toEqual(['2026-10-06', '2026-10-11'])
    expect([at('fit').start, at('fit').end]).toEqual(['2026-10-12', '2026-10-13'])
    expect(at('drive').start).toBe('2026-10-14')
    expect(dependencies(t).every((d) => !d.late)).toBe(true)
    expect(lineUp(t)).toBe(t)
  })

  it('forgets dependencies on deleted entries', () => {
    const t = deleteEntry(addDependency(t0, 'clamps', 'frame'), 'clamps')
    expect(t.entries.find((e) => e.id === 'frame')!.after).toBeUndefined()
  })
})
