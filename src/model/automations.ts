/**
 * Automations on a database: "when this happens, set that". A rule starts when a record is added,
 * or when a field changes (to a given value, or to anything), and sets fields of the same record:
 * to a value, to today (a date field), or empty. Rules run once on the change that sets them off,
 * for whoever made it, and what they set is synced like any edit; they don't set each other off.
 */

import { coerce, display, fieldById, optionOf } from './dataset'
import { fromDay, today } from './timeline'
import type { Automation, Dataset, DataRecord, FieldValue } from './types'

const same = (a: FieldValue | undefined, z: FieldValue | undefined) => (typeof a === 'string' && typeof z === 'string' ? a.trim().toLowerCase() === z.trim().toLowerCase() : a === z)

/** Whether `rule` is set off by this record changing from `was` (undefined: just added) to `now`. */
function startsOn(rule: Automation, was: DataRecord | undefined, now: DataRecord): boolean {
  if ('added' in rule.when) return !was
  if (!was) return false
  const f = rule.when.field
  if (same(was.values[f], now.values[f])) return false
  return rule.when.to === undefined || same(now.values[f], rule.when.to)
}

/** Applies the rules a change sets off: `before` is the dataset as it was, `after` as changed. */
export function runAutomations(before: Dataset | undefined, after: Dataset, now = new Date()): Dataset {
  const rules = (after.automations ?? []).filter((r) => !r.off)
  if (!rules.length || before === after) return after
  const old = new Map((before?.records ?? []).map((r) => [r.id, r]))
  let changed = false
  const records = after.records.map((r) => {
    const was = old.get(r.id)
    if (was === r) return r
    let values = r.values
    for (const rule of rules) {
      if (!startsOn(rule, was, r)) continue
      for (const step of rule.set) {
        const f = fieldById(after, step.field)
        if (!f) continue
        const v = step.value === 'today' ? (f.type === 'date' ? fromDay(today(now)) : undefined) : step.value === null ? undefined : coerce(f, step.value)
        if (same(values[f.id], v)) continue
        values = { ...values }
        if (v === undefined) delete values[f.id]
        else values[f.id] = v
      }
    }
    if (values === r.values) return r
    changed = true
    return { ...r, values }
  })
  return changed ? { ...after, records } : after
}

/** A value as it reads in a rule ("Done", "today", "ticked"). */
function valueWords(ds: Dataset, fieldId: string, v: FieldValue | 'today' | null | undefined): string {
  if (v === 'today') return 'today'
  if (v === null || v === undefined || v === '') return 'empty'
  const f = fieldById(ds, fieldId)
  if (!f) return String(v)
  if (f.type === 'checkbox') return v ? 'ticked' : 'unticked'
  if (f.type === 'select') return optionOf(f, v)?.name ?? String(v)
  return display(ds, f, v) || String(v)
}

/** A rule as a sentence: "When Status becomes Done, set Completed to today". */
export function describe(ds: Dataset, rule: Automation): string {
  const name = (id: string) => fieldById(ds, id)?.name ?? 'a field that’s gone'
  const when = 'added' in rule.when ? 'When a record is added' : rule.when.to === undefined ? `When ${name(rule.when.field)} changes` : `When ${name(rule.when.field)} becomes ${valueWords(ds, rule.when.field, rule.when.to)}`
  const then = rule.set.map((s) => `set ${name(s.field)} to ${valueWords(ds, s.field, s.value)}`).join(' and ')
  return `${when}, ${then || 'do nothing yet'}`
}
