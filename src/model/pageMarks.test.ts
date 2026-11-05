import { describe, expect, it } from 'vitest'
import { inlineText, parseInline } from './markdown'
import { pageMarks } from './pageMarks'

/** The text as it reads with everything hidden. */
function reads(text: string, shown: number[] = []) {
  const m = pageMarks(text)
  const gone = new Set<number>()
  for (const h of m.hides) {
    if (shown.some((c) => c >= h.show[0] && c <= h.show[1])) continue
    for (let k = h.from; k < h.to; k++) gone.add(k)
  }
  return [...text].filter((_, k) => !gone.has(k)).join('')
}

const cut = (text: string, r: { from: number; to: number }) => text.slice(r.from, r.to)

describe('words in a page being written', () => {
  it('reads the same as the page parser, for every kind of emphasis', () => {
    for (const s of ['**bold** and *it* and ~~gone~~ and `code`', 'a **bold *nested* word** end', '***both***', 'snake_case and _under_ and __bold__', 'not * a star and 2 * 3 * 4', 'an \\*escaped\\* star']) {
      expect(reads(s)).toBe(inlineText(parseInline(s)))
    }
  })

  it('shows a web link by its words', () => {
    const s = 'see [the plan](https://example.com/plan) today'
    const m = pageMarks(s)
    expect(reads(s)).toBe('see the plan today')
    expect(cut(s, m.words[0])).toBe('[the plan](https://example.com/plan)')
    expect(m.words[0].look).toBe('a')
  })

  it('leaves a bare address alone, and marks it as a link', () => {
    const s = 'at https://example.com now'
    expect(reads(s)).toBe(s)
    expect(cut(s, pageMarks(s).words[0])).toBe('https://example.com')
  })

  it('brings the marks back with the caret inside them, and only those', () => {
    const s = '**one** and **two**'
    expect(reads(s, [3])).toBe('**one** and two')
    expect(reads(s, [15])).toBe('one and **two**')
  })

  it('formats a closed span as soon as it is closed', () => {
    const s = '**done**'
    expect(reads(s, [s.length])).toBe('done')
  })

  it('leaves an unfinished span as typed', () => {
    expect(reads('**not yet')).toBe('**not yet')
  })
})

describe('chips', () => {
  it('names links, mentions and macros', () => {
    const s = 'See [[Budget]](page:p1), @[Sam](user:u1), [[Later]] and {{status Done}}.'
    const m = pageMarks(s)
    expect(m.chips.map((c) => c.label)).toEqual(['Budget', '@Sam', 'Later', 'Done'])
    expect(cut(s, m.chips[0])).toBe('[[Budget]](page:p1)')
  })

  it('leaves a macro that can’t go in a sentence as typed', () => {
    expect(pageMarks('Hello {{nonsense}} there').chips).toEqual([])
  })
})

describe('lines', () => {
  it('turns a heading into a heading as soon as it has a space', () => {
    const m = pageMarks('## Plan')
    expect(m.lines).toEqual([{ at: 0, look: 'h2' }])
    expect(reads('## Plan')).toBe('Plan')
    expect(reads('## ')).toBe('')
    expect(pageMarks('##').lines[0].look).toBe('h2')
  })

  it('shows a heading’s marks with the caret in them, not just on the line', () => {
    expect(reads('## Plan', [1])).toBe('## Plan')
    expect(reads('## Plan', [3])).toBe('Plan')
  })

  it('formats words in a heading', () => {
    expect(reads('# A **big** one')).toBe('A big one')
  })

  it('finds bullets and checklists, but keeps numbers', () => {
    const s = '- one\n  - two\n- [ ] todo\n- [x] done\n\n1. first'
    const m = pageMarks(s)
    expect(m.bullets.map((b) => [cut(s, b), b.task])).toEqual([
      ['- ', undefined],
      ['- ', undefined],
      ['- [ ] ', false],
      ['- [x] ', true],
    ])
    expect(m.lines.filter((l) => l.look === 'done')).toHaveLength(1)
    expect(m.lines.filter((l) => l.look === 'list')).toHaveLength(4)
  })

  it('formats words in list items', () => {
    expect(reads('- [ ] **now**')).toBe('- [ ] now')
  })

  it('tucks away quote marks', () => {
    const m = pageMarks('> first\n> second')
    expect(m.lines.map((l) => l.look)).toEqual(['quote', 'quote'])
    expect(reads('> first\n> second')).toBe('first\nsecond')
  })

  it('colours a callout, from its first line on', () => {
    const s = '> [!tip] Good idea\n> More of it'
    expect(pageMarks(s).lines.map((l) => l.look)).toEqual(['tip', 'tip'])
    expect(reads(s)).toBe('Good idea\nMore of it')
  })

  it('makes blank lines between paragraphs a small gap', () => {
    expect(pageMarks('One\n\nTwo').lines).toEqual([{ at: 4, look: 'gap' }])
  })
})

describe('blocks', () => {
  it('finds each block, its whole extent, and leaves the lines around it', () => {
    const s = 'Before\n\n```js\nlet a\n```\n\nAfter'
    const [b] = pageMarks(s).blocks
    expect(cut(s, b)).toBe('```js\nlet a\n```')
    expect(b.block.t).toBe('code')
    expect(b.fixed).toBe(false)
  })

  it('takes a table and a divider', () => {
    const s = '| A |\n| --- |\n| 1 |\n\n---'
    const m = pageMarks(s)
    expect(m.blocks.map((b) => b.block.t)).toEqual(['table', 'hr'])
    expect(cut(s, m.blocks[0])).toBe('| A |\n| --- |\n| 1 |')
  })

  it('takes a section macro whole, what’s in it included', () => {
    const s = '{{expand More}}\n**inside**\n{{/expand}}\nAfter'
    const m = pageMarks(s)
    expect(cut(s, m.blocks[0])).toBe('{{expand More}}\n**inside**\n{{/expand}}')
    expect(m.words).toEqual([])
  })

  it('keeps embeds and pictures as they read', () => {
    const s = '![[Plan]](board:abc)\n\n![Cat](file:f1)\n\n{{toc}}'
    expect(pageMarks(s).blocks.map((b) => [b.block.t, b.fixed])).toEqual([
      ['embed', true],
      ['image', true],
      ['toc', true],
    ])
  })

  it('stays out of code blocks', () => {
    const m = pageMarks('```\n**not bold**\n- not a list\n```')
    expect(m.words).toEqual([])
    expect(m.bullets).toEqual([])
  })
})

describe('odd pages', () => {
  it('copes with an empty page', () => {
    expect(pageMarks('')).toEqual({ lines: [{ at: 0, look: 'gap' }], words: [], hides: [], chips: [], bullets: [], blocks: [] })
  })

  it('keeps its place past Windows line ends', () => {
    const s = '# One\r\n\r\n**two**\r\n'
    const m = pageMarks(s)
    expect(cut(s, m.words[0])).toBe('**two**')
    expect(m.lines[0]).toEqual({ at: 0, look: 'h1' })
  })

  it('never lets a position run past the text', () => {
    for (const s of ['```', '{{expand', '> ', '- ', '- [ ] ', '# ', '|', '| a |\n| - |', '\n\n\n', '[[', '**', '> [!tip]', '1. ', '   ']) {
      const m = pageMarks(s)
      for (const r of [...m.hides, ...m.chips, ...m.bullets, ...m.blocks, ...m.words]) {
        expect(r.from).toBeGreaterThanOrEqual(0)
        expect(r.to).toBeLessThanOrEqual(s.length)
        expect(r.to).toBeGreaterThanOrEqual(r.from)
      }
    }
  })

  it('stays quick on a long page', () => {
    const s = Array.from({ length: 5000 }, (_, k) => `Line ${k} with **some** words and a [link](https://example.com).`).join('\n')
    const t = performance.now()
    pageMarks(s)
    expect(performance.now() - t).toBeLessThan(250)
  })
})
