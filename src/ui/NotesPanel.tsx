import { type ClipboardEvent, type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { emptyBoard, getItem } from '../model/board'
import {
  allNotes,
  backlinks,
  fromEditable,
  type LinkCandidate,
  type LinkRef,
  type LinkTarget,
  linkCandidates,
  linkToken,
  mentionCandidates,
  mentionToken,
  objectLabel,
  parseNote,
  resolveName,
  toEditable,
} from '../model/notes'
import { type Id, type Item, itemKindLabel, type Note } from '../model/types'
import type { CrossLink } from '../store/links'
import { formatTime } from './BoardView'
import { useEditor } from './useEditor'
import { useWorkspace } from './useWorkspace'
import { targetFromUrl } from '../store/deepLink'


/** One wiki-link, resolved against this board and the boards in this browser. */
function WikiLink({ to, label }: { to: LinkTarget | null; label: string }) {
  const editor = useEditor()
  const ws = useWorkspace()
  const target = to ?? resolveName(label, editor.viewBoard, ws.otherBoards)
  if (!target) {
    // A [[Name]] nothing is called yet: following it starts that board, the way wikis do.
    return (
      <button
        className="wikilink new"
        title={editor.readOnly ? 'Nothing is called this yet' : `Start a new board called “${label}”`}
        disabled={editor.readOnly}
        onClick={() => void ws.newBoard({ ...emptyBoard(), title: label })}
      >
        {label}
      </button>
    )
  }
  if (target.page !== undefined) {
    // A wiki page: opens beside the board, so you can read it without leaving.
    const wiki = target.board ? ws.findBoard(target.board) : undefined
    const page = wiki?.outline?.find((p) => p.id === target.page)
    const gone = !wiki || !page
    return (
      <button
        className={`wikilink page${gone ? ' missing' : ''}`}
        title={!wiki ? 'That wiki isn’t in this browser' : !page ? 'That page was deleted or is in the trash' : `Read “${page.title}” beside the board`}
        disabled={!wiki}
        onClick={() => editor.peekPage({ board: target.board!, page: target.page!, ...(target.heading ? { heading: target.heading } : {}) })}
      >
        📘 {wiki ? `${wiki.title} › ` : ''}
        {page?.title ?? label}
      </button>
    )
  }
  const elsewhere = target.board !== undefined && !ws.selfKeys.includes(target.board)
  const meta = elsewhere ? ws.findBoard(target.board!) : undefined
  const item = !elsewhere && target.item !== undefined ? getItem(editor.viewBoard, target.item) : undefined
  const missing = elsewhere ? !meta : target.item !== undefined && !item
  const shown = elsewhere ? (target.item !== undefined ? `${meta?.title ?? 'Board'} › ${label}` : (meta?.title ?? label)) : item ? objectLabel(item) : label
  const title = missing
    ? elsewhere
      ? 'That board isn’t in this browser'
      : 'This object was deleted'
    : elsewhere
      ? `Open the board “${meta!.title}”`
      : item
        ? `Go to ${itemKindLabel(item).toLowerCase()}`
        : 'This board'
  return (
    <button className={`wikilink${elsewhere ? (meta?.icon ? ' board has-icon' : ' board') : ''}${missing ? ' missing' : ''}`} title={title} disabled={missing} onClick={() => void ws.openLink(target)}>
      {meta?.icon && `${meta.icon} `}
      {shown}
    </button>
  )
}

/** Renders note text with @mentions and [[links]] as buttons that go to what they point at. */
function NoteText({ text, onOpen }: { text: string; onOpen: (id: Id) => void }) {
  const editor = useEditor()
  return (
    <p className="note-text">
      {parseNote(text).map((part, k) => {
        if ('text' in part) return <span key={k}>{part.text}</span>
        if ('link' in part) return <WikiLink key={k} to={part.link} label={part.label} />
        const target = getItem(editor.viewBoard, part.mention)
        return (
          <button
            key={k}
            className={`mention${target ? '' : ' missing'}`}
            title={target ? `Go to ${itemKindLabel(target).toLowerCase()}` : 'This object was deleted'}
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

/**
 * The @ and [[ pickers for a text box. The box shows "@Label" and "[[Label]]";
 * `encode` swaps the picked ones for real links when the text is saved.
 */
function useLinkPicker(ref: RefObject<HTMLTextAreaElement | null>, text: string, setText: (t: string) => void, exclude: Id) {
  const editor = useEditor()
  const ws = useWorkspace()
  const picks = useRef(new Map<string, string>())
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  // Caret position to restore once React has rendered an inserted link.
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  })

  const before = text.slice(0, caret)
  const wiki = /\[\[([^[\]\n]*)$/.exec(before)
  const mention = wiki ? null : /@([^\s@]*)$/.exec(before)
  const candidates: LinkCandidate[] = wiki
    ? linkCandidates(editor.viewBoard, wiki[1], ws.otherBoards, exclude)
    : mention
      ? mentionCandidates(editor.viewBoard, mention[1], exclude).map((i) => ({ label: objectLabel(i), hint: itemKindLabel(i), to: { item: i.id } }))
      : []

  const insert = (c: LinkCandidate) => {
    const typed = (wiki ?? mention)!
    const start = caret - typed[0].length
    const shown = wiki ? `[[${c.label}]]` : `@${c.label}`
    picks.current.set(shown, wiki ? linkToken(c.label, c.to) : mentionToken(c.label, c.to.item!))
    // Skip past a "]]" the browser or the person already typed.
    const rest = text.slice(caret).replace(wiki ? /^\]{0,2}/ : /^/, '')
    const next = `${text.slice(0, start)}${shown} ${rest}`
    setText(next)
    const pos = start + shown.length + 1
    setCaret(pos)
    pendingCaret.current = pos
  }

  /** Handles picker keys; true when the key was used. */
  const onKey = (e: KeyboardEvent) => {
    if (!candidates.length) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insert(candidates[Math.min(pick, candidates.length - 1)])
      return true
    }
    return false
  }

  const list =
    candidates.length > 0 ? (
      <ul className="mention-picker" role="listbox">
        {candidates.map((c, k) => (
          <li key={`${c.to.board ?? ''}#${c.to.item ?? ''}/${c.to.page ?? ''}`}>
            <button
              role="option"
              aria-selected={k === pick}
              className={k === pick ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                insert(c)
              }}
            >
              <span>{c.label}</span>
              <small>{c.hint}</small>
            </button>
          </li>
        ))}
      </ul>
    ) : null

  /** A BrainCraft web link pasted in becomes a named link (to a page, an object or a board). */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const to = targetFromUrl(e.clipboardData.getData('text/plain'))
    if (!to) return
    e.preventDefault()
    const [a, z] = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd]
    void ws.labelFor(to).then((label) => {
      // An object on this board needs no board in its link.
      const target = to.board && ws.selfKeys.includes(to.board) && to.page === undefined ? { item: to.item } : to
      const shown = `[[${label}]]`
      picks.current.set(shown, linkToken(label, target))
      const v = ref.current?.value ?? text
      setText(`${v.slice(0, a)}${shown}${v.slice(z)}`)
      pendingCaret.current = a + shown.length
    })
  }

  return {
    list,
    onKey,
    onPaste,
    encode: (t: string) => fromEditable(t, picks.current),
    picks: picks.current,
    track: (el: HTMLTextAreaElement) => {
      setCaret(el.selectionStart)
      setPick(0)
    },
  }
}

function NoteRow({ note, onDelete, onOpen, about }: { note: Note; onDelete?: () => void; onOpen: (id: Id) => void; about?: Item }) {
  return (
    <li className="note">
      <div className="note-meta">
        <strong>{note.author || 'Someone'}</strong>
        <time dateTime={new Date(note.at).toISOString()} title={new Date(note.at).toLocaleString()}>
          {formatTime(note.at)}
        </time>
        {about && (
          <button className="note-about" onClick={() => onOpen(about.id)} title="Go to this object">
            on {objectLabel(about)}
          </button>
        )}
        {onDelete && (
          <button className="note-delete" title="Delete this comment" aria-label="Delete this comment" onClick={onDelete}>
            ×
          </button>
        )}
      </div>
      <NoteText text={note.text} onOpen={onOpen} />
    </li>
  )
}

/** The note composer, with @mention and [[link]] pickers. */
function Composer({ target, author, setAuthor }: { target: Item; author: string; setAuthor: (name: string) => void }) {
  const editor = useEditor()
  const [text, setText] = useState('')
  // Asked once, on the first post: with friends on the same board, "You" tells nobody anything.
  const [askName, setAskName] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const picker = useLinkPicker(ref, text, setText, target.id)
  const { picks } = picker

  useEffect(() => {
    setText('')
    picks.clear()
  }, [target.id, picks])

  const send = () => {
    editor.addNote(target.id, picker.encode(text))
    picks.clear()
    setText('')
  }

  const post = () => {
    if (!text.trim()) return
    if (!author.trim()) {
      setAskName(true)
      return
    }
    send()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // Typing stays here; Ctrl shortcuts (Ctrl K to search, Ctrl J for the assistant) still work.
    if (!(e.ctrlKey || e.metaKey)) e.stopPropagation()
    if (picker.onKey(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      post()
    }
    // Esc hands the keyboard back to the board; Alt C closes the panel, as from the board.
    if (e.key === 'Escape') ref.current?.blur()
    // Only with nothing typed: Option C (Mac) and AltGr C type letters such as ç and ć.
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyC' && !text) {
      e.preventDefault()
      editor.toggleNotes(false)
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={ref}
        value={text}
        rows={3}
        placeholder="Add a comment…  (@ or [[ to link)"
        onChange={(e) => {
          setText(e.target.value)
          picker.track(e.target)
        }}
        onSelect={(e) => picker.track(e.target as HTMLTextAreaElement)}
        onKeyDown={onKeyDown}
        onPaste={picker.onPaste}
      />
      {picker.list}
      {askName && (
        <form
          className="composer-name"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            setAuthor(name.trim())
            setAskName(false)
            send()
          }}
        >
          <label>
            Your name, so friends know who wrote this
            <input autoFocus value={name} placeholder="e.g. Sam" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <button className="primary" type="submit" disabled={!name.trim()}>
            Post
          </button>
        </form>
      )}
      <div className="composer-foot">
        <span className="muted">Enter to post · Shift Enter new line</span>
        <button className="primary" disabled={!text.trim()} onClick={post}>
          Post
        </button>
      </div>
    </div>
  )
}

/**
 * The object's description. It reads with its links as buttons; click it to
 * edit, with the same @ and [[ pickers as comments. Saves when you click away
 * (Ctrl+Enter also saves); Escape cancels.
 */
function Description({ id, value }: { id: Id; value: string }) {
  const editor = useEditor()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const cancelled = useRef(false)
  const picker = useLinkPicker(ref, text, setText, id)
  const { picks } = picker

  const startEditing = () => {
    if (editor.readOnly || editing) return
    const shown = toEditable(value)
    picks.clear()
    for (const [k, v] of shown.picks) picks.set(k, v)
    setText(shown.text)
    setEditing(true)
  }
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])
  // Grow with the text.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [text, editing])

  const finish = () => {
    if (!cancelled.current) {
      const next = picker.encode(text)
      if (next !== value) editor.setDescription(id, next)
    }
    cancelled.current = false
    setEditing(false)
  }

  // Shown as text with links unless it's being edited (or empty, when the box invites typing).
  const asText = !editing && (!!value || editor.readOnly)
  return (
    <section className="description">
      <label htmlFor={`desc-${id}`}>Description</label>
      {asText ? (
        value ? (
          <div
            id={`desc-${id}`}
            className="description-view"
            role={editor.readOnly ? undefined : 'button'}
            tabIndex={editor.readOnly ? undefined : 0}
            title={editor.readOnly ? undefined : 'Click to edit'}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('button')) startEditing()
            }}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                e.stopPropagation()
                startEditing()
              }
            }}
          >
            <NoteText text={value} onOpen={(item) => editor.focusObject(item)} />
          </div>
        ) : (
          <p className="description-view muted">No description</p>
        )
      ) : (
        <div className="description-edit">
          <textarea
            id={`desc-${id}`}
            ref={ref}
            value={text}
            rows={2}
            placeholder="What is this? Add context, decisions, [[links]]…"
            onFocus={startEditing}
            onChange={(e) => {
              setText(e.target.value)
              picker.track(e.target)
            }}
            onSelect={(e) => picker.track(e.target as HTMLTextAreaElement)}
            onPaste={picker.onPaste}
            onBlur={finish}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (picker.onKey(e)) return
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur()
              if (e.key === 'Escape') {
                cancelled.current = true
                requestAnimationFrame(() => ref.current?.blur())
              }
            }}
          />
          {picker.list}
        </div>
      )}
    </section>
  )
}

/** Work notes for the selected object, sliding in from the right. */
export function NotesPanel() {
  const editor = useEditor()
  const open = (id: Id) => editor.focusObject(id)
  const target = editor.single
  const ws = useWorkspace()
  // One name everywhere: the workspace stores it (the share dialog sets the same one).
  const author = editor.author
  const setAuthor = (name: string) => ws.setName(name)
  const [draft, setDraft] = useState(author)
  useEffect(() => setDraft(author), [author])

  const cross = useLinksHere(editor.notesOpen)
  // Opened for one object: the keyboard goes to its comment box, so typing doesn't replace the
  // object's text. Not on touch screens, where that would pop up the keyboard just to read.
  useEffect(() => {
    if (editor.notesOpen && !globalThis.matchMedia?.('(pointer: coarse)').matches) document.querySelector<HTMLTextAreaElement>('.notes-panel .composer textarea')?.focus({ preventScroll: true })
  }, [editor.notesOpen])

  if (!editor.notesOpen) return null
  const notes = target ? [...(target.notes ?? [])].reverse() : []
  const links = target ? backlinks(editor.viewBoard, target.id, ws.selfKeys, ws.otherBoards) : []
  // With an object selected, links to it; otherwise every link to this board.
  const fromElsewhere = target ? cross.filter((l) => l.to.item === target.id) : cross

  return (
    <aside className="notes-panel no-canvas" aria-label="Comments" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <div>
          <h2>Comments</h2>
          {target ? (
            <button className="panel-target" onClick={() => open(target.id)} title="Go to this object">
              {itemKindLabel(target)} · {objectLabel(target)}
            </button>
          ) : (
            <span className="muted">{editor.selection.size > 1 ? 'Select one object to comment on it' : 'All comments on this board'}</span>
          )}
        </div>
        <button className="icon-close" aria-label="Close comments" title="Close (Alt C)" onClick={() => editor.toggleNotes(false)}>
          ×
        </button>
      </header>

      {target && <Description key={target.id} id={target.id} value={target.description ?? ''} />}

      {target && target.kind !== 'pen' && !editor.readOnly && <Composer target={target} author={author} setAuthor={setAuthor} />}

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
                <h3>Linked from</h3>
                <ul className="notes">
                  {links.map((r) => (
                    <LinkRow key={`${r.item!.id}:${r.note?.id ?? 'description'}`} link={r} onOpen={open} />
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <AllNotes onOpen={open} />
        )}
        {fromElsewhere.length > 0 && (
          <>
            <h3>Linked from other boards</h3>
            <ul className="notes">
              {fromElsewhere.map((l) => (
                <CrossRow key={`${l.boardId}:${l.from ?? l.fromPage}:${l.note?.id ?? 'description'}:${l.to.item ?? ''}`} link={l} />
              ))}
            </ul>
          </>
        )}
      </div>

      <footer>
        <label>
          Posting as
          <input
            value={draft}
            placeholder="Your name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft.trim() !== author && setAuthor(draft)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </label>
      </footer>
    </aside>
  )
}

/** Links to the open board from comments and descriptions on the other boards in this browser. */
function useLinksHere(open: boolean): CrossLink[] {
  const ws = useWorkspace()
  const [links, setLinks] = useState<CrossLink[]>([])
  const { boards, boardId } = ws
  useEffect(() => {
    if (!open) return
    let current = true
    ws.linksHere().then(
      (l) => current && setLinks(l),
      () => current && setLinks([]),
    )
    return () => {
      current = false
    }
  }, [open, ws, boards, boardId])
  return links
}

/** A comment (or description) on this board that links to the selected object. */
function LinkRow({ link, onOpen }: { link: LinkRef; onOpen: (id: Id) => void }) {
  const { note } = link
  // Links found on this board come from objects (backlinks never list pages here).
  const item = link.item!
  if (note) return <NoteRow note={note} about={item} onOpen={onOpen} />
  return (
    <li className="note">
      <div className="note-meta">
        <strong>Description</strong>
        <button className="note-about" onClick={() => onOpen(item.id)} title="Go to this object">
          of {objectLabel(item)}
        </button>
      </div>
      <NoteText text={item.description ?? ''} onOpen={onOpen} />
    </li>
  )
}

/** A comment (or description) on another board that links here. */
function CrossRow({ link }: { link: CrossLink }) {
  const ws = useWorkspace()
  const editor = useEditor()
  const { note } = link
  return (
    <li className="note">
      <div className="note-meta">
        <strong>{note ? note.author || 'Someone' : link.fromPage !== undefined ? 'Wiki page' : 'Description'}</strong>
        {note && (
          <time dateTime={new Date(note.at).toISOString()} title={new Date(note.at).toLocaleString()}>
            {formatTime(note.at)}
          </time>
        )}
        {link.fromPage !== undefined ? (
          <button className="note-about" onClick={() => editor.peekPage({ board: link.boardId, page: link.fromPage! })} title="Read that wiki page beside the board">
            📘 {link.boardTitle} › {link.fromLabel}
          </button>
        ) : (
          <button className="note-about" onClick={() => void ws.openLink({ board: link.boardId, item: link.from })} title="Open that board at this object">
            {link.boardTitle} › {link.fromLabel}
          </button>
        )}
      </div>
      <p className="note-text">{link.text}</p>
    </li>
  )
}

function AllNotes({ onOpen }: { onOpen: (id: Id) => void }) {
  const editor = useEditor()
  const notes = allNotes(editor.viewBoard)
  if (!notes.length)
    return <p className="empty muted">Nothing yet. Select any object and add a comment, or press Alt C with it selected.</p>
  return (
    <ul className="notes">
      {notes.map(({ item, note }) => (
        <NoteRow key={note.id} note={note} about={item} onOpen={onOpen} />
      ))}
    </ul>
  )
}
