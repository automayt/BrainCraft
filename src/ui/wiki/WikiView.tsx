import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { headings, parseMarkdown, toggleTask } from '../../model/markdown'
import { type LinkTarget, linkToken, linksIn } from '../../model/notes'
import type { Page } from '../../model/types'
import * as W from '../../model/wiki'
import { formatTime } from '../BoardView'
import { copyText } from '../copyText'
import { useEditor } from '../useEditor'
import { useWorkspace } from '../useWorkspace'
import { Markdown, type MarkdownActions } from './Markdown'
import { PageEditor } from './PageEditor'
import { PageTree } from './PageTree'

const LAST_PAGE = 'braincraft:page:'

/** A wiki: its pages in a tree on the left, the open page on the right. */
export function WikiView() {
  const editor = useEditor()
  const ws = useWorkspace()
  const page = editor.currentPage
  const [editing, setEditing] = useState(false)
  const [drawer, setDrawer] = useState(false)

  // Each wiki opens on the page you were last on.
  useEffect(() => {
    if (editor.page !== null || !ws.boardId) return
    try {
      const last = localStorage.getItem(LAST_PAGE + ws.boardId)
      if (last && W.getPage(editor.board, last) && !W.getPage(editor.board, last)!.trashed) editor.openPage(last)
    } catch {
      // Storage blocked: the first page it is.
    }
  }, [ws.boardId, editor])
  useEffect(() => {
    if (!page || !ws.boardId) return
    try {
      localStorage.setItem(LAST_PAGE + ws.boardId, page.id)
    } catch {
      // Remembering is a nicety.
    }
  }, [page?.id, ws.boardId, page])

  // Opening another page stops editing; a heading link scrolls to its heading.
  useEffect(() => {
    setEditing(false)
    setDrawer(false)
    document.querySelector('.wiki-main')?.scrollTo({ top: 0 })
  }, [page?.id])
  useEffect(() => {
    const h = editor.pageHeading
    if (!h) return
    requestAnimationFrame(() => document.getElementById(`h-${h}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [editor.pageHeading, page?.id])

  return (
    <div className={`wiki no-canvas${drawer ? ' drawer-open' : ''}`}>
      <button className="wiki-drawer-btn" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
        ☰ Pages
      </button>
      <PageTree current={page} />
      <main className="wiki-main">
        {page ? (
          <PageView key={page.id} page={page} editing={editing && !editor.readOnly} setEditing={setEditing} />
        ) : (
          <div className="wiki-empty">
            <h1>No pages yet</h1>
            {!editor.readOnly && (
              <button className="primary" onClick={() => editor.addWikiPage({ title: 'Home' })}>
                Add the first page
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

/** One page: where it sits, its title, its words (or the editor), sub-pages and what links here. */
function PageView({ page, editing, setEditing }: { page: Page; editing: boolean; setEditing: (v: boolean) => void }) {
  const editor = useEditor()
  const ws = useWorkspace()
  const board = editor.board
  const ro = editor.readOnly
  const body = W.getBody(board, page.id)
  const text = body?.text ?? ''
  const blocks = useMemo(() => parseMarkdown(text), [text])
  const heads = useMemo(() => headings(blocks), [blocks])
  const path = W.pagePath(board, page.id)
  const kids = W.childrenOf(board, page.id)
  const [title, setTitle] = useState(page.title)
  useEffect(() => setTitle(page.title), [page.title])

  // Pages of this wiki that link here.
  const linkedFrom = useMemo(() => {
    const self = new Set(ws.selfKeys)
    return W.pageOrder(board).filter(
      (p) => p.id !== page.id && linksIn(W.pageText(board, p.id)).some((t) => t.page === page.id && (!t.board || self.has(t.board))),
    )
  }, [board, page.id, ws.selfKeys])

  const actions: MarkdownActions = {
    link: (to, label, key) => <PageLink key={key} to={to} label={label} from={page} />,
    mention: (_id, label, key) => (
      <span key={key} className="md-mention muted" title="Objects are on canvas boards">
        @{label}
      </span>
    ),
    toggle: ro ? undefined : (line) => editor.setPageText(page.id, toggleTask(text, line)),
    children: () => <SubPages pages={kids} />,
    headings: heads,
    copyHeading: (slug, words) => {
      // A link token that works anywhere: in this wiki, other wikis and canvas comments.
      const key = ws.linkKey ?? undefined
      void copyText(linkToken(`${page.title || 'Untitled'} › ${words}`, { ...(key ? { board: key } : {}), page: page.id, heading: slug })).then((ok) =>
        editor.setStatus(ok ? 'Copied a link to that heading — paste it into any page or comment' : 'Couldn’t copy the link'),
      )
    },
  }

  const saveTitle = () => {
    if (title !== page.title) editor.setPageTitle(page.id, title.trim() || 'Untitled')
  }

  return (
    <article className="wiki-page" aria-labelledby="wiki-page-title">
      {path.length > 1 && (
        <nav className="wiki-crumbs" aria-label="This page is under">
          {path.slice(0, -1).map((p) => (
            <span key={p.id}>
              <button className="link" onClick={() => editor.openPage(p.id)}>
                {p.title || 'Untitled'}
              </button>
              <span aria-hidden="true"> › </span>
            </span>
          ))}
        </nav>
      )}
      <header className="wiki-page-head">
        <input
          id="wiki-page-title"
          className="wiki-title"
          value={title}
          readOnly={ro}
          placeholder="Untitled"
          aria-label="Page title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              saveTitle()
              setEditing(true)
            }
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
        />
        <div className="wiki-page-actions">
          {!ro && !editing && (
            <button className="primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <button
            onClick={() => {
              const key = ws.linkKey ?? undefined
              void copyText(linkToken(page.title || 'Untitled', { ...(key ? { board: key } : {}), page: page.id })).then((ok) =>
                editor.setStatus(ok ? 'Copied a link to this page — paste it into any page or comment' : 'Couldn’t copy the link'),
              )
            }}
            title="Copy a link to this page, to paste into pages and comments"
          >
            Copy link
          </button>
          {!ro && (
            <>
              <button title="Add a page under this one" onClick={() => editor.addWikiPage({ parent: page.id })}>
                + Sub-page
              </button>
              <button className="danger-quiet" title="Move this page (and its sub-pages) to the trash" onClick={() => editor.trashPage(page.id)}>
                Trash
              </button>
            </>
          )}
        </div>
        <p className="wiki-meta muted">
          {body?.at ? `Edited ${body.by ? `by ${body.by} · ` : ''}${formatTime(body.at)}` : 'Not written yet'}
          {kids.length > 0 && ` · ${kids.length} sub-page${kids.length === 1 ? '' : 's'}`}
        </p>
      </header>

      {editing ? (
        <PageEditor key={page.id} page={page} text={text} actions={actions} onDone={() => setEditing(false)} />
      ) : text.trim() ? (
        <div className="wiki-body" onDoubleClick={(e) => !ro && !(e.target as Element).closest('a, button, input') && setEditing(true)}>
          <Markdown blocks={blocks} actions={actions} />
        </div>
      ) : (
        <p className="wiki-blank muted">
          {ro ? 'Nothing on this page yet.' : 'This page is empty.'}{' '}
          {!ro && (
            <button className="link" onClick={() => setEditing(true)}>
              Start writing
            </button>
          )}
        </p>
      )}

      {!editing && kids.length > 0 && !blocks.some((b) => b.t === 'children') && (
        <section className="wiki-section" aria-label="Sub-pages">
          <h2 className="wiki-section-title">Pages under this one</h2>
          <SubPages pages={kids} />
        </section>
      )}
      {linkedFrom.length > 0 && (
        <section className="wiki-section" aria-label="Linked from">
          <h2 className="wiki-section-title">Linked from</h2>
          <ul className="wiki-backlinks">
            {linkedFrom.map((p) => (
              <li key={p.id}>
                <button className="link" onClick={() => editor.openPage(p.id)}>
                  {p.icon ?? '📄'} {p.title || 'Untitled'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

function SubPages({ pages }: { pages: Page[] }) {
  const editor = useEditor()
  if (!pages.length) return null
  return (
    <ul className="wiki-subpages">
      {pages.map((p) => {
        const words = W.pageText(editor.board, p.id).replace(/[#>*_`[\]()|-]+/g, ' ').replace(/\s+/g, ' ').trim()
        return (
          <li key={p.id}>
            <button onClick={() => editor.openPage(p.id)}>
              <strong>
                {p.icon ?? '📄'} {p.title || 'Untitled'}
              </strong>
              {words && <small className="muted">{words.slice(0, 120)}</small>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A `[[link]]` in a page: to another page here (by id, or by name when typed by hand), to a page
 * in another wiki or to a canvas board. A name nothing has yet offers to make that page.
 */
function PageLink({ to, label, from }: { to: LinkTarget | null; label: string; from: Page }): ReactNode {
  const editor = useEditor()
  const ws = useWorkspace()
  const board = editor.board
  const self = !to?.board || ws.selfKeys.includes(to.board)
  if (to?.page !== undefined && self) {
    const p = W.getPage(board, to.page)
    const gone = !p || !!p.trashed
    return (
      <button
        className={`md-link${gone ? ' missing' : ''}`}
        title={gone ? (p ? 'That page is in the trash' : 'That page was deleted') : undefined}
        disabled={gone}
        onClick={() => editor.openPage(to.page!, to.heading ?? null)}
      >
        {p && !gone ? `${p.title || 'Untitled'}${to.heading ? ` › ${label.split(' › ').at(-1)}` : ''}` : label}
      </button>
    )
  }
  if (to) {
    const elsewhere = to.board ? ws.findBoard(to.board) : undefined
    return (
      <button
        className={`md-link other${to.board && !elsewhere ? ' missing' : ''}`}
        title={to.board && !elsewhere ? 'That board isn’t in this browser' : `On ${elsewhere?.title ?? 'another board'}`}
        onClick={() => void ws.openLink(to)}
      >
        {label}
      </button>
    )
  }
  // Typed by hand: a page with that title, else a board, else a page to make.
  const p = W.pageByTitle(board, label)
  if (p)
    return (
      <button className="md-link" onClick={() => editor.openPage(p.id)}>
        {p.title}
      </button>
    )
  const other = ws.otherBoards.find((b) => b.title.trim().toLowerCase() === label.trim().toLowerCase())
  if (other)
    return (
      <button className="md-link other" onClick={() => void ws.openLink({ board: other.key })}>
        {label}
      </button>
    )
  return editor.readOnly ? (
    <span className="md-link missing">{label}</span>
  ) : (
    <button className="md-link new" title={`Make a page called “${label}” under this one`} onClick={() => editor.addWikiPage({ title: label, parent: from.id })}>
      {label}
    </button>
  )
}
