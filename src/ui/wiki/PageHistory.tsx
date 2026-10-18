import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { type DiffLine, diffCounts, lineDiff } from '../../model/merge'
import type { Board, Page } from '../../model/types'
import * as W from '../../model/wiki'
import type { PageVersion } from '../../store/workspace'
import { formatTime } from '../BoardView'
import { useDialog } from '../useDialog'
import { useEditor } from '../useEditor'
import { useEscape } from '../useEscape'
import { useWorkspace } from '../useWorkspace'

/** Unchanged lines shown around a change; longer runs fold away. */
const CONTEXT = 2

/**
 * One page through the wiki's saved versions: what each change added and took away, and a way to
 * put an old version of just this page back (the rest of the wiki stays as it is).
 */
export function PageHistory({ page, onClose }: { page: Page; onClose: () => void }) {
  const editor = useEditor()
  const ws = useWorkspace()
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  useEscape(onClose)
  const [list, setList] = useState<PageVersion[] | null>(null)
  const [k, setK] = useState(0)
  const [vsNow, setVsNow] = useState(false)

  useEffect(() => {
    let live = true
    void ws.pageHistory(page.id).then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [ws, page.id])

  const now: PageVersion = { v: { at: Date.now(), title: '', items: 0 }, title: page.title, text: W.pageText(editor.board, page.id), at: W.getBody(editor.board, page.id)?.at ?? page.created, by: W.getBody(editor.board, page.id)?.by }
  // The page as it is now, then each saved change (the newest saved one may be the same as now).
  const entries = list ? (list[0] && list[0].text === now.text && list[0].title === now.title ? [{ ...now, v: list[0].v }, ...list.slice(1)] : [now, ...list]) : []
  const picked = entries[Math.min(k, entries.length - 1)]
  const older = entries[Math.min(k, entries.length - 1) + 1]
  const isNow = k === 0
  const from = vsNow ? picked?.text : (older?.text ?? '')
  const to = vsNow ? now.text : picked?.text
  const lines = useMemo(() => (picked ? lineDiff(from ?? '', to ?? '') : []), [picked, from, to])
  const ro = editor.readOnly

  const label = (e: PageVersion, n: number) => (n === 0 ? 'Now' : e.v.name ?? formatTime(e.at))

  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal page-history" role="dialog" aria-modal="true" aria-label={`History of ${page.title || 'Untitled'}`}>
        <header>
          <h2>History of “{page.title || 'Untitled'}”</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {!list ? (
          <p className="muted page-history-note">Reading the saved versions…</p>
        ) : entries.length < 2 ? (
          <p className="muted page-history-note">No earlier versions of this page yet. The wiki saves a version every ten minutes while it changes, and whenever you save one by name.</p>
        ) : (
          <div className="page-history-body">
            <ul className="page-history-list" aria-label="Versions">
              {entries.map((e, n) => {
                const c = diffCounts(entries[n + 1]?.text ?? '', e.text)
                return (
                  <li key={`${e.v.at}-${n}`}>
                    <button className={n === k ? 'on' : ''} aria-current={n === k ? 'true' : undefined} onClick={() => setK(n)}>
                      <strong>{label(e, n)}</strong>
                      <small className="muted">
                        {e.by ? `${e.by} · ` : ''}
                        {n < entries.length - 1 ? `+${c.added} −${c.removed} lines` : 'the first saved version'}
                        {e.title !== entries[n + 1]?.title && n < entries.length - 1 ? ' · renamed' : ''}
                      </small>
                    </button>
                  </li>
                )
              })}
            </ul>
            <section className="page-history-view" aria-label="Changes">
              <div className="page-history-tools">
                <span className="muted">{vsNow ? 'From this version to the page now' : older ? 'What this version changed' : 'The page in its first saved version'}</span>
                {!isNow && (
                  <label>
                    <input type="checkbox" checked={vsNow} onChange={(e) => setVsNow(e.target.checked)} /> Compare with now
                  </label>
                )}
                {!isNow && !ro && picked && (
                  <button
                    className="primary"
                    onClick={() => {
                      editor.restorePageVersion(page.id, picked.title, picked.text, `(${formatTime(picked.at)})`)
                      onClose()
                    }}
                  >
                    Put this version back
                  </button>
                )}
              </div>
              <Diff lines={lines} />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

/** Added and removed lines, with long unchanged stretches folded. */
function Diff({ lines }: { lines: DiffLine[] }) {
  const near = new Set<number>()
  lines.forEach((l, n) => {
    if (l.t !== 'same') for (let d = -CONTEXT; d <= CONTEXT; d++) near.add(n + d)
  })
  const changed = near.size > 0
  const out: ReactNode[] = []
  let skipped = 0
  lines.forEach((l, n) => {
    if (changed && l.t === 'same' && !near.has(n)) {
      skipped++
      return
    }
    if (skipped) out.push(<div key={`s${n}`} className="diff-skip muted">… {skipped} unchanged line{skipped === 1 ? '' : 's'}</div>)
    skipped = 0
    out.push(
      <div key={n} className={`diff-${l.t}`}>
        <span className="diff-mark" aria-hidden="true">
          {l.t === 'add' ? '+' : l.t === 'del' ? '−' : ' '}
        </span>
        <span className="sr-only">{l.t === 'add' ? 'Added: ' : l.t === 'del' ? 'Removed: ' : ''}</span>
        {l.s || ' '}
      </div>,
    )
  })
  if (skipped) out.push(<div key="end" className="diff-skip muted">… {skipped} unchanged line{skipped === 1 ? '' : 's'}</div>)
  return <div className="page-diff">{changed || lines.some((l) => l.s) ? out : <p className="muted">No words on the page.</p>}</div>
}

/** What happened to one page since this person last looked (from "Since you were here"). */
export function ChangesSince({ page, before, since, onClose }: { page: Page; before: Board; since: number; onClose: () => void }) {
  const editor = useEditor()
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  useEscape(onClose)
  const was = W.getPage(before, page.id)
  const lines = useMemo(() => lineDiff(W.pageText(before, page.id), W.pageText(editor.board, page.id)), [before, editor.board, page.id])
  const by = W.getBody(editor.board, page.id)?.by
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal page-history page-changes" role="dialog" aria-modal="true" aria-label={`What changed on ${page.title || 'Untitled'}`}>
        <header>
          <h2>What changed on “{page.title || 'Untitled'}”</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="page-history-tools">
          <span className="muted">
            Since you were here ({formatTime(since)}){by ? ` · last edited by ${by}` : ''}
            {was && was.title !== page.title ? ` · renamed from “${was.title || 'Untitled'}”` : ''}
          </span>
        </div>
        <Diff lines={lines} />
      </div>
    </div>
  )
}
