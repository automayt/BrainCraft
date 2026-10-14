import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getItem } from '../model/board'
import { allNotes, backlinks, mentionCandidates, mentionToken, objectLabel, parseNote } from '../model/notes'
import { type Id, type Item, KIND_LABELS, type Note } from '../model/types'
import { formatTime } from './BoardView'
import { useEditor } from './useEditor'

const AUTHOR_KEY = 'braincraft:author'

/** Renders note text with @mentions as links to their objects. */
function NoteText({ text, onOpen }: { text: string; onOpen: (id: Id) => void }) {
  const editor = useEditor()
  return (
    <p className="note-text">
      {parseNote(text).map((part, k) => {
        if ('text' in part) return <span key={k}>{part.text}</span>
        const target = getItem(editor.board, part.mention)
        return (
          <button
            key={k}
            className={`mention${target ? '' : ' missing'}`}
            title={target ? `Go to ${KIND_LABELS[target.kind].toLowerCase()}` : 'This object was deleted'}
            disabled={!target}
            onClick={() => onOpen(part.mention)}
          >
            @{target ? objectLabel(target) : part.label}
          </button>
        )
      })}
    </p>
  )
}

function NoteRow({ note, onDelete, onOpen, about }: { note: Note; onDelete?: () => void; onOpen: (id: Id) => void; about?: Item }) {
  return (
    <li className="note">
      <div className="note-meta">
        <strong>{note.author || 'You'}</strong>
        <time dateTime={new Date(note.at).toISOString()} title={new Date(note.at).toLocaleString()}>
          {formatTime(note.at)}
        </time>
        {about && (
          <button className="note-about" onClick={() => onOpen(about.id)} title="Go to this object">
            on {objectLabel(about)}
          </button>
        )}
        {onDelete && (
          <button className="note-delete" title="Delete this note" aria-label="Delete this note" onClick={onDelete}>
            ×
          </button>
        )}
      </div>
      <NoteText text={note.text} onOpen={onOpen} />
    </li>
  )
}

/** The note composer, with an @mention picker. */
function Composer({ target }: { target: Item }) {
  const editor = useEditor()
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Caret position to restore once React has rendered an inserted mention.
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  })

  useEffect(() => {
    setText('')
  }, [target.id])

  const mention = /@([^\s@]*)$/.exec(text.slice(0, caret))
  const candidates = mention ? mentionCandidates(editor.board, mention[1], target.id) : []

  const insert = (item: Item) => {
    if (!mention) return
    const start = caret - mention[0].length
    const token = `${mentionToken(objectLabel(item), item.id)} `
    const next = text.slice(0, start) + token + text.slice(caret)
    setText(next)
    const pos = start + token.length
    setCaret(pos)
    pendingCaret.current = pos
  }

  const post = () => {
    if (!text.trim()) return
    editor.addNote(target.id, text)
    setText('')
    setCaret(0)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insert(candidates[Math.min(pick, candidates.length - 1)])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      post()
    }
    if (e.key === 'Escape') ref.current?.blur()
  }

  return (
    <div className="composer">
      <textarea
        ref={ref}
        value={text}
        rows={3}
        placeholder="Add a work note…  (@ to mention an object)"
        onChange={(e) => {
          setText(e.target.value)
          setCaret(e.target.selectionStart)
          setPick(0)
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={onKeyDown}
      />
      {candidates.length > 0 && (
        <ul className="mention-picker" role="listbox">
          {candidates.map((c, k) => (
            <li key={c.id}>
              <button
                role="option"
                aria-selected={k === pick}
                className={k === pick ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insert(c)
                }}
              >
                <span>{objectLabel(c)}</span>
                <small>{KIND_LABELS[c.kind]}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-foot">
        <span className="muted">Enter to post · Shift+Enter new line</span>
        <button className="primary" disabled={!text.trim()} onClick={post}>
          Post
        </button>
      </div>
    </div>
  )
}

/** Work notes for the selected object, sliding in from the right. */
export function NotesPanel() {
  const editor = useEditor()
  const open = (id: Id) => editor.focusObject(id)
  const target = editor.single
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem(AUTHOR_KEY) ?? ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    editor.setAuthor(author)
    try {
      localStorage.setItem(AUTHOR_KEY, author)
    } catch {
      // Storage blocked: the name lasts for this visit only.
    }
  }, [author, editor])

  if (!editor.notesOpen) return null
  const notes = target ? [...(target.notes ?? [])].reverse() : []
  const links = target ? backlinks(editor.board, target.id) : []

  return (
    <aside className="notes-panel no-canvas" aria-label="Comments" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <div>
          <h2>Comments</h2>
          {target ? (
            <button className="panel-target" onClick={() => open(target.id)} title="Go to this object">
              {KIND_LABELS[target.kind]} · {objectLabel(target)}
            </button>
          ) : (
            <span className="muted">{editor.selection.size > 1 ? 'Select one object to comment on it' : 'All comments on this board'}</span>
          )}
        </div>
        <button className="icon-close" aria-label="Close comments" title="Close (Shift+C)" onClick={() => editor.toggleNotes(false)}>
          ×
        </button>
      </header>

      {target && target.kind !== 'pen' && <Composer target={target} />}

      <div className="notes-scroll">
        {target ? (
          <>
            {notes.length === 0 && <p className="empty muted">No comments yet.</p>}
            <ul className="notes">
              {notes.map((n) => (
                <NoteRow key={n.id} note={n} onOpen={open} onDelete={() => editor.deleteNote(target.id, n.id)} />
              ))}
            </ul>
            {links.length > 0 && (
              <>
                <h3>Mentioned in</h3>
                <ul className="notes">
                  {links.map(({ item, note }) => (
                    <NoteRow key={note.id} note={note} about={item} onOpen={open} />
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <AllNotes onOpen={open} />
        )}
      </div>

      <footer>
        <label>
          Posting as
          <input value={author} placeholder="Your name" onChange={(e) => setAuthor(e.target.value)} />
        </label>
      </footer>
    </aside>
  )
}

function AllNotes({ onOpen }: { onOpen: (id: Id) => void }) {
  const editor = useEditor()
  const notes = allNotes(editor.board)
  if (!notes.length)
    return <p className="empty muted">Nothing yet. Select any object and add a comment, or press Shift+C with it selected.</p>
  return (
    <ul className="notes">
      {notes.map(({ item, note }) => (
        <NoteRow key={note.id} note={note} about={item} onOpen={onOpen} />
      ))}
    </ul>
  )
}
