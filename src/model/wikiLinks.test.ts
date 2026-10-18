import { describe, expect, it } from 'vitest'
import { type Op, applyOps } from '../api/ops'
import { getPage as readPage, listPages } from '../api/queries'
import { runTool, type ToolHost } from '../api/tools'
import { Editor } from '../editor/Editor'
import { openFromHash, openHash, targetFromUrl } from '../store/deepLink'
import { MemoryKV } from '../store/kv'
import { LinkIndex } from '../store/links'
import { Library } from '../store/library'
import { Workspace } from '../store/workspace'
import { addItem, emptyBoard, newItem } from './board'
import { boardLinks, linkCandidates, linkToken, parseNote, resolveName } from './notes'
import { addNote } from './notes'
import { cleanItem } from './sanitize'
import { fakeMeasure } from './test-helpers'
import type { Board } from './types'
import * as W from './wiki'

const ctx = { measure: fakeMeasure, now: 5 }

function tripWiki() {
  let b = W.emptyWiki('Trip', 1)
  let flights: string
  ;[b, flights] = W.addPage(b, { title: 'Flights', text: '## Budget\nSee [[Plan]](board:plan1#7)' }, 2)
  return { b, flights }
}

describe('links between wikis and boards', () => {
  it('writes and reads page and heading links, and keeps the old forms working', () => {
    const page = linkToken('Flights › Budget', { board: 'wiki1', page: 'abc', heading: 'budget' })
    expect(page).toBe('[[Flights › Budget]](board:wiki1/page:abc#budget)')
    expect(parseNote(page)).toEqual([{ link: { board: 'wiki1', page: 'abc', heading: 'budget' }, label: 'Flights › Budget' }])
    expect(parseNote(linkToken('Here', { page: 'abc' }))).toEqual([{ link: { page: 'abc' }, label: 'Here' }])
    expect(parseNote('[[Note]](board:k#12)')).toEqual([{ link: { board: 'k', item: 12 }, label: 'Note' }])
  })

  it('offers and finds wiki pages from a canvas board', () => {
    const refs = [{ key: 'wiki1', title: 'Trip', kind: 'wiki' as const, pages: [{ id: 'abc', title: 'Flights' }, { id: 'def', title: 'Food' }] }]
    const picks = linkCandidates(emptyBoard(), 'fli', refs)
    expect(picks).toContainEqual({ label: 'Flights', hint: '📘 Trip', to: { board: 'wiki1', page: 'abc' } })
    expect(resolveName('Food', emptyBoard(), refs)).toEqual({ board: 'wiki1', page: 'def' })
    // In a wiki, its own pages come first.
    const { b, flights } = tripWiki()
    expect(resolveName('flights', b, refs)).toEqual({ page: flights })
  })

  it('finds links on wiki pages as well as on objects', () => {
    const { b, flights } = tripWiki()
    const links = boardLinks(b)
    expect(links).toContainEqual(expect.objectContaining({ page: expect.objectContaining({ id: flights }), to: { board: 'plan1', item: 7 } }))
  })

  it('indexes backlinks both ways: pages to objects, and comments to pages', async () => {
    const lib = new Library(new MemoryKV())
    const { b: wiki, flights } = tripWiki()
    const wikiId = await lib.create(wiki)
    let plan = emptyBoard('Plan')
    let note: number
    ;[plan, note] = addItem(plan, newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'Book' }))
    plan = addNote(plan, note, `Details in ${linkToken('Flights', { board: wikiId, page: flights })}`)
    const planId = await lib.create(plan)
    const index = new LinkIndex(lib)
    const boards = await lib.list()
    // The wiki page links to an object on the plan board (by its key here, "plan1" stands in).
    const toPlan = await index.to(['plan1'], boards, planId)
    expect(toPlan).toEqual([expect.objectContaining({ boardId: wikiId, fromPage: flights, fromLabel: 'Flights', to: { board: 'plan1', item: 7 } })])
    // The comment on the plan board links to the wiki page.
    const toWiki = await index.to([wikiId], boards, wikiId)
    expect(toWiki).toEqual([expect.objectContaining({ boardId: planId, from: note, to: { board: wikiId, page: flights } })])
  })

  it('makes and reads web links to a page, a heading or an object', () => {
    expect(openHash('wiki1', { page: 'abc', heading: 'budget' })).toBe('open=wiki1&page=abc&h=budget')
    expect(openFromHash('#open=wiki1&page=abc&h=budget')).toEqual({ board: 'wiki1', page: 'abc', heading: 'budget' })
    expect(openFromHash('#open=k&item=12')).toEqual({ board: 'k', item: 12 })
    expect(openFromHash('#open=bad key!')).toBeNull()
    expect(openFromHash('#open=k&page=__proto__&item=-3')).toEqual({ board: 'k' })
    expect(targetFromUrl('http://localhost:8080/#open=k&page=abc')).toEqual({ board: 'k', page: 'abc' })
    expect(targetFromUrl('https://example.com/page')).toBeNull()
  })

  it('opens a pasted page link in an open tab, and turns it into a page card on a board', async () => {
    const editor = new Editor(emptyBoard(), fakeMeasure)
    const ws = await Workspace.start(editor, new MemoryKV(), '')
    const canvas = ws.boardId!
    const { b: wiki, flights } = tripWiki()
    const wikiId = await ws.newBoard(wiki)
    await ws.switchTo(canvas)
    expect(await ws.openHash(`#open=${wikiId}&page=${flights}`)).toBe(true)
    expect(ws.boardId).toBe(wikiId)
    expect(editor.currentPage!.title).toBe('Flights')
    expect(await ws.labelFor({ board: wikiId, page: flights, heading: 'budget' })).toBe('Flights › Budget')
    await ws.switchTo(canvas)
    await ws.addPageCard({ board: wikiId, page: flights }, `http://x/#open=${wikiId}&page=${flights}`)
    const card = editor.single!
    expect(card).toMatchObject({ kind: 'link', page: { board: wikiId, page: flights } })
    expect(card.link!.title).toBe('Flights')
    expect(card.link!.description).toContain('Budget')
    // It survives a save and reload, and a page id that isn't one is dropped.
    expect(cleanItem(card)!.page).toEqual({ board: wikiId, page: flights })
    expect(cleanItem({ ...card, page: { board: 'k', page: '__proto__' } })!.page).toBeUndefined()
    ws.dispose()
  })
})

describe('page operations and tools', () => {
  it('creates, nests, appends to, moves and trashes pages, by ref or title', () => {
    const ops: Op[] = [
      { op: 'createPage', title: 'Plan', ref: 'plan', text: '# Plan' },
      { op: 'createPage', title: 'Food', parent: 'plan', text: 'Tapas' },
      { op: 'updatePage', page: 'Food', append: '- Paella' },
      { op: 'createPage', title: 'Beds', parent: 'plan', before: 'Food' },
      { op: 'movePage', page: 'Beds', parent: null },
      { op: 'deletePage', page: 'Home' },
    ]
    const { board, results } = applyOps(W.emptyWiki('Trip', 1), ops, ctx)
    expect(results[0]).toMatchObject({ op: 'createPage', ref: 'plan' })
    const order = W.pageOrder(board).map((p) => p.title)
    expect(order).toEqual(['Plan', 'Food', 'Beds'])
    expect(W.pageText(board, W.pageByTitle(board, 'Food')!.id)).toBe('Tapas\n- Paella')
    expect(W.trashed(board).map((p) => p.title)).toEqual(['Home'])
  })

  it('keeps page operations to wikis, and canvas operations to boards', () => {
    expect(() => applyOps(emptyBoard(), [{ op: 'createPage', title: 'X' }], ctx)).toThrow(/wikis/)
    expect(() => applyOps(W.emptyWiki(), [{ op: 'createNote', text: 'X' }], ctx)).toThrow(/this is a wiki/)
    expect(() => applyOps(W.emptyWiki(), [{ op: 'updatePage', page: 'Nope', text: 'x' }], ctx)).toThrow(/isn't a page/)
    const [b, a] = W.addPage(W.emptyWiki(), { title: 'A' })
    const [b2] = W.addPage(b, { title: 'B', parent: a })
    expect(() => applyOps(b2, [{ op: 'movePage', page: 'A', parent: 'B' }], ctx)).toThrow(/own sub-pages/)
  })

  it('lists and reads pages for AI assistants', async () => {
    const { b, flights } = tripWiki()
    let board: Board = b
    const host: ToolHost = {
      where: () => 'the wiki',
      board: () => board,
      apply: (ops) => {
        const out = applyOps(board, ops, ctx)
        board = out.board
        return out.results
      },
      listBoards: async () => [],
      openBoard: async () => ({ id: '', title: '' }),
      createBoard: async () => ({ id: '', title: '' }),
    }
    const list = (await runTool(host, 'list_pages')) as ReturnType<typeof listPages>
    expect(list.pages.map((p) => (p as { title: string }).title)).toEqual(['Home', 'Flights'])
    const page = (await runTool(host, 'read_page', { page: 'Flights' })) as NonNullable<ReturnType<typeof readPage>>
    expect(page).toMatchObject({ page: flights, title: 'Flights', path: [] })
    expect(page.text).toContain('## Budget')
    await runTool(host, 'apply_ops', { ops: [{ op: 'updatePage', page: flights, title: 'Getting there' }] })
    expect(((await runTool(host, 'find', { query: 'getting' })) as { title: string }[])[0].title).toBe('Getting there')
    // The rename left two versions: the page before it, and after.
    await runTool(host, 'apply_ops', { ops: [{ op: 'updatePage', page: flights, append: 'Book seats', note: 'Seats' }] })
    const history = (await runTool(host, 'page_history', { page: flights })) as { versions: { version: number; note?: string; added: number }[] }
    expect(history.versions[0]).toMatchObject({ note: 'Seats', added: 1 })
    const first = (await runTool(host, 'read_page', { page: flights, version: 1 })) as { title: string; text: string }
    expect(first.title).toBe('Flights')
    expect(first.text).not.toContain('Book seats')
    await expect(runTool(host, 'read_page', { page: flights, version: 99 })).rejects.toThrow(/No version 99/)
    await expect(runTool({ ...host, board: () => emptyBoard() }, 'list_pages')).rejects.toThrow(/isn’t a wiki/)
  })
})
