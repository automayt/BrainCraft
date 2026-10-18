import { useRef } from 'react'
import type { Page } from '../../model/types'
import * as W from '../../model/wiki'
import { useDialog } from '../useDialog'
import { useEditor } from '../useEditor'
import { useEscape } from '../useEscape'

/**
 * Puts a page (with its sub-pages) under another page, or at the top. The way to rearrange pages
 * without dragging or Alt Shift + arrows: on a phone, or with a screen reader.
 */
export function MovePage({ page, onClose }: { page: Page; onClose: () => void }) {
  const editor = useEditor()
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  useEscape(onClose)
  const board = editor.board
  const inside = W.withDescendants(board, page.id)
  const current = W.parentOf(board, page)
  const depth = (p: Page) => W.pagePath(board, p.id).length - 1
  const choices = W.pageOrder(board).filter((p) => !inside.has(p.id))
  const move = (parent: string | undefined) => {
    editor.movePageTo(page.id, parent)
    onClose()
  }
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal embed-picker move-page" role="dialog" aria-modal="true" aria-label={`Move ${page.title || 'Untitled'}`}>
        <header>
          <h2>Move “{page.title || 'Untitled'}”</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="muted move-page-hint">Pick the page it goes under. Its own sub-pages come with it.</p>
        <ul className="embed-choices">
          <li>
            <button disabled={current === undefined} onClick={() => move(undefined)}>
              <strong>The top level</strong>
              {current === undefined && <small className="muted">Here now</small>}
            </button>
          </li>
          {choices.map((p) => (
            <li key={p.id}>
              <button disabled={p.id === current} onClick={() => move(p.id)} style={{ paddingLeft: 10 + depth(p) * 16 }}>
                <strong>
                  {p.icon ?? '📄'} {p.title || 'Untitled'}
                </strong>
                {p.id === current && <small className="muted">Under this now</small>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
