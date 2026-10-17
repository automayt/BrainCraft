/** Runbook mode: the panel that walks a flowchart, the summary after a run, and run history. */

import { useEffect, useRef, useState } from 'react'
import { useDialog } from './useDialog'
import * as B from '../model/board'
import { type RunRecord, formatDuration, instructions, runStats, runToMarkdown, runsOf } from '../model/runbook'
import { type Id, flowShapeInfo } from '../model/types'
import { FlowShapeIcon } from './icons'
import { useEditor } from './useEditor'
import { useEscape } from './useEscape'

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function copy(text: string, done: () => void) {
  void navigator.clipboard?.writeText(text).then(done, done)
}

export function RunPanel() {
  const editor = useEditor()
  const run = editor.running
  const finished = editor.finishedRun
  const now = useNow(!!run)
  if (run) return <Running now={now} />
  if (finished) return <Finished />
  return null
}

function Running({ now }: { now: number }) {
  const editor = useEditor()
  const run = editor.running!
  const at = editor.runStep!
  const item = B.getItem(editor.board, at)
  const step = run.steps[run.steps.length - 1]
  const opts = editor.runOptions
  const title = B.getItem(editor.board, run.start)?.text || 'Flowchart'
  const howTo = instructions(editor.board, at)
  const isDecision = opts.length > 1

  return (
    <aside className="run-panel island no-canvas" aria-label="Running flowchart" onPointerDown={(e) => e.stopPropagation()}>
      <header className="run-head">
        <span className="run-live" aria-hidden="true" />
        <span className="run-title">
          <small>Running</small>
          <strong title={title}>{title}</strong>
        </span>
        <span className="run-time" aria-label="Elapsed time">
          {formatDuration(now - run.startedAt)}
        </span>
      </header>

      <ol className="run-trail" aria-label="Steps so far">
        {run.steps.slice(0, -1).map((s, k) => (
          <li key={k} title={s.note}>
            <span>{s.text}</span>
            {s.choice && <em>{s.choice}</em>}
          </li>
        ))}
      </ol>

      <section className="run-step">
        <div className="run-kind">
          {item?.shape && <FlowShapeIcon shape={item.shape} size={20} />}
          <span>
            Step {run.steps.length} · {flowShapeInfo(item?.shape).label}
          </span>
        </div>
        <h3>{step.text}</h3>
        {howTo.length > 0 && (
          <ul className="run-howto">
            {howTo.map((h, k) => (
              <li key={k}>{h}</li>
            ))}
          </ul>
        )}
        <textarea
          className="run-note"
          placeholder="Note for this step (optional)"
          value={step.note ?? ''}
          rows={2}
          onChange={(e) => editor.setRunNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              ;(e.target as HTMLTextAreaElement).blur()
              editor.runKey('Enter')
            }
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          }}
        />
      </section>

      <div className="run-choices">
        {opts.length === 0 ? (
          <button className="primary run-go" onClick={() => editor.endRun('done')}>
            Finish run <kbd>Enter</kbd>
          </button>
        ) : (
          opts.map((o, k) => (
            <button key={o.connector} className={`run-go${isDecision ? '' : ' primary'}`} onClick={() => editor.runChoose(k)}>
              <span>{isDecision ? o.label : <>Done — next: {o.label}</>}</span>
              <kbd>{isDecision ? k + 1 : 'Enter'}</kbd>
            </button>
          ))
        )}
      </div>

      <footer className="run-foot">
        <button onClick={() => editor.runBack()} disabled={run.steps.length < 2}>
          ← Back
        </button>
        <button className="danger" onClick={() => editor.endRun('stopped')}>
          Stop <kbd>Esc</kbd>
        </button>
      </footer>
    </aside>
  )
}

function Finished() {
  const editor = useEditor()
  const { start, record } = editor.finishedRun!
  const [copied, setCopied] = useState(false)
  const title = B.getItem(editor.board, start)?.text || 'Flowchart'
  const done = record.status === 'done'
  return (
    <aside className="run-panel island no-canvas run-finished" aria-label="Run summary" onPointerDown={(e) => e.stopPropagation()}>
      <div className={`run-badge ${record.status}`} aria-hidden="true">
        {done ? '✓' : '■'}
      </div>
      <h3>{done ? 'Run complete' : 'Run stopped'}</h3>
      <p className="muted">
        {title} · {record.steps.length} steps · {formatDuration(record.endedAt - record.startedAt)}
      </p>
      <ol className="run-summary">
        {record.steps.map((s, k) => (
          <li key={k}>
            <span>{s.text}</span>
            {s.choice && <em>{s.choice}</em>}
            {s.note && <small>{s.note}</small>}
          </li>
        ))}
      </ol>
      <div className="run-foot">
        <button onClick={() => copy(runToMarkdown(title, record), () => setCopied(true))}>{copied ? 'Copied' : 'Copy as Markdown'}</button>
        <button onClick={() => editor.startRun(start)}>Run again</button>
        <button className="primary" onClick={() => editor.dismissRun()}>
          Close
        </button>
      </div>
    </aside>
  )
}

/** Every recorded run of a flowchart, with how it usually goes. */
export function RunsDialog({ id, onClose }: { id: Id; onClose: () => void }) {
  const editor = useEditor()
  useEscape(onClose)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialog(dialogRef)
  const found = runsOf(editor.board, id)
  const [copied, setCopied] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  if (!found) return null
  const title = B.getItem(editor.board, found.start)?.text || 'Flowchart'
  const runs = [...found.runs].reverse()
  const stats = runStats(found.runs)
  const row = (r: RunRecord) => (
    <li key={r.id} className={open === r.id ? 'open' : ''}>
      <button className="run-row" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
        <span className={`run-dot ${r.status}`} aria-hidden="true" />
        <span>
          <strong>{new Date(r.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong>
          <small className="muted">
            {r.status === 'done' ? 'Completed' : 'Stopped'} · {r.steps.length} steps · {formatDuration(r.endedAt - r.startedAt)}
            {r.by ? ` · ${r.by}` : ''}
          </small>
        </span>
      </button>
      {open === r.id && (
        <div className="run-detail">
          <ol className="run-summary">
            {r.steps.map((s, k) => (
              <li key={k}>
                <span>{s.text}</span>
                {s.choice && <em>{s.choice}</em>}
                {s.note && <small>{s.note}</small>}
              </li>
            ))}
          </ol>
          <div className="run-foot">
            <button className="danger" onClick={() => editor.deleteRun(found.start, r.id)}>
              Delete
            </button>
            <button onClick={() => copy(runToMarkdown(title, r), () => setCopied(r.id))}>{copied === r.id ? 'Copied' : 'Copy as Markdown'}</button>
          </div>
        </div>
      )}
    </li>
  )
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal runs-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Run history" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
        <header>
          <h2>Runs of “{title}”</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="runs-body">
          {stats.total ? (
            <div className="run-stats">
              <div>
                <strong>{stats.total}</strong>
                <small>runs</small>
              </div>
              <div>
                <strong>{stats.finished}</strong>
                <small>completed</small>
              </div>
              <div>
                <strong>{stats.typical !== undefined ? formatDuration(stats.typical) : '—'}</strong>
                <small>typical time</small>
              </div>
              {stats.commonPath && (
                <p className="run-common">
                  <small>Usual route ({Math.round((stats.commonPathShare ?? 0) * 100)}% of completed runs)</small>
                  <span>{stats.commonPath.join(' → ')}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="muted">No runs yet. Select a shape and choose Run flowchart (Alt R) to walk through it step by step.</p>
          )}
          <ol className="run-list">{runs.map(row)}</ol>
        </div>
        <footer className="dialog-foot runs-foot">
          <span />
          <button
            className="primary"
            onClick={() => {
              onClose()
              editor.startRun(found.start)
            }}
          >
            Start a run
          </button>
        </footer>
      </div>
    </div>
  )
}
