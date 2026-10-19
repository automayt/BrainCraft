/** The board library, version history, share links and the read-only banner. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { LEVEL_LABEL } from '../store/account'
import { useDialog } from './useDialog'
import { TEMPLATES, boardFromTemplate } from '../model/templates'
import { WIKI_TEMPLATES } from '../model/wikiTemplates'
import { isWiki, pageOrder, pagePath } from '../model/wiki'
import { type BoardMeta, type ThumbRect, thumbnail, type VersionMeta } from '../store/library'
import { darken } from './BoardView'
import { ink, mindRootFill } from './paint'
import { useEditor } from './useEditor'
import { useEscape } from './useEscape'
import { useWorkspace } from './useWorkspace'
import { LiveSection } from './Live'
import { copyText } from './copyText'
import { useUi } from './uiContext'

export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.round((now - t) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined })
}

function fillOf([, , , , color, kind]: ThumbRect): string {
  if (kind === 'text' || kind === 'pen') return ink(color)
  if (kind === 'table' || kind === 'kanban' || kind === 'timeline') return 'var(--surface-3)'
  if (kind === 'mind') return mindRootFill(color)
  return darken(color, 0.85)
}

/** A miniature of a board: every object as a coloured block. */
export function Thumb({ thumb, aspect }: { thumb: ThumbRect[]; aspect: number }) {
  const w = aspect >= 1 ? 1000 : 1000 * aspect
  const h = aspect >= 1 ? 1000 / aspect : 1000
  const pad = 60
  return (
    <svg className="thumb" viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {thumb.map((r, k) =>
        r[5] === 'frame' ? (
          <rect key={k} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={8} className="thumb-frame" />
        ) : (
          <rect key={k} x={r[0]} y={r[1]} width={r[2]} height={Math.max(r[3], 4)} rx={Math.min(6, r[2] / 6)} style={{ fill: fillOf(r) }} />
        ),
      )}
    </svg>
  )
}

export function Dialog({ label, onClose, className = '', children }: { label: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  useEscape(onClose)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialog(dialogRef)
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// ----- board library ---------------------------------------------------------------

export function BoardsDialog({ onClose, onOpenFile }: { onClose: () => void; onOpenFile: () => void }) {
  const ws = useWorkspace()
  const editor = useEditor()
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? ws.boards.filter((b) => b.title.toLowerCase().includes(q)) : ws.boards
  }, [ws.boards, query])

  const open = (id: string) => {
    onClose()
    if (id !== ws.boardId) void ws.switchTo(id)
  }
  const create = (t: (typeof TEMPLATES)[number]) => {
    onClose()
    void ws.newBoard(boardFromTemplate(t, editor.measure))
  }

  return (
    <Dialog label="Your boards" onClose={onClose} className="boards">
      <header>
        <h2>Your boards</h2>
        <input
          className="boards-search"
          aria-label="Find a board"
          placeholder="Find a board"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && shown[0] && open(shown[0].id)}
        />
        <button onClick={() => (onClose(), onOpenFile())}>Open file…</button>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="boards-body">
        {!query && (
          <h3 className="templates-title" id="new-board-title">
            New board <small>a canvas to draw and brainstorm on</small>
          </h3>
        )}
        {!query && (
          <section className="templates" aria-labelledby="new-board-title">
            {TEMPLATES.map((t) => (
              <button key={t.id} className="template" onClick={() => create(t)}>
                <TemplateThumb id={t.id} />
                <strong>{t.label}</strong>
                <small>{t.hint}</small>
              </button>
            ))}
          </section>
        )}
        {!query && (
          <h3 className="templates-title" id="new-wiki-title">
            New wiki <small>pages to write things down: plans, lists, notes</small>
          </h3>
        )}
        {!query && (
          <section className="templates wiki-templates" aria-labelledby="new-wiki-title">
            <button
              className="template guide-template"
              onClick={() => {
                onClose()
                void ws.openGuide()
              }}
            >
              <span className="thumb wiki-thumb" aria-hidden="true">
                <span>🧭 Start here</span>
                <span>🎨 The canvas</span>
                <span>📘 Wikis</span>
                <span>🤝 Together</span>
                <span>🔌 The API</span>
              </span>
              <strong>BrainCraft guide</strong>
              <small>How everything works, with a tour board</small>
            </button>
            {WIKI_TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="template"
                onClick={() => {
                  onClose()
                  void ws.newWiki(undefined, t.id)
                }}
              >
                <span className="thumb wiki-thumb" aria-hidden="true">
                  {t.pages.length ? (
                    t.pages.slice(0, 5).map((p) => <span key={p.title}>{p.icon} {p.title}</span>)
                  ) : (
                    <>
                      <i />
                      <i />
                      <i className="sub" />
                      <i className="sub" />
                      <i />
                    </>
                  )}
                </span>
                <strong>{t.id === 'wiki' ? 'Wiki' : `${t.label} wiki`}</strong>
                <small>{t.hint}</small>
              </button>
            ))}
          </section>
        )}
        {!ws.persistent && <p className="boards-warning">This browser isn't keeping boards between visits. Save to a file to keep your work.</p>}
        {ws.account?.user && (
          <section className="server-boards" aria-labelledby="server-boards-title">
            <h3 className="templates-title" id="server-boards-title">
              On this server <small>boards and wikis you can open, yours and shared with you</small>
            </h3>
            <ul className="access-list">
              {ws.serverBoards
                .filter((b) => !query.trim() || b.title.toLowerCase().includes(query.trim().toLowerCase()))
                .map((b) => (
                  <li key={b.id}>
                    <button
                      className="link server-board"
                      onClick={() => {
                        onClose()
                        void ws.openServerBoard(b)
                      }}
                    >
                      {b.kind === 'wiki' ? '📘 ' : ''}
                      {b.title || 'Untitled'}
                    </button>
                    <small className="muted">
                      {b.owner ? (b.owner.id === ws.account?.user?.id ? 'yours' : b.owner.name) : 'no owner'} · {LEVEL_LABEL[b.level].toLowerCase()} · {timeAgo(b.updated)}
                    </small>
                  </li>
                ))}
              {!ws.serverBoards.length && <li className="muted">Nothing here yet. New boards you make go to the server.</li>}
            </ul>
            <h3 className="templates-title">In this browser</h3>
          </section>
        )}
        <div className="board-grid">
          {shown.map((b) => (
            <BoardCard
              key={b.id}
              meta={b}
              current={b.id === ws.boardId}
              renaming={renaming === b.id}
              confirming={confirming === b.id}
              onOpen={() => open(b.id)}
              onRename={(title) => {
                setRenaming(null)
                if (title.trim() && title !== b.title) void ws.rename(b.id, title.trim())
              }}
              onStartRename={() => setRenaming(b.id)}
              onDuplicate={() => void ws.duplicate(b.id)}
              onDelete={() => (confirming === b.id ? (setConfirming(null), void ws.remove(b.id)) : setConfirming(b.id))}
              onCancelDelete={() => setConfirming(null)}
            />
          ))}
          {!shown.length && <p className="muted empty">No boards match “{query}”.</p>}
        </div>
      </div>
    </Dialog>
  )
}

/** A wiki's card: the first few pages of its tree. */
function WikiOutline({ meta }: { meta: BoardMeta }) {
  const pages = meta.outline ?? []
  const depth = (id: string | undefined, n = 0): number => {
    const p = id === undefined ? undefined : pages.find((x) => x.id === id)
    return p?.parent === undefined || n > 4 ? n : depth(p.parent, n + 1)
  }
  return (
    <span className="thumb wiki-outline" aria-hidden="true">
      <span className="wiki-badge">Wiki</span>
      {pages.slice(0, 6).map((p) => (
        <span key={p.id} style={{ paddingLeft: depth(p.id) * 10 }}>
          {p.icon ?? '📄'} {p.title || 'Untitled'}
        </span>
      ))}
    </span>
  )
}

const templateThumbs = new Map<string, ReturnType<typeof thumbnail>>()

function TemplateThumb({ id }: { id: string }) {
  const editor = useEditor()
  if (!templateThumbs.has(id)) templateThumbs.set(id, thumbnail(boardFromTemplate(TEMPLATES.find((t) => t.id === id)!, editor.measure)))
  const t = templateThumbs.get(id)!
  return t.thumb.length ? <Thumb {...t} /> : <span className="thumb blank-thumb">+</span>
}

function BoardCard(p: {
  meta: BoardMeta
  current: boolean
  renaming: boolean
  confirming: boolean
  onOpen: () => void
  onRename: (title: string) => void
  onStartRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  onCancelDelete: () => void
}) {
  const { meta } = p
  return (
    <div
      className={`board-card${p.current ? ' current' : ''}`}
      // The whole card opens the board (its buttons do their own thing).
      onClick={(e) => !p.renaming && !(e.target as Element).closest('button, input') && p.onOpen()}
    >
      <button className="board-open" onClick={p.onOpen} aria-label={`Open ${meta.title}`}>
        {meta.kind === 'wiki' ? <WikiOutline meta={meta} /> : <Thumb thumb={meta.thumb} aspect={meta.aspect} />}
      </button>
      <div className="board-info">
        {p.renaming ? (
          <input
            autoFocus
            defaultValue={meta.title}
            aria-label={meta.kind === 'wiki' ? 'Wiki name' : 'Board name'}
            onBlur={(e) => p.onRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                e.stopPropagation()
                p.onRename(meta.title)
              }
            }}
          />
        ) : (
          <button className="board-name" title={`Open ${meta.title}`} onClick={p.onOpen}>
            {meta.icon && <span className="board-name-icon">{meta.icon}</span>}
            {meta.title}
          </button>
        )}
        <small>
          {p.current ? 'Open now' : `Edited ${timeAgo(meta.updated)}`} · {meta.items} {meta.kind === 'wiki' ? 'page' : 'object'}
          {meta.items === 1 ? '' : 's'}
        </small>
      </div>
      <div className="board-actions">
        {p.confirming ? (
          <>
            <button className="danger confirm" onClick={p.onDelete}>
              Delete forever
            </button>
            <button onClick={p.onCancelDelete}>Keep</button>
          </>
        ) : (
          <>
            <button onClick={p.onStartRename}>Rename</button>
            <button onClick={p.onDuplicate}>Duplicate</button>
            <button className="danger" onClick={p.onDelete}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ----- version history ---------------------------------------------------------------

export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const [versions, setVersions] = useState<VersionMeta[] | null>(null)
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<{ v: VersionMeta; thumb: ReturnType<typeof thumbnail>; pages?: string[] } | null>(null)
  const reload = () => void ws.versions().then(setVersions)
  useEffect(reload, [ws])

  const show = async (v: VersionMeta) => {
    const b = await ws.previewVersion(v)
    // A wiki has no drawing to show: its pages instead.
    if (b) setPreview({ v, thumb: thumbnail(b), ...(isWiki(b) ? { pages: pageOrder(b).map((p) => `${'  '.repeat(pagePath(b, p.id).length - 1)}${p.icon ?? '📄'} ${p.title || 'Untitled'}`) } : {}) })
  }

  return (
    <Dialog label="Version history" onClose={onClose} className="versions">
      <header>
        <h2>Version history</h2>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <form
        className="version-save"
        onSubmit={async (e) => {
          e.preventDefault()
          await ws.saveVersion(name)
          setName('')
          reload()
        }}
      >
        <input placeholder="Name this version, e.g. “Before the reorg”" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <button className="primary" type="submit">
          Save version
        </button>
      </form>
      {isWiki(ws.editor.board) && (
        <p className="muted versions-wiki-note">This takes every page of the wiki back. To undo just one page, use its Page history (⋯ on the page).</p>
      )}
      <div className="versions-body">
        <ol className="version-list">
          {versions?.map((v) => (
            <li key={v.at} className={preview?.v.at === v.at ? 'on' : ''}>
              <button className="version-pick" onClick={() => void show(v)} onFocus={() => void show(v)}>
                <strong>{v.name ?? 'Autosave'}</strong>
                <small>
                  {new Date(v.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  {v.kind === 'wiki' ? ` · ${v.items} page${v.items === 1 ? '' : 's'}` : v.items || !isWiki(ws.editor.board) ? ` · ${v.items} objects` : ''}
                </small>
              </button>
            </li>
          ))}
          {versions && !versions.length && <li className="muted empty">Versions appear here as you work — one every ten minutes, plus any you name.</li>}
        </ol>
        <div className="version-preview">
          {preview ? (
            <>
              {preview.pages ? (
                <ul className="version-pages">
                  {preview.pages.slice(0, 60).map((p, n) => (
                    <li key={n}>{p}</li>
                  ))}
                  {preview.pages.length > 60 && <li className="muted">and {preview.pages.length - 60} more</li>}
                </ul>
              ) : (
                <Thumb {...preview.thumb} />
              )}
              <div className="version-preview-foot">
                <span>
                  <strong>{preview.v.title}</strong>
                  <small className="muted"> · {timeAgo(preview.v.at)}</small>
                </span>
                <span>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (!window.confirm('Delete this version for good?')) return
                      await ws.deleteVersion(preview.v)
                      setPreview(null)
                      reload()
                    }}
                  >
                    Delete
                  </button>
                  <button
                    className="primary"
                    onClick={async () => {
                      // In a live session it replaces the board for everyone, and only you can undo it.
                      if (ws.liveInfo && !window.confirm('Everyone in the live session will see this version instead of the board as it is now. Restore it?')) return
                      await ws.restoreVersion(preview.v)
                      onClose()
                    }}
                  >
                    Restore this version
                  </button>
                </span>
              </div>
            </>
          ) : (
            <p className="muted">Pick a version to preview it.</p>
          )}
        </div>
      </div>
    </Dialog>
  )
}

// ----- share links -------------------------------------------------------------------

const LONG_LINK = 200_000

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const editor = useEditor()
  const hasImages = editor.board.items.some((i) => i.kind === 'image')
  const [images, setImages] = useState(true)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let live = true
    void ws.shareLink({ images }).then((l) => live && setLink(l))
    return () => {
      live = false
    }
  }, [ws, images])

  const copy = async () => {
    const ok = await copyText(link, field.current)
    if (!ok) {
      field.current?.select()
      editor.setStatus('Press Ctrl C to copy the link')
    }
    setCopied(ok)
  }

  const kb = Math.ceil(link.length / 1024)
  return (
    <Dialog label="Share" onClose={onClose} className="share">
      <header>
        <h2>Share</h2>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="share-body">
        <LiveSection />
        <h3 className="share-sub">Snapshot link</h3>
        <p className="muted">
          The whole board travels inside the link, so anyone with it sees this board as it is right now. Nothing is uploaded anywhere. Later changes need a new link.
        </p>
        <div className="share-row">
          <input ref={field} readOnly value={link || 'Making the link…'} onFocus={(e) => e.target.select()} aria-label="Share link" />
          <button className="primary" disabled={!link} onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {hasImages && (
          <label className="check-row">
            <input type="checkbox" checked={images} onChange={(e) => (setImages(e.target.checked), setCopied(false))} />
            Include images (they make the link much longer)
          </label>
        )}
        {link && (
          <p className={kb * 1024 > LONG_LINK ? 'warning' : 'muted'}>
            {kb} KB link.{kb * 1024 > LONG_LINK ? ' Some apps cut links this long — send it as a file instead if it doesn’t open.' : ''}
          </p>
        )}
      </div>
    </Dialog>
  )
}

// ----- read-only banner -----------------------------------------------------------------

export function ReadOnlyBanner() {
  const ws = useWorkspace()
  const ui = useUi()
  const editor = ws.editor
  if (!ws.readOnly) return null
  return (
    <div className="readonly-banner island no-canvas" role="status">
      <span className="readonly-dot" aria-hidden="true" />
      <span>
        <strong>{isWiki(editor.board) ? 'Shared wiki' : 'Shared board'}</strong> · view only
      </span>
      <button className="primary" onClick={() => void ws.keepCopy()}>
        Save a copy to edit
      </button>
      <button onClick={ui.openBoards}>Your boards</button>
    </div>
  )
}

/** In a live session joined with the view link: say so, under the top bars (the live bar is wide). */
export function LiveViewerBanner() {
  const ws = useWorkspace()
  if (ws.readOnly || !ws.viewOnly) return null
  return (
    <div className="viewer-banner island no-canvas" role="status">
      <span className="readonly-dot" aria-hidden="true" />
      <span>
        <strong>Watching live</strong> · you can follow people, send emotes (E) and chat by your cursor (/). Ask for the edit link to join in.
      </span>
      <button onClick={() => void ws.leaveLive().then(() => ws.editor.setStatus('This is your own copy now; the live board carries on without it'))}>Make my own copy</button>
    </div>
  )
}
