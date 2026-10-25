import { describe, expect, it } from 'vitest'
import { type Op, applyOps } from '../api/ops'
import { emptyBoard } from './board'
import * as D from './dataset'
import { answersToValues, definitionOf, sharedForm, valuesByFieldName } from './forms'
import { fromJson, toJson } from './serialize'
import { fakeMeasure } from './test-helpers'
import type { Board, DataView } from './types'

const make = (ops: Op[], b: Board = emptyBoard()) => applyOps(b, ops, { measure: fakeMeasure, now: 1 }).board

/** Sign-ups: a form view of a database with a few kinds of field, a link and a formula. */
function signups() {
  let b = make([{ op: 'createDatabase', title: 'Teams', fields: ['Team'], records: [{ Team: 'Red' }] }])
  b = make(
    [
      {
        op: 'createDatabase',
        title: 'Sign-ups',
        views: ['form'],
        fields: [
          'Name',
          { name: 'Age', type: 'number' },
          { name: 'Shirt', type: 'select', options: ['S', 'M', 'L'] },
          { name: 'Coming', type: 'checkbox' },
          { name: 'Team', type: 'relation', to: 'Teams' },
          { name: 'Label', type: 'formula', formula: 'upper({Name})' },
        ],
      },
    ],
    b,
  )
  const item = b.items.find((i) => i.view?.type === 'form')!
  const ds = D.getDataset(b, item.view!.dataset)!
  const field = (name: string) => D.fieldByName(ds, name)!.id
  return { b, item, ds, field }
}

describe('forms', () => {
  it('asks the fields a person can answer, and nothing else', () => {
    const { ds, item, field } = signups()
    const view: DataView = { ...item.view!, hidden: [field('Age')], form: { title: 'Join in', required: [field('Name')] } }
    const form = definitionOf(ds, view)
    expect(form.title).toBe('Join in')
    // No link to other records, no formula, nothing hidden; choices offered by id and name.
    expect(form.questions.map((q) => [q.name, q.required])).toEqual([
      ['Name', true],
      ['Shirt', false],
      ['Coming', false],
    ])
    expect(form.questions[1].options!.map((o) => o.name)).toEqual(['S', 'M', 'L'])
    // The database's name when the form has no title of its own.
    expect(definitionOf(ds, item.view!).title).toBe('Sign-ups')
  })

  it('checks answers, keeping only the questions', () => {
    const { ds, item, field } = signups()
    const view: DataView = { ...item.view!, form: { required: [field('Name')] } }
    const shirt = D.fieldByName(ds, 'Shirt')!.options!.find((o) => o.name === 'M')!.id
    expect(answersToValues(ds, view, { [field('Age')]: '12' })).toEqual({ error: '“Name” needs an answer' })
    expect(answersToValues(ds, view, { [field('Name')]: 'Ada', [field('Age')]: 'twelve' })).toEqual({ error: '“Age” should be a number' })
    expect(answersToValues(ds, view, { [field('Name')]: 'Ada', [field('Shirt')]: 'XXL' })).toMatchObject({ error: expect.stringContaining('should be one of: S, M, L') })
    expect(answersToValues(ds, view, { [field('Name')]: 'x'.repeat(5001) })).toMatchObject({ error: expect.stringContaining('too long') })
    expect(answersToValues(ds, view, [])).toMatchObject({ error: expect.any(String) })
    expect(answersToValues(ds, { ...view, form: {} }, {})).toEqual({ error: 'Answer at least one question' })
    // A link and a formula can't be set through a form, whatever is sent.
    const ok = answersToValues(ds, view, { [field('Name')]: ' Ada ', [field('Age')]: '12', [field('Shirt')]: shirt, [field('Coming')]: true, [field('Team')]: 'r1', [field('Label')]: 'X', junk: 1 })
    expect(ok).toEqual({ values: { [field('Name')]: 'Ada', [field('Age')]: 12, [field('Shirt')]: shirt, [field('Coming')]: true } })
    expect(valuesByFieldName(ds, (ok as { values: Record<string, string> }).values)).toEqual({ Name: 'Ada', Age: 12, Shirt: 'M', Coming: true })
  })

  it('is open to answers only once shared, and keeps its settings through a save', () => {
    const { b, item } = signups()
    expect(sharedForm(b, item.id)).toBeNull()
    const shared = { ...b, items: b.items.map((i) => (i.id === item.id ? { ...i, view: { ...i.view!, form: { shared: true, intro: 'Saturday 10am', bogus: 1 } as never } } : i)) }
    const back = fromJson(toJson(shared))
    expect(back.items.find((i) => i.id === item.id)!.view!.form).toEqual({ shared: true, intro: 'Saturday 10am' })
    expect(sharedForm(back, item.id)?.definition.intro).toBe('Saturday 10am')
    // Another kind of view isn't a form, shared or not.
    const table = { ...shared, items: shared.items.map((i) => (i.id === item.id ? { ...i, view: { ...i.view!, type: 'table' as const } } : i)) }
    expect(sharedForm(table, item.id)).toBeNull()
  })

  it('is set up by an operation: what it asks, what needs an answer, and sharing', () => {
    const { b, item, ds } = signups()
    const after = make([{ op: 'setForm', id: item.id, title: 'Join in', ask: ['Name', 'Shirt'], required: ['Name'], shared: true }], b)
    const view = after.items.find((i) => i.id === item.id)!.view!
    expect(view.form).toEqual({ title: 'Join in', required: [D.fieldByName(ds, 'Name')!.id], shared: true })
    expect(definitionOf(ds, view).questions.map((q) => q.name)).toEqual(['Name', 'Shirt'])
    expect(sharedForm(after, item.id)).not.toBeNull()
    expect(() => make([{ op: 'setForm', id: item.id, required: ['Label'] }], b)).toThrow(/a form can ask/)
  })
})
