import { describe, expect, it } from 'vitest'
import { countdown, parseArgs, parseDay, statusLook } from './macros'
import { type Block, headings, parseInline, parseMarkdown, plainMarkdown, taskItems, toggleTask } from './markdown'

describe('wiki macros', () => {
  it('reads options: words, quoted words and key=value', () => {
    expect(parseArgs('here "Getting there" depth=2 page="Trip plan"')).toEqual({ pos: ['here', 'Getting there'], named: { depth: '2', page: 'Trip plan' } })
    expect(parseArgs(undefined)).toEqual({ pos: [], named: {} })
  })

  it('reads block macros, keeping {{children}} and {{toc}} as they were', () => {
    const b = parseMarkdown('{{children}}\n{{toc}}\n{{tasks here}}\n{{recnet}}\nText {{today}} here')
    expect(b.map((x) => x.t)).toEqual(['children', 'toc', 'macro', 'macro', 'p'])
    expect(b[2]).toMatchObject({ t: 'macro', name: 'tasks', args: { pos: ['here'] }, line: 2 })
    // An unknown name is still a macro (shown as itself, marked), not lost.
    expect(b[3]).toMatchObject({ t: 'macro', name: 'recnet' })
  })

  it('reads sections around lines, nested, with headings and ticks still working inside', () => {
    const md = ['{{expand Packing details}}', '## Inside', '- [ ] Towel', '{{expand More}}', 'Deeper', '{{/expand}}', '{{/expand}}', 'After'].join('\n')
    const b = parseMarkdown(md)
    expect(b.map((x) => x.t)).toEqual(['macro', 'p'])
    const outer = b[0] as Extract<Block, { t: 'macro' }>
    expect(outer.args.pos.join(' ')).toBe('Packing details')
    expect(outer.children!.map((x) => x.t)).toEqual(['h', 'list', 'macro'])
    expect(headings(b).map((h) => h.text)).toEqual(['Inside'])
    const [task] = taskItems(b)
    expect(task.line).toBe(2)
    expect(toggleTask(md, task.line).split('\n')[2]).toBe('- [x] Towel')
    // Not closed (yet): just that line, and the rest reads as usual.
    expect(parseMarkdown('{{expand Later}}\nStill here').map((x) => x.t)).toEqual(['macro', 'p'])
  })

  it('splits columns, keeping columns inside a column together', () => {
    const md = ['{{columns}}', 'Left', '{{column}}', '{{columns}}', 'A', '{{column}}', 'B', '{{/columns}}', '{{/columns}}'].join('\n')
    const [cols] = parseMarkdown(md) as Extract<Block, { t: 'macro' }>[]
    expect(cols.columns).toHaveLength(2)
    expect(cols.columns![0][0]).toMatchObject({ t: 'p', line: 1 })
    expect((cols.columns![1][0] as Extract<Block, { t: 'macro' }>).columns).toHaveLength(2)
  })

  it('reads macros inside sentences, and says them as words', () => {
    const c = parseInline('Flights {{status Booked}} and {{status "In progress" purple}} — {{countdown 2026-12-20}}')
    expect(c.filter((x) => x.t === 'macro').map((x) => (x.t === 'macro' ? x.name : ''))).toEqual(['status', 'status', 'countdown'])
    expect(plainMarkdown('{{expand Hidden}}\nFlights {{status Booked}}\n{{/expand}}')).toBe('Flights Booked')
    // A block macro's name written in a sentence is just text.
    expect(parseInline('see {{tasks}}')).toEqual([{ t: 'text', s: 'see {{tasks}}' }])
  })

  it('colours status labels and counts down to a day', () => {
    expect(statusLook(parseArgs('Done'))).toEqual({ label: 'Done', color: 'green' })
    expect(statusLook(parseArgs('"Waiting on Sam"'))).toEqual({ label: 'Waiting on Sam', color: 'yellow' })
    expect(statusLook(parseArgs('Ideas purple'))).toEqual({ label: 'Ideas', color: 'purple' })
    const today = new Date(2026, 9, 18, 15, 0)
    expect(countdown(parseDay('2026-12-20')!, today)).toBe('63 days to go')
    expect(countdown(parseDay('2026-10-19')!, today)).toBe('Tomorrow')
    expect(countdown(parseDay('2026-10-18')!, today)).toBe('Today')
    expect(countdown(parseDay('2026-10-15')!, today)).toBe('3 days ago')
    expect(parseDay('2026-02-31')).toBeNull()
  })

  it('stays quick on hostile macro text', () => {
    const t = performance.now()
    // Thousands of sections never closed: each used to look all the way down the page.
    parseMarkdown('{{expand x}}\n'.repeat(15000))
    parseMarkdown(`{{tasks${' '.repeat(5000)}}}`)
    parseInline('{{status '.repeat(20000))
    expect(performance.now() - t).toBeLessThan(1500)
  })
})
