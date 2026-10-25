/**
 * Forms: a database view that asks its fields as questions, each answer a new record. Shared, a
 * form can be answered by people who never open the board, through a link to the server, which
 * sees only the questions and adds only the answer. Pure functions, used by the app and server.
 */

import { coerce, getDataset, isComputed } from './dataset'
import { getItem } from './board'
import type { Board, Dataset, DataView, FieldType, FieldValue, Id } from './types'

/** Field types a form can ask (relations would show other records; worked-out ones aren't set). */
const ASKED: FieldType[] = ['text', 'number', 'date', 'select', 'person', 'checkbox']

/** The longest answer to one question. */
export const ANSWER_MAX = 5000

export interface FormQuestion {
  id: string
  name: string
  type: FieldType
  options?: { id: string; name: string }[]
  required: boolean
}

/** What a person answering sees: no records, no other fields. */
export interface FormDefinition {
  title: string
  intro?: string
  thanks?: string
  questions: FormQuestion[]
}

/** The fields a form could ask. */
export const askable = (ds: Dataset) => ds.fields.filter((f) => !isComputed(f) && ASKED.includes(f.type))

/** The questions of a form view: the fields it could ask that it doesn't hide. */
export function questionsOf(ds: Dataset, view: DataView): FormQuestion[] {
  const hidden = new Set(view.hidden ?? [])
  const required = new Set(view.form?.required ?? [])
  return askable(ds)
    .filter((f) => !hidden.has(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      ...(f.type === 'select' ? { options: (f.options ?? []).map((o) => ({ id: o.id, name: o.name })) } : {}),
      required: required.has(f.id),
    }))
}

export function definitionOf(ds: Dataset, view: DataView): FormDefinition {
  const form = view.form ?? {}
  return {
    title: form.title?.trim() || ds.name,
    ...(form.intro?.trim() ? { intro: form.intro.trim() } : {}),
    ...(form.thanks?.trim() ? { thanks: form.thanks.trim() } : {}),
    questions: questionsOf(ds, view),
  }
}

/** The form a `data` item shows, when it's a form view that has been shared; null otherwise. */
export function sharedForm(b: Board, id: Id): { ds: Dataset; view: DataView; definition: FormDefinition } | null {
  const view = getItem(b, id)?.view
  if (!view || view.type !== 'form' || !view.form?.shared) return null
  const ds = getDataset(b, view.dataset)
  return ds ? { ds, view, definition: definitionOf(ds, view) } : null
}

/**
 * Answers (keyed by field id) checked against the questions: the new record's values, or what's
 * wrong in words a person can act on. Anything that isn't a question is left out.
 */
export function answersToValues(ds: Dataset, view: DataView, answers: unknown): { values: Record<string, FieldValue> } | { error: string } {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { error: 'Send the answers as an object keyed by question id' }
  const given = answers as Record<string, unknown>
  const values: Record<string, FieldValue> = {}
  for (const q of questionsOf(ds, view)) {
    const raw = Object.hasOwn(given, q.id) ? given[q.id] : undefined
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim()) || (q.type === 'checkbox' && raw === false)
    if (empty) {
      if (q.required) return { error: `“${q.name}” needs an answer` }
      continue
    }
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return { error: `“${q.name}” should be text, a number or yes/no` }
    if (typeof raw === 'string' && raw.length > ANSWER_MAX) return { error: `“${q.name}” is too long (${ANSWER_MAX} characters at most)` }
    const field = ds.fields.find((f) => f.id === q.id)!
    // Only the choices offered: a form never adds new ones.
    if (q.type === 'select' && !q.options?.some((o) => o.id === raw)) return { error: `“${q.name}” should be one of: ${q.options?.map((o) => o.name).join(', ')}` }
    const v = coerce(field, typeof raw === 'string' ? raw.trim() : raw)
    if (v === undefined) return { error: q.type === 'number' ? `“${q.name}” should be a number` : q.type === 'date' ? `“${q.name}” should be a date` : `“${q.name}” isn’t a valid answer` }
    values[q.id] = v
  }
  if (!Object.keys(values).length) return { error: 'Answer at least one question' }
  return { values }
}

/** The same values keyed by field name, with choices by name, as the addRecords operation takes them. */
export function valuesByFieldName(ds: Dataset, values: Record<string, FieldValue>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const [id, v] of Object.entries(values)) {
    const f = ds.fields.find((x) => x.id === id)
    if (!f) continue
    out[f.name] = f.type === 'select' ? (f.options?.find((o) => o.id === v)?.name ?? '') : v
  }
  return out
}
