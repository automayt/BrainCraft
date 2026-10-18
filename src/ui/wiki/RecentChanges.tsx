import { useRef, useState } from 'react'
import { diffCounts, lineDiff } from '../../model/merge'
import * as RV from '../../model/revisions'
import * as W from '../../model/wiki'
import { formatTime } from '../BoardView'
import { useDialog } from '../useDialog'
import { useEditor } from '../useEditor'
import { useEscape } from '../useEscape'
import { Diff } from './PageHistory'

/** Changes listed at once (older ones are in each page's history). */
const SHOWN = 150

/** What's been written across the whole wiki lately: each saved version, newest first, by day. */
export function RecentChanges({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  useEscape(onClose)
  const [open, setOpen] = useState<string | null>(null)
  const board = editor.board
  const changes = RV.recentChanges(board, SHOWN)
  const day = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal page-history recent-changes" role="dialog" aria-modal="true" aria-label="Recent changes in this wiki">
        <header>
          <h2>Recent changes</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {!changes.length ? (
          <p className="muted page-history-note">Nothing saved yet. Each time someone finishes writing on a page, a version of it is kept here and in the page's history.</p>
        ) : (
          <ol className="recent-list">
            {changes.map(({ rev, prev }, n) => {
              const page = W.getPage(board, rev.page)
              const c = diffCounts(prev?.text ?? '', rev.text)
              const newDay = n === 0 || day(changes[n - 1].rev.at) !== day(rev.at)
              return (
                <li key={rev.id}>
                  {newDay && <h3 className="recent-day">{day(rev.at)}</h3>}
                  <div className="recent-row">
                    <button
                      className="link"
                      onClick={() => {
                        onClose()
                        editor.openPage(rev.page)
                      }}
                    >
                      {page?.icon ?? '📄'} {page?.title || rev.title || 'Untitled'}
                    </button>
                    <span className="muted">
                      {' '}
                      version {RV.revNumber(board, rev)}
                      {rev.by ? ` · ${rev.by}` : ''} · {formatTime(rev.at)} · {prev ? `+${c.added} −${c.removed}` : 'first version'}
                      {prev && prev.title !== rev.title ? ` · renamed from “${prev.title || 'Untitled'}”` : ''}
                      {page?.trashed ? ' · in the Trash' : ''}
                    </span>
                    {rev.keep && <span className="rev-star" title="Milestone"> ★</span>}
                    <button className="link recent-toggle" aria-expanded={open === rev.id} onClick={() => setOpen(open === rev.id ? null : rev.id)}>
                      {open === rev.id ? 'hide' : 'what changed'}
                    </button>
                  </div>
                  {rev.note && <p className="rev-note recent-note">{rev.note}</p>}
                  {open === rev.id && <Diff lines={lineDiff(prev?.text ?? '', rev.text)} />}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
