import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from '../src/api/ops'
import { addItem, emptyBoard, newItem } from '../src/model/board'
import { startBrainstorm } from '../src/model/brainstorm'
import { fakeMeasure } from '../src/model/test-helpers'
import type { Board } from '../src/model/types'
import { emptyWiki } from '../src/model/wiki'
import { readBoard } from './boardReads'

const build = (b: Board, ops: Op[]) => applyOps(b, ops, { measure: fakeMeasure, now: 1_000_000 }).board
const read = (b: Board, path: string) => {
  const url = new URL(`http://x/${path}`)
  return readBoard(b, url.pathname.split('/').filter(Boolean), url.searchParams)
}

describe('reading a board over HTTP', () => {
  const canvas = build(emptyBoard('Plan'), [
    { op: 'createNote', ref: 'n', text: 'Pricing page' },
    { op: 'createFlowchart', mermaid: 'flowchart TD\n  A([Start]) --> B[Ship]' },
    { op: 'addComment', id: 'n', text: 'Needs a decision' },
  ])

  it('lists objects (by kind too), gets one, searches, and gives flowcharts as Mermaid', () => {
    const all = read(canvas, 'objects')!
    expect(all.status).toBe(200)
    expect((all.body as { counts: Record<string, number> }).counts).toMatchObject({ sticky: 1 })
    const notes = (read(canvas, 'objects?kind=sticky')!.body as { objects: { id: number; label: string }[] }).objects
    expect(notes).toEqual([expect.objectContaining({ label: 'Pricing page', commentCount: 1 })])
    expect(read(canvas, `objects/${notes[0].id}`)!.body).toMatchObject({ text: 'Pricing page', comments: [{ text: 'Needs a decision' }] })
    expect(read(canvas, 'objects/999')!.status).toBe(404)
    expect(read(canvas, 'objects?kind=constructor')!.status).toBe(400)
    expect((read(canvas, 'search?q=decision')!.body as { results: unknown[] }).results).toHaveLength(1)
    expect(read(canvas, 'search')!.status).toBe(400)
    const mermaid = read(canvas, 'mermaid')!
    expect(mermaid.text).toMatch(/^flowchart/)
    expect(mermaid.text).toContain('Ship')
    expect(read(canvas, 'pages')!.status).toBe(409)
    // Anything else is left to the caller.
    expect(read(canvas, 'ops')).toBeNull()
  })

  it('reads a wiki: the page tree, a page by id or title, its history and an old version', () => {
    let wiki = build(emptyWiki('Club'), [
      { op: 'updatePage', page: 'Home', text: '# Welcome' },
      { op: 'createPage', title: 'How we work', parent: 'Home', text: 'Meet on Fridays', note: 'First go' },
    ])
    wiki = build(wiki, [{ op: 'updatePage', page: 'How we work', text: 'Meet on Saturdays', note: 'Moved the day' }])
    const tree = read(wiki, 'pages')!.body as { pages: { page: string; title: string; children: { title: string }[] }[] }
    expect(tree.pages[0]).toMatchObject({ title: 'Home', children: [{ title: 'How we work' }] })
    const page = read(wiki, `pages/${encodeURIComponent('How we work')}`)!
    expect(page.body).toMatchObject({ title: 'How we work', text: 'Meet on Saturdays', path: ['Home'] })
    expect(read(wiki, `pages/${tree.pages[0].page}`)!.body).toMatchObject({ title: 'Home' })
    const history = read(wiki, 'pages/How%20we%20work/history')!.body as { versions: { version: number; note?: string }[] }
    expect(history.versions[0]).toMatchObject({ note: 'Moved the day' })
    expect(read(wiki, 'pages/How%20we%20work?version=1')!.body).toMatchObject({ text: 'Meet on Fridays' })
    expect(read(wiki, 'pages/How%20we%20work?version=99')!.status).toBe(404)
    expect(read(wiki, 'pages/Nope')!.status).toBe(404)
    expect(read(wiki, 'pages/%E0%A4%A')!.status).toBe(400)
  })

  it('keeps hidden brainstorm notes blank', () => {
    let [b] = startBrainstorm(emptyBoard('Ideas'), { x: 0, y: 0 }, 'Sam')
    ;[b] = addItem(b, { ...newItem('sticky', { x: 0, y: 300, w: 200, h: 200 }, { text: 'A secret idea' }), hiddenBy: 'Sam' })
    const notes = (read(b, 'objects?kind=sticky')!.body as { objects: { id: number; hidden?: boolean }[] }).objects
    expect(notes[0].hidden).toBe(true)
    expect(read(b, `objects/${notes[0].id}`)!.body).toMatchObject({ text: '' })
    expect((read(b, 'search?q=secret')!.body as { results: unknown[] }).results).toEqual([])
  })
})
