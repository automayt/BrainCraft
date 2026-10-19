import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { isProtected } from '../../model/protection'
import { MovePage } from './MovePage'
import { ChangesSince, PageHistory } from './PageHistory'
import { WikiCatchUp } from './WikiCatchUp'
import { WikiMacro } from './WikiMacros'
import * as RV from '../../model/revisions'
import { PageMenu } from './PageMenu'
import { download } from '../imageExport'
import { fileNameFor, pageMarkdown, pagesFromFiles, wikiZip } from '../../model/wikiFiles'
import { useEscape } from '../useEscape'
import { headings, parseMarkdown } from '../../model/markdown'
import { type LinkTarget, linkToken, parseNote } from '../../model/notes'
import type { Page, PageBody } from '../../model/types'
import * as W from '../../model/wiki'
import { formatTime } from '../BoardView'
import { copyText } from '../copyText'
import type { CrossLink } from '../../store/links'
import type { Workspace } from '../../store/workspace'
import type { Editor } from '../../editor/Editor'
import { useEditor } from '../useEditor'
import { useWorkspace } from '../useWorkspace'
import { Markdown, type MarkdownActions, smoothScroll } from './Markdown'
import { PageEditor } from './PageEditor'
import { PageTree } from './PageTree'
import { ObjectEmbed } from './ObjectEmbed'

const LAST_PAGE = 'braincraft:page:'

/** A wiki: its pages in a tree on the left, the open page on the right. */

const isBoardFile = (f: File) => /\.(braincraft|json)$/i.test(f.name)
const isMarkdownFile = (f: File) => /\.(md|markdown|mdown|txt)$/i.test(f.name) || f.type === 'text/markdown'

/** Markdown files become pages at the top of the wiki (one file opens straight away). */
async function importMarkdown(editor: Editor, files: File[]) {
  const md = files.filter(isMarkdownFile)
  if (!md.length) return editor.setStatus('Only Markdown (.md) and text files can become pages')
  const ids = editor.importPages(pagesFromFiles(await Promise.all(md.map(async (f) => ({ name: f.name, text: await f.text() })))))
  if (ids.length === 1) editor.openPage(ids[0])
}

/** What a page's words link to, read once per version of them (pages re-read on every change otherwise). */
const bodyLinks = new WeakMap<PageBody, { to: LinkTarget[]; names: string[] }>()
function linksOf(body: PageBody) {
  let hit = bodyLinks.get(body)
  if (!hit) {
    hit = { to: [], names: [] }
    for (const part of parseNote(body.text)) {
      if (!('link' in part)) continue
      if (part.link) hit.to.push(part.link)
      else hit.names.push(part.label)
    }
    bodyLinks.set(body, hit)
  }
  return hit
}
export function WikiView() {
  const editor = useEditor()
  const ws = useWorkspace()
  const page = editor.currentPage
  const [editing, setEditing] = useState(false)
  const [drawer, setDrawer] = useState(false)
  useEscape(() => setDrawer(false), drawer)

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
    requestAnimationFrame(() => document.getElementById(`h-${h}`)?.scrollIntoView({ behavior: smoothScroll(), block: 'start' }))
  }, [editor.pageHeading, page?.id])

  return (
    <div
      className={`wiki no-canvas${drawer ? ' drawer-open' : ''}`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer.files)
        // Board files open as boards (the app does that); anything else stays here, never opening in the browser.
        if (!files.length || files.every(isBoardFile)) return
        e.preventDefault()
        if (editor.readOnly) return editor.setStatus('This wiki is read-only here')
        const md = files.filter(isMarkdownFile)
        if (md.length) void importMarkdown(editor, md)
        else if (files.some((f) => /\.zip$/i.test(f.name))) editor.setStatus('A .zip can’t be added yet: unzip it and drop the .md files')
        else editor.setStatus('Only Markdown (.md) and text files can become pages')
      }}
    >
      <button
        className="wiki-drawer-btn"
        aria-expanded={drawer}
        onClick={() => {
          setDrawer(!drawer)
          if (!drawer) requestAnimationFrame(() => document.querySelector<HTMLElement>('.page-filter')?.focus())
        }}
      >
        ☰ Pages
      </button>
      {drawer && <div className="wiki-drawer-backdrop" onPointerDown={() => setDrawer(false)} />}
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
  // A protected page (or one under a protected page) is read-only, except to those who manage the
  // wiki on a server with accounts; without accounts, anyone who can edit may lift the protection.
  const locked = isProtected(board, page.id)
  const ownLock = !!page.protected
  const accounts = !!ws.liveInfo?.account
  const canProtect = !editor.readOnly && (accounts ? ws.managesBoard : true)
  const ro = editor.readOnly || (locked && !(accounts && ws.managesBoard))
  const body = W.getBody(board, page.id)
  const text = body?.text ?? ''
  const blocks = useMemo(() => parseMarkdown(text), [text])
  const heads = useMemo(() => headings(blocks), [blocks])
  const path = W.pagePath(board, page.id)
  const kids = W.childrenOf(board, page.id)
  const [title, setTitle] = useState(page.title)
  useEffect(() => setTitle(page.title), [page.title])
  const [moving, setMoving] = useState(false)
  const [history, setHistory] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  /** These pages (or all) as a web page: downloaded when named, else printed. */
  const exportPage = async (pages?: string[], file?: string) => {
    editor.setStatus(file ? 'Making the web page…' : 'Getting it ready to print…')
    try {
      const { wikiPage, printHtml } = await import('../wikiExport')
      const html = await wikiPage(ws, editor, board, pages)
      if (file) download(new Blob([html], { type: 'text/html' }), file)
      else printHtml(html)
      editor.setStatus(file ? 'Downloaded the web page' : '')
    } catch (err) {
      editor.setStatus(`Couldn’t make it: ${(err as Error).message}`)
    }
  }
  // Ctrl+K asked for a page panel.
  useEffect(() => {
    if (editor.wikiPanel === 'history') setHistory(true)
    else if (editor.wikiPanel === 'import' && !ro) fileInput.current?.click()
    else return
    editor.wikiPanel = null
  }, [editor, editor.wikiPanel, ro])
  /** The page whose changes since the last visit are showing. */
  const news = editor.catchUp?.pages
  const changedHere = !!news?.changed.includes(page.id)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  // A page just made: its title is ready to type.
  useEffect(() => {
    if (!editor.focusTitle || ro) return
    editor.focusTitle = false
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [editor, ro, page.id])
  const doneEditing = () => {
    setEditing(false)
    // Back to where writing started from, not the top of the page.
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.wiki-page-actions .primary')?.focus())
  }

  // Pages of this wiki that link here.
  const linkedFrom = useMemo(() => {
    const self = new Set(ws.selfKeys)
    return W.pageOrder(board).filter((p) => {
      const body = W.getBody(board, p.id)
      if (p.id === page.id || !body) return false
      const { to, names } = linksOf(body)
      // Links typed by name (`[[Plan]]`) count too, the way the page reads them.
      return to.some((t) => t.page === page.id && (!t.board || self.has(t.board))) || names.some((n) => W.pageByTitle(board, n)?.id === page.id)
    })
  }, [board, page.id, ws.selfKeys])

  // Canvas comments and other wikis' pages that link here (from boards in this browser).
  const [elsewhere, setElsewhere] = useState<CrossLink[]>([])
  useEffect(() => {
    let live = true
    ws.linksHere().then(
      (l) => live && setElsewhere(l.filter((x) => x.to.page === page.id)),
      () => live && setElsewhere([]),
    )
    return () => {
      live = false
    }
  }, [ws, ws.boards, page.id])

  const actions: MarkdownActions = {
    link: (to, label, key) => <PageLink key={key} to={to} label={label} from={page} />,
    mention: (_id, label, key) => (
      <span key={key} className="md-mention muted" title="Objects are on canvas boards">
        @{label}
      </span>
    ),
    toggle: ro ? undefined : (line) => editor.tickTask(page.id, line),
    children: () => <SubPages pages={kids} />,
    embed: (block) => <ObjectEmbed block={block} />,
    macro: (block) => <WikiMacro block={block} page={page} actions={actions} />,
    headings: heads,
    copyHeading: (slug, words) => copyPlace(ws, editor, `${page.title || 'Untitled'} › ${words}`, { page: page.id, heading: slug }),
  }

  const saveTitle = () => {
    if (title.trim() !== page.title) editor.setPageTitle(page.id, title.trim())
  }

  return (
    <article className="wiki-page" aria-labelledby="wiki-page-title">
      {moving && <MovePage page={page} onClose={() => setMoving(false)} />}
      {history && <PageHistory page={page} onClose={() => setHistory(false)} />}
      {editor.changesOf === page.id && editor.catchUp && <ChangesSince page={page} before={editor.catchUp.before} since={editor.catchUp.since} onClose={() => editor.showChanges(null)} />}
      <WikiCatchUp onShowChanges={(id) => editor.showChanges(id)} />
      {editor.readOnly ? (
        <p className="wiki-readonly muted" role="status">
          {ws.readOnly ? 'A shared copy of this wiki: read it here, or save your own copy to write in it.' : 'You’re reading this wiki. Ask for the edit link to write in it.'}
        </p>
      ) : locked ? (
        <p className="wiki-protected" role="status">
          <span aria-hidden="true">🔒 </span>
          {ownLock ? 'Protected' : `Protected along with “${W.pagePath(board, page.id).find((p) => p.protected)?.title || 'a page above'}”`}
          {': '}
          {!ro
            ? 'you manage this wiki, so you can change it; others who can edit it can’t.'
            : canProtect
              ? 'unprotect it in the page menu (⋯) to change it.'
              : 'only people who manage this wiki can change it, or the pages under it.'}
        </p>
      ) : null}
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
        {/* A text box that grows onto more lines, so a long title shows in full. */}
        <textarea
          ref={titleRef}
          id="wiki-page-title"
          className="wiki-title"
          rows={1}
          value={title}
          readOnly={ro}
          placeholder="Untitled"
          aria-label="Page title"
          onChange={(e) => setTitle(e.target.value.replace(/\s*\n\s*/g, ' '))}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              saveTitle()
              setEditing(true)
            }
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          }}
        />
        <div className="wiki-page-actions">
          {!ro && !editing && (
            <button className="primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {editing && (
            <button className="primary" onClick={doneEditing}>
              Done
            </button>
          )}
          <button
            onClick={() => copyPlace(ws, editor, page.title || 'Untitled', { page: page.id })}
            title="Copy a link to this page, for a chat (in a live session), a page or a comment"
          >
            Copy link
          </button>
          {!ro && (
            <>
              <button title="Add a page under this one" onClick={() => editor.addWikiPage({ parent: page.id })}>
                + Sub-page
              </button>
            </>
          )}
          <PageMenu
            label="More for this page"
            items={[
              { label: 'Page history', hint: 'Earlier versions of this page, what changed, and putting one back', run: () => setHistory(true) },
              ...(ro ? [] : [{ label: 'Move…', hint: 'Put this page somewhere else in the wiki', run: () => setMoving(true) }]),
              ...(canProtect && (ownLock || !locked)
                ? [
                    ownLock
                      ? { label: 'Remove protection', hint: 'Anyone who can edit the wiki can change this page again', run: () => editor.setPageProtected(page.id, false) }
                      : {
                          label: 'Protect page…',
                          hint: accounts ? 'Only people who manage this wiki can change it and the pages under it' : 'Keeps it from being changed by accident; anyone who can edit can lift it',
                          run: () => editor.setPageProtected(page.id, true),
                        },
                  ]
                : []),
              { label: 'Download page (.md)', hint: 'This page as a Markdown file', run: () => download(new Blob([pageMarkdown(board, page.id, (to) => ws.linkTo(to))], { type: 'text/markdown' }), `${fileNameFor(page.title)}.md`) },
              {
                label: 'Download page as a web page (.html)',
                hint: 'This page with its pictures, to open in any browser',
                run: () => void exportPage([page.id], `${fileNameFor(page.title)}.html`),
              },
              {
                label: 'Print or save page as PDF',
                hint: 'This page, ready to print; choose “Save as PDF” in the print dialog',
                run: () => void exportPage([page.id]),
              },
              {
                label: 'Download wiki as a web page (.html)',
                hint: 'Every page in one file, with a contents list and pictures; prints as a handbook',
                run: () => void exportPage(undefined, `${fileNameFor(board.title)}.html`),
              },
              {
                label: 'Print or save wiki as PDF',
                hint: 'Every page, each on its own sheet',
                run: () => void exportPage(),
              },
              {
                label: 'Download wiki (.zip)',
                hint: 'Every page as a Markdown file, sub-pages in folders',
                run: () => download(new Blob([wikiZip(board, (to) => ws.linkTo(to)) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${fileNameFor(board.title)}.zip`),
              },
              ...(ro ? [] : [{ label: 'Add Markdown files…', hint: 'Each .md file becomes a page (you can also drop them on the wiki)', run: () => fileInput.current?.click() }]),
              ...(ro
                ? []
                : [{ label: kids.length ? `Move to Trash (with ${kids.length} sub-page${kids.length === 1 ? '' : 's'})` : 'Move to Trash', hint: 'It can be restored from the Trash at the foot of the page list', danger: true, run: () => editor.trashPage(page.id) }]),
            ]}
          />
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain"
            multiple
            hidden
            onChange={(e) => {
              void importMarkdown(editor, Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </div>
        <p className="wiki-meta muted">
          {body?.by || (body?.at && body.at > page.created) ? `Edited ${body.by ? `by ${body.by} · ` : ''}${formatTime(body.at)}` : body?.text.trim() ? `Added ${formatTime(page.created)}` : 'Not written yet'}
          {kids.length > 0 && ` · ${kids.length} sub-page${kids.length === 1 ? '' : 's'}`}
          {RV.pageRevs(board, page.id).length > 0 && (
            <>
              {' · '}
              <button className="link" title="Earlier versions of this page" onClick={() => setHistory(true)}>
                version {RV.pageRevs(board, page.id).length}
                {RV.unsavedChanges(board, page.id) ? ' + changes' : ''}
              </button>
            </>
          )}
          {changedHere && (
            <>
              {' · '}
              <button className="link wiki-news-link" onClick={() => editor.showChanges(page.id)}>
                changed since you were here
              </button>
            </>
          )}
          {news?.added.includes(page.id) && ' · new since you were here'}
        </p>
      </header>

      {editing ? (
        <PageEditor key={page.id} page={page} text={text} actions={actions} onDone={doneEditing} />
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
      {(linkedFrom.length > 0 || elsewhere.length > 0) && (
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
            {elsewhere.map((l) => (
              <li key={`${l.boardId}:${l.from ?? l.fromPage}:${l.note?.id ?? ''}`}>
                <button
                  className="link"
                  title={l.text}
                  onClick={() => void ws.openLink(l.fromPage !== undefined ? { board: l.boardId, page: l.fromPage } : { board: l.boardId, item: l.from })}
                >
                  {l.fromPage !== undefined ? '📘' : '🗺'} {l.boardTitle} › {l.fromLabel}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

/**
 * Copies a link to a page (or a heading on it): a web link that opens it for anyone who has the
 * wiki, and that turns into a named link when pasted into a page or a comment. A snapshot with no
 * address of its own gets a link for pages and comments only.
 */
function copyPlace(ws: Workspace, editor: Editor, label: string, place: { page: string; heading?: string }) {
  // In a live session, the session's own link (it opens for any friend); else one for friends who have the wiki.
  const live = ws.liveInfo ? ws.inviteLink(ws.liveInfo.role === 'edit' ? 'edit' : 'view', place) : null
  const web = live ?? ws.webLink(place)
  const key = ws.linkKey ?? undefined
  const message = live
    ? 'Copied a link to the live wiki at this page — anyone you send it to can open it'
    : web
      ? 'Copied — it opens for friends who already have this wiki; paste it into a page or comment for a link'
      : 'Copied a link to paste into a page or comment'
  void copyText(web ?? linkToken(label, { ...(key ? { board: key } : {}), ...place })).then((ok) => editor.setStatus(ok ? message : 'Couldn’t copy the link'))
}

function SubPages({ pages }: { pages: Page[] }) {
  const editor = useEditor()
  if (!pages.length) return null
  return (
    <ul className="wiki-subpages">
      {pages.map((p) => {
        const words = W.plainText(editor.board, p.id)
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
