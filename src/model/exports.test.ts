import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from '../api/ops'
import { guideWiki, tourBoard } from '../store/guide'
import { addItem, emptyBoard, newItem } from './board'
import { boardMarkdown, itemCsv, recordsCsv } from './boardMarkdown'
import { startBrainstorm } from './brainstorm'
import { fakeMeasure } from './test-helpers'
import type { Board } from './types'
import { emptyWiki, pageOrder } from './wiki'
import { wikiHtml } from './wikiHtml'

const build = (b: Board, ops: Op[]) => applyOps(b, ops, { measure: fakeMeasure, now: Date.UTC(2026, 9, 19) }).board

describe('a canvas as Markdown and CSV', () => {
  it('writes frames as sections in reading order, with maps, tables, plans, comments and flowcharts', () => {
    const b = build(emptyBoard('Trip'), [
      { op: 'createFrame', ref: 'f', title: 'Ideas', at: { x: 0, y: 0 }, w: 1400, h: 900 },
      { op: 'createNote', ref: 'n', text: 'Go to the sea', at: { x: 40, y: 80 } },
      { op: 'createNote', text: 'Second idea', at: { x: 300, y: 80 } },
      { op: 'update', id: 'n', status: 'done' },
      { op: 'addComment', id: 'n', text: 'Booked!', author: 'Sam' },
      { op: 'createMindMap', outline: 'Food\n  Pizza\n  Curry', at: { x: 40, y: 400 } },
      { op: 'createTable', title: 'Packing', columns: ['Thing', 'Who'], rows: [['Tent', 'Jo | Kim']], at: { x: 2000, y: 0 } },
      { op: 'createKanban', title: 'Plan', columns: [{ title: 'To do', cards: [{ title: 'Train', due: '2026-11-01' }] }], at: { x: 2000, y: 600 } },
      { op: 'createFlowchart', mermaid: 'flowchart TD\n  A([Start]) --> B[Go]', at: { x: 4000, y: 0 } },
    ])
    const md = boardMarkdown(b)
    expect(md.startsWith('# Trip\n')).toBe(true)
    expect(md).toContain('## Ideas')
    expect(md.indexOf('Go to the sea')).toBeLessThan(md.indexOf('Second idea'))
    expect(md).toContain('- [Done] Go to the sea\n  - 💬 Sam: Booked!')
    expect(md).toMatch(/- Food\n\s+- Pizza\n\s+- Curry/)
    expect(md).toContain('## Elsewhere on the board')
    expect(md).toContain('| Tent | Jo \\| Kim |')
    expect(md).toContain('- Train (due 2026-11-01)')
    expect(md).toContain('```mermaid\nflowchart')
  })

  it('leaves hidden brainstorm notes out', () => {
    let [b] = startBrainstorm(emptyBoard('Ideas'), { x: 0, y: 0 }, 'Sam', 'What next?')
    ;[b] = addItem(b, { ...newItem('sticky', { x: 0, y: 300, w: 200, h: 200 }, { text: 'A secret' }), hiddenBy: 'Sam' })
    expect(boardMarkdown(b)).not.toContain('A secret')
  })

  it('gives tables and databases as CSV, with cells that spreadsheets would run made safe', () => {
    const b = build(emptyBoard(), [
      { op: 'createTable', ref: 't', columns: ['A', 'B'], rows: [['1', 'two, three']] },
      { op: 'createDatabase', ref: 'd', records: [{ Name: 'x', Cost: 3 }, { Name: '=HYPERLINK("http://evil")', Cost: 4 }] },
    ])
    const table = b.items.find((i) => i.kind === 'table')!
    expect(itemCsv(b, table)).toBe('A,B\n1,"two, three"')
    const view = b.items.find((i) => i.kind === 'data')!
    const csv = itemCsv(b, view)!
    expect(csv.split('\n')[0]).toBe('Name,Cost')
    expect(csv).toContain('"=HYPERLINK(""http://evil"")",4')
    expect(recordsCsv([{ a: 'x\ny' }], ['a'])).toBe('a\n"x\ny"')
  })
})

describe('a wiki as a web page', () => {
  // Midday where the tests run, so it's the 19th in local dates too.
  const now = new Date(2026, 9, 19, 12)
  const tour = tourBoard(fakeMeasure, now.getTime())
  const guide = guideWiki('tour1', tour, now.getTime())

  it('has every page, a contents list, and links between pages that land on something', () => {
    const html = wikiHtml(guide, { now })
    for (const p of pageOrder(guide)) expect(html).toContain(`id="p-${p.id}"`)
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    expect(targets.length).toBeGreaterThan(20)
    for (const t of targets) expect(ids.has(t), t).toBe(true)
    expect(html).not.toMatch(/<script/i)
    // Macros are worked out: open tasks from "Try it", statuses, today.
    expect(html).toContain('Make a sticky note and connect it to another')
    expect(html).toContain('class="status status-green"')
    expect(html).toContain('19 October 2026')
    // Embeds without pictures say what they were.
    expect(html).toContain('class="embed-missing"')
  })

  it('escapes what people wrote, shows only chosen pages, and doesn’t include a page in itself forever', () => {
    let w = build(emptyWiki('W'), [
      { op: 'updatePage', page: 'Home', text: '# Home\n\n<script>alert(1)</script> [x](javascript:alert(1))\n\n{{include "Home"}}\n\n[[Other]]' },
      { op: 'createPage', title: 'Other', text: 'Loops: {{include "Other"}}' },
    ])
    w = { ...w, pages: w.pages!.map((p) => (p.title === 'Other' ? { ...p, title: 'Other <img src=x onerror=alert(1)>' } : p)) }
    const html = wikiHtml(w, { now })
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('javascript:')
    const home = pageOrder(w)[0].id
    const only = wikiHtml(w, { now, pages: [home] })
    expect(only).not.toContain('Loops:')
    // A picture given for an embed goes in as an image, never as markup.
    const pic = wikiHtml(build(emptyWiki('P'), [{ op: 'updatePage', page: 'Home', text: '![[Map|300]](board:b1#3)' }]), { now, pictures: new Map([['b1#3', '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>']]) })
    expect(pic).toContain('<img src="data:image/svg+xml')
    expect(pic).not.toContain('<script>x')
  })
})
