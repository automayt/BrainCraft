import { useEffect, useMemo, useState } from 'react'
import { headings, parseMarkdown } from '../../model/markdown'
import type { LinkTarget } from '../../model/notes'
import type { Board } from '../../model/types'
import * as W from '../../model/wiki'
import { useEditor } from '../useEditor'
import { useEscape } from '../useEscape'
import { useWorkspace } from '../useWorkspace'
import { Markdown, type MarkdownActions } from './Markdown'

/**
 * A wiki page beside the canvas: a link to a page on a board opens it here, read-only, so you can
 * look without leaving the board. Links to other pages of that wiki open here too.
 */
export function PagePeek() {
  const editor = useEditor()
  const ws = useWorkspace()
  const peek = editor.peek
  const meta = peek ? ws.findBoard(peek.board) : undefined
  const [wiki, setWiki] = useState<Board | null>(null)
  const close = () => editor.peekPage(null)
  useEscape(close, !!peek)

  useEffect(() => {
    let live = true
    setWiki(null)
    if (peek) void ws.readBoard(peek.board).then((b) => live && setWiki(b))
    return () => {
      live = false
    }
  }, [peek?.board, meta?.updated, ws, peek])

  const page = wiki && peek ? W.getPage(wiki, peek.page) : undefined
  const text = wiki && page ? W.pageText(wiki, page.id) : ''
  const blocks = useMemo(() => parseMarkdown(text), [text])

  useEffect(() => {
    const h = peek?.heading
    if (!h || !page) return
    requestAnimationFrame(() => document.getElementById(`h-${h}`)?.scrollIntoView({ block: 'start' }))
  }, [peek?.heading, page])

  if (!peek) return null

  const openHere = (to: LinkTarget) => {
    // Another page of the same wiki opens in the panel; anything else opens for real.
    if (to.page !== undefined && (!to.board || to.board === peek.board)) editor.peekPage({ board: peek.board, page: to.page, ...(to.heading ? { heading: to.heading } : {}) })
    else void ws.openLink(to)
  }
  const actions: MarkdownActions = {
    link: (to, label, key) => {
      const target = to ?? (wiki ? (W.pageByTitle(wiki, label) ? { page: W.pageByTitle(wiki, label)!.id } : null) : null)
      return target ? (
        <button key={key} className={`md-link${target.board && target.board !== peek.board ? ' other' : ''}`} onClick={() => openHere(target)}>
          {label}
        </button>
      ) : (
        <span key={key} className="md-link missing">
          {label}
        </span>
      )
    },
    mention: (_id, label, key) => (
      <span key={key} className="md-mention muted">
        @{label}
      </span>
    ),
    children: () =>
      wiki && page ? (
        <ul className="wiki-backlinks">
          {W.childrenOf(wiki, page.id).map((p) => (
            <li key={p.id}>
              <button className="link" onClick={() => openHere({ page: p.id })}>
                {p.icon ?? '📄'} {p.title || 'Untitled'}
              </button>
            </li>
          ))}
        </ul>
      ) : null,
    headings: headings(blocks),
  }

  return (
    <aside className="notes-panel page-peek no-canvas" aria-label="Wiki page" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <div>
          <h2>
            {page?.icon ?? '📘'} {page ? page.title || 'Untitled' : 'Wiki page'}
          </h2>
          <span className="muted">
            {meta ? `${meta.title}${wiki && page ? ` · ${W.pagePath(wiki, page.id).slice(0, -1).map((p) => p.title).join(' › ') || 'top level'}` : ''}` : 'That wiki isn’t in this browser'}
          </span>
        </div>
        <button className="icon-close" aria-label="Close the page" title="Close (Esc)" onClick={close}>
          ×
        </button>
      </header>
      <div className="notes-scroll page-peek-body">
        {!meta ? (
          <p className="muted">Ask a friend for the wiki’s link to open it here.</p>
        ) : !wiki ? (
          <p className="muted">Opening…</p>
        ) : !page || page.trashed ? (
          <p className="muted">{page ? 'That page is in the trash.' : 'That page was deleted.'}</p>
        ) : text.trim() ? (
          <Markdown blocks={blocks} actions={actions} />
        ) : (
          <p className="muted">Nothing on this page yet.</p>
        )}
      </div>
      {meta && (
        <footer className="page-peek-foot">
          <button
            className="primary"
            onClick={() => {
              const to = { board: peek.board, page: peek.page, ...(peek.heading ? { heading: peek.heading } : {}) }
              close()
              void ws.openLink(to)
            }}
          >
            Open in the wiki
          </button>
        </footer>
      )}
    </aside>
  )
}
