import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { boardText } from '../ai/boardText'
import { applyPatches } from '../collab/patch'
import { Editor } from '../editor/Editor'
import { BoardView } from '../ui/BoardView'
import { EditorContext } from '../ui/useEditor'
import { addItem, emptyBoard, newItem } from './board'
import { allNotes } from './notes'
import { cleanPatches } from './sanitize'
import { search } from './search'
import { fromJson, toJson } from './serialize'
import { fakeMeasure } from './test-helpers'
import type { Board } from './types'

const base = { x: 0, y: 0, w: 100, h: 100, color: '#fff', text: 'x', fontSize: 16 }

/** Boards (or items) people could send in a file, a share link or a live session. */
const HOSTILE: Record<string, unknown>[] = [
  { ...base, id: 1, kind: 'sticky', text: 123 },
  { ...base, id: 1, kind: 'sticky', text: undefined },
  { ...base, id: 1, kind: 'pen', points: [null, { x: 'a' }] },
  { ...base, id: 1, kind: 'pen', points: 5 },
  { ...base, id: 1, kind: 'table', table: {} },
  { ...base, id: 1, kind: 'table', table: { columns: [null], rows: 'no' } },
  { ...base, id: 1, kind: 'kanban', kanban: { columns: 'x' } },
  { ...base, id: 1, kind: 'kanban', kanban: { columns: [{ id: 'c', cards: null }] } },
  { ...base, id: 1, kind: 'timeline', timeline: { lanes: null, entries: [null, { id: 'e' }] } },
  { ...base, id: 1, kind: 'sticky', notes: 'abc' },
  { ...base, id: 1, kind: 'sticky', notes: [null, { text: 5 }] },
  { ...base, id: 1, kind: 'sticky', description: {} },
  { ...base, id: 1, kind: 'comment', poll: { options: 'x' } },
  { ...base, id: 1, kind: 'sticky', reactions: { '👍': 'sam' }, votes: { 3: { constructor: 'many' } } },
  { ...base, id: 1, kind: 'bogus' },
  { id: 1, kind: 'sticky', text: 'no position' },
  { ...base, id: 1, kind: 'sticky', title: {}, color: 7, fontSize: 'big' },
]

function survive(b: Board) {
  const editor = new Editor(b, fakeMeasure)
  search(b, 'x')
  allNotes(b)
  boardText(b, {})
  renderToStaticMarkup(createElement(EditorContext.Provider, { value: editor }, createElement(BoardView, { board: b, hidden: new Set<number>(), editingId: null, editingLabel: null, selectedConnector: null, selection: new Set<number>() })))
}

describe('hostile board data', () => {
  it.each(HOSTILE.map((item, k) => [k, item] as const))('case %i loads, searches and draws without crashing', (_k, item) => {
    const raw = { version: 1, title: 'T', items: [item], connectors: [null, { id: 9, from: 1, to: 'x' }], nextId: 2, datasets: [{ id: 'd', name: 'D', fields: [{ id: 'f', type: 'bogus' }, { id: 'g', name: 'G', type: 'select', options: 'x' }], records: [{ id: 'r', values: { g: { evil: 1 } } }] }] }
    const b = fromJson(JSON.stringify(raw))
    expect(() => survive(b)).not.toThrow()
    // Through a live session too.
    const live = applyPatches(emptyBoard(), cleanPatches([{ k: 'item', id: 1, v: item }]))
    expect(() => survive(live)).not.toThrow()
  })

  it('refuses patches that smuggle another id or broken lists', () => {
    const b = applyPatches(emptyBoard(), cleanPatches([{ k: 'item', id: 1, v: { ...base, id: 1, kind: 'sticky' } }]))
    const patches = cleanPatches([
      { k: 'item', id: 2, v: { ...base, id: 1, kind: 'sticky' } },
      { k: 'order', v: 5 },
      { k: 'ds', id: 'd', v: { id: 'd', fields: [], order: 7 } },
      { k: 'title', v: {} },
      { k: 'rec', ds: 'd', id: 'r', v: 'garbage' },
      { k: 'conn', id: 3, v: { id: 3, from: 'a' } },
    ])
    expect(patches).toEqual([])
    expect(applyPatches(b, patches).items).toHaveLength(1)
  })

  it('keeps the first of two items with the same id', () => {
    const b = fromJson(JSON.stringify({ version: 1, title: 't', items: [{ ...base, id: 1, kind: 'sticky', text: 'a' }, { ...base, id: 1, kind: 'sticky', text: 'b' }], connectors: [], nextId: 2 }))
    expect(b.items.map((i) => i.text)).toEqual(['a'])
  })

  it('ignores a nextId that would give new objects ids a reload drops', () => {
    for (const nextId of ['1e309', '2.5', '-4']) {
      const b = fromJson(`{"version":1,"title":"t","items":[${JSON.stringify({ ...base, id: 7, kind: 'sticky' })}],"connectors":[],"nextId":${nextId}}`)
      expect(b.nextId).toBe(8)
      const [withNew, id] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }))
      expect(fromJson(toJson(withNew)).items.some((i) => i.id === id)).toBe(true)
    }
  })

  it('opens a very big board (no spreading its ids into Math.max)', () => {
    const items = Array.from({ length: 200_000 }, (_, k) => ({ ...base, id: k + 1, kind: 'sticky', text: '' }))
    const b = fromJson(JSON.stringify({ version: 1, title: 't', items, connectors: [], nextId: 1 }))
    expect(b.nextId).toBe(200_001)
  })
})
