import { type DragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { Page } from '../../model/types'
import * as W from '../../model/wiki'
import { useEditor } from '../useEditor'

type Where = 'before' | 'inside' | 'after'

/** The wiki's pages as a tree: open, add, drag to nest, rearrange from the keyboard, and the trash. */
export function PageTree({ current }: { current: Page | undefined }) {
  const editor = useEditor()
  const board = editor.board
  const ro = editor.readOnly
  const tree = useMemo(() => W.pageTree(board), [board])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [drag, setDrag] = useState<{ id: string; over?: string; where?: Where } | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const trash = W.trashed(board)
  const news = new Set([...(editor.catchUp?.pages?.added ?? []), ...(editor.catchUp?.pages?.changed ?? [])])

  // The path to the open page is always expanded, so it can be seen in the tree.
  const path = new Set(current ? W.pagePath(board, current.id).map((p) => p.id) : [])
  const isOpen = (id: string) => !collapsed.has(id) || path.has(id)
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (isOpen(id)) next.add(id)
      else next.delete(id)
      return next
    })

  const siblingsOf = (p: Page) => W.childrenOf(board, W.parentOf(board, p))
  // A row that moved under another page is drawn anew, so focus follows it once it's there.
  const pendingFocus = useRef<string | null>(null)
  const rowEl = (id: string) => document.querySelector<HTMLElement>(`.page-tree [data-page="${id}"]`)
  useEffect(() => {
    const id = pendingFocus.current
    const el = id ? rowEl(id) : null
    if (!el) return
    pendingFocus.current = null
    if (document.activeElement !== el) el.focus()
  })
  const focusRow = (id: string) => {
    pendingFocus.current = id
    requestAnimationFrame(() => rowEl(id)?.focus())
    // Not for ever: a row that never shows up mustn't grab focus later.
    setTimeout(() => pendingFocus.current === id && (pendingFocus.current = null), 400)
  }

  /** Rows in the order they're shown, for the arrow keys. */
  const visible: Page[] = []
  const collect = (nodes: W.PageNode[]) => {
    for (const n of nodes) {
      visible.push(n.page)
      if (isOpen(n.page.id)) collect(n.children)
    }
  }
  collect(tree)

  const onKey = (e: KeyboardEvent, p: Page) => {
    const k = visible.findIndex((x) => x.id === p.id)
    const sibs = siblingsOf(p)
    const at = sibs.findIndex((x) => x.id === p.id)
    const parent = W.parentOf(board, p)
    if (e.altKey && e.shiftKey && !ro) {
      // Alt Shift + arrows rearrange: up and down among siblings, right to nest, left to come out.
      if (e.key === 'ArrowUp' && at > 0) editor.movePageTo(p.id, parent, sibs[at - 1].id)
      else if (e.key === 'ArrowDown' && at < sibs.length - 1) editor.movePageTo(p.id, parent, sibs[at + 2]?.id)
      else if (e.key === 'ArrowRight' && at > 0) {
        editor.movePageTo(p.id, sibs[at - 1].id)
        setCollapsed((s) => new Set([...s].filter((x) => x !== sibs[at - 1].id)))
      } else if (e.key === 'ArrowLeft' && parent !== undefined) {
        const up = W.getPage(board, parent)!
        const grand = W.parentOf(board, up)
        const gs = W.childrenOf(board, grand)
        editor.movePageTo(p.id, grand, gs[gs.findIndex((x) => x.id === parent) + 1]?.id)
      } else return
      e.preventDefault()
      focusRow(p.id)
      return
    }
    if (e.key === 'ArrowDown' && visible[k + 1]) focusRow(visible[k + 1].id)
    else if (e.key === 'ArrowUp' && visible[k - 1]) focusRow(visible[k - 1].id)
    else if (e.key === 'ArrowRight' && W.childrenOf(board, p.id).length) {
      if (!isOpen(p.id)) toggle(p.id)
      else focusRow(W.childrenOf(board, p.id)[0].id)
    } else if (e.key === 'ArrowLeft') {
      if (W.childrenOf(board, p.id).length && isOpen(p.id) && !path.has(p.id)) toggle(p.id)
      else if (parent !== undefined) focusRow(parent)
    } else if (e.key === 'Home' && visible[0]) focusRow(visible[0].id)
    else if (e.key === 'End' && visible.length) focusRow(visible[visible.length - 1].id)
    else return
    e.preventDefault()
  }

  const whereIn = (e: DragEvent<HTMLElement>): Where => {
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
  }

  const drop = (target: Page, where: Where) => {
    if (!drag || drag.id === target.id) return
    const parent = W.parentOf(board, target)
    if (where === 'inside') {
      editor.movePageTo(drag.id, target.id)
      setCollapsed((s) => new Set([...s].filter((x) => x !== target.id)))
    } else if (where === 'before') editor.movePageTo(drag.id, parent, target.id)
    else {
      const sibs = siblingsOf(target).filter((x) => x.id !== drag.id)
      editor.movePageTo(drag.id, parent, sibs[sibs.findIndex((x) => x.id === target.id) + 1]?.id)
    }
  }

  const row = (n: W.PageNode, depth: number) => {
    const p = n.page
    const kids = n.children.length > 0
    const openNow = isOpen(p.id)
    const over = drag?.over === p.id ? drag.where : undefined
    return (
      <li key={p.id}>
        <div
          className={`page-row${current?.id === p.id ? ' on' : ''}${over ? ` drop-${over}` : ''}${drag?.id === p.id ? ' dragging' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={!ro}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', p.title)
            e.dataTransfer.effectAllowed = 'move'
            setDrag({ id: p.id })
          }}
          onDragOver={(e) => {
            if (!drag || drag.id === p.id) return
            e.preventDefault()
            const where = whereIn(e)
            if (drag.over !== p.id || drag.where !== where) setDrag({ ...drag, over: p.id, where })
          }}
          onDragLeave={() => drag?.over === p.id && setDrag({ id: drag.id })}
          onDrop={(e) => {
            e.preventDefault()
            drop(p, whereIn(e))
            setDrag(null)
          }}
          onDragEnd={() => setDrag(null)}
        >
          {kids ? (
            <button className="page-twisty" tabIndex={-1} aria-label={`${openNow ? 'Collapse' : 'Expand'} ${p.title || 'Untitled'}`} aria-expanded={openNow} onClick={() => toggle(p.id)}>
              {openNow ? '▾' : '▸'}
            </button>
          ) : (
            <span className="page-twisty" aria-hidden="true" />
          )}
          <button
            className="page-title"
            data-page={p.id}
            aria-current={current?.id === p.id ? 'page' : undefined}
            aria-label={`${p.title || 'Untitled'}${kids ? `, ${n.children.length} sub-page${n.children.length === 1 ? '' : 's'}${openNow ? '' : ', collapsed'}` : ''}`}
            onClick={() => editor.openPage(p.id)}
            onKeyDown={(e) => onKey(e, p)}
          >
            <span className="page-icon" aria-hidden="true">
              {p.icon ?? '📄'}
            </span>
            <span className="page-name">{p.title || 'Untitled'}</span>
            {news.has(p.id) && (
              <span className="page-news" title="New or changed since you were here">
                <span className="sr-only">, new or changed since you were here</span>
              </span>
            )}
          </button>
          {!ro && (
            <button className="page-add" tabIndex={-1} title="Add a sub-page" aria-label={`Add a page under ${p.title || 'Untitled'}`} onClick={() => editor.addWikiPage({ parent: p.id })}>
              +
            </button>
          )}
        </div>
        {kids && openNow && <ul>{n.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    )
  }

  const q = filter.trim().toLowerCase()
  const found = q ? W.pageOrder(board).filter((p) => p.title.toLowerCase().includes(q)) : []

  return (
    <nav className="page-tree" aria-label="Pages">
      <div className="page-tree-head">
        <input className="page-filter" placeholder="Find a page" aria-label="Find a page" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {!ro && (
          <div className="page-tree-tools">
            <button className="page-new" title="New page at the top level" onClick={() => editor.addWikiPage()}>
              + New page
            </button>
            <button className="icon-btn" aria-label="Undo" title="Undo (Ctrl Z)" disabled={!editor.history.canUndo} onClick={() => editor.undo()}>
              ↶
            </button>
            <button className="icon-btn" aria-label="Redo" title="Redo (Ctrl Shift Z)" disabled={!editor.history.canRedo} onClick={() => editor.redo()}>
              ↷
            </button>
          </div>
        )}
      </div>
      {q ? (
        <ul className="page-found">
          {found.map((p) => (
            <li key={p.id}>
              <button className={`page-title${current?.id === p.id ? ' on' : ''}`} onClick={() => editor.openPage(p.id)}>
                <span className="page-icon" aria-hidden="true">
                  {p.icon ?? '📄'}
                </span>
                <span className="page-name">{p.title || 'Untitled'}</span>
                <small className="muted">{W.pagePath(board, p.id).slice(0, -1).map((x) => x.title).join(' › ')}</small>
              </button>
            </li>
          ))}
          {!found.length && <li className="muted page-none">No page is called that</li>}
        </ul>
      ) : (
        <ul className="page-list">
          {tree.map((n) => row(n, 0))}
          {/* Dropping below the last page puts it last at the top level. */}
          {drag && (
            <li
              className="page-drop-end"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                editor.movePageTo(drag.id, undefined)
                setDrag(null)
              }}
            >
              Drop here for the top level
            </li>
          )}
        </ul>
      )}
      {trash.length > 0 && (
        <div className="page-trash">
          <button className="link" aria-expanded={showTrash} onClick={() => setShowTrash(!showTrash)}>
            🗑 Trash ({trash.length})
          </button>
          {showTrash && (
            <ul>
              {trash.map((p) => (
                <li key={p.id}>
                  <span className="page-name">{p.title || 'Untitled'}</span>
                  {!ro && (
                    <span className="page-trash-actions">
                      <button onClick={() => editor.restorePage(p.id)}>Restore</button>
                      <button
                        className="danger"
                        onClick={() => window.confirm(`Delete “${p.title || 'Untitled'}” and its sub-pages for good? This can’t be undone.`) && editor.deletePageForever(p.id)}
                      >
                        Delete forever
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!ro && <p className="page-tree-tip muted">Drag pages to nest them, use Alt Shift + arrows, or Move… on a page.</p>}
    </nav>
  )
}
