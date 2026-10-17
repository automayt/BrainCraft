import { describe, expect, it } from 'vitest'
import { applyPatches } from '../collab/patch'
import { addItem, emptyBoard, getItem, newItem } from './board'
import { guessLang, langId, tokenize } from './code'
import { monthGrid } from './dataset'
import { cleanItem, cleanPatches } from './sanitize'
import { fromJson, toJson } from './serialize'
import type { Item } from './types'

describe('untrusted board data', () => {
  it('never treats object built-ins as a code language', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(langId(name), name).toBeUndefined()
      expect(() => tokenize('x', name)).not.toThrow()
    }
    expect(langId(42)).toBeUndefined()
    expect(guessLang('plain words')).toBe('text')
  })

  it('shows this month for a month that isn’t one', () => {
    expect(monthGrid('abc')).toHaveLength(42)
    expect(monthGrid('2026-13')).toHaveLength(42)
  })

  it('cleans wrong types out of the newer fields', () => {
    const bad = {
      ...newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }),
      id: 1,
      status: 'nonsense',
      by: { evil: true },
      hiddenBy: 7,
      back: 3,
      lang: ['x'],
      masked: true,
      wheel: { spin: { at: 'soon' } },
      view: { dataset: 'd', type: 'calendar', month: 'abc' },
    } as unknown as Item
    const clean = cleanItem(bad)!
    for (const k of ['status', 'by', 'hiddenBy', 'back', 'lang', 'masked']) expect(k in clean, k).toBe(false)
    expect(clean.wheel).toEqual({})
    expect(clean.view?.month).toBeUndefined()
    const link = { ...newItem('link', { x: 0, y: 0, w: 10, h: 10 }), id: 2, link: { url: 'https://x.example/', title: 5, site: { a: 1 } } } as unknown as Item
    expect(cleanItem(link)!.link).toEqual({ url: 'https://x.example/' })
    expect(cleanItem({ ...link, link: { title: 'no url' } } as unknown as Item)).toBeNull()
  })

  it('checks live patches and file loads the same way', () => {
    let b = emptyBoard()
    let id: number
    ;[b, id] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }, { text: 'hi' }))
    const evil = { ...getItem(b, id)!, by: { x: 1 } } as unknown as Item
    const patches = cleanPatches([{ k: 'item', id, v: evil }, { k: 'icon', v: { no: 1 } as unknown as string }, { k: 'title', v: 'ok' }])
    const after = applyPatches(b, patches)
    expect('by' in getItem(after, id)!).toBe(false)
    expect(after.icon).toBeUndefined()
    expect(after.title).toBe('ok')
    const raw = JSON.parse(toJson(b))
    raw.items[0].status = 'bogus'
    raw.icon = { x: 1 }
    const loaded = fromJson(JSON.stringify(raw))
    expect(loaded.items[0].status).toBeUndefined()
    expect(loaded.icon).toBeUndefined()
  })
})
