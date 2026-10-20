/**
 * A wiki's files: its knowledge base of PDFs, Word documents, slides, spreadsheets and text. Add
 * them (or drop them on the wiki), find them by name or by any word in them, read them here, and
 * make a wiki page from one.
 */

import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FILE_ICON, FILE_KIND_LABEL, filesOf, formatSize, kindOf } from '../../model/files'
import { headings, parseMarkdown } from '../../model/markdown'
import type { BoardFile } from '../../model/types'
import * as W from '../../model/wiki'
import { formatTime } from '../BoardView'
import { useDialog } from '../useDialog'
import { useEditor } from '../useEditor'
import { useEscape } from '../useEscape'
import { useWorkspace } from '../useWorkspace'
import { Markdown, type MarkdownActions } from './Markdown'

/** What the file input offers (anything can be added; these are the ones BrainCraft reads). */
const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.csv,.tsv,.md,.markdown,.txt,.html,.htm,.json,.png,.jpg,.jpeg,.gif,.webp,*/*'

export function FilesDialog() {
  const editor = useEditor()
  const ws = useWorkspace()
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  const close = () => editor.closeFiles()
  useEscape(close)
  const ro = editor.readOnly
  const board = editor.board
  const [query, setQuery] = useState('')
  const [trash, setTrash] = useState(false)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const files = filesOf(board, trash)
  const [selected, setSelected] = useState<string | null>(editor.filesPanel?.select ?? files[0]?.id ?? null)
  const current = files.find((f) => f.id === selected) ?? null

  // Every file's words, read once when someone searches (for finding a word inside a file).
  const [texts, setTexts] = useState<Map<string, string>>(new Map())
  const wantText = query.trim().length >= 3
  useEffect(() => {
    if (!wantText) return
    let live = true
    void (async () => {
      const next = new Map(texts)
      for (const f of filesOf(board).concat(filesOf(board, true))) {
        if (next.has(f.id) || !f.chars) continue
        next.set(f.id, ((await ws.fileText(f)) ?? '').toLowerCase())
      }
      if (live && next.size !== texts.size) setTexts(next)
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantText, board.files])

  const q = query.trim().toLowerCase()
  const shown = q
    ? files.filter((f) => f.name.toLowerCase().includes(q) || (f.excerpt ?? '').toLowerCase().includes(q) || (texts.get(f.id) ?? '').includes(q))
    : files

  const add = async (list: File[]) => {
    if (!list.length) return
    setBusy(true)
    const made = await ws.addFiles(list)
    setBusy(false)
    setTrash(false)
    if (made.length) setSelected(made[made.length - 1])
  }
  const onDrop = (e: DragEvent) => {
    setOver(false)
    const list = Array.from(e.dataTransfer.files)
    if (!list.length) return
    e.preventDefault()
    e.stopPropagation()
    if (ro) return editor.setStatus('This wiki is read-only here')
    void add(list)
  }

  // Over the whole app (the wiki's own layers would otherwise cover it).
  return createPortal(
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={ref}
        className={`modal files-dialog${over ? ' drop-over' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Files in this wiki"
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return
          e.preventDefault()
          e.stopPropagation()
          setOver(true)
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
        onDrop={onDrop}
      >
        <header>
          <h2>Files</h2>
          <span className="muted">{filesOf(board).length ? `${filesOf(board).length} in this wiki` : ''}</span>
          {!ro && (
            <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Adding…' : 'Add files…'}
            </button>
          )}
          <button className="icon-close" aria-label="Close" onClick={close}>
            ×
          </button>
        </header>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          onChange={(e) => {
            void add(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <div className="files-body">
          <section className="files-list" aria-label="Files">
            <input className="files-search" type="search" placeholder="Find a file, or a word in one…" aria-label="Find a file, or a word in one" value={query} onChange={(e) => setQuery(e.target.value)} />
            {!files.length && !trash ? (
              <div className="files-empty">
                <p>
                  <strong>Keep your documents with the wiki.</strong> PDFs, Word documents, slides, spreadsheets and text: drop them here, find them by any word in them, and turn one into a wiki page.
                </p>
                {!ro && <p className="muted">Drop files anywhere on this window, or use Add files.</p>}
              </div>
            ) : !shown.length ? (
              <p className="muted files-none">{q ? `No file has “${query.trim()}” in it${wantText && texts.size < files.filter((f) => f.chars).length ? ' (still reading them…)' : ''}.` : 'The trash is empty.'}</p>
            ) : (
              <ul role="listbox" aria-label="Files">
                {shown.map((f) => (
                  <li key={f.id}>
                    <button role="option" aria-selected={f.id === selected} className={f.id === selected ? 'on' : ''} onClick={() => setSelected(f.id)}>
                      <span className="file-icon" aria-hidden="true">
                        {FILE_ICON[kindOf(f.name, f.type)]}
                      </span>
                      <span className="file-row">
                        <strong>{f.name}</strong>
                        <small className="muted">
                          {FILE_KIND_LABEL[kindOf(f.name, f.type)]} · {formatSize(f.size)}
                          {f.page && W.getPage(board, f.page) && !W.getPage(board, f.page)!.trashed ? ' · has a page' : ''}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(filesOf(board, true).length > 0 || trash) && (
              <button className="link files-trash-toggle" onClick={() => setTrash(!trash)}>
                {trash ? '← Back to the files' : `🗑 Trash (${filesOf(board, true).length})`}
              </button>
            )}
          </section>
          <section className="files-preview" aria-label="The file">
            {current ? <FileView key={current.id} f={current} onPicked={setSelected} /> : <p className="muted files-pick">{files.length ? 'Pick a file to see it here.' : ''}</p>}
          </section>
        </div>
        {over && <div className="files-drop">Drop to add to this wiki</div>}
      </div>
    </div>,
    document.body,
  )
}

/** One file: what it is, what to do with it, and what's in it. */
function FileView({ f, onPicked }: { f: BoardFile; onPicked: (id: string | null) => void }) {
  const editor = useEditor()
  const ws = useWorkspace()
  const ro = editor.readOnly
  const kind = kindOf(f.name, f.type)
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [making, setMaking] = useState(false)
  const showsItself = kind === 'pdf' || kind === 'image'

  useEffect(() => {
    let live = true
    let made: string | null = null
    void (async () => {
      if (showsItself) {
        const blob = await ws.fileBlob(f)
        if (!live) return
        if (!blob) return setMissing(true)
        made = URL.createObjectURL(blob)
        setUrl(made)
      }
      if (f.chars) {
        const t = await ws.fileText(f)
        if (live) setText(t)
      }
    })()
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.id])

  const download = async () => {
    const blob = await ws.fileBlob(f)
    if (!blob) return editor.setStatus(f.local ? 'That file is only in the browser that added it' : 'Couldn’t get that file')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = f.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
  }

  const page = f.page ? W.getPage(editor.board, f.page) : undefined
  const hasPage = !!page && !page.trashed
  const blocks = useMemo(() => (text && !showsItself ? parseMarkdown(text.slice(0, 120_000)) : []), [text, showsItself])
  const actions: MarkdownActions = {
    link: (_to, label, key) => <span key={key}>{label}</span>,
    mention: (_id, label, key) => <span key={key}>@{label}</span>,
    children: () => null,
    headings: headings(blocks),
  }

  return (
    <div className="file-view">
      <div className="file-head">
        <h3>
          <span aria-hidden="true">{FILE_ICON[kind]}</span> {f.name}
        </h3>
        <p className="muted">
          {FILE_KIND_LABEL[kind]} · {formatSize(f.size)}
          {f.pages ? ` · ${f.pages} ${kind === 'slides' ? 'slides' : kind === 'sheet' ? 'sheets' : 'pages'}` : ''} · added {formatTime(f.at)}
          {f.by ? ` by ${f.by}` : ''}
          {f.local && ws.liveInfo ? ' · only in the browser that added it' : ''}
        </p>
        <div className="file-actions">
          {f.trashed ? (
            !ro && (
              <>
                <button className="primary" onClick={() => editor.trashFile(f.id, false)}>
                  Restore
                </button>
                <button
                  className="danger-quiet"
                  onClick={() => {
                    if (!window.confirm(`Delete “${f.name}” for good? This can’t be undone.`)) return
                    onPicked(null)
                    void ws.deleteFile(f.id)
                  }}
                >
                  Delete for good
                </button>
              </>
            )
          ) : (
            <>
              {hasPage ? (
                <button
                  className="primary"
                  onClick={() => {
                    editor.closeFiles()
                    editor.openPage(page!.id)
                  }}
                >
                  Open its page
                </button>
              ) : (
                !ro &&
                !!f.chars && (
                  <button
                    className="primary"
                    disabled={making}
                    title="A page with its words, headings and tables (a long one gets a page per section), linked back to this file"
                    onClick={async () => {
                      setMaking(true)
                      const made = await ws.pageFromFile(f.id)
                      setMaking(false)
                      if (made) editor.closeFiles()
                    }}
                  >
                    {making ? 'Making it…' : 'Make a wiki page'}
                  </button>
                )
              )}
              <button onClick={() => void download()}>Download</button>
              {!!f.chars && (
                <button
                  title="Opens the assistant, which reads the file"
                  onClick={() => {
                    editor.closeFiles()
                    editor.askAi(`Read the file “${f.name}” (file id ${f.id}) with read_file and summarise it: what it's about, the main points, and anything to act on.`, undefined, `Summarise ${f.name}`)
                  }}
                >
                  Ask AI about it
                </button>
              )}
              {!ro && (
                <button className="danger-quiet" onClick={() => editor.trashFile(f.id)}>
                  Move to trash
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="file-content">
        {missing ? (
          <p className="muted">{f.local ? 'This file is only in the browser that added it (it was added before the wiki was shared).' : 'This file couldn’t be fetched.'}</p>
        ) : kind === 'pdf' && url ? (
          <iframe className="file-pdf" src={url} title={f.name} />
        ) : kind === 'image' && url ? (
          <img className="file-image" src={url} alt={f.name} />
        ) : blocks.length ? (
          <Markdown blocks={blocks} actions={actions} />
        ) : f.chars ? (
          <p className="muted">Reading…</p>
        ) : (
          <p className="muted">BrainCraft can’t read the words in this kind of file, but it keeps it: download it to open it.</p>
        )}
      </div>
    </div>
  )
}
