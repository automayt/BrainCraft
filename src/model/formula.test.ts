import { describe, expect, it } from 'vitest'
import { FormulaError, type FormulaValue, compile } from './formula'

const now = new Date(2026, 9, 25)
const run = (src: string, fields: Record<string, FormulaValue> = {}) => {
  const f = compile(src)
  if (f instanceof FormulaError) throw f
  return f.run((n) => fields[n] ?? null, now)
}

describe('formulas', () => {
  it('does arithmetic on fields, and joins text', () => {
    expect(run('{Price} * {Qty}', { Price: 12.5, Qty: 4 })).toBe(50)
    expect(run('({a} + {b}) / 2 - 1 % 3', { a: 4, b: 6 })).toBe(4)
    expect(run('{First} + " " + {Last}', { First: 'Ana', Last: 'Lopez' })).toBe('Ana Lopez')
    expect(run('"Total: " + round({x} / 3, 2)', { x: 10 })).toBe('Total: 3.33')
    expect(run('{x} / 0', { x: 1 })).toBeNull()
  })

  it('decides with if, comparisons and logic', () => {
    expect(run('if({Done}, "✓", "open")', { Done: true })).toBe('✓')
    expect(run('if({Status} = "approved" and {Cost} <= 500, "go", "wait")', { Status: 'Approved', Cost: 400 })).toBe('go')
    expect(run('not empty({Owner}) or {Urgent}', { Owner: '', Urgent: false })).toBe(false)
    expect(run('max({a}, {b}, 3) + min(1, 2)', { a: 5, b: 9 })).toBe(10)
  })

  it('works with dates', () => {
    expect(run('daysUntil({Due})', { Due: '2026-11-01' })).toBe(7)
    expect(run('{End} - {Start}', { Start: '2026-11-01', End: '2026-11-08' })).toBe(7)
    expect(run('addDays({Start}, 10)', { Start: '2026-11-25' })).toBe('2026-12-05')
    expect(run('if(daysUntil({Due}) < 0 and not {Done}, "overdue", "")', { Due: '2026-10-01', Done: false })).toBe('overdue')
    expect(run('today()')).toBe('2026-10-25')
    expect(run('year({d}) + month({d})', { d: '2026-03-09' })).toBe(2029)
  })

  it('says what is wrong, plainly', () => {
    const err = (src: string) => (compile(src) as FormulaError).message
    expect(err('{Price} *')).toMatch(/ends too soon/)
    expect(err('Price * 2')).toMatch(/write fields in braces, like \{Price\}/)
    expect(err('frob(1)')).toMatch(/no function "frob"/)
    expect(err('"open')).toMatch(/never closed/)
    expect(err('')).toMatch(/empty/)
    expect(() => run('{x} * 2', { x: 'lots' })).toThrow(/isn't a number/)
  })

  it('lists the fields it reads', () => {
    expect((compile('if({Done}, {Price} * {Qty}, {Price})') as { fields: string[] }).fields).toEqual(['Done', 'Price', 'Qty'])
  })
})
