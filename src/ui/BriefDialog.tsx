/**
 * The board's brief: what the board is for, in its people's words. The assistant is given it with
 * its own instructions in everything it does here (see ai/brief.ts); in a meeting it's what tells
 * the notes what's on topic. Written and changed here.
 */

import { useEffect, useRef, useState } from 'react'
import { BRIEF_MAX } from '../model/types'
import { Dialog } from './Boards'
import { useEditor } from './useEditor'

const EXAMPLE = `The warehouse move: weekly check-in.
On topic: the schedule, suppliers, the budget.
Not for the notes: hiring, the office party.
WMS is the warehouse system. Sam is Samira Khan.`

export function BriefDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  const saved = editor.board.brief ?? ''
  const [text, setText] = useState(saved)
  // Someone else changed it while this was open: what's here follows, unless it's been typed in.
  const last = useRef(saved)
  useEffect(() => {
    if (saved === last.current) return
    setText((t) => (t === last.current ? saved : t))
    last.current = saved
  }, [saved])
  const ro = editor.readOnly
  const what = editor.board.kind === 'wiki' ? 'wiki' : 'board'
  const changed = text.trim() !== saved.trim()
  const save = () => {
    editor.setBrief(text)
    onClose()
  }
  return (
    <Dialog label="Brief for the assistant" onClose={onClose} className="brief-dialog">
      <header>
        <h2>Brief for the assistant</h2>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="brief-body">
        <p>
          Say what this {what} is for, in your own words. The assistant reads it before everything it does here: answering, building as you talk, and taking a meeting’s notes, where it’s what tells the notes
          what’s on topic and what isn’t.
        </p>
        <label htmlFor="brief-text">What this {what} is about</label>
        <textarea
          id="brief-text"
          value={text}
          readOnly={ro}
          maxLength={BRIEF_MAX}
          placeholder={EXAMPLE}
          spellCheck
          aria-describedby="brief-hint"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !ro) {
              e.preventDefault()
              save()
            }
          }}
        />
        <p id="brief-hint" className="muted brief-hint">
          <span>Worth saying: what belongs and what doesn’t, names and abbreviations, how you like notes written. Anyone who can change this {what} can change its brief.</span>
          <span className="brief-count" aria-label={`${text.length} of ${BRIEF_MAX} characters`}>
            {text.length.toLocaleString()} / {BRIEF_MAX.toLocaleString()}
          </span>
        </p>
      </div>
      <footer className="check-foot brief-foot">
        {!ro && saved && (
          <button
            className="brief-remove"
            onClick={() => {
              editor.setBrief('')
              onClose()
            }}
          >
            Remove the brief
          </button>
        )}
        <button onClick={onClose}>{ro ? 'Close' : 'Cancel'}</button>
        {!ro && (
          <button className="primary" disabled={!changed} title="Ctrl Enter" onClick={save}>
            Save
          </button>
        )}
      </footer>
    </Dialog>
  )
}
