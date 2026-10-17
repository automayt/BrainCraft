import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { search } from './search'
import { addItem, emptyBoard, getItem, newItem } from './board'
import { addChild, createMap } from './mindmap'
import { branchProgress, parseStatus, setStatus, statusCounts, statusInfo } from './status'
import { fakeMeasure } from './test-helpers'

describe('status marks', () => {
  it('reads statuses by id or name', () => {
    expect(parseStatus('Done')).toBe('done')
    expect(parseStatus('in progress')).toBe('doing')
    expect(parseStatus('In-Progress')).toBe('doing')
    expect(parseStatus('doing')).toBe('doing')
    expect(parseStatus('nope')).toBeUndefined()
    expect(statusInfo('bogus')).toBeUndefined()
  })

  it('sets and clears statuses, skipping frames and widgets', () => {
    let b = emptyBoard()
    let s: number, f: number
    ;[b, s] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }))
    ;[b, f] = addItem(b, newItem('frame', { x: 0, y: 0, w: 10, h: 10 }))
    b = setStatus(b, [s, f], 'waiting')
    expect(getItem(b, s)!.status).toBe('waiting')
    expect(getItem(b, f)!.status).toBeUndefined()
    expect(statusCounts(b).map((c) => [c.info.id, c.count])).toEqual([['waiting', 1]])
    const same = setStatus(b, [s], 'waiting')
    expect(same).toBe(b)
    b = setStatus(b, [s], null)
    expect('status' in getItem(b, s)!).toBe(false)
  })

  it('counts how much of a mind-map branch is done', () => {
    let b = emptyBoard()
    let root: number, a: number, a1: number, a2: number, a3: number
    ;[b, root] = createMap(b, { x: 0, y: 0 }, 'Car')
    ;[b, a] = addChild(b, root, 'right', 'Engine')
    ;[b, a1] = addChild(b, a, undefined, 'Fuel')
    ;[b, a2] = addChild(b, a, undefined, 'Spark')
    ;[b, a3] = addChild(b, a, undefined, 'Air')
    expect(branchProgress(b, a)).toBeNull()
    b = setStatus(b, [a1], 'done')
    b = setStatus(b, [a2], 'doing')
    b = setStatus(b, [a3], 'dropped')
    expect(branchProgress(b, a)).toEqual({ done: 1, total: 2 })
    expect(branchProgress(b, root)).toEqual({ done: 1, total: 2 })
  })

  it('can be set by the update operation and found by search', () => {
    let b = emptyBoard()
    let s: number
    ;[b, s] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }, { text: 'Brakes' }))
    b = applyOps(b, [{ op: 'update', id: s, status: 'In progress' }], { measure: fakeMeasure }).board
    expect(getItem(b, s)!.status).toBe('doing')
    expect(search(b, 'in progress').map((r) => r.id)).toContain(s)
    b = applyOps(b, [{ op: 'update', id: s, status: 'none' }], { measure: fakeMeasure }).board
    expect(getItem(b, s)!.status).toBeUndefined()
    expect(() => applyOps(b, [{ op: 'update', id: s, status: 'finished-ish' }], { measure: fakeMeasure })).toThrow('status')
  })
})
