import { describe, expect, it } from 'vitest'
import { type Block, continueList, headings, inlineText, parseInline, parseMarkdown, safeHref, slugify, toggleTask } from './markdown'

const kinds = (blocks: Block[]) => blocks.map((b) => b.t)

describe('markdown', () => {
  it('reads headings, paragraphs, rules, quotes, callouts, code, tables and page macros', () => {
    const md = [
      '# Lisbon trip',
      'We go in **May**.',
      'Second line',
      '',
      '---',
      '> A quote',
      '',
      '> [!tip] Book early',
      '> Prices go up.',
      '',
      '```js',
      'const a = 1',
      '```',
      '',
      '| Who | Paid |',
      '| --- | ---: |',
      '| Ana | 120 |',
      '',
      '{{children}}',
      '{{ toc }}',
    ].join('\n')
    const blocks = parseMarkdown(md)
    expect(kinds(blocks)).toEqual(['h', 'p', 'hr', 'quote', 'callout', 'code', 'table', 'children', 'toc'])
    const p = blocks[1] as Extract<Block, { t: 'p' }>
    expect(p.c.map((x) => x.t)).toEqual(['text', 'b', 'text', 'br', 'text'])
    const callout = blocks[4] as Extract<Block, { t: 'callout' }>
    expect(callout.kind).toBe('tip')
    expect(inlineText(callout.title)).toBe('Book early')
    expect(callout.children[0].t).toBe('p')
    expect(blocks[5]).toMatchObject({ t: 'code', lang: 'js', code: 'const a = 1' })
    const table = blocks[6] as Extract<Block, { t: 'table' }>
    expect(table.align).toEqual([null, 'right'])
    expect(table.rows.map((r) => r.map(inlineText))).toEqual([['Ana', '120']])
  })

  it('nests lists by indent and knows each checklist item’s line', () => {
    const md = ['- [ ] Book flights', '  - [x] Compare prices', '- Pack', '  continued', '1. one', '2. two'].join('\n')
    const blocks = parseMarkdown(md)
    expect(kinds(blocks)).toEqual(['list', 'list'])
    const list = blocks[0] as Extract<Block, { t: 'list' }>
    expect(list.items).toHaveLength(2)
    expect(list.items[0]).toMatchObject({ task: false, line: 0 })
    const sub = list.items[0].sub as Extract<Block, { t: 'list' }>
    expect(sub.items[0]).toMatchObject({ task: true, line: 1 })
    expect(inlineText(list.items[1].c)).toBe('Pack continued')
    expect(blocks[1]).toMatchObject({ ordered: true, start: 1 })
    expect(toggleTask(md, 0).split('\n')[0]).toBe('- [x] Book flights')
    expect(toggleTask(md, 1).split('\n')[1]).toBe('  - [ ] Compare prices')
    expect(toggleTask(md, 2)).toBe(md)
  })

  it('reads BrainCraft links and mentions inline, and keeps emphasis around them', () => {
    const c = parseInline('See **[[Flights]](page:abc#budget)** and @[Ana’s note](#12), or [[Packing]]')
    expect(c[1]).toMatchObject({ t: 'b', c: [{ t: 'link', to: { page: 'abc', heading: 'budget' }, label: 'Flights' }] })
    expect(c[3]).toMatchObject({ t: 'mention', id: 12 })
    expect(c[5]).toMatchObject({ t: 'link', to: null, label: 'Packing' })
    expect(parseInline('[[Board]](board:k1/page:p2)')[0]).toMatchObject({ t: 'link', to: { board: 'k1', page: 'p2' } })
  })

  it('keeps only ordinary web links, and shows anything else as text', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,hi')).toBeNull()
    expect(parseInline('[click](javascript:alert(1))').every((x) => x.t === 'text')).toBe(true)
    expect(parseInline('go to https://example.com/x.')[1]).toMatchObject({ t: 'a', href: 'https://example.com/x' })
    expect(parseInline('<b>raw</b>')).toEqual([{ t: 'text', s: '<b>raw</b>' }])
  })

  it('leaves snake_case, lone stars and escapes alone', () => {
    expect(parseInline('a_long_name')).toEqual([{ t: 'text', s: 'a_long_name' }])
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', s: '2 * 3 * 4' }])
    expect(parseInline('\\*not italic\\*')).toEqual([{ t: 'text', s: '*not italic*' }])
    expect(parseInline('*yes*')[0]).toMatchObject({ t: 'i' })
  })

  it('gives headings unique anchors', () => {
    const blocks = parseMarkdown('# Budget\n## Budget\n## Café & bar')
    expect(headings(blocks).map((h) => h.slug)).toEqual(['budget', 'budget-2', 'cafe-bar'])
    expect(slugify('!!!')).toBe('section')
  })

  it('continues lists on Enter and ends them on an empty item', () => {
    const t = '- [x] one'
    expect(continueList(t, t.length)).toEqual({ text: '- [x] one\n- [ ] ', caret: t.length + 7 })
    expect(continueList('3. three', 8)).toEqual({ text: '3. three\n4. ', caret: 12 })
    expect(continueList('- ', 2)).toEqual({ text: '', caret: 0 })
    expect(continueList('plain', 5)).toBeNull()
  })

  it('copes with hostile pages quickly and without throwing', () => {
    const start = performance.now()
    parseMarkdown('> '.repeat(5000) + 'deep')
    parseMarkdown(Array.from({ length: 2000 }, (_, k) => `${' '.repeat(k % 40)}- item`).join('\n'))
    parseInline('*'.repeat(20000))
    parseInline('`'.repeat(20000))
    parseInline('**a'.repeat(5000))
    parseInline('['.repeat(5000) + ']]')
    parseMarkdown('| a |\n| - |\n' + '| x |\n'.repeat(5000))
    expect(performance.now() - start).toBeLessThan(3000)
  })
})
