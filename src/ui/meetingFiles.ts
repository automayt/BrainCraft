/**
 * Meetings and their files: choosing a recording to take notes from, the record each meeting's
 * frame keeps (what was said, how the notes grew, and its review), reviewing a meeting against its
 * whole transcript in the background, the level of detail its views show, correcting a name once
 * for the whole meeting, and playing a meeting back.
 */

import type { Editor } from '../editor/Editor'
import { MEETING_REVIEW } from '../ai/assistant'
import { askOnce } from '../ai/once'
import { getFile } from '../model/files'
import { ALL_PICKS, type MeetingPicks, clock, howLong, joinFragments, transcriptText } from '../model/meeting'
import { type MeetingRecord, readRecord } from '../model/meetingReplay'
import { type Detail, DETAILS, correctSpeakers, firstDetail, parseReview, peopleOf, renameInReview, unfinished } from '../model/meetingReview'
import type { Id } from '../model/types'
import type { Workspace } from '../store/workspace'

/** Asks for a meeting's recording (audio, or a video of it); null when none was chosen. */
export function pickRecording(): Promise<File | null> {
  return new Promise((done) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*,video/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4,.mov,.mkv'
    input.onchange = () => done(input.files?.[0] ?? null)
    input.oncancel = () => done(null)
    input.click()
  })
}

/** The file a meeting's frame keeps its record and replay in, if it has one on this board. */
export function replayFileOf(editor: Editor, frame: Id) {
  const item = editor.board.items.find((i) => i.id === frame)
  const id = item?.kind === 'frame' ? item.meeting?.replay : undefined
  const f = id ? getFile(editor.board, id) : undefined
  return f && !f.trashed ? f : null
}

/** Records already read, by file (a record's file never changes: a new one replaces it). */
const read = new Map<string, MeetingRecord>()

/** The record a meeting's frame keeps, read back; a sentence saying why not when it can't be. */
export async function recordOf(ws: Workspace, editor: Editor, frame: Id): Promise<MeetingRecord | string> {
  const f = replayFileOf(editor, frame)
  if (!f) return 'This meeting has no record'
  const known = read.get(f.id)
  if (known) return known
  const blob = await ws.fileBlob(f)
  if (!blob) return f.local ? 'This meeting’s record is only in the browser that took the notes' : 'Couldn’t fetch this meeting’s record'
  const record = readRecord(await blob.text())
  if (!record) return 'This meeting’s record can’t be read'
  read.set(f.id, record)
  return record
}

/** Keeps a meeting's record as a file with the board, linked from its frame (the one it replaces goes). */
export async function saveRecord(ws: Workspace, editor: Editor, frame: Id, record: MeetingRecord): Promise<boolean> {
  const old = replayFileOf(editor, frame)
  const id = await ws.keepMadeFile(`Meeting record: ${record.title}.json`, 'application/json', new Blob([JSON.stringify(record)], { type: 'application/json' }))
  if (!id) return false
  read.set(id, record)
  editor.setMeetingReplay(frame, id)
  if (old && old.id !== id) void ws.deleteFile(old.id)
  return true
}

/** Plays back the meeting framed by `frame`, from `at` ms in. */
export async function playMeeting(ws: Workspace, editor: Editor, frame: Id, at = 0) {
  const record = await recordOf(ws, editor, frame)
  if (typeof record === 'string') return editor.setStatus(record)
  if (!record.steps.length) return editor.setStatus('This meeting has nothing to play back')
  editor.startReplay(record, frame)
  if (at > 0) editor.replayTo(at)
}

/** The meeting's frame an object is in, if any (the innermost, when meetings sit inside one another). */
export function meetingFrameOf(editor: Editor, id: Id): Id | null {
  const i = editor.board.items.find((x) => x.id === id)
  if (!i) return null
  if (i.kind === 'frame' && i.meeting?.replay) return i.id
  const cx = i.x + i.w / 2
  const cy = i.y + i.h / 2
  const frames = editor.board.items.filter((f) => f.kind === 'frame' && f.meeting?.replay && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h)
  frames.sort((a, z) => a.w * a.h - z.w * z.h)
  return frames[0]?.id ?? null
}

/** The transcript as the review reads it: when, who (as far as was known), what. */
export function reviewText(r: MeetingRecord): string {
  const day = new Date(r.started).toISOString().slice(0, 10)
  const head = `[The meeting “${r.title}”, on ${day}, ${howLong(r.length)}. Those named in it: ${peopleOf(null, r.lines).join(', ') || 'nobody yet'}.]`
  const lines = joinFragments(r.lines).map((l) => `[${clock(l.at)}] ${l.who ?? 'Not sure who'}: ${l.text}`)
  return `${head}\n\n${lines.join('\n')}`
}

/**
 * Reviews a meeting against its whole transcript, in the background: the assistant writes the
 * meeting down once (who really spoke, the complete ideas, what it came to), names are corrected
 * everywhere, and the frame's views are made or updated from it, leaving alone anything changed
 * by hand. `arrange`: the first review lays the frame out afresh.
 */
export async function reviewMeeting(ws: Workspace, editor: Editor, frame: Id, o: { record?: MeetingRecord; picks?: MeetingPicks; touched?: ReadonlySet<Id>; arrange?: boolean } = {}) {
  if (editor.reviewing.has(frame) || editor.readOnly) return
  const got = o.record ?? (await recordOf(ws, editor, frame))
  if (typeof got === 'string') return editor.setStatus(got)
  if (!got.lines.length) return editor.setStatus('Nothing was said in this meeting to review')
  editor.setReviewing(frame, true)
  editor.setStatus('Reviewing the meeting against its whole transcript…')
  try {
    const reply = await askOnce(ws.server, MEETING_REVIEW, reviewText(got))
    const review = parseReview(reply)
    if (!review.ideas.length && !review.outcomes.length) return editor.setStatus('The review came back empty, so the notes are as they were')
    // Who spoke, corrected once for everything.
    const fixed = correctSpeakers(got.lines, review)
    for (const r of fixed.renames) editor.renameInMeeting(frame, r.from, r.to)
    const lines = fixed.lines
    const title = review.title ?? got.title
    const picks = { ...ALL_PICKS, ...got.picks, ...o.picks }
    const at = editor.board.items.find((i) => i.id === frame)
    const detail = at?.meeting?.detail ?? firstDetail(review)
    const kept = editor.polishMeeting({
      frame,
      title,
      review,
      detail,
      picks,
      length: got.length,
      howLong: howLong(got.length),
      lines,
      people: peopleOf(review, lines),
      transcript: transcriptText({ lines: joinFragments(lines) }),
      touched: o.touched,
      arrange: !!o.arrange,
    })
    if (kept === null) return editor.setStatus('The meeting’s frame is gone, so its review wasn’t used')
    await saveRecord(ws, editor, frame, { ...got, v: 2, title, lines, review, picks })
    editor.setStatus(`Reviewed “${title}”${kept.length ? `; left ${kept.join(' and ')} as you changed ${kept.length > 1 ? 'them' : 'it'}` : ''}`)
  } catch (err) {
    editor.setStatus(`Couldn’t review the meeting (${(err as Error).message}); its notes are as they were`)
  } finally {
    editor.setReviewing(frame, false)
  }
}

/** Shows a meeting's mind map and speaker timeline at another level of detail (the transcript keeps every word). */
export async function showDetail(ws: Workspace, editor: Editor, frame: Id, detail: Detail) {
  const record = await recordOf(ws, editor, frame)
  if (typeof record === 'string') return editor.setStatus(record)
  if (!record.review) return editor.setStatus('Review this meeting first: its views are made from the review')
  const kept = editor.polishMeeting({
    frame,
    title: editor.board.items.find((i) => i.id === frame)?.text || record.title,
    review: record.review,
    detail,
    picks: { ...ALL_PICKS, ...record.picks },
    length: record.length,
    howLong: howLong(record.length),
    lines: record.lines,
    people: peopleOf(record.review, record.lines),
    arrange: false,
    only: ['map', 'timeline'],
  })
  const name = DETAILS.find((d) => d.level === detail)?.name ?? ''
  if (kept !== null) editor.setStatus(kept.length ? `Showing ${name.toLowerCase()} detail; left ${kept.join(' and ')} as you changed ${kept.length > 1 ? 'them' : 'it'}` : `Showing ${name.toLowerCase()} detail`)
}

/** Everyone who spoke in a meeting, as its record has them. */
export async function meetingPeople(ws: Workspace, editor: Editor, frame: Id): Promise<string[] | string> {
  const record = await recordOf(ws, editor, frame)
  if (typeof record === 'string') return record
  const all = new Set<string>()
  for (const l of record.lines) if (l.who) all.add(l.who)
  for (const i of record.review?.ideas ?? []) if (i.who) all.add(i.who)
  return [...all]
}

/**
 * One correction for a whole meeting: a person's name changed on everything in its frame, in its
 * record (transcript and review), and in the voices the server remembers.
 */
export async function renamePerson(ws: Workspace, editor: Editor, frame: Id, from: string, to: string, password?: string) {
  const name = to.replace(/[[\]\n]+/g, ' ').trim().slice(0, 40)
  if (!name || name === from) return
  editor.renameInMeeting(frame, from, name)
  const record = await recordOf(ws, editor, frame)
  if (typeof record !== 'string') {
    const same = (w?: string) => (w && w.toLowerCase() === from.toLowerCase() ? name : w)
    const lines = record.lines.map((l) => (same(l.who) !== l.who ? { ...l, who: same(l.who) } : l))
    await saveRecord(ws, editor, frame, { ...record, v: 2, lines, ...(record.review ? { review: renameInReview(record.review, from, name) } : {}) })
  }
  // A voice the server remembers by the old name is known by the new one from now on.
  if (ws.server && !/^voice \d+$/i.test(from))
    void fetch(new URL(`api/ai/voices?name=${encodeURIComponent(from)}`, ws.server.endsWith('/') ? ws.server : `${ws.server}/`), {
      method: 'PATCH',
      body: JSON.stringify({ name }),
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-braincraft': '1', ...(password ? { 'x-braincraft-ai-password': password } : {}) },
    }).catch(() => {})
  editor.setStatus(`“${from}” is “${name}” everywhere in this meeting`)
}

/** What's left from the last meeting on this board, for the next one's agenda. */
export async function carryOver(ws: Workspace, editor: Editor): Promise<{ title: string; items: string[] } | null> {
  const frames = editor.board.items.filter((i) => i.kind === 'frame' && i.meeting?.replay)
  const latest = frames
    .map((f) => ({ f, file: replayFileOf(editor, f.id) }))
    .filter((x) => x.file)
    .sort((a, z) => z.file!.at - a.file!.at)[0]
  if (!latest) return null
  const record = await recordOf(ws, editor, latest.f.id)
  if (typeof record === 'string' || !record.review) return null
  const items = unfinished(record.review.outcomes)
  return items.length ? { title: latest.f.text || record.title, items: items.slice(0, 12) } : null
}
