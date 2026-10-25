/**
 * Shared forms over HTTP, for people who never open the board:
 *
 *   GET  /api/forms/:board/:item           the form: title, words and questions (no records)
 *   POST /api/forms/:board/:item {answers}  one answer, added as a record (automations run)
 *
 * Only a form view whose editors turned on "Anyone with the link" answers. Without accounts the
 * board's id and the view's id are the link; with accounts, the caller has already checked that
 * the asker is signed in.
 */

import { OpError } from '../src/api/ops'
import type { Room } from '../src/collab/room'
import { answersToValues, sharedForm, valuesByFieldName } from '../src/model/forms'
import type { ReadReply } from './boardReads'

const gone = { status: 404, body: { error: 'This form doesn’t exist, or isn’t taking answers any more' } }

/** The item id from the path, when it's one. */
const itemOf = (s: string | undefined) => (s && /^\d{1,9}$/.test(s) ? Number(s) : null)

export function readForm(room: Room | null, item: string | undefined): ReadReply {
  const id = itemOf(item)
  const form = room && id !== null ? sharedForm(room.data.board, id) : null
  return form ? { status: 200, body: { board: room!.data.id, item: id, ...form.definition } } : gone
}

/** Adds one answer; `text` is the request body, {"answers": {fieldId: value}}. */
export function answerForm(room: Room | null, item: string | undefined, text: string): ReadReply {
  const id = itemOf(item)
  const form = room && id !== null ? sharedForm(room.data.board, id) : null
  if (!room || !form || id === null) return gone
  let answers: unknown
  try {
    answers = (JSON.parse(text) as { answers?: unknown }).answers
  } catch {
    return { status: 400, body: { error: 'Send {"answers": {questionId: answer}}' } }
  }
  const checked = answersToValues(form.ds, form.view, answers)
  if ('error' in checked) return { status: 422, body: { error: checked.error } }
  try {
    room.applyOps([{ op: 'addRecords', id, records: [valuesByFieldName(form.ds, checked.values)] }])
  } catch (err) {
    return { status: err instanceof OpError ? 422 : 500, body: { error: (err as Error).message } }
  }
  return { status: 201, body: { ok: true, thanks: form.definition.thanks ?? 'Thanks, your answer is in.' } }
}
