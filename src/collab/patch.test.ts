import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import * as B from '../model/board'
import { emptyBoard } from '../model/board'
import * as D from '../model/dataset'
import { fakeMeasure } from '../model/test-helpers'
import type { Board, Connector } from '../model/types'
import { type Patch, applyPatches, diff, keyOf, squash } from './patch'

const ops = (b: Board, list: Parameters<typeof applyOps>[1]) => applyOps(b, list, { measure: fakeMeasure }).board

/** Comparable content (ignores the local id counter). */
const content = (b: Board) => JSON.parse(JSON.stringify({ ...b, nextId: 0 }))

function base() {
  return ops(emptyBoard('Plan'), [
    { op: 'createNote', ref: 'a', text: 'One' },
    { op: 'createNote', ref: 'b', text: 'Two' },
    { op: 'connect', from: 'a', to: 'b' },
    { op: 'createMindMap', outline: 'Root\n  Child' },
    { op: 'createDatabase', title: 'Work', records: [{ Name: 'x', Status: 'To do' }, { Name: 'y', Status: 'Done' }, { Name: 'z', Status: 'Done' }] },
  ])
}

describe('patches', () => {
  it('turn one board into another, for many kinds of change', () => {
    const a = base()
    const edits: ((b: Board) => Board)[] = [
      (b) => ({ ...b, title: 'Renamed' }),
      (b) => B.updateItem(b, b.items[0].id, (i) => ({ ...i, text: 'Changed', x: 99 })),
      (b) => B.remove(b, new Set([b.items[1].id])),
      (b) => B.bringToFront(b, new Set([b.items[0].id])),
      (b) => ops(b, [{ op: 'createNote', text: 'New' }]),
      (b) => D.updateDataset(b, b.datasets![0].id, (d) => D.setValue(d, d.records[0].id, d.fields[0].id, 'renamed')),
      (b) => D.updateDataset(b, b.datasets![0].id, (d) => D.moveRecord(d, d.records[2].id, d.records[0].id)),
      (b) => D.updateDataset(b, b.datasets![0].id, (d) => D.addField(d, 'Points', 'number')[0]),
      (b) => D.updateDataset(b, b.datasets![0].id, (d) => D.deleteRecord(d, d.records[1].id)),
      (b) => B.remove(b, new Set(b.items.filter((i) => i.kind === 'data').map((i) => i.id))),
    ]
    let prev = a
    for (const edit of edits) {
      const next = edit(prev)
      const p = diff(prev, next)
      expect(p.length).toBeGreaterThan(0)
      expect(content(applyPatches(prev, p))).toEqual(content(next))
      // And back again: what undo does.
      expect(content(applyPatches(next, diff(next, prev)))).toEqual(content(prev))
      prev = next
    }
  })

  it('finds nothing to send when nothing changed', () => {
    const a = base()
    expect(diff(a, a)).toEqual([])
    expect(diff(a, JSON.parse(JSON.stringify(a)))).toEqual([])
  })

  it('only sends the paint order when existing items change places', () => {
    const a = base()
    const added = ops(a, [{ op: 'createNote', text: 'Late' }])
    expect(diff(a, added).some((p) => p.k === 'order')).toBe(false)
    const raised = B.bringToFront(a, new Set([a.items[0].id]))
    expect(diff(a, raised).some((p) => p.k === 'order')).toBe(true)
  })

  it('merges two people editing different objects', () => {
    const a = base()
    const mine = B.updateItem(a, a.items[0].id, (i) => ({ ...i, text: 'Mine' }))
    const theirs = B.updateItem(a, a.items[1].id, (i) => ({ ...i, text: 'Theirs' }))
    const merged = applyPatches(mine, diff(a, theirs))
    expect(merged.items[0].text).toBe('Mine')
    expect(merged.items[1].text).toBe('Theirs')
  })

  it('undoes only my change when someone else edited meanwhile', () => {
    const a = base()
    const mine = B.updateItem(a, a.items[0].id, (i) => ({ ...i, text: 'Mine' }))
    const withTheirs = B.updateItem(mine, a.items[1].id, (i) => ({ ...i, text: 'Theirs' }))
    const undone = applyPatches(withTheirs, diff(mine, a))
    expect(undone.items[0].text).toBe('One')
    expect(undone.items[1].text).toBe('Theirs')
  })

  it('drops lines whose ends were deleted elsewhere', () => {
    const a = base()
    const p = [{ k: 'item' as const, id: a.items[0].id, v: null }]
    expect(applyPatches(a, p).connectors).toHaveLength(0)
  })

  it('squashes repeated patches to the last one per object', () => {
    const p = squash([
      { k: 'title', v: 'a' },
      { k: 'item', id: 1, v: null },
      { k: 'title', v: 'b' },
    ])
    expect(p.map(keyOf)).toEqual(['i:1', 'title'])
    expect(p[1]).toEqual({ k: 'title', v: 'b' })
  })
})

describe('applyPatches matches applying one change at a time', () => {
  // The straightforward version: each change copies the lists.
  function oneByOne(b: Board, patches: Patch[]): Board {
    let items = b.items
    let connectors = b.connectors
    for (const p of patches) {
      if (p.k === 'item') {
        const at = items.findIndex((i) => i.id === p.id)
        if (p.v === null) items = items.filter((i) => i.id !== p.id)
        else if (at >= 0) items = items.map((i, k) => (k === at ? p.v! : i))
        else items = [...items, p.v]
      } else if (p.k === 'conn') {
        const at = connectors.findIndex((c) => c.id === p.id)
        if (p.v === null) connectors = connectors.filter((c) => c.id !== p.id)
        else if (at >= 0) connectors = connectors.map((c, k) => (k === at ? p.v! : c))
        else connectors = [...connectors, p.v]
      } else if (p.k === 'order') {
        const byId = new Map(items.map((i) => [i.id, i]))
        const first = [...new Set(p.v)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
        items = [...first, ...items.filter((i) => !p.v.includes(i.id))]
      }
    }
    const ids = new Set(items.map((i) => i.id))
    connectors = connectors.filter((c) => ids.has(c.from) && ids.has(c.to))
    return { ...b, items, connectors }
  }

  it('for random mixes of adds, edits, deletes, re-adds and reorders', () => {
    let seed = 7
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n)
    for (let round = 0; round < 300; round++) {
      let b = emptyBoard()
      for (let k = 0; k < 8; k++) b = B.addItem(b, B.newItem('sticky', { x: k * 10, y: 0, w: 10, h: 10 }))[0]
      const patches: Patch[] = []
      for (let k = 0; k < 14; k++) {
        const id = 1 + rnd(12)
        const r = rnd(10)
        if (r < 4) patches.push({ k: 'item', id, v: { ...B.newItem('sticky', { x: rnd(100), y: 0, w: 10, h: 10 }), id, text: `v${k}` } })
        else if (r < 6) patches.push({ k: 'item', id, v: null })
        else if (r < 8) patches.push({ k: 'conn', id: 100 + rnd(4), v: rnd(3) ? ({ id: 100 + rnd(4), from: 1 + rnd(12), to: 1 + rnd(12) } as Connector) : null })
        else patches.push({ k: 'order', v: [1 + rnd(12), 1 + rnd(12), 1 + rnd(12)] })
      }
      // Connector patches carry their own id.
      for (const p of patches) if (p.k === 'conn' && p.v) p.v = { ...p.v, id: p.id }
      const want = oneByOne(b, patches)
      const got = applyPatches(b, patches)
      expect(got.items.map((i) => [i.id, i.text])).toEqual(want.items.map((i) => [i.id, i.text]))
      expect(got.connectors).toEqual(want.connectors)
    }
  })
})

describe('board icon', () => {
  it('travels as its own patch and can be taken off again', () => {
    const a = emptyBoard()
    const z = { ...a, icon: '🚗' }
    const p = diff(a, z)
    expect(p).toEqual([{ k: 'icon', v: '🚗' }])
    expect(keyOf(p[0])).toBe('icon')
    expect(applyPatches(a, p).icon).toBe('🚗')
    const back = applyPatches(z, diff(z, a))
    expect('icon' in back).toBe(false)
  })
})
