import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { emptyBoard } from './board'
import { canLink, cleanItemLink, describeLink, setItemLink } from './itemLink'
import { backlinks, boardLinks } from './notes'
import { cleanItem } from './sanitize'
import { fromJson, toJson } from './serialize'
import { fakeMeasure } from './test-helpers'

const board = () => applyOps(emptyBoard('Plan'), [{ op: 'createText', ref: 't', text: 'Packing list' }, { op: 'createNote', ref: 'n', text: 'Budget' }], { measure: fakeMeasure }).board

describe('links on objects', () => {
  it('lead to a wiki page (and heading), a board, an object, or a web address, and nothing else', () => {
    expect(cleanItemLink({ board: 'w1', page: 'p1', heading: 'tent', label: 'Packing' })).toEqual({ board: 'w1', page: 'p1', heading: 'tent', label: 'Packing' })
    expect(cleanItemLink({ item: 4 })).toEqual({ item: 4 })
    expect(cleanItemLink({ url: 'https://example.org/a b' })).toEqual({ url: 'https://example.org/a%20b' })
    // Scripts, junk and nowhere at all are refused.
    expect(cleanItemLink({ url: 'javascript:alert(1)' })).toBeNull()
    expect(cleanItemLink({ url: 'not a url' })).toBeNull()
    expect(cleanItemLink({ board: '../x' })).toBeNull()
    expect(cleanItemLink({ label: 'Nowhere' })).toBeNull()
    expect(cleanItemLink({ heading: 'x' })).toBeNull()
    // A link card is a link already.
    expect(canLink('link')).toBe(false)
    expect(describeLink({ url: 'https://example.org/' })).toBe('https://example.org/')
    expect(describeLink({ board: 'w1', page: 'p1', label: 'Packing' })).toBe('Packing')
  })

  it('are set and taken away in one go, kept with the board, and checked when it comes back', () => {
    const b = board()
    const [t, n] = b.items
    const linked = setItemLink(b, [t.id, n.id], { board: 'w1', page: 'p1', label: 'Packing' })
    expect(linked.items.every((i) => i.linkTo?.page === 'p1')).toBe(true)
    expect(fromJson(toJson(linked)).items[0].linkTo).toEqual({ board: 'w1', page: 'p1', label: 'Packing' })
    expect(setItemLink(linked, [t.id], null).items[0].linkTo).toBeUndefined()
    expect(setItemLink(b, [t.id], null)).toBe(b)
    expect(cleanItem({ ...t, linkTo: { url: 'javascript:x' } })!.linkTo).toBeUndefined()
  })

  it('can be set through the API (and by the assistant)', () => {
    const b = board()
    const id = b.items[0].id
    const r = applyOps(b, [{ op: 'update', id, linkTo: { board: 'w1', page: 'p1' } }], { measure: fakeMeasure }).board
    expect(r.items[0].linkTo).toEqual({ board: 'w1', page: 'p1' })
    const web = applyOps(r, [{ op: 'update', id, linkTo: 'https://example.org' }], { measure: fakeMeasure }).board
    expect(web.items[0].linkTo).toEqual({ url: 'https://example.org/' })
    expect(applyOps(web, [{ op: 'update', id, linkTo: null }], { measure: fakeMeasure }).board.items[0].linkTo).toBeUndefined()
    expect(() => applyOps(b, [{ op: 'update', id, linkTo: { label: 'x' } }], { measure: fakeMeasure })).toThrow(/linkTo/)
  })

  it('count as links: the page lists the object, and an object linked to lists it', () => {
    const b = board()
    const [t, n] = b.items
    let linked = setItemLink(b, [t.id], { board: 'w1', page: 'p1' })
    expect(boardLinks(linked).find((l) => l.item?.id === t.id)?.to).toEqual({ board: 'w1', page: 'p1' })
    linked = setItemLink(linked, [n.id], { item: t.id })
    expect(backlinks(linked, t.id).map((l) => l.item!.id)).toEqual([n.id])
    // A web address isn't a link inside BrainCraft.
    expect(boardLinks(setItemLink(b, [t.id], { url: 'https://example.org/' }))).toEqual([])
  })
})
