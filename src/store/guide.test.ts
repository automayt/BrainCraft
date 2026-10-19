import { describe, expect, it } from 'vitest'
import { getItem } from '../model/board'
import { getSnap } from '../model/embed'
import { type Block, type Inline, parseMarkdown } from '../model/markdown'
import { macroInfo } from '../model/macros'
import { fakeMeasure } from '../model/test-helpers'
import { pageOrder, pageText } from '../model/wiki'
import { SHORTCUTS } from '../ui/shortcuts'
import { GUIDE_TITLE, guideWiki, tourBoard, tourOps } from './guide'

const now = Date.UTC(2026, 9, 19)
const tour = tourBoard(fakeMeasure, now)
const guide = guideWiki('tour1', tour, now, 'Sam')

/** Every inline piece in some blocks, and every block, however deep. */
function walk(blocks: Block[], onBlock: (b: Block) => void, onInline: (i: Inline) => void) {
  const inl = (c: Inline[]) =>
    c.forEach((i) => {
      onInline(i)
      if ('c' in i && Array.isArray(i.c)) inl(i.c)
    })
  for (const b of blocks) {
    onBlock(b)
    if ('c' in b) inl(b.c)
    if (b.t === 'list') b.items.forEach((it) => (inl(it.c), it.sub && walk([it.sub], onBlock, onInline)))
    if (b.t === 'table') [b.head, ...b.rows].forEach((row) => row.forEach(inl))
    if (b.t === 'callout') inl(b.title)
    if ('children' in b && b.children) walk(b.children, onBlock, onInline)
    if (b.t === 'macro' && b.columns) b.columns.forEach((col) => walk(col, onBlock, onInline))
  }
}

describe('the built-in guide', () => {
  it('builds its tour with operations: eight frames to present, each with a description', () => {
    const frames = tour.board.items.filter((i) => i.kind === 'frame')
    expect(frames.map((f) => f.text)).toHaveLength(8)
    for (const f of frames) expect(f.description).toBeTruthy()
    for (const kind of ['mind', 'flow', 'kanban', 'timeline', 'code', 'table', 'link'] as const) expect(tour.board.items.some((i) => i.kind === kind), kind).toBe(true)
    expect(tour.board.items.some((i) => i.wheel)).toBe(true)
    expect(tour.board.items.some((i) => i.poll)).toBe(true)
    expect(tour.board.datasets?.length).toBe(1)
    // Stations don't spill out of their frames.
    for (const f of frames) {
      const inside = tour.board.items.filter((i) => i.id !== f.id && i.x + i.w / 2 > f.x && i.y + i.h / 2 > f.y && i.x + i.w / 2 < f.x + f.w && i.y + i.h / 2 < f.y + f.h)
      for (const i of inside) expect(i.x >= f.x - 1 && i.y >= f.y - 1 && i.x + i.w <= f.x + f.w + 1 && i.y + i.h <= f.y + f.h + 1, `${f.text}: ${i.kind} ${i.text}`).toBe(true)
    }
  })

  it('writes pages whose macros, page links and pictures all work', () => {
    const titles = new Set(pageOrder(guide).map((p) => p.title))
    expect(guide.title).toBe(GUIDE_TITLE)
    for (const t of ['Start here', 'The canvas', 'Mind maps', 'Wikis', 'Macros', 'The API', 'Keyboard shortcuts', 'Try it']) expect(titles.has(t), t).toBe(true)
    let embeds = 0
    for (const p of pageOrder(guide)) {
      walk(
        parseMarkdown(pageText(guide, p.id)),
        (b) => {
          if (b.t === 'macro') expect(macroInfo(b.name), `${p.title}: {{${b.name}}}`).toBeDefined()
          if (b.t === 'embed') {
            embeds++
            expect(b.board).toBe('tour1')
            expect(getItem(tour.board, b.item!), `${p.title}: ${b.label}`).toBeDefined()
            expect(getSnap(guide, `tour1#${b.item}`), `${p.title}: a copy of ${b.label}`).toBeDefined()
          }
        },
        (i) => {
          if (i.t === 'macro') expect(i.raw, `${p.title}: ${i.raw}`).toBeUndefined()
          if (i.t === 'link' && !i.to) expect(titles.has(i.label), `${p.title}: [[${i.label}]]`).toBe(true)
          if (i.t === 'link' && i.to?.item !== undefined) expect(getItem(tour.board, i.to.item), `${p.title}: ${i.label}`).toBeDefined()
        },
      )
    }
    expect(embeds).toBeGreaterThanOrEqual(8)
  })

  it('lists every shortcut, and shows real operations on its API page', () => {
    const text = (title: string) => pageText(guide, pageOrder(guide).find((p) => p.title === title)!.id)
    for (const [section, rows] of SHORTCUTS) {
      expect(text('Keyboard shortcuts')).toContain(`## ${section}`)
      expect(rows.length).toBeGreaterThan(0)
    }
    const api = text('The API')
    const sample = JSON.parse(api.split('```json\n')[1].split('```')[0]) as { ops: { op: string }[] }
    expect(sample.ops.length).toBeGreaterThan(2)
    for (const op of sample.ops) expect(tourOps(now)).toContainEqual(op)
  })
})
