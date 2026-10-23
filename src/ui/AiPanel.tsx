/** The AI assistant panel: chat about the board, previewed changes, and the history of AI changes. */

import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { AI_MODELS, type AiImage, type AiModel, Assistant, type Proposal, describeError, makeBackend } from '../ai/assistant'
import { type AiSettings, type ServerAi, type ServerProvider, connectionFor, listModels, loadSettings, saveSettings, serverAi, serverProvider } from '../ai/settings'
import { type Keeper, type SavedThread, type Turn, type Where, forgetThread, loadThread, ownerOf, saveThread, toSaved } from '../ai/threadStore'
import * as B from '../model/board'
import { type LinkTarget, objectLabel, parseNote, resolveName } from '../model/notes'
import { isWiki } from '../model/wiki'
import { timeAgo } from './Boards'
import { useLinkPicker } from './NotesPanel'
import { PersonMention } from './PersonMention'
import { useEditor } from './useEditor'
import { useWorkspace } from './useWorkspace'
import { useTalk } from './useTalk'
import { type FlowLine, Flowstate, plainLine } from './Flowstate'

const QUICK: { label: string; prompt: string; needs?: 'selection'; changes?: true }[] = [
  { label: 'Summarise', prompt: 'Summarise what is on the board (or in my selection) in a few bullets.' },
  { label: 'Find gaps', prompt: 'Look for gaps and loose ends: decisions without a "No" branch, dead ends in flowcharts, overdue or unowned tasks, open questions in comments. List what you find, linking each object.' },
  { label: 'Cluster into themes', prompt: 'Cluster the selected sticky notes into themes. Propose frames, one per theme, with the notes moved inside them in tidy rows.', needs: 'selection', changes: true },
  { label: 'Make a mind map', prompt: 'Turn the selected content into a mind map placed beside it.', needs: 'selection', changes: true },
  { label: 'Make a flowchart', prompt: 'Turn the selected content into a clear flowchart (with decisions where there are choices), placed beside it.', needs: 'selection', changes: true },
  { label: 'Decision log', prompt: 'Read the comments on the selected objects (or the whole board) and propose a comment block summarising the decisions made and the open questions.', changes: true },
]

/**
 * Answers (and questions) as light Markdown: paragraphs, bullets, **bold**, `code`, @[Label](#id)
 * object links, [[Title]](…) links to pages and boards, and mentions of people.
 */
function RichText({ text, onObject, onLink }: { text: string; onObject: (id: number) => void; onLink: (to: LinkTarget | null, label: string) => void }) {
  const styled = (s: string, key: string): ReactNode[] => {
    const parts: ReactNode[] = []
    const re = /\*\*([^*]+)\*\*|`([^`]+)`|_([^_]+)_/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index))
      if (m[1]) parts.push(<strong key={`${key}.${m.index}`}>{m[1]}</strong>)
      else if (m[2]) parts.push(<code key={`${key}.${m.index}`}>{m[2]}</code>)
      else parts.push(<em key={`${key}.${m.index}`}>{m[3]}</em>)
      last = m.index + m[0].length
    }
    if (last < s.length) parts.push(s.slice(last))
    return parts
  }
  const inline = (line: string, key: number): ReactNode => (
    <Fragment key={key}>
      {parseNote(line).map((p, n) => {
        if ('text' in p) return <Fragment key={n}>{styled(p.text, `${key}.${n}`)}</Fragment>
        if ('person' in p) return <PersonMention key={n} id={p.person} label={p.label} />
        if ('mention' in p)
          return (
            <button key={n} className="ai-ref" onClick={() => onObject(p.mention)} title="Go to this object">
              {p.label}
            </button>
          )
        const page = p.link?.page !== undefined
        return (
          <button key={n} className="ai-ref" onClick={() => onLink(p.link, p.label)} title={page ? 'Open this page' : p.link?.item !== undefined ? 'Go to this object' : 'Open this board'}>
            {page ? '📄 ' : p.link?.item === undefined ? '📋 ' : ''}
            {p.label}
          </button>
        )
      })}
    </Fragment>
  )
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

function ProposalCard({
  p,
  undone,
  away,
  onGo,
  onApply,
  onDiscard,
  onUndo,
  onOpen,
  onHover,
}: {
  p: Proposal
  undone: boolean
  /** Made on another board or wiki than the open one: applied or undone there. */
  away?: Where | null
  onGo?: () => void
  onApply: () => void
  onDiscard: () => void
  onUndo: () => void
  onOpen: () => void
  onHover: (on: boolean) => void
}) {
  const { added, changed, removed } = p.counts
  const parts = [added && `${added} new`, changed && `${changed} changed`, removed && `${removed} removed`].filter(Boolean).join(' · ')
  const t = p.target
  const what = t ? `${t.kind === 'wiki' ? 'wiki' : 'board'} “${t.title}”` : ''
  if (t)
    return (
      <div className={`ai-proposal elsewhere ${p.status}`}>
        <div className="ai-proposal-head">
          <span className="ai-proposal-kind">{p.status === 'applied' ? (t.create ? 'Made' : 'Applied') : p.status === 'discarded' ? 'Discarded' : t.create ? `New ${t.kind === 'wiki' ? 'wiki' : 'board'}` : 'Change elsewhere'}</span>
          <small>{parts}</small>
        </div>
        <p className="ai-proposal-where">
          {t.kind === 'wiki' ? '📘' : '📋'} {t.create ? `A new ${what}` : `In the ${what}`}
        </p>
        <p>{p.summary}</p>
        {p.status === 'pending' && (
          <div className="ai-proposal-actions">
            <button className="primary" onClick={onApply}>
              {t.create ? `Make the ${t.kind === 'wiki' ? 'wiki' : 'board'}` : 'Apply'}
            </button>
            <button onClick={onDiscard}>Discard</button>
            <small className="muted">{t.create ? 'Nothing is made until you do' : 'Changes that one, not this'}</small>
          </div>
        )}
        {p.status === 'applied' && p.opened && (
          <div className="ai-proposal-actions">
            <button className="primary" onClick={onOpen}>
              Open the {t.kind === 'wiki' ? 'wiki' : 'board'}
            </button>
            <small className="muted">Undo it there (a wiki keeps every page’s history)</small>
          </div>
        )}
      </div>
    )
  if (away) {
    const there = `${away.kind === 'wiki' ? 'the wiki' : 'the board'} “${away.title}”`
    return (
      <div className={`ai-proposal away ${p.status}`}>
        <div className="ai-proposal-head">
          <span className="ai-proposal-kind">{p.status === 'applied' ? 'Applied' : p.status === 'discarded' ? 'Discarded' : 'Proposed change'}</span>
          <small>{parts}</small>
        </div>
        <p>{p.summary}</p>
        {p.status !== 'discarded' && (
          <div className="ai-proposal-actions">
            {onGo && (
              <button className={p.status === 'pending' ? 'primary' : ''} onClick={onGo}>
                Open {there}
              </button>
            )}
            <small className="muted">{p.status === 'pending' ? 'Apply it there' : 'Undo it there'}</small>
          </div>
        )}
      </div>
    )
  }
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

/**
 * One conversation per person, following them between boards and wikis (each message says where
 * it was sent from), kept with their account or in this browser between visits (ai/threadStore).
 */
interface Thread {
  owner: string
  turns: Turn[]
  assistant: Assistant | null
  /** A kept conversation, until the assistant carries it on. */
  kept: SavedThread | null
}
let thread: Thread | null = null
let saving: ReturnType<typeof setTimeout> | undefined

/** Keeps the conversation a moment after it changes (once, however many changes come together). */
function keep(t: Thread, k: Keeper) {
  clearTimeout(saving)
  saving = setTimeout(() => {
    if (thread !== t || !t.assistant) return
    const saved = toSaved(t.assistant.messages, t.turns, t.assistant.usage)
    if (saved) void saveThread(k, saved)
  }, 800)
}

/**
 * The assistant: a side panel, or, in Flowstate (`flow`), nothing but the board, its words
 * floating over it while you talk. Both share the board's conversation.
 */
export function AiPanel({ onClose, flow = false, onFlow }: { onClose: () => void; flow?: boolean; onFlow?: (on: boolean) => void }) {
  const editor = useEditor()
  const ws = useWorkspace()
  const [settings, setSettings] = useState<AiSettings>(loadSettings)
  const [server, setServer] = useState<ServerAi>({ available: false, password: false, providers: [], openaiModels: [], textTools: false, agents: [], agentsLocal: false })
  /** Models found on your own model server, or why none were. */
  const [found, setFound] = useState<string[] | string | null>(null)
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
  const keeper: Keeper = { server: ws.server, account: ws.account?.user?.id ?? null }
  const owner = ownerOf(keeper)
  const here: Where = { key: boardKey, title: editor.board.title || 'Untitled', kind: isWiki(editor.board) ? 'wiki' : 'board' }
  // Flowstate's words are the replies since it started (see below).
  const flowFrom = useRef(0)
  const wasFlow = useRef(false)
  // The conversation kept from before (or by another device), once per person.
  useEffect(() => {
    if (thread?.owner === owner) return
    const mine: Thread = { owner, turns: [], assistant: null, kept: null }
    thread = mine
    void loadThread(keeper).then((kept) => {
      if (thread !== mine || !kept || mine.turns.length) return
      mine.turns = kept.turns
      mine.kept = kept
      // Arriving after Flowstate started: these are from before, not words to float up now.
      if (wasFlow.current) flowFrom.current += kept.turns.length
      setVersion((v) => v + 1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner])
  const state = thread?.owner === owner ? thread : null
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
    if (!connection) return null
    if (thread?.owner !== owner) thread = { owner, turns: [], assistant: null, kept: null }
    const s = thread
    const backend = makeBackend(connection, settings.model)
    if (!s.assistant) {
      s.assistant = new Assistant(backend, {
          board: () => editor.board,
          readable: () => editor.viewBoard,
          measure: editor.measure,
          selection: () => [...editor.selection],
          view: () => editor.visibleWorld,
          // The person's other boards and wikis in this browser, to read what a message links to.
          others: () => ({ boards: ws.otherBoards, selfKeys: ws.selfKeys, read: (key) => ws.readBoard(key), me: editor.me, link: ws.linkKey }),
          fileText: async (id) => {
            const f = editor.board.files?.find((x) => x.id === id)
            return f ? ws.fileText(f) : null
          },
        })
      if (s.kept) s.assistant.restore(s.kept.messages, s.kept.usage)
      s.kept = null
      // A summary arriving later is kept too.
      s.assistant.onChange = () => keep(s, keeper)
    }
    // Settings may have changed since the last message; the conversation carries over.
    s.assistant.backend = backend
    return s as Thread & { assistant: Assistant }
  }
  const provider = serverProvider(settings, server)
  /** The server's choices as one list: Claude models, its model server's models, its agent. */
  const serverChoices: { value: string; label: string }[] = [
    ...(server.providers.includes('anthropic') ? AI_MODELS.map((m) => ({ value: `anthropic:${m.id}`, label: `${m.label} — ${m.hint}` })) : []),
    ...(server.providers.includes('openai') ? (server.openaiModels.length ? server.openaiModels : ['']).map((m) => ({ value: `openai:${m}`, label: `${m || 'The model server'} — on this server’s model server` })) : []),
    ...(server.providers.includes('command')
      ? server.agents.map((a) => ({ value: `command:${a.id}`, label: `${a.label} — signed in on the server's computer (slower: each step starts it afresh)` }))
      : []),
  ]
  const agent = server.agents.find((a) => a.id === settings.agent) ?? server.agents[0]
  const serverChoice = provider === 'anthropic' ? `anthropic:${settings.model}` : provider === 'openai' ? `openai:${settings.serverModel && server.openaiModels.includes(settings.serverModel) ? settings.serverModel : (server.openaiModels[0] ?? '')}` : `command:${agent?.id ?? ''}`
  const pickServer = (value: string) => {
    const [p, rest] = [value.slice(0, value.indexOf(':')) as ServerProvider, value.slice(value.indexOf(':') + 1)]
    update({ ...settings, mode: 'server', provider: p, ...(p === 'anthropic' ? { model: rest as AiModel } : p === 'openai' ? { serverModel: rest } : { agent: rest }) })
  }

  // A turn is with the assistant (kept outside React too, so a turn spoken meanwhile waits its go).
  const busy = useRef(false)
  const send = async (text: string, images: AiImage[] = [], label?: string, live = false) => {
    const s = session()
    if (!s || !text.trim() || busy.current) return
    busy.current = true
    // A long built-in request shows as its short label in the chat.
    s.turns.push({ role: 'user', text: label ?? text.trim(), proposals: [], where: here })
    const reply: Turn = { role: 'assistant', text: '', proposals: [], where: here }
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
            // Changes elsewhere can't be shown on this board; their card says where they go.
            if (!p.target && p.status === 'pending') editor.previewAi(p)
            refresh()
          },
          // Talking: changes go on the board as they come (each one in History, to undo).
          ...(live ? { apply: (p: Proposal) => !editor.readOnly && editor.applyAi(p.id, p.summary, p.patches, p.bases) } : {}),
        },
        ctrl.signal,
        images,
        live,
      )
    } catch (err) {
      s.turns.push({ role: 'error', text: describeError(err), proposals: [] })
    } finally {
      busy.current = false
      abort.current = null
      setRunning(false)
      setStatus(null)
      refresh()
      keep(s, keeper)
    }
  }

  // A question asked from elsewhere (e.g. "Summarise with AI" on the catch-up banner).
  const asked = editor.pendingAiPrompt
  useEffect(() => {
    // Wait until we know how to reach Claude; without a connection the question waits
    // (pictures and all) while the setup card shows, and goes out once connected.
    if (!asked || running || !checked || !connection) return
    editor.pendingAiPrompt = null
    void send(asked.text, asked.images, asked.label)
    // Only when a new question arrives or the connection becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, !!connection, checked, running])

  const go = (id: number) => B.getItem(editor.board, id) && editor.focusObject(id)
  // Talking: each pause sends what was said, and the assistant shapes the board as it goes.
  const talk = useTalk({ server: ws.server, serverTranscribes: !!server.transcribe, serverPreviews: !!server.transcribePreview, password: settings.password, say: (t) => send(t, [], `🎙 ${t}`, true) })
  const follow = (to: LinkTarget | null, label: string) => {
    const target = to ?? resolveName(label, editor.board, ws.otherBoards)
    if (target) void ws.openLink(target)
    else editor.setStatus(`Nothing is called “${label}”`)
  }
  // @ and [[ in the question: link objects, pages and boards, which go along with it.
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useLinkPicker(area, input, setInput, -1)
  const ask = () => {
    // Sent with its links; shown as typed.
    const shown = input.trim()
    if (shown) void send(picker.encode(input), [], shown)
  }
  /** Made on another board or wiki than the open one. */
  const awayOf = (t: Turn) => (t.where && t.where.key !== boardKey ? t.where : null)
  /** Opens a board or wiki the conversation was on (a shared link opened without saving has nowhere to go back to). */
  const goTo = (w: Where | null) => (w && w.key !== 'shared' ? () => void ws.switchTo(w.key) : undefined)
  const latestPending = turns
    .filter((t) => !awayOf(t))
    .flatMap((t) => t.proposals)
    .filter((p) => p.status === 'pending' && !p.target)
    .at(-1)
  const history = [...editor.aiHistory].reverse()

  const apply = (p: Proposal) => {
    if (p.target) {
      // Another board or wiki, or a new one: applied there, then it can be opened.
      void ws.applyElsewhere(p.target, p.ops).then(
        (id) => {
          p.status = 'applied'
          p.opened = id
          editor.setStatus(`${p.target!.create ? 'Made' : 'Changed'} ${p.target!.kind === 'wiki' ? 'the wiki' : 'the board'} “${p.target!.title}”`)
          refresh()
        },
        (err: Error) => editor.setStatus(`Couldn’t apply that: ${err.message}`),
      )
      return
    }
    if (editor.readOnly) return editor.setStatus('This board is read-only')
    if (editor.applyAi(p.id, p.summary, p.patches, p.bases)) p.status = 'applied'
    else editor.setStatus('Nothing left to change')
    refresh()
  }

  // Flowstate starts listening at once, and stops when it ends; its words are this session's replies.
  if (flow && !wasFlow.current) flowFrom.current = turns.length
  wasFlow.current = flow
  const canTalk = !!connection && !editor.readOnly && !!talk.how
  useEffect(() => {
    if (flow) {
      if (checked && canTalk && !talk.on) void talk.start()
    } else if (talk.on) talk.stop()
    // Only when Flowstate starts or ends, or once it's known whether it can listen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, checked, canTalk])

  if (flow) {
    const lines: FlowLine[] = turns.slice(flowFrom.current).flatMap((t, i): FlowLine[] => {
      if (t.role === 'user') return []
      const key = String(flowFrom.current + i)
      if (t.role === 'error') return [{ key, text: plainLine(t.text), state: 'error' }]
      const last = flowFrom.current + i === turns.length - 1
      // Said in words, or else what it changed.
      const text = plainLine(t.text) || (last && running ? '' : t.proposals.map((p) => p.summary).join('; '))
      return text || (last && running) ? [{ key, text, state: last && running ? 'working' : 'done' }] : []
    })
    const problem = !checked
      ? null
      : !connection
        ? 'The assistant isn’t connected yet. Leave Flowstate (Esc) and open Ask AI to set it up.'
        : editor.readOnly
          ? 'This board is read-only, so it can’t be changed by talking.'
          : !talk.how
            ? 'This browser can’t hear you here: the server needs speech to text (BRAINCRAFT_TRANSCRIBE_URL), or use Chrome, Edge or Safari.'
            : talk.error
    return <Flowstate lines={lines} waiting={talk.waiting} interim={talk.interim} level={talk.level} listening={talk.on} muted={talk.muted} onMute={talk.mute} problem={problem} onLeave={() => onFlow?.(false)} />
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
        <button className="icon-close" aria-label="Close the assistant" title="Close (Ctrl J)" onClick={onClose}>
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
                <strong>Use this server</strong>
                <small>
                  {server.agents.length && server.providers.length === 1
                    ? `${server.agents.map((a) => a.label).join(' or ')}, on the server's computer, with whoever is signed in there. Nothing to set up here.`
                    : 'Its owner set up the AI; nothing to set up here.'}
                </small>
              </span>
            </label>
          )}
          {settings.mode === 'server' && server.available && (
            <>
              {server.password && (
                <input type="password" className="ai-field" aria-label="Server AI password" placeholder="Server AI password" value={settings.password ?? ''} onChange={(e) => update({ ...settings, password: e.target.value })} />
              )}
              <label className="ai-model">
                Model
                <select aria-label="Model" value={serverChoice} onChange={(e) => pickServer(e.target.value)}>
                  {serverChoices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="ai-choice">
            <input type="radio" checked={settings.mode === 'key' || (settings.mode === 'server' && !server.available)} onChange={() => update({ ...settings, mode: 'key' })} />
            <span>
              <strong>Use my own Anthropic API key</strong>
              <small>
                Claude, with a key stored only in this browser and sent only to Anthropic. Get one at{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                  console.anthropic.com
                </a>
                .
              </small>
            </span>
          </label>
          {(settings.mode === 'key' || (settings.mode === 'server' && !server.available)) && (
            <>
              <input
                type="password"
                className="ai-field"
                aria-label="Anthropic API key"
                placeholder="sk-ant-…"
                autoFocus
                autoComplete="off"
                value={settings.apiKey ?? ''}
                onChange={(e) => update({ ...settings, mode: 'key', apiKey: e.target.value })}
              />
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
            </>
          )}
          <label className="ai-choice">
            <input type="radio" checked={settings.mode === 'openai'} onChange={() => update({ ...settings, mode: 'openai' })} />
            <span>
              <strong>Use my own model server</strong>
              <small>Any server with an OpenAI-compatible API, such as vLLM, reached straight from this browser.</small>
            </span>
          </label>
          {settings.mode === 'openai' && (
            <div className="ai-openai">
              <input
                className="ai-field"
                aria-label="Model server address"
                placeholder="http://localhost:8000/v1"
                autoComplete="off"
                value={settings.openaiBase ?? ''}
                onChange={(e) => update({ ...settings, openaiBase: e.target.value })}
              />
              <input
                type="password"
                className="ai-field"
                aria-label="Model server API key (if it needs one)"
                placeholder="API key (if it needs one)"
                autoComplete="off"
                value={settings.openaiKey ?? ''}
                onChange={(e) => update({ ...settings, openaiKey: e.target.value })}
              />
              <div className="ai-openai-model">
                <input
                  className="ai-field"
                  aria-label="Model name"
                  placeholder="Model name"
                  list="ai-found-models"
                  autoComplete="off"
                  value={settings.openaiModel ?? ''}
                  onChange={(e) => update({ ...settings, openaiModel: e.target.value })}
                />
                <button
                  disabled={!settings.openaiBase?.trim()}
                  onClick={async () => {
                    const r = await listModels(settings.openaiBase!.trim(), settings.openaiKey?.trim() || undefined)
                    setFound(r)
                    if (Array.isArray(r) && !settings.openaiModel?.trim()) update({ ...settings, openaiModel: r[0] })
                  }}
                >
                  Find models
                </button>
              </div>
              <datalist id="ai-found-models">{Array.isArray(found) && found.map((m) => <option key={m} value={m} />)}</datalist>
              {typeof found === 'string' && <p className="ai-waiting">{found}</p>}
              {Array.isArray(found) && <p className="muted">Found: {found.join(', ')}</p>}
              <label className="ai-check">
                <input type="checkbox" checked={!!settings.textTools} onChange={(e) => update({ ...settings, textTools: e.target.checked })} />
                <span>Describe the tools in the text (for a model served without tool calling)</span>
              </label>
              <p className="muted">The server has to allow this page’s address; vLLM does with <code>--allowed-origins</code>. Pictures need a model that can see them.</p>
            </div>
          )}
          {!checked && <p className="muted">Checking for a server…</p>}
          {editor.pendingAiPrompt && <p className="ai-waiting">“{editor.pendingAiPrompt.label ?? 'Your question'}” will be sent as soon as the assistant is connected.</p>}
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
                {editor.readOnly ? (
                  <p>This board can’t be changed from here, so the assistant answers questions about it but won’t change it.</p>
                ) : (
                  <p>
                    Ask about this board, or ask for changes. Changes are <strong>previewed</strong> on the board first, and every applied change can be undone from{' '}
                    <button className="link" onClick={() => setTab('history')}>
                      History
                    </button>
                    . The conversation goes with you to your other boards and wikis.
                  </p>
                )}
              </div>
            )}
            {turns.map((t, k) => (
              <Fragment key={k}>
                {t.role === 'user' && t.where && t.where.key !== turns.slice(0, k).findLast((x) => x.role === 'user')?.where?.key && (
                  <div className="ai-where">
                    {t.where.kind === 'wiki' ? '📘' : '📋'} {t.where.title}
                  </div>
                )}
                {t.role === 'user' ? (
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
                    {t.text && <RichText text={t.text} onObject={go} onLink={follow} />}
                    {t.proposals.map((p) => (
                      <ProposalCard
                        key={p.id}
                        p={p}
                        away={p.target ? null : awayOf(t)}
                        onGo={goTo(awayOf(t))}
                        undone={!!editor.aiHistory.find((c) => c.id === p.id)?.undone}
                        onApply={() => apply(p)}
                        onDiscard={() => {
                          p.status = 'discarded'
                          if (editor.aiPreview?.id === p.id) editor.previewAi(null)
                          refresh()
                        }}
                        onUndo={() => editor.toggleAiChange(p.id)}
                        onOpen={() => p.opened && void ws.switchTo(p.opened)}
                        onHover={(on) => {
                          if (p.status !== 'pending' || p.target || awayOf(t)) return
                          editor.previewAi(on ? p : (latestPending ?? null))
                        }}
                      />
                    ))}
                  </div>
                )}
              </Fragment>
            ))}
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
            {QUICK.filter((q) => (!q.needs || editor.selection.size) && !(q.changes && editor.readOnly)).map((q) => (
              <button key={q.label} disabled={running} onClick={() => void send(q.prompt)}>
                {q.label}
              </button>
            ))}
          </div>

          <form
            className="ai-compose"
            onSubmit={(e) => {
              e.preventDefault()
              ask()
            }}
          >
            {picker.list}
            <textarea
              ref={area}
              autoFocus
              value={input}
              rows={2}
              aria-label="Ask the assistant"
              placeholder={editor.selection.size ? `Ask about the ${editor.selection.size} selected…` : 'Ask anything… (@ an object, [[ a page or board)'}
              onChange={(e) => {
                setInput(e.target.value)
                picker.track(e.target)
              }}
              onSelect={(e) => picker.track(e.target as HTMLTextAreaElement)}
              onPaste={picker.onPaste}
              onKeyDown={(e) => {
                // Typing stays here; Ctrl shortcuts (Ctrl J to close, Ctrl K to search) still work.
                if (!(e.ctrlKey || e.metaKey)) e.stopPropagation()
                if (picker.onKey(e)) return
                if (e.key === 'Escape' && !running) onClose()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask()
                }
              }}
            />
            <div className="ai-compose-foot">
              <small className="muted" title={state?.assistant ? usageTitle(state.assistant.usage) : undefined}>
                {connection ? makeBackend(connection, settings.model).label : ''}
                {state?.assistant && usageLine(state.assistant.usage)}
              </small>
              {turns.length > 0 && !running && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    // Starts over everywhere (it's one conversation), and forgets the kept copy.
                    clearTimeout(saving)
                    if (thread) {
                      thread.turns = []
                      thread.kept = null
                      thread.assistant?.reset()
                    }
                    void forgetThread(keeper)
                    editor.previewAi(null)
                    refresh()
                  }}
                >
                  New chat
                </button>
              )}
              {!talk.on && onFlow && (
                <button
                  type="button"
                  className="talk-btn"
                  disabled={!connection || editor.readOnly || !talk.how || isWiki(editor.board)}
                  title="Flowstate: just the board, built as you talk (Ctrl Shift F)"
                  onClick={() => onFlow(true)}
                >
                  Flowstate
                </button>
              )}
              {!talk.on && (
                <button
                  type="button"
                  className="talk-btn"
                  disabled={!connection || editor.readOnly || !talk.how}
                  title={
                    !talk.how
                      ? 'This browser can’t hear you here: the server needs speech to text (BRAINCRAFT_TRANSCRIBE_URL), or use Chrome, Edge or Safari'
                      : 'Talk: the assistant builds the board as you speak, no need to send'
                  }
                  onClick={() => void talk.start()}
                >
                  🎙 Talk
                </button>
              )}
              {running && !talk.on ? (
                <button type="button" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              ) : (
                !talk.on && (
                  <button className="primary" type="submit" disabled={!input.trim()}>
                    Send
                  </button>
                )
              )}
            </div>
            {talk.error && <p className="talk-error">{talk.error}</p>}
          </form>
          {talk.on && (
            <div className="talk-bar" role="status" aria-live="polite">
              <span className={`talk-dot${talk.muted ? ' muted' : ''}`} aria-hidden="true" />
              <span className="talk-level" aria-hidden="true">
                <i style={{ transform: `scaleX(${Math.max(0.04, talk.level)})` }} />
              </span>
              <span className="talk-words">
                {talk.interim || talk.waiting ? (
                  <>
                    {talk.waiting} <span className="muted">{talk.interim}</span>
                  </>
                ) : (
                  <span className="muted">{talk.muted ? 'Muted: not listening until you unmute' : running ? 'Working on what you said… keep talking' : talk.state === 'transcribing' ? 'Hearing that…' : 'Listening: just talk'}</span>
                )}
              </span>
              {talk.waiting && (
                <button type="button" className="link" onClick={() => talk.flush()}>
                  Go now
                </button>
              )}
              <button type="button" className="link" aria-pressed={talk.muted} onClick={() => talk.mute(!talk.muted)}>
                {talk.muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" className="primary" onClick={() => talk.stop()}>
                Stop talking
              </button>
            </div>
          )}
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
                    {!editor.readOnly && <button onClick={() => editor.toggleAiChange(c.id)}>{c.undone ? 'Redo' : 'Undo'}</button>}
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
