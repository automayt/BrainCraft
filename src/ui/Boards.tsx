/** The board library, version history, share links and the read-only banner. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { type BoardEntry, type BoardFilter, type BoardSort, boardEntries, byOpened, keysOf, sharedWithMe, shownEntries } from '../store/boardList'
import { createPortal } from 'react-dom'
import { useButtonMenu } from './menuKeys'
import { useDialog } from './useDialog'
import { TEMPLATES, boardFromTemplate } from '../model/templates'
import { WIKI_TEMPLATES } from '../model/wikiTemplates'
import { isWiki, pageOrder, pagePath } from '../model/wiki'
import { type BoardMeta, type LiveInfo, type ThumbRect, thumbnail, type VersionMeta } from '../store/library'
import { type DeletedBoard, deletedBoards, readServerVersion, restoreDeleted, restoreServerVersion, saveServerVersion, type ServerVersion, serverVersions, versionLabel } from '../store/serverBackups'
import type { Board } from '../model/types'
import { darken } from './BoardView'
import { ink, mindRootFill } from './paint'
import { useEditor } from './useEditor'
import { useEscape } from './useEscape'
import { useWorkspace } from './useWorkspace'
import { safeStorage } from '../store/workspace'
import { LiveSection } from './Live'
import { copyText } from './copyText'
import { useUi } from './uiContext'
import { appName } from '../store/brand'
import { InboxPanel } from './Inbox'

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

/** How many recent boards show at first, and how many more each "Show more" adds. */
const RECENT = 5
const MORE = 10

/** Your boards: a page of its own, where BrainCraft starts, with your inbox beside it. */
export function BoardsDialog({ onClose, onOpenFile }: { onClose: () => void; onOpenFile: () => void }) {
  const ws = useWorkspace()
  const editor = useEditor()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<BoardFilter>('all')
  // By name unless you chose otherwise: Recent above already has the latest.
  const [sort, setSort] = useState<BoardSort>(() => (safeStorage()?.getItem(SORT_KEY) === 'recent' ? 'recent' : 'name'))
  const [recent, setRecent] = useState(RECENT)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const me = ws.account?.user?.id
  const all = useMemo(() => boardEntries(ws.boards, ws.account?.user ? ws.serverBoards : [], ws.server ?? undefined), [ws.boards, ws.serverBoards, ws.account, ws.server])
  const shown = useMemo(() => shownEntries(all, { query, filter, sort, me }), [all, query, filter, sort, me])
  const recentList = useMemo(() => byOpened(all), [all])
  const sharedList = useMemo(() => all.filter((e) => sharedWithMe(e, me)).sort((a, z) => (z.server?.updated ?? 0) - (a.server?.updated ?? 0)), [all, me])
  const titleOf = (key: string | undefined) => (key === undefined ? undefined : all.find((e) => keysOf(e).includes(key))?.title)
  const shared = all.some((e) => sharedWithMe(e, me))
  const wikis = all.some((e) => e.kind === 'wiki')
  const searching = !!query.trim()

  // The board first, so the address goes from here straight to it.
  const open = async (e: BoardEntry) => {
    try {
      if (e.local) {
        if (e.local.id !== ws.boardId) await ws.switchTo(e.local.id)
      } else if (e.server) await ws.openServerBoard(e.server)
    } finally {
      onClose()
    }
  }
  const create = (t: (typeof TEMPLATES)[number], title?: string) => {
    onClose()
    const b = boardFromTemplate(t, editor.measure)
    void ws.newBoard(title ? { ...b, title } : b)
  }
  const newWiki = (template: string, title?: string) => {
    onClose()
    void ws.newWiki(title, template)
  }
  const list = useRef<HTMLUListElement>(null)
  // ↓ from the search goes into the list; ↑ and ↓ move along it; ↑ at the top goes back.
  const moveIn = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const names = [...(list.current?.querySelectorAll<HTMLElement>('.board-name') ?? [])]
    const at = names.indexOf(document.activeElement as HTMLElement)
    const to = e.key === 'ArrowDown' ? at + 1 : at - 1
    e.preventDefault()
    if (to < 0) search.current?.focus()
    else names[Math.min(to, names.length - 1)]?.focus()
  }
  const search = useRef<HTMLInputElement>(null)
  // On a phone the keyboard would cover the list before you've looked at it.
  const typing = typeof matchMedia === 'undefined' || matchMedia('(pointer: fine)').matches
  const choose = (s: BoardSort) => {
    setSort(s)
    try {
      safeStorage()?.setItem(SORT_KEY, s)
    } catch {
      // Storage full or blocked: the order just isn't remembered.
    }
  }
  const row = (e: BoardEntry, depth = 0) => (
    <BoardRow
      key={e.key}
      entry={e}
      depth={depth}
      me={me}
      parentTitle={e.parent !== undefined && (sort !== 'name' || !depth) ? titleOf(e.parent) : undefined}
      current={!!e.local && e.local.id === ws.boardId}
      renaming={renaming === e.key}
      confirming={confirming === e.key}
      onOpen={() => void open(e)}
      onRename={(title) => {
        setRenaming(null)
        if (title.trim() && title !== e.title) void ws.rename(e.local?.id, title.trim(), e.server?.id)
      }}
      onStartRename={() => setRenaming(e.key)}
      onDuplicate={() => e.local && void ws.duplicate(e.local.id)}
      onDelete={() =>
        confirming === e.key
          ? (setConfirming(null), e.server ? void ws.removeFromServer(e.server.id, e.local?.id) : e.local && void ws.remove(e.local.id))
          : setConfirming(e.key)
      }
      onCancelDelete={() => setConfirming(null)}
    />
  )

  return (
    <Dialog label="Your boards" onClose={onClose} className="boards">
      <header>
        <span className="wordmark" aria-hidden="true">
          {appName()}
        </span>
        <h2>Your boards</h2>
        <input
          ref={search}
          className="boards-search"
          type="search"
          aria-label="Find a board or wiki"
          placeholder={`Find among ${all.length} board${all.length === 1 ? '' : 's'} and wikis`}
          autoFocus={typing}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown[0]) void open(shown[0].entry)
            else moveIn(e)
          }}
        />
        <button className="boards-open-file" onClick={() => (onClose(), onOpenFile())}>
          Open a file…
        </button>
        <NewMenu onBoard={(t) => create(t)} onWiki={(t) => newWiki(t)} onGuide={() => (onClose(), void ws.openGuide())} onFile={() => (onClose(), onOpenFile())} />
        <button className="home-back" onClick={onClose}>
          Back to the board
        </button>
      </header>
      <div className={`boards-body${ws.account?.user ? ' with-inbox' : ''}`}>
        {ws.account?.user && <InboxPanel onOpened={onClose} />}
        <div className="home-main">
        {!ws.persistent && <p className="boards-warning">This browser isn't keeping boards between visits. Save to a file to keep your work.</p>}
        {!searching && sharedList.length > 0 && (
          <section className="boards-recent" aria-labelledby="boards-shared-title">
            <div className="home-section-head">
              <h3 id="boards-shared-title">Shared with you</h3>
              {sharedList.length > RECENT && (
                <button className="link" onClick={() => setFilter('shared')}>
                  See all {sharedList.length}
                </button>
              )}
            </div>
            <div className="recent-grid">
              {sharedList.slice(0, RECENT).map((e) => (
                <BoardTile key={e.key} entry={e} me={me} parentTitle={titleOf(e.parent)} current={!!e.local && e.local.id === ws.boardId} onOpen={() => void open(e)} />
              ))}
            </div>
          </section>
        )}
        {!searching && all.length > 0 && (
          <section className="boards-recent" aria-labelledby="boards-recent-title">
            <h3 id="boards-recent-title">Recent</h3>
            <div className="recent-grid">
              {recentList.slice(0, recent).map((e) => (
                <BoardTile key={e.key} entry={e} me={me} parentTitle={titleOf(e.parent)} current={!!e.local && e.local.id === ws.boardId} onOpen={() => void open(e)} />
              ))}
            </div>
            {all.length > RECENT && (
              <div className="recent-more">
                {recent < all.length && <button onClick={() => setRecent((n) => n + MORE)}>Show {Math.min(MORE, all.length - recent)} more</button>}
                {recent > RECENT && <button onClick={() => setRecent(RECENT)}>Show fewer</button>}
              </div>
            )}
          </section>
        )}
        <section className="boards-all" aria-labelledby="boards-all-title">
          <div className="boards-all-head">
            <h3 id="boards-all-title">{searching ? `Found ${shown.length}` : 'All boards and wikis'}</h3>
            {(wikis || shared) && (
              <div className="boards-filter" role="radiogroup" aria-label="Show">
                {(
                  [
                    ['all', 'All'],
                    ['boards', 'Boards'],
                    ...(wikis ? [['wikis', 'Wikis']] : []),
                    ...(shared ? [['shared', 'Shared with me']] : []),
                  ] as [BoardFilter, string][]
                ).map(([f, label]) => (
                  <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <label className="boards-sort">
              Order
              <select value={sort} onChange={(e) => choose(e.target.value as BoardSort)}>
                <option value="recent">Last edited</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          {shown.length ? (
            <ul className="board-rows" ref={list} onKeyDown={moveIn}>
              {shown.map(({ entry, depth }) => row(entry, depth))}
            </ul>
          ) : searching ? (
            <div className="boards-none">
              <p>Nothing called “{query.trim()}”{filter !== 'all' ? ' here. Try All.' : '.'}</p>
              <button className="primary" onClick={() => create(TEMPLATES[0], query.trim())}>
                New board called “{query.trim()}”
              </button>
              <button onClick={() => newWiki('wiki', query.trim())}>New wiki called “{query.trim()}”</button>
            </div>
          ) : (
            <p className="muted boards-none">{filter === 'shared' ? 'Nobody has shared a board with you yet.' : 'Nothing here yet.'}</p>
          )}
          {ws.account?.user && ws.account.backups && <RecentlyDeleted />}
        </section>
        {!searching && (
          <section className="start-new" aria-label="Start something new">
            <h3 className="templates-title" id="new-board-title">
              New board <small>a canvas to draw and brainstorm on</small>
            </h3>
            <section className="templates" aria-labelledby="new-board-title">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="template" onClick={() => create(t)}>
                  <TemplateThumb id={t.id} />
                  <strong>{t.label}</strong>
                  <small>{t.hint}</small>
                </button>
              ))}
            </section>
            <h3 className="templates-title" id="new-wiki-title">
              New wiki <small>pages to write things down: plans, lists, notes</small>
            </h3>
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
                <strong>{appName()} guide</strong>
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
          </section>
        )}
        </div>
      </div>
    </Dialog>
  )
}

const SORT_KEY = 'braincraft:boards-sort'

/** New: a blank board or wiki, or one from a template. */
function NewMenu({ onBoard, onWiki, onGuide, onFile }: { onBoard: (t: (typeof TEMPLATES)[number]) => void; onWiki: (template: string) => void; onGuide: () => void; onFile: () => void }) {
  const { at, close, toggle, menuProps } = useButtonMenu()
  const pick = (run: () => void) => () => (close(), run())
  return (
    <span className="align-anchor">
      <button className={`primary new-button${at ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={!!at} onClick={toggle}>
        New
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {at &&
        createPortal(
          <div className="align-menu more-menu new-menu no-canvas" role="menu" aria-label="New" {...menuProps} style={{ left: Math.min(at.x, window.innerWidth - 130), top: at.y }}>
            <p className="menu-heading">Board</p>
            {TEMPLATES.map((t) => (
              <button key={t.id} role="menuitem" onClick={pick(() => onBoard(t))}>
                {t.label}
                <small>{t.hint}</small>
              </button>
            ))}
            <p className="menu-heading">Wiki</p>
            {WIKI_TEMPLATES.map((t) => (
              <button key={t.id} role="menuitem" onClick={pick(() => onWiki(t.id))}>
                {t.id === 'wiki' ? 'Blank wiki' : `${t.label} wiki`}
                <small>{t.hint}</small>
              </button>
            ))}
            <button role="menuitem" onClick={pick(onGuide)}>
              {appName()} guide
              <small>How everything works, with a practice board</small>
            </button>
            {/* On phones Open a file… isn't in the header, so it's here. */}
            <button role="menuitem" className="new-menu-file" onClick={pick(onFile)}>
              Open a file…
              <small>A board, Excalidraw drawing, Markdown or Mermaid file</small>
            </button>
          </div>,
          document.body,
        )}
    </span>
  )
}

/** Whose it is and where it lives, when that's not the usual (yours, to edit): nothing otherwise. */
function whereOf(e: BoardEntry, me: string | undefined): string {
  // Signed in, a board in this browser alone is the odd one out; without accounts, they all are.
  if (!e.server) return e.local?.live ? 'Shared by link' : me ? 'Only in this browser' : ''
  const owner = e.server.owner
  const whose = !owner ? 'No owner yet' : owner.id === me ? '' : `${owner.name}’s`
  if (e.server.level !== 'view') return whose
  return whose ? `${whose}, view only` : 'View only'
}

/** A board's picture: its objects in miniature, a wiki's first pages, or (not opened here yet) its initial. */
function EntryThumb({ entry }: { entry: BoardEntry }) {
  if (entry.local) return entry.kind === 'wiki' ? <WikiOutline meta={entry.local} /> : <Thumb thumb={entry.local.thumb} aspect={entry.local.aspect} />
  return (
    <span className={`thumb unseen-thumb${entry.kind === 'wiki' ? ' unseen-wiki' : ''}`} aria-hidden="true">
      {entry.icon ?? (entry.title.trim()[0] ?? '·').toUpperCase()}
    </span>
  )
}

/** A recent board: big enough to recognise by its picture. */
function BoardTile({ entry: e, me, parentTitle, current, onOpen }: { entry: BoardEntry; me: string | undefined; parentTitle?: string; current: boolean; onOpen: () => void }) {
  return (
    <button className={`board-tile${current ? ' current' : ''}`} onClick={onOpen} aria-label={`Open ${e.title || 'Untitled'}`}>
      <EntryThumb entry={e} />
      <span className="board-tile-name">
        {e.icon && e.local && <span className="board-name-icon">{e.icon}</span>}
        {e.title || 'Untitled'}
      </span>
      <small>
        {current ? 'Open now' : `Edited ${timeAgo(e.updated)}`}
        {parentTitle !== undefined ? `, in ${parentTitle || 'another board'}` : e.server && whereOf(e, me) ? `, ${whereOf(e, me)}` : ''}
      </small>
    </button>
  )
}

/** A line in the full list, with Rename, Duplicate and Delete behind ⋯. */
function BoardRow(p: {
  entry: BoardEntry
  depth: number
  me: string | undefined
  /** A child board, said in words when it isn't right under its parent. */
  parentTitle?: string
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
  const { entry: e } = p
  const { at, close, toggle, menuProps } = useButtonMenu()
  const items = e.local?.items
  // On a server with accounts: renamed by those who can edit it, deleted (for everyone) by those
  // who manage it. Only in this browser: anything goes.
  const level = e.server?.level
  const renamable = !e.server || level === 'edit' || level === 'manage'
  const deletable = !e.server ? !!e.local : level === 'manage'
  return (
    <li className={`board-row${p.current ? ' current' : ''}${p.depth ? ' child-board' : ''}`} style={p.depth ? { paddingLeft: 8 + Math.min(p.depth, 4) * 22 } : undefined}>
      <button className="board-row-open" onClick={p.onOpen} tabIndex={-1} aria-hidden="true">
        <EntryThumb entry={e} />
      </button>
      <div className="board-row-name">
        {p.renaming ? (
          <input
            autoFocus
            defaultValue={e.title}
            aria-label={e.kind === 'wiki' ? 'Wiki name' : 'Board name'}
            onBlur={(ev) => p.onRename(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
              if (ev.key === 'Escape') {
                ev.stopPropagation()
                p.onRename(e.title)
              }
            }}
          />
        ) : (
          <button className="board-name" onClick={p.onOpen}>
            {p.depth > 0 && <span className="board-child-mark" aria-label="Child board of the one above">↳</span>}
            {e.icon && <span className="board-name-icon">{e.icon}</span>}
            <span className="board-title-text">{e.title || 'Untitled'}</span>
            {e.kind === 'wiki' && <span className="board-kind">Wiki</span>}
            {p.current && <span className="board-kind now">Open now</span>}
          </button>
        )}
        {p.parentTitle !== undefined && <small className="board-parent">Divided from {p.parentTitle || 'another board'}</small>}
      </div>
      <span className="board-row-where">{whereOf(e, p.me)}</span>
      <span className="board-row-size">{items === undefined ? '' : `${items} ${e.kind === 'wiki' ? 'page' : 'object'}${items === 1 ? '' : 's'}`}</span>
      <span className="board-row-when">{timeAgo(e.updated)}</span>
      {p.confirming ? (
        <span className="board-row-confirm">
          <button className="danger confirm" onClick={p.onDelete}>
            {e.server ? 'Delete for everyone' : 'Delete forever'}
          </button>
          <button onClick={p.onCancelDelete}>Keep</button>
        </span>
      ) : renamable || e.local || deletable ? (
        <span className="align-anchor">
          <button className={`board-row-more${at ? ' on' : ''}`} aria-label={`More for ${e.title || 'Untitled'}`} aria-haspopup="menu" aria-expanded={!!at} onClick={toggle}>
            ⋯
          </button>
          {at &&
            createPortal(
              <div className="align-menu more-menu no-canvas" role="menu" {...menuProps} style={{ left: Math.min(at.x, window.innerWidth - 118), top: at.y }}>
                {renamable && (
                  <button role="menuitem" onClick={() => (close(), p.onStartRename())}>
                    Rename
                  </button>
                )}
                {e.local && (
                  <button role="menuitem" onClick={() => (close(), p.onDuplicate())}>
                    Duplicate
                  </button>
                )}
                {deletable && (
                  <button role="menuitem" className="danger-quiet" onClick={() => (close(), p.onDelete())}>
                    Delete…
                  </button>
                )}
              </div>,
              document.body,
            )}
        </span>
      ) : (
        <span />
      )}
    </li>
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

/** Boards deleted from the server in the last 90 days that you managed (admins: all), to put back. */
function RecentlyDeleted() {
  const ws = useWorkspace()
  const [boards, setBoards] = useState<DeletedBoard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    void deletedBoards(ws.server!).then(
      (b) => (setBoards(b), setError(null)),
      (err: Error) => setError(err.message),
    )
  return (
    <details className="recently-deleted" onToggle={(e) => e.currentTarget.open && !boards && load()}>
      <summary>Recently deleted</summary>
      {error && <p className="signin-error">{error}</p>}
      {boards && !boards.length && <p className="muted">Nothing deleted in the last 90 days that you could put back.</p>}
      {!!boards?.length && (
        <ul className="access-list">
          {boards.map((b) => (
            <li key={b.id}>
              <span>
                {b.kind === 'wiki' ? '📘 ' : ''}
                {b.title || 'Untitled'}
                <small className="muted">
                  {' '}
                  deleted {timeAgo(b.deleted)}
                  {b.by ? ` by ${b.by}` : ''}
                  {b.owner && b.owner.id !== ws.account?.user?.id ? ` · ${b.owner.name}’s` : ''}
                </small>
              </span>
              <button
                onClick={async () => {
                  try {
                    const back = await restoreDeleted(ws.server!, b.id)
                    ws.editor.setStatus(`Put back “${back.title || 'Untitled'}”`)
                    setBoards((all) => all?.filter((x) => x.id !== b.id) ?? null)
                    await ws.loadServerBoards()
                  } catch (err) {
                    setError((err as Error).message)
                  }
                }}
              >
                Put back
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

// ----- version history ---------------------------------------------------------------

/** What a version preview shows: a miniature of a board, or a wiki's pages. */
function previewOf(b: Board) {
  return { thumb: thumbnail(b), ...(isWiki(b) ? { pages: pageOrder(b).map((p) => `${'  '.repeat(pagePath(b, p.id).length - 1)}${p.icon ?? '📄'} ${p.title || 'Untitled'}`) } : {}) }
}

function PreviewBody({ preview }: { preview: ReturnType<typeof previewOf> }) {
  return preview.pages ? (
    <ul className="version-pages">
      {preview.pages.slice(0, 60).map((p, n) => (
        <li key={n}>{p}</li>
      ))}
      {preview.pages.length > 60 && <li className="muted">and {preview.pages.length - 60} more</li>}
    </ul>
  ) : (
    <Thumb {...preview.thumb} />
  )
}

export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const live = ws.liveInfo
  // A board on a server has the server's backups too: shared, and safe from a cleared browser.
  const [source, setSource] = useState<'server' | 'browser'>(live ? 'server' : 'browser')
  const [versions, setVersions] = useState<VersionMeta[] | null>(null)
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<{ v: VersionMeta; thumb: ReturnType<typeof thumbnail>; pages?: string[] } | null>(null)
  const reload = () => void ws.versions().then(setVersions)
  useEffect(reload, [ws])

  const show = async (v: VersionMeta) => {
    const b = await ws.previewVersion(v)
    // A wiki has no drawing to show: its pages instead.
    if (b) setPreview({ v, ...previewOf(b) })
  }

  return (
    <Dialog label="Version history" onClose={onClose} className="versions">
      <header>
        <h2>Version history</h2>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {live && (
        <div className="admin-tabs versions-source" role="tablist" aria-label="Where the versions are kept">
          {(
            [
              ['server', 'On the server'],
              ['browser', 'In this browser'],
            ] as const
          ).map(([s, label]) => (
            <button key={s} role="tab" aria-selected={source === s} className={source === s ? 'on' : ''} onClick={() => setSource(s)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {live && source === 'server' ? (
        <ServerVersions live={live} onClose={onClose} />
      ) : (
      <>
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
          {versions && !versions.length && <li className="muted empty">Versions appear here as you work: one every ten minutes, plus any you name.</li>}
        </ol>
        <div className="version-preview">
          {preview ? (
            <>
              <PreviewBody preview={preview} />
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
      </>
      )}
    </Dialog>
  )
}

/**
 * The server's versions of a live board: saved every few hours it changes, before anyone puts an
 * older one back, and whenever someone saves one; the newest few are kept. Putting one back changes
 * the board for everyone.
 */
function ServerVersions({ live, onClose }: { live: LiveInfo; onClose: () => void }) {
  const ws = useWorkspace()
  const [versions, setVersions] = useState<ServerVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<({ v: ServerVersion } & ReturnType<typeof previewOf>) | null>(null)
  const canEdit = live.role === 'edit'
  const reload = () =>
    void serverVersions(live).then(
      (v) => (setVersions(v), setError(null)),
      (err: Error) => setError(err.message),
    )
  useEffect(reload, [live.server, live.id])
  const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  const show = async (v: ServerVersion) => {
    try {
      setPreview({ v, ...previewOf(await readServerVersion(live, v.id)) })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      {canEdit && (
        <form
          className="version-save"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              const v = await saveServerVersion(live, name)
              ws.editor.setStatus(v.note ? `Saved version “${v.note}” on the server` : 'Saved a version on the server')
              setName('')
              reload()
            } catch (err) {
              setError((err as Error).message)
            }
          }}
        >
          <input placeholder="Name this version, e.g. “Before the reorg”" aria-label="Name this version" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button className="primary" type="submit">
            Save version
          </button>
        </form>
      )}
      <p className="muted versions-wiki-note">
        Everyone on this board sees these. The server saves one every few hours the board changes, and keeps the newest five.{isWiki(ws.editor.board) ? ' Restoring takes every page back; for one page, use its Page history.' : ''}
      </p>
      {error && (
        <p className="signin-error" role="alert">
          {error}
        </p>
      )}
      <div className="versions-body">
        <ol className="version-list">
          {versions?.map((v) => (
            <li key={v.id} className={preview?.v.id === v.id ? 'on' : ''}>
              <button className="version-pick" onClick={() => void show(v)}>
                <strong>{versionLabel(v)}</strong>
                <small>
                  {when(v.at)} · {v.objects} {v.kind === 'wiki' ? (v.objects === 1 ? 'page' : 'pages') : v.objects === 1 ? 'object' : 'objects'}
                  {v.note && v.by ? ` · ${v.by}` : ''}
                </small>
              </button>
            </li>
          ))}
          {versions && !versions.length && <li className="muted empty">No versions yet. The server saves the first within the hour, or save one now.</li>}
          {!versions && !error && <li className="muted empty">Loading…</li>}
        </ol>
        <div className="version-preview">
          {preview ? (
            <>
              <PreviewBody preview={preview} />
              <div className="version-preview-foot">
                <span>
                  <strong>{preview.v.title}</strong>
                  <small className="muted"> · {timeAgo(preview.v.at)}</small>
                </span>
                {canEdit && (
                  <button
                    className="primary"
                    onClick={async () => {
                      if (!window.confirm(`Put the board back to how it was on ${when(preview.v.at)}? Everyone on it sees the change. The board as it is now is saved first, so you can come back to it.`)) return
                      try {
                        await restoreServerVersion(live, preview.v.id)
                        ws.editor.setStatus(`Restored the version from ${when(preview.v.at)}. To undo, restore the one saved just before.`)
                        onClose()
                      } catch (err) {
                        setError((err as Error).message)
                      }
                    }}
                  >
                    Restore this version
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="muted">Pick a version to preview it.</p>
          )}
        </div>
      </div>
    </>
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
            {kb} KB link.{kb * 1024 > LONG_LINK ? ' Some apps cut links this long. If it doesn’t open, send it as a file instead.' : ''}
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
  // With accounts there are no links to ask for: whoever owns the board gives access.
  const owner = ws.liveInfo?.account ? ws.serverBoards.find((b) => b.id === ws.liveInfo!.id)?.owner : undefined
  const ask = ws.liveInfo?.account ? `Ask ${owner && owner.id !== ws.account?.user?.id ? owner.name : 'whoever manages it'} for edit access to join in.` : 'Ask for the edit link to join in.'
  return (
    <div className="viewer-banner island no-canvas" role="status">
      <span className="readonly-dot" aria-hidden="true" />
      <span>
        <strong>Watching live</strong> · you can follow people, send emotes (E) and chat by your cursor (/). {ask}
      </span>
      <button onClick={() => void ws.leaveLive().then(() => ws.editor.setStatus('This is your own copy now; the live board carries on without it'))}>Make my own copy</button>
    </div>
  )
}
