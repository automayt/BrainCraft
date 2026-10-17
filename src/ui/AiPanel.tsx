/** The AI assistant panel: chat about the board, previewed changes, and the history of AI changes. */

import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { AI_MODELS, type AiModel, Assistant, type Proposal, describeError, makeClient } from '../ai/assistant'
import { type AiSettings, type ServerAi, connectionFor, loadSettings, saveSettings, serverAi } from '../ai/settings'
import * as B from '../model/board'
import { objectLabel } from '../model/notes'
import { timeAgo } from './Boards'
import { useEditor } from './useEditor'
import { useWorkspace } from './useWorkspace'

interface Turn {
  role: 'user' | 'assistant' | 'error'
  text: string
  proposals: Proposal[]
}

const QUICK: { label: string; prompt: string; needs?: 'selection' }[] = [
  { label: 'Summarise', prompt: 'Summarise what is on the board (or in my selection) in a few bullets.' },
  { label: 'Find gaps', prompt: 'Look for gaps and loose ends: decisions without a "No" branch, dead ends in flowcharts, overdue or unowned tasks, open questions in comments. List what you find, linking each object.' },
  { label: 'Cluster into themes', prompt: 'Cluster the selected sticky notes into themes. Propose frames, one per theme, with the notes moved inside them in tidy rows.', needs: 'selection' },
  { label: 'Make a mind map', prompt: 'Turn the selected content into a mind map placed beside it.', needs: 'selection' },
  { label: 'Make a flowchart', prompt: 'Turn the selected content into a clear flowchart (with decisions where there are choices), placed beside it.', needs: 'selection' },
  { label: 'Decision log', prompt: 'Read the comments on the selected objects (or the whole board) and propose a comment block summarising the decisions made and the open questions.' },
]

/** Answers as light Markdown: paragraphs, bullets, **bold**, `code`, and @[Label](#id) object links. */
function RichText({ text, onObject }: { text: string; onObject: (id: number) => void }) {
  const inline = (line: string, key: number): ReactNode => {
    const parts: ReactNode[] = []
    const re = /@\[([^\]]+)\]\(#(\d+)\)|\*\*([^*]+)\*\*|`([^`]+)`|_([^_]+)_/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push(line.slice(last, m.index))
      if (m[1]) {
        const id = Number(m[2])
        parts.push(
          <button key={m.index} className="ai-ref" onClick={() => onObject(id)} title="Go to this object">
            {m[1]}
          </button>,
        )
      } else if (m[3]) parts.push(<strong key={m.index}>{m[3]}</strong>)
      else if (m[4]) parts.push(<code key={m.index}>{m[4]}</code>)
      else parts.push(<em key={m.index}>{m[5]}</em>)
      last = m.index + m[0].length
    }
    if (last < line.length) parts.push(line.slice(last))
    return <Fragment key={key}>{parts}</Fragment>
  }
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list}</ul>)
    list = []
  }
  text.split('\n').forEach((raw, k) => {
    const line = raw.trimEnd()
    const bullet = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line)
    if (bullet) list.push(<li key={k}>{inline(bullet[1], k)}</li>)
    else {
      flush()
      const h = /^#{1,4}\s+(.*)$/.exec(line)
      if (h) blocks.push(<h4 key={k}>{inline(h[1], k)}</h4>)
      else if (line.trim()) blocks.push(<p key={k}>{inline(line, k)}</p>)
    }
  })
  flush()
  return <div className="ai-text">{blocks}</div>
}

function ProposalCard({ p, undone, onApply, onDiscard, onUndo, onHover }: { p: Proposal; undone: boolean; onApply: () => void; onDiscard: () => void; onUndo: () => void; onHover: (on: boolean) => void }) {
  const { added, changed, removed } = p.counts
  const parts = [added && `${added} new`, changed && `${changed} changed`, removed && `${removed} removed`].filter(Boolean).join(' · ')
  return (
    <div className={`ai-proposal ${p.status}`} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <div className="ai-proposal-head">
        <span className="ai-proposal-kind">{p.status === 'applied' ? (undone ? 'Undone' : 'Applied') : p.status === 'discarded' ? 'Discarded' : 'Proposed change'}</span>
        <small>{parts}</small>
      </div>
      <p>{p.summary}</p>
      {p.status === 'pending' && (
        <div className="ai-proposal-actions">
          <button className="primary" onClick={onApply}>
            Apply
          </button>
          <button onClick={onDiscard}>Discard</button>
          <small className="muted">Previewed on the board</small>
        </div>
      )}
      {p.status === 'applied' && (
        <div className="ai-proposal-actions">
          <button onClick={onUndo}>{undone ? 'Redo' : 'Undo this change'}</button>
        </div>
      )}
    </div>
  )
}

type Usage = Assistant['usage']
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
const inputOf = (u: Usage) => u.input + u.cacheRead + u.cacheWrite

/** " · 41k tokens, 78% from cache" once something has been sent. */
function usageLine(u: Usage) {
  const total = inputOf(u) + u.output
  if (!total) return null
  const cached = inputOf(u) ? Math.round((100 * u.cacheRead) / inputOf(u)) : 0
  return ` · ${k(total)} tokens${cached ? `, ${cached}% from cache` : ''}`
}

const usageTitle = (u: Usage) => `This chat so far: ${u.input} input, ${u.cacheRead} read from cache (a tenth of the price or less), ${u.cacheWrite} written to cache, ${u.output} output tokens`

/** One assistant (and its conversation) per board, for this visit. */
const assistants = new Map<string, { assistant: Assistant; turns: Turn[] }>()

export function AiPanel({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  const ws = useWorkspace()
  const [settings, setSettings] = useState<AiSettings>(loadSettings)
  const [server, setServer] = useState<ServerAi>({ available: false, password: false })
  const [checked, setChecked] = useState(false)
  const [setup, setSetup] = useState(false)
  const [tab, setTab] = useState<'chat' | 'history'>('chat')
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [, setVersion] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const boardKey = ws.boardId ?? 'shared'

  useEffect(() => {
    let live = true
    void serverAi(ws.server).then((s) => {
      if (!live) return
      setServer(s)
      setChecked(true)
    })
    return () => {
      live = false
    }
  }, [ws.server])

  const connection = connectionFor(settings, ws.server, server)
  const state = assistants.get(boardKey)
  const turns = state?.turns ?? []
  const refresh = () => setVersion((v) => v + 1)
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  })
  // Leaving the panel or the board clears any preview.
  useEffect(() => () => editor.previewAi(null), [editor, boardKey])

  const update = (s: AiSettings) => {
    setSettings(s)
    saveSettings(s)
    // Stay on the settings until Done, so the panel doesn't switch away mid-typing.
    setSetup(true)
  }

  const session = () => {
    let s = assistants.get(boardKey)
    if (!s || !connection) {
      if (!connection) return null
      s = { assistant: new Assistant(makeClient(connection), { board: () => editor.board, measure: editor.measure, selection: () => [...editor.selection], view: () => editor.visibleWorld }, settings.model), turns: [] }
      assistants.set(boardKey, s)
    }
    s.assistant.model = settings.model
    return s
  }

  const send = async (text: string) => {
    const s = session()
    if (!s || !text.trim() || running) return
    s.turns.push({ role: 'user', text: text.trim(), proposals: [] })
    const reply: Turn = { role: 'assistant', text: '', proposals: [] }
    s.turns.push(reply)
    setInput('')
    setRunning(true)
    refresh()
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      await s.assistant.send(
        text.trim(),
        {
          text: (d) => {
            reply.text += d
            refresh()
          },
          status: (st) => setStatus(st),
          proposal: (p) => {
            reply.proposals.push(p)
            editor.previewAi(p)
            refresh()
          },
        },
        ctrl.signal,
      )
    } catch (err) {
      s.turns.push({ role: 'error', text: describeError(err), proposals: [] })
    } finally {
      abort.current = null
      setRunning(false)
      setStatus(null)
      refresh()
    }
  }

  // A question asked from elsewhere (e.g. "Summarise with AI" on the catch-up banner).
  const asked = editor.pendingAiPrompt
  useEffect(() => {
    if (!asked || running) return
    editor.pendingAiPrompt = null
    if (connection) void send(asked)
    else setInput(asked)
    // Only when a new question arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, !!connection])

  const go = (id: number) => B.getItem(editor.board, id) && editor.focusObject(id)
  const pending = turns.flatMap((t) => t.proposals).filter((p) => p.status === 'pending')
  const latestPending = pending.at(-1)
  const history = [...editor.aiHistory].reverse()

  const apply = (p: Proposal) => {
    if (editor.readOnly) return editor.setStatus('This board is read-only')
    if (editor.applyAi(p.id, p.summary, p.patches)) p.status = 'applied'
    else editor.setStatus('Nothing left to change')
    refresh()
  }

  const showSetup = setup || !connection
  return (
    <aside className="ai-panel no-canvas" aria-label="AI assistant" onPointerDown={(e) => e.stopPropagation()}>
      <header className="ai-head">
        <span className="ai-spark" aria-hidden="true">
          ✦
        </span>
        <div className="ai-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
            Assistant
          </button>
          <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
            History{editor.aiHistory.length ? ` (${editor.aiHistory.length})` : ''}
          </button>
        </div>
        <button className="icon-btn" title="AI settings" aria-label="AI settings" onClick={() => setSetup(!setup)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
          </svg>
        </button>
        <button className="icon-close" aria-label="Close the assistant" title="Close (Ctrl+J)" onClick={onClose}>
          ×
        </button>
      </header>

      {showSetup && (
        <section className="ai-setup">
          <h3>Connect the assistant</h3>
          {ws.server && server.available && (
            <label className="ai-choice">
              <input type="radio" checked={settings.mode === 'server'} onChange={() => update({ ...settings, mode: 'server' })} />
              <span>
                <strong>Use this BrainCraft server</strong>
                <small>Its owner pays for usage; nothing to set up.</small>
              </span>
            </label>
          )}
          {settings.mode === 'server' && server.available && server.password && (
            <input type="password" className="ai-field" placeholder="Server AI password" value={settings.password ?? ''} onChange={(e) => update({ ...settings, password: e.target.value })} />
          )}
          <label className="ai-choice">
            <input type="radio" checked={settings.mode === 'key' || !server.available} onChange={() => update({ ...settings, mode: 'key' })} />
            <span>
              <strong>Use my own Anthropic API key</strong>
              <small>
                Stored only in this browser and sent only to Anthropic. Get one at{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  console.anthropic.com
                </a>
                .
              </small>
            </span>
          </label>
          {(settings.mode === 'key' || !server.available) && (
            <input
              type="password"
              className="ai-field"
              placeholder="sk-ant-…"
              autoFocus
              autoComplete="off"
              value={settings.apiKey ?? ''}
              onChange={(e) => update({ ...settings, mode: 'key', apiKey: e.target.value })}
            />
          )}
          {!checked && <p className="muted">Checking for a server…</p>}
          <label className="ai-model">
            Model
            <select value={settings.model} onChange={(e) => update({ ...settings, model: e.target.value as AiModel })}>
              {AI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.hint}
                </option>
              ))}
            </select>
          </label>
          {connection && setup && (
            <button className="primary" onClick={() => setSetup(false)}>
              Done
            </button>
          )}
        </section>
      )}

      {!showSetup && tab === 'chat' && (
        <>
          <div className="ai-scroll" ref={scroller}>
            {!turns.length && (
              <div className="ai-empty">
                <p>
                  Ask about this board, or ask for changes. Changes are <strong>previewed</strong> on the board first, and every applied change can be undone from{' '}
                  <button className="link" onClick={() => setTab('history')}>
                    History
                  </button>
                  .
                </p>
              </div>
            )}
            {turns.map((t, k) =>
              t.role === 'user' ? (
                <div key={k} className="ai-msg user">
                  {t.text}
                </div>
              ) : t.role === 'error' ? (
                <div key={k} className="ai-msg error">
                  {t.text}
                  {/settings|key|password/i.test(t.text) && (
                    <button className="link ai-fix" onClick={() => setSetup(true)}>
                      Open AI settings
                    </button>
                  )}
                </div>
              ) : (
                <div key={k} className="ai-msg assistant">
                  {t.text && <RichText text={t.text} onObject={go} />}
                  {t.proposals.map((p) => (
                    <ProposalCard
                      key={p.id}
                      p={p}
                      undone={!!editor.aiHistory.find((c) => c.id === p.id)?.undone}
                      onApply={() => apply(p)}
                      onDiscard={() => {
                        p.status = 'discarded'
                        if (editor.aiPreview?.id === p.id) editor.previewAi(null)
                        refresh()
                      }}
                      onUndo={() => editor.toggleAiChange(p.id)}
                      onHover={(on) => {
                        if (p.status !== 'pending') return
                        editor.previewAi(on ? p : (latestPending ?? null))
                      }}
                    />
                  ))}
                </div>
              ),
            )}
            {status && (
              <div className="ai-status">
                <span className="ai-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {status}
              </div>
            )}
          </div>

          <div className="ai-quick">
            {QUICK.filter((q) => !q.needs || editor.selection.size).map((q) => (
              <button key={q.label} disabled={running} onClick={() => void send(q.prompt)}>
                {q.label}
              </button>
            ))}
          </div>

          <form
            className="ai-compose"
            onSubmit={(e) => {
              e.preventDefault()
              void send(input)
            }}
          >
            <textarea
              autoFocus
              value={input}
              rows={2}
              placeholder={editor.selection.size ? `Ask about the ${editor.selection.size} selected…` : 'Ask anything about this board…'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
            />
            <div className="ai-compose-foot">
              <small className="muted" title={state ? usageTitle(state.assistant.usage) : undefined}>
                {AI_MODELS.find((m) => m.id === settings.model)?.label}
                {state && usageLine(state.assistant.usage)}
              </small>
              {turns.length > 0 && !running && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    assistants.delete(boardKey)
                    editor.previewAi(null)
                    refresh()
                  }}
                >
                  New chat
                </button>
              )}
              {running ? (
                <button type="button" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              ) : (
                <button className="primary" type="submit" disabled={!input.trim()}>
                  Send
                </button>
              )}
            </div>
          </form>
        </>
      )}

      {!showSetup && tab === 'history' && (
        <div className="ai-scroll">
          {!history.length && <p className="ai-empty muted">Changes you apply from the assistant are listed here. Each one can be undone on its own, even after other edits.</p>}
          <ol className="ai-history">
            {history.map((c) => {
              const touched = c.forward.flatMap((p) => (p.k === 'item' && p.v ? [p.id] : []))
              const first = touched.map((id) => B.getItem(editor.board, id)).find(Boolean)
              return (
                <li key={c.id} className={c.undone ? 'undone' : ''}>
                  <div>
                    <strong>{c.summary}</strong>
                    <small className="muted">
                      {timeAgo(c.at)} · {c.forward.length} change{c.forward.length === 1 ? '' : 's'}
                      {c.undone ? ' · undone' : ''}
                    </small>
                  </div>
                  <div className="ai-history-actions">
                    {first && !c.undone && (
                      <button className="link" onClick={() => editor.focusObject(first.id)} title={objectLabel(first)}>
                        Show
                      </button>
                    )}
                    <button onClick={() => editor.toggleAiChange(c.id)}>{c.undone ? 'Redo' : 'Undo'}</button>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </aside>
  )
}
