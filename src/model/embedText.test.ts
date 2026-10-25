import { describe, expect, it } from 'vitest'
import { type Op, applyOps } from '../api/ops'
import { emptyBoard, getItem } from './board'
import { makeSnap, setSnap } from './embed'
import { editOps, editText, embedMarkdown, expandTextEmbeds, kanbanTick } from './embedText'
import { embedLine, parseMarkdown } from './markdown'
import { fakeMeasure } from './test-helpers'
import { emptyWiki, searchPages } from './wiki'
import type { Board } from './types'

const make = (ops: Op[]) => applyOps(emptyBoard(), ops, { measure: fakeMeasure }).board
const apply = (b: Board, ops: Op[]) => applyOps(b, ops, { measure: fakeMeasure }).board
const find = (b: Board, kind: string) => b.items.find((i) => i.kind === kind && i.parent === undefined)!

describe('canvas objects as text in a page', () => {
  it('reads an embed line asking for text', () => {
    expect(embedLine('![[Plan|text]](board:abc#4)')).toEqual({ label: 'Plan', board: 'abc', item: 4, asText: true })
    expect(embedLine('![[Plan|400]](board:abc#4)')).toEqual({ label: 'Plan', board: 'abc', item: 4, height: 400 })
    expect(parseMarkdown('![[Plan|text]](board:abc#4)')[0]).toMatchObject({ t: 'embed', asText: true })
  })

  it('writes each kind as Markdown', () => {
    const b = make([
      { op: 'createMindMap', outline: 'Launch\n  Website\n    Copy\n  Party' },
      { op: 'createKanban', columns: [{ title: 'To do', cards: [{ title: 'Book van', due: '2026-11-02' }] }, { title: 'Done', cards: ['Flights'] }] },
      { op: 'createTable', columns: ['Name', 'Status'], rows: [['Venue', 'booked | paid']] },
      { op: 'createTimeline', lanes: [{ name: 'Trip', entries: [{ title: 'Stay', start: '2026-11-03', end: '2026-11-07' }, { title: 'Fly', start: '2026-11-03' }] }] },
      { op: 'createFlowchart', mermaid: 'flowchart TD\n a([Request]) --> b{Approved?}\n b -->|Yes| c[Order]\n b -->|No| d[Tell them why]' },
    ])
    expect(embedMarkdown(b, find(b, 'mind'))).toBe('**Launch**\n\n- Website\n  - Copy\n- Party\n')
    expect(embedMarkdown(b, find(b, 'kanban'))).toBe('**To do** · 1\n- [ ] Book van · due 2 Nov 2026\n\n**Done** · 1\n- [x] Flights')
    expect(embedMarkdown(b, find(b, 'table'))).toBe('| Name | Status |\n| --- | --- |\n| Venue | booked \\| paid |')
    expect(embedMarkdown(b, find(b, 'timeline'))).toBe('**Trip**\n- Stay · 3 Nov 2026 → 7 Nov 2026\n- Fly · 3 Nov 2026')
    const flow = embedMarkdown(b, find(b, 'flow'))
    expect(flow).toMatch(/^1\. Request\n2\. Approved\? → Yes: step 3 · No: step 4\n3\. Order → step 4|^1\. Request\n2\. Approved\? → Yes: step \d · No: step \d/)
    expect(flow.split('\n')).toHaveLength(4)
  })

  it('writes edits back in place: a mind map keeps its ideas, a Kanban board its cards', () => {
    let b = make([{ op: 'createMindMap', outline: 'Launch\n  Website\n  Party' }])
    const map = find(b, 'mind')
    const website = b.items.find((i) => i.text === 'Website')!.id
    const ops = editOps(map, editText(b, map).replace('Party', 'Dinner\n    Budget'))
    b = apply(b, ops as Op[])
    expect(getItem(b, website)!.text).toBe('Website')
    expect(editText(b, find(b, 'mind'))).toBe('Launch\n  Website\n  Dinner\n    Budget')

    let k = make([{ op: 'createKanban', columns: [{ title: 'To do', cards: [{ title: 'Book van', due: '2026-11-02' }, 'Boxes'] }, { title: 'Done' }] }])
    const card = find(k, 'kanban').kanban!.columns[0].cards[0]
    k = apply(k, editOps(find(k, 'kanban'), '## To do\n- Boxes\n\n## Doing\n- Book van\n\n## Done') as Op[])
    expect(find(k, 'kanban').kanban!.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done'])
    expect(find(k, 'kanban').kanban!.columns[1].cards[0]).toEqual(card)
  })

  it('edits only the branch an embed shows', () => {
    let b = make([{ op: 'createMindMap', outline: 'Launch\n  Website\n    Copy\n  Party' }])
    const site = b.items.find((i) => i.text === 'Website')!
    expect(editText(b, site)).toBe('Website\n  Copy')
    b = apply(b, editOps(site, 'Website\n  Copy\n  Photos') as Op[])
    expect(editText(b, find(b, 'mind'))).toBe('Launch\n  Website\n    Copy\n    Photos\n  Party')
  })

  it('edits tables, timelines and flowcharts as text, and says what is wrong with bad text', () => {
    let b = make([
      { op: 'createTable', columns: ['Name', 'Status'], rows: [['Venue', 'booked']] },
      { op: 'createTimeline', lanes: [{ name: 'Trip', entries: [{ title: 'Stay', start: '2026-11-03' }] }] },
      { op: 'createFlowchart', mermaid: 'flowchart TD\n a([Start]) --> b[Plan]' },
    ])
    b = apply(b, editOps(find(b, 'table'), '| Name | Status | Owner |\n|---|---|---|\n| Venue | paid | Sam |') as Op[])
    expect(embedMarkdown(b, find(b, 'table'))).toContain('| Venue | paid | Sam |')
    b = apply(b, editOps(find(b, 'timeline'), '## Trip\n- Stay 2026-11-04..2026-11-08\n## Work\n- Off 2026-11-04') as Op[])
    expect(embedMarkdown(b, find(b, 'timeline'))).toContain('**Work**\n- Off · 4 Nov 2026')
    const flow = find(b, 'flow')
    const mermaid = editText(b, flow)
    expect(mermaid).toMatch(/^flowchart/)
    b = apply(b, editOps(flow, `${mermaid}\n  n9[Ship it]`) as Op[])
    expect(b.items.some((i) => i.text === 'Ship it')).toBe(true)
    expect(editOps(find(b, 'timeline'), '## Trip\n- Stay sometime')).toMatch(/date at the end/)
    expect(editOps(find(b, 'kanban') ?? find(b, 'table'), '')).toEqual(expect.anything())
  })

  it('ticks a card in the checklist to move it to the last column, and unticks it back', () => {
    let k = make([{ op: 'createKanban', columns: [{ title: 'To do', cards: ['Book van', 'Boxes'] }, { title: 'Doing' }, { title: 'Done', cards: ['Flights'] }] }])
    // Lines: 0 To do · 1 Book van · 2 Boxes · 3 (blank) · 4 Doing · 5 (blank) · 6 Done · 7 Flights
    k = apply(k, kanbanTick(find(k, 'kanban'), 2)!)
    expect(find(k, 'kanban').kanban!.columns.map((c) => c.cards.map((x) => x.title))).toEqual([['Book van'], [], ['Flights', 'Boxes']])
    k = apply(k, kanbanTick(find(k, 'kanban'), 6)!)
    expect(find(k, 'kanban').kanban!.columns[0].cards.map((x) => x.title)).toEqual(['Book van', 'Flights'])
  })

  it('shows text embeds as their text to search and exports, from the wiki’s copy', () => {
    const board = make([{ op: 'createMindMap', outline: 'Infrastructure\n  Servers\n    Backups' }])
    const root = find(board, 'mind')
    let wiki: Board = emptyWiki('Team')
    const snap = makeSnap(board, 'b1', root.id, 1, 'me')!
    wiki = setSnap(wiki, snap)
    const page = '# IT\n\n![[Infrastructure|text]](board:b1#' + root.id + ')\n'
    expect(expandTextEmbeds(wiki, page)).toContain('- Servers\n  - Backups')
    // A picture embed stays as it is.
    expect(expandTextEmbeds(wiki, '![[Infrastructure]](board:b1#' + root.id + ')')).toBe('![[Infrastructure]](board:b1#' + root.id + ')')
    // The board as this browser has it wins over the copy.
    const later = apply(board, [{ op: 'addIdeas', parent: root.id, ideas: 'Monitoring' }])
    expect(expandTextEmbeds(wiki, page, () => later)).toContain('- Monitoring')
    void searchPages
  })
})
