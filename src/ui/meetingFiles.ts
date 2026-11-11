/**
 * Meetings and their files: choosing a recording to take notes from, and playing back a meeting
 * whose frame keeps its replay.
 */

import type { Editor } from '../editor/Editor'
import { getFile } from '../model/files'
import { readRecord } from '../model/meetingReplay'
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

/** The file a meeting's frame keeps its replay in, if it has one on this board. */
export function replayFileOf(editor: Editor, frame: Id) {
  const item = editor.board.items.find((i) => i.id === frame)
  const id = item?.kind === 'frame' ? item.meeting?.replay : undefined
  const f = id ? getFile(editor.board, id) : undefined
  return f && !f.trashed ? f : null
}

/** Plays back the meeting framed by `frame`. */
export async function playMeeting(ws: Workspace, editor: Editor, frame: Id) {
  const f = replayFileOf(editor, frame)
  if (!f) return editor.setStatus('This meeting has no replay')
  const blob = await ws.fileBlob(f)
  if (!blob) return editor.setStatus(f.local ? 'This meeting’s replay is only in the browser that took the notes' : 'Couldn’t fetch this meeting’s replay')
  const record = readRecord(await blob.text())
  if (!record || !record.steps.length) return editor.setStatus('This meeting’s replay can’t be read')
  editor.startReplay(record, frame)
}
