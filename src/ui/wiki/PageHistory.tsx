import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { parseMarkdown, headings } from '../../model/markdown'
import { type DiffLine, diffCounts, lineDiff } from '../../model/merge'
import * as RV from '../../model/revisions'
import type { Board, Page, PageRev } from '../../model/types'
import * as W from '../../model/wiki'
import type { PageVersion } from '../../store/workspace'
import { formatTime } from '../BoardView'
import { useDialog } from '../useDialog'
import { useEditor } from '../useEditor'
import { useEscape } from '../useEscape'
import { useWorkspace } from '../useWorkspace'
import { Markdown, type MarkdownActions } from './Markdown'

/** Unchanged lines shown around a change; longer runs fold away. */
const CONTEXT = 2

/** One point in a page's history: a saved version, an older backup of the wiki, or the page now. */
interface Entry {
  key: string
  label: string
  title: string
  text: string
  at: number
  by?: string
  note?: string
  rev?: PageRev
  /** From the wiki's own backups (taken before page versions existed, or since pruned). */
  backup?: boolean
  now?: boolean
}

type Tab = 'changes' | 'page' | 'who'

/** Colours for telling writers apart in "Who wrote what". */
const HUES = [210, 150, 30, 280, 0, 100, 330, 190]
const hueOf = (name: string) => HUES[[...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]

/**
 * One page's history: every saved version (who, when, their note, lines added and removed), the
 * page as each version had it, what changed between any two, who wrote each line, milestones, and
 * putting an old version of just this page back (the rest of the wiki stays as it is).
 */
export function PageHistory({ page, onClose }: { page: Page; onClose: () => void }) {
  const editor = useEditor()
  const ws = useWorkspace()
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  useEscape(onClose)
  const board = editor.board
  const ro = editor.readOnly
  const [backups, setBackups] = useState<PageVersion[] | null>(null)
  const [k, setK] = useState(0)
  const [tab, setTab] = useState<Tab>('changes')
  const [against, setAgainst] = useState('prev')

  useEffect(() => {
    let live = true
    void ws.pageHistory(page.id).then(
      (l) => live && setBackups(l),
      () => live && setBackups([]),
    )
    return () => {
      live = false
    }
  }, [ws, page.id])

  const revs = RV.pageRevs(board, page.id)
  const entries = useMemo(() => {
    const out: Entry[] = []
    const text = W.pageText(board, page.id)
    const body = W.getBody(board, page.id)
    const unsaved = RV.unsavedChanges(board, page.id)
    if (unsaved) out.push({ key: 'now', label: 'Now', title: page.title, text, at: body?.at ?? page.created, by: body?.by, now: true })
    // Newest first.
    for (let n = revs.length - 1; n >= 0; n--) {
      const r = revs[n]
      out.push({ key: r.id, label: `Version ${n + 1}${!unsaved && n === revs.length - 1 ? ' · now' : ''}`, title: r.title, text: r.text, at: r.at, by: r.by, note: r.note, rev: r })
    }
    // Older history from the wiki's backups: before the first saved version.
    const first = revs[0]
    let after = first?.text
    for (const v of backups ?? []) {
      if (first && v.at >= first.at) continue
      if (v.text === after) continue
      after = v.text
      out.push({ key: `b${v.v.at}`, label: v.v.name ? `Backup “${v.v.name}”` : 'Backup', title: v.title, text: v.text, at: v.at, by: v.by, backup: true })
    }
    if (!out.length) out.push({ key: 'now', label: 'Now', title: page.title, text, at: body?.at ?? page.created, by: body?.by, now: true })
    return out
  }, [board, page.id, page.title, page.created, revs, backups])

  const at = Math.min(k, entries.length - 1)
  const picked = entries[at]
  const older = entries[at + 1]
  const other = against === 'prev' ? older : against === 'now' ? entries[0] : entries.find((e) => e.key === against)
  const [from, to] = against === 'prev' ? [older?.text ?? '', picked.text] : other && entries.indexOf(other) > at ? [other.text, picked.text] : [picked.text, other?.text ?? picked.text]
  const lines = useMemo(() => (tab === 'changes' ? lineDiff(from, to) : []), [tab, from, to])
  const who = useMemo(() => (tab === 'who' ? RV.whoWrote(board, page.id) : []), [tab, board, page.id])
  const isCurrent = at === 0
  const nOf = (e: Entry | undefined) => (e?.rev ? RV.revNumber(board, e.rev) : 0)

  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal page-history" role="dialog" aria-modal="true" aria-label={`History of ${page.title || 'Untitled'}`}>
        <header>
          <h2>History of “{page.title || 'Untitled'}”</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="page-history-body">
          <ul className="page-history-list" aria-label="Versions">
            {entries.map((e, n) => {
              const c = diffCounts(entries[n + 1]?.text ?? '', e.text)
              return (
                <li key={e.key}>
                  <button
                    className={n === at ? 'on' : ''}
                    aria-current={n === at ? 'true' : undefined}
                    onClick={() => {
                      setK(n)
                      setAgainst('prev')
                    }}
                  >
                    <strong>
                      {e.rev?.keep && (
                        <span className="rev-star" title="Milestone">
                          ★{' '}
                        </span>
                      )}
                      {e.label}
                    </strong>
                    <small className="muted">
                      {[e.by, formatTime(e.at)].filter(Boolean).join(' · ')}
                      {n < entries.length - 1 ? ` · +${c.added} −${c.removed}` : ''}
                      {entries[n + 1] && e.title !== entries[n + 1].title ? ' · renamed' : ''}
                    </small>
                    {e.note && <small className="rev-note">{e.note}</small>}
                  </button>
                </li>
              )
            })}
            {backups === null && <li className="muted page-history-more">Looking through older backups…</li>}
          </ul>
          <section className="page-history-view" aria-label={picked.label}>
            <div className="page-history-tabs" role="tablist" aria-label="Show">
              {(
                [
                  ['changes', 'Changes'],
                  ['page', 'The page then'],
                  ['who', 'Who wrote what'],
                ] as [Tab, string][]
              ).map(([t, label]) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="page-history-tools">
              {tab === 'changes' && (
                <label>
                  Compare with{' '}
                  <select value={against} onChange={(e) => setAgainst(e.target.value)}>
                    <option value="prev">{older ? 'the version before' : 'an empty page'}</option>
                    {!isCurrent && <option value="now">the page now</option>}
                    {entries.map((e, n) =>
                      n === at || n === at + 1 || n === 0 ? null : (
                        <option key={e.key} value={e.key}>
                          {e.label} ({formatTime(e.at)})
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}
              {tab === 'who' && <span className="muted">Each line of the page now, and the version that brought it in</span>}
              {picked.rev && !ro && (
                <button onClick={() => editor.markPageVersion(picked.rev!.id, { keep: !picked.rev!.keep })} title="A milestone is kept for good, however many versions come after it">
                  {picked.rev.keep ? '★ Milestone' : '☆ Mark as milestone'}
                </button>
              )}
              {!isCurrent && !ro && (
                <button
                  className="primary"
                  onClick={() => {
                    editor.restorePageVersion(page.id, picked.title, picked.text, picked.rev ? `(version ${nOf(picked)})` : `(backup from ${formatTime(picked.at)})`)
                    onClose()
                  }}
                >
                  Put this version back
                </button>
              )}
            </div>
            {picked.rev && !ro && tab !== 'who' && <NoteField key={picked.rev.id} rev={picked.rev} onSave={(note) => editor.markPageVersion(picked.rev!.id, { note })} />}
            {tab === 'changes' && <Diff lines={lines} />}
            {tab === 'page' && <VersionPage entry={picked} />}
            {tab === 'who' && <WhoWrote lines={who} board={board} />}
          </section>
        </div>
      </div>
    </div>
  )
}

/** The note on a saved version: what changed, in the writer's words (anyone may add one later). */
function NoteField({ rev, onSave }: { rev: PageRev; onSave: (note: string) => void }) {
  const [value, setValue] = useState(rev.note ?? '')
  return (
    <input
      className="rev-note-field"
      value={value}
      maxLength={300}
      placeholder="Add a note about this version"
      aria-label="Note about this version"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== (rev.note ?? '') && onSave(value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** A version of the page as it read then (links shown, but nothing to click through or tick). */
function VersionPage({ entry }: { entry: Entry }) {
  const blocks = useMemo(() => parseMarkdown(entry.text), [entry.text])
  const actions: MarkdownActions = {
    link: (_to, label, key) => (
      <span key={key} className="md-link">
        {label}
      </span>
    ),
    mention: (_id, label, key) => <span key={key}>@{label}</span>,
    children: () => <p className="muted">(The sub-pages are listed here.)</p>,
    headings: headings(blocks),
  }
  return (
    <div className="page-history-page md">
      <h1>{entry.title || 'Untitled'}</h1>
      {entry.text.trim() ? <Markdown blocks={blocks} actions={actions} /> : <p className="muted">No words on the page then.</p>}
    </div>
  )
}

/** Each line with who brought it in, runs of lines from one version sharing a label. */
function WhoWrote({ lines, board }: { lines: RV.WhoLine[]; board: Board }) {
  return (
    <div className="page-diff who-wrote">
      {lines.map((l, n) => {
        const first = n === 0 || lines[n - 1].rev !== l.rev
        const name = l.rev ? `v${RV.revNumber(board, l.rev)}${l.rev.by ? ` · ${l.rev.by}` : ''}` : 'Not saved as a version yet'
        return (
          <div key={n} className="who-line" style={{ '--who': l.rev?.by ? hueOf(l.rev.by) : 0 } as CSSProperties}>
            <span className={`who-tag${l.rev ? '' : ' muted'}`} aria-hidden={!first}>
              {first ? name : ''}
            </span>
            <span className="who-text">{l.s || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Added and removed lines, with long unchanged stretches folded. */
export function Diff({ lines }: { lines: DiffLine[] }) {
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
