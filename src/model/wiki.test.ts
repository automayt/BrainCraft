import { describe, expect, it } from 'vitest'
import { applyPatches, diff } from '../collab/patch'
import { cleanPatches } from './sanitize'
import { fromJson, toJson } from './serialize'
import type { Board } from './types'
import * as W from './wiki'

const titles = (pages: { title: string }[]) => pages.map((p) => p.title)

function wiki() {
  let b = W.emptyWiki('Trip', 1)
  const home = b.pages![0].id
  let plan: string, food: string, beds: string
  ;[b, plan] = W.addPage(b, { title: 'Plan' }, 2)
  ;[b, food] = W.addPage(b, { title: 'Food', parent: plan }, 3)
  ;[b, beds] = W.addPage(b, { title: 'Beds', parent: plan }, 4)
  return { b, home, plan, food, beds }
}

describe('wiki pages', () => {
  it('builds a tree in order, with paths and sub-pages', () => {
    const { b, plan, beds } = wiki()
    expect(titles(W.childrenOf(b, undefined))).toEqual(['Home', 'Plan'])
    expect(titles(W.childrenOf(b, plan))).toEqual(['Food', 'Beds'])
    expect(titles(W.pagePath(b, beds))).toEqual(['Plan', 'Beds'])
    expect(titles(W.pageOrder(b))).toEqual(['Home', 'Plan', 'Food', 'Beds'])
  })

  it('moves pages, never under themselves, and puts them where asked', () => {
    let { b, home, plan, food, beds } = wiki()
    b = W.movePage(b, beds, plan, food)
    expect(titles(W.childrenOf(b, plan))).toEqual(['Beds', 'Food'])
    expect(W.movePage(b, plan, food)).toBe(b)
    b = W.movePage(b, plan, home)
    expect(titles(W.pagePath(b, food))).toEqual(['Home', 'Plan', 'Food'])
    b = W.movePage(b, plan, undefined)
    expect(titles(W.childrenOf(b, undefined))).toEqual(['Home', 'Plan'])
  })

  it('keeps finding room between pages, however often one is squeezed in', () => {
    let { b, plan, food } = wiki()
    let before = food
    for (let k = 0; k < 80; k++) {
      let id: string
      ;[b, id] = W.addPage(b, { title: `p${k}`, parent: plan, before }, 10 + k)
      before = id
    }
    const kids = W.childrenOf(b, plan)
    expect(kids[0].title).toBe('p79')
    expect(kids.at(-2)!.title).toBe('Food')
    expect(new Set(kids.map((p) => p.rank)).size).toBe(kids.length)
  })

  it('shows pages nested in a loop (two friends at once) at the top, not lost', () => {
    let { b, plan, food } = wiki()
    // As if one friend put Plan under Food while another kept Food under Plan.
    b = { ...b, pages: b.pages!.map((p) => (p.id === plan ? { ...p, parent: food } : p)) }
    const top = titles(W.childrenOf(b, undefined))
    expect(top).toEqual(expect.arrayContaining(['Plan', 'Food']))
    expect(W.pageOrder(b)).toHaveLength(4)
  })

  it('trashes a page with its sub-pages, restores them together, and deletes for good', () => {
    let { b, plan, food } = wiki()
    b = W.trashPage(b, plan, 50)
    expect(titles(W.pageOrder(b))).toEqual(['Home'])
    expect(titles(W.trashed(b))).toEqual(['Plan'])
    b = W.restorePage(b, plan)
    expect(titles(W.pageOrder(b))).toEqual(['Home', 'Plan', 'Food', 'Beds'])
    // A sub-page restored on its own while its parent stays in the trash goes to the top.
    b = W.trashPage(b, food, 60)
    b = W.trashPage(b, plan, 70)
    b = W.restorePage(b, food)
    expect(titles(W.childrenOf(b, undefined))).toEqual(['Home', 'Food'])
    b = W.deletePage(b, plan)
    expect(W.getPage(b, plan)).toBeUndefined()
    expect(b.bodies!.some((x) => x.id === plan)).toBe(false)
  })

  it('syncs a rename and someone typing on the same page without one undoing the other', () => {
    const { b: base, plan } = wiki()
    const renamed = W.setPageMeta(base, plan, { title: 'The plan' })
    const typed = W.setPageBody(base, plan, '- [ ] Book flights', 9, 'Ana')
    // Each friend's change, as it travels, lands on the other's board.
    const a = applyPatches(renamed, cleanPatches(diff(base, typed)))
    const z = applyPatches(typed, cleanPatches(diff(base, renamed)))
    for (const x of [a, z]) {
      expect(W.getPage(x, plan)!.title).toBe('The plan')
      expect(W.pageText(x, plan)).toBe('- [ ] Book flights')
    }
  })

  it('sends a new page before its words, and drops words for a page that is gone', () => {
    const { b: base } = wiki()
    const [withPage, id] = W.addPage(base, { title: 'New', text: 'Hello' }, 9)
    const patches = diff(base, withPage)
    expect(patches.map((p) => p.k)).toEqual(['page', 'body'])
    expect(W.pageText(applyPatches(base, patches), id)).toBe('Hello')
    expect(applyPatches(base, [patches[1]]).bodies!.some((x) => x.id === id)).toBe(false)
  })

  it('saves and loads a wiki, repairing what it can and refusing junk', () => {
    const { b } = wiki()
    const back = fromJson(toJson(b))
    expect(back.kind).toBe('wiki')
    expect(titles(W.pageOrder(back))).toEqual(titles(W.pageOrder(b)))
    const junk = fromJson(
      JSON.stringify({
        version: 1,
        title: 'x',
        items: [],
        connectors: [],
        kind: 'wiki',
        pages: [{ id: 'a', rank: 1, title: 'A', parent: 'gone' }, { id: 'a', title: 'Again' }, { id: '__proto__', title: 'Sneaky' }, { id: 'bad id!', title: 'B' }, 7],
        bodies: [{ id: 'a', text: 'ok' }, { id: 'nope', text: 'orphan' }, { id: 'a', text: 'twice' }],
      }),
    )
    expect(junk.pages!.map((p) => p.id)).toEqual(['a'])
    expect(junk.pages![0].parent).toBeUndefined()
    expect(junk.bodies).toEqual([{ id: 'a', text: 'ok', at: 0 }])
    // A canvas board stays a canvas board.
    expect(fromJson(JSON.stringify({ version: 1, title: 'x', items: [], connectors: [], kind: 'evil' })).kind).toBeUndefined()
  })

  it('refuses page patches that smuggle another id or junk', () => {
    const patches = cleanPatches([
      { k: 'page', id: 'a', v: { id: 'b', rank: 1, title: 'B' } },
      { k: 'body', id: '__proto__', v: { id: '__proto__', text: 'x' } },
      { k: 'page', id: 'c', v: 'nope' },
      { k: 'body', id: 'd', v: { id: 'd', text: 5 } },
    ])
    expect(patches).toEqual([{ k: 'body', id: 'd', v: { id: 'd', text: '', at: 0 } }])
  })

  it('stops adding pages when the wiki is full', () => {
    const b: Board = { ...W.emptyWiki('Big'), pages: Array.from({ length: W.MAX_PAGES }, (_, k) => ({ id: `p${k}`, rank: k, title: `${k}`, created: 0 })) }
    expect(W.addPage(b, { title: 'One more' })).toEqual([b, ''])
  })
})

describe('wiki pages in the editor, rooms and the library', () => {
  it('undoes a burst of typing as one step, and a rename on its own', async () => {
    const { Editor } = await import('../editor/Editor')
    const { fakeMeasure } = await import('./test-helpers')
    const e = new Editor(W.emptyWiki('Trip'), fakeMeasure)
    const page = e.currentPage!
    const original = W.pageText(e.board, page.id)
    e.setPageText(page.id, 'H')
    e.setPageText(page.id, 'He')
    e.setPageText(page.id, 'Hello')
    e.setPageTitle(page.id, 'Start here')
    e.undo()
    expect(e.currentPage!.title).toBe('Home')
    expect(W.pageText(e.board, page.id)).toBe('Hello')
    e.undo()
    expect(W.pageText(e.board, page.id)).toBe(original)
    e.redo()
    expect(W.pageText(e.board, page.id)).toBe('Hello')
  })

  it('passes page changes through a live room, and refuses them from the view link', async () => {
    const { Room } = await import('../collab/room')
    const { fakeMeasure } = await import('./test-helpers')
    const board = W.emptyWiki('Trip', 1)
    const room = new Room({ id: 'r', board, version: 0, editKey: 'e'.repeat(20), viewKey: 'v'.repeat(20), nextSlot: 1, created: 0, updated: 0 }, fakeMeasure)
    const inbox: { t: string }[] = []
    room.join({ id: 'a', role: 'edit', send: (m) => inbox.push(m) })
    room.join({ id: 'v', role: 'view', send: () => {} })
    const [next] = W.addPage(board, { title: 'Food', text: 'Tapas' }, 2)
    room.receive('a', { t: 'patch', seq: 1, patches: diff(board, next) })
    expect(inbox.at(-1)).toMatchObject({ t: 'ack', seq: 1 })
    expect(titles(W.pageOrder(room.data.board))).toEqual(['Home', 'Food'])
    room.receive('v', { t: 'patch', seq: 1, patches: diff(next, W.setPageMeta(next, next.pages![1].id, { title: 'Hacked' })) })
    expect(titles(W.pageOrder(room.data.board))).toEqual(['Home', 'Food'])
  })

  it('saves a wiki in the library with an outline of its pages', async () => {
    const { Library } = await import('../store/library')
    const { MemoryKV } = await import('../store/kv')
    const lib = new Library(new MemoryKV())
    const { b } = wiki()
    const id = await lib.create(b)
    const meta = (await lib.list()).find((m) => m.id === id)!
    expect(meta.kind).toBe('wiki')
    expect(meta.items).toBe(4)
    expect(meta.outline!.map((p) => p.title)).toEqual(['Home', 'Plan', 'Food', 'Beds'])
    expect(titles(W.pageOrder((await lib.load(id))!))).toEqual(['Home', 'Plan', 'Food', 'Beds'])
  })
})
