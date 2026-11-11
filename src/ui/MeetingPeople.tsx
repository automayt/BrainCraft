/**
 * Who was in a meeting: each person (or voice) heard, and a name to correct. One correction
 * changes the name everywhere in the meeting's frame, in its record, and in the voices the server
 * remembers.
 */

import { useEffect, useRef, useState } from 'react'
import { loadSettings } from '../ai/settings'
import type { Id } from '../model/types'
import { meetingPeople, renamePerson } from './meetingFiles'
import { useDialog } from './useDialog'
import { useEditor } from './useEditor'
import { useEscape } from './useEscape'
import { useWorkspace } from './useWorkspace'

export function MeetingPeopleDialog({ frame, onClose }: { frame: Id; onClose: () => void }) {
  useEscape(onClose)
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  const editor = useEditor()
  const ws = useWorkspace()
  const [people, setPeople] = useState<string[] | string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    void meetingPeople(ws, editor, frame).then(setPeople)
  }, [ws, editor, frame])
  const change = async (from: string) => {
    const to = (names[from] ?? '').trim()
    if (!to || to === from) return
    await renamePerson(ws, editor, frame, from, to, loadSettings().password)
    setPeople((p) => (Array.isArray(p) ? [...new Set(p.map((x) => (x === from ? to : x)))] : p))
    setNames((n) => ({ ...n, [from]: '' }))
  }
  const title = editor.board.items.find((i) => i.id === frame)?.text || 'this meeting'

  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal meeting-people" role="dialog" aria-modal="true" aria-label="People in the meeting">
        <header>
          <h2>People in {title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="meeting-people-body">
          <p className="muted">A name changed here changes everywhere in the meeting: its notes, its transcript and its timeline. A voice the server remembers is known by the new name from then on.</p>
          {people === null ? (
            <p className="muted">Reading the meeting’s record…</p>
          ) : typeof people === 'string' ? (
            <p>{people}</p>
          ) : !people.length ? (
            <p>Nobody in this meeting was told apart by voice.</p>
          ) : (
            <ul>
              {people.map((p) => (
                <li key={p}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void change(p)
                    }}
                  >
                    <label>
                      <span className="meeting-person">{p}</span>
                      <input value={names[p] ?? ''} placeholder="Their name" aria-label={`New name for ${p}`} maxLength={40} disabled={editor.readOnly} onChange={(e) => setNames({ ...names, [p]: e.target.value })} />
                    </label>
                    <button type="submit" disabled={editor.readOnly || !(names[p] ?? '').trim()}>
                      Rename
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
