/**
 * Flowstate: the board alone on screen while you talk it into shape. The rest fades away; the
 * assistant's few words float at the top as it works; what you're saying shows faintly at the
 * bottom. It stays in the window unless you ask for full screen. Esc ends it.
 *
 * Meeting notes is Flowstate hearing a meeting: the assistant takes the notes, a small sign at the
 * top left says it's listening and for how long (or how far through a recording it is), the agenda
 * shows under it with what's been covered, and Esc ends the meeting: what to keep is asked, then
 * the notes are finished and framed, and it leaves.
 *
 * Guided is Flowstate with the assistant asking the questions: the one it asks now shows large.
 */

import { useEffect, useRef, useState } from 'react'
import type { AgendaItem, MeetingPicks } from '../model/meeting'
import { flowFullScreen } from './flowFullScreen'
import { PushToMute } from './pushToMute'
import { useEditor } from './useEditor'

/** Typing somewhere (a sticky being edited, a field), where Space is a space. */
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || !!t.closest('.flow-picks'))

export interface FlowLine {
  key: string
  text: string
  state: 'working' | 'done' | 'error'
}

/** A reply as plain words: links to objects and pages read as their names. */
export function plainLine(text: string): string {
  return text
    .replace(/@?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Minutes and seconds since `from` ("12:04", or "1:02:09" past an hour). */
export function elapsed(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`
}

/** The question the assistant asks now, in a guided session: the last line of its latest words that asks one. */
export function askedLast(turns: readonly { role: string; text: string }[]): string | null {
  const last = [...turns].reverse().find((t) => t.role === 'assistant' && t.text.trim())
  if (!last) return null
  // Each line on its own (plainLine runs everything together, so a mark it keeps stands between them).
  const lines = plainLine(last.text.replace(/\n+/g, ' \u00b6 '))
    .split('\u00b6')
    .map((l) => l.trim())
    .filter(Boolean)
  for (const line of lines.reverse()) {
    const asks = line.match(/[^.!?]*\?/g)
    if (asks?.length) return asks[asks.length - 1].trim()
  }
  return null
}

/** What to keep from a meeting, as last chosen in this browser. */
function lastPicks(): MeetingPicks {
  try {
    const v = JSON.parse(localStorage.getItem('braincraft.meetingPicks') ?? 'null') as Partial<MeetingPicks> | null
    if (v && typeof v === 'object') return { collage: v.collage !== false, kanban: v.kanban !== false, notes: v.notes !== false }
  } catch {
    // Not kept here: everything, as at first.
  }
  return { collage: true, kanban: true, notes: true }
}

const PICKS: { key: keyof MeetingPicks; label: string; hint: string }[] = [
  { key: 'collage', label: 'Idea collage', hint: 'The ideas placed as they fit best: flows, sequences, timelines' },
  { key: 'kanban', label: 'Kanban', hint: 'A card for each action, with who and when' },
  { key: 'notes', label: 'Notes', hint: 'The mind map of every point, and the decisions and actions' },
]

/** Asked when a meeting ends: what to keep. The transcript is always kept. */
function MeetingPicker({ onPick }: { onPick: (p: MeetingPicks) => void }) {
  const [picks, setPicks] = useState(lastPicks)
  const go = () => {
    try {
      localStorage.setItem('braincraft.meetingPicks', JSON.stringify(picks))
    } catch {
      // Asked again next time.
    }
    onPick(picks)
  }
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  // Enter finishes, wherever the focus is (it may have stayed on the board).
  const latest = useRef(go)
  latest.current = go
  useEffect(() => {
    const enter = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.repeat) return
      const t = e.target as HTMLElement | null
      // A button elsewhere (Leave now) does its own thing.
      if (t?.closest?.('button') && !t.closest('.flow-picks')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      latest.current()
    }
    window.addEventListener('keydown', enter, true)
    return () => window.removeEventListener('keydown', enter, true)
  }, [])
  return (
    <form
      className="flow-picks"
      aria-label="What to keep from the meeting"
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
    >
      <h2>What should the meeting leave on the board?</h2>
      {PICKS.map((p) => (
        <label key={p.key}>
          <input type="checkbox" checked={picks[p.key]} onChange={(e) => setPicks({ ...picks, [p.key]: e.target.checked })} />
          <span>
            <b>{p.label}</b>
            <small>{p.hint}</small>
          </span>
        </label>
      ))}
      <p>The transcript is always kept, with a summary, and the meeting can be played back.</p>
      <button ref={first} type="submit" className="primary">
        Finish the notes <kbd>Enter</kbd>
      </button>
    </form>
  )
}

/** The meeting's agenda, with what's been covered so far. */
function Agenda({ items }: { items: readonly AgendaItem[] }) {
  if (!items.length) return null
  return (
    <section className="flow-agenda" aria-label="Agenda">
      <h2>Agenda</h2>
      <ol>
        {items.map((a, k) => (
          <li key={k} className={a.covered ? 'covered' : undefined}>
            <i aria-hidden="true">{a.covered ? '✓' : ''}</i>
            <span>{a.text}</span>
            {a.covered && <span className="sr-only"> (covered)</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

interface MeetingProps {
  started: number
  ending: boolean
  /** What to keep has been chosen (so the notes are being finished). */
  picked: boolean
  onPick: (p: MeetingPicks) => void
  people: number | null
  onPeople?: (n: number | null) => void
  /** From a recording: its name, and how far through it is (ms). */
  recording: { name: string; done: number; length: number } | null
  agenda: readonly AgendaItem[]
}

/** The sign that a meeting is being heard: how long for, and how many people are in it (or how far through a recording). */
function MeetingSign({ started, ending, picked, people, onPeople, listening, recording }: Pick<MeetingProps, 'started' | 'ending' | 'picked' | 'people' | 'onPeople' | 'recording'> & { listening: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const read = recording && recording.length ? Math.min(1, recording.done / recording.length) : 0
  return (
    <div className={`flow-meeting${listening && !ending ? ' on' : ''}`} role="status" aria-label="Meeting notes">
      <i aria-hidden="true" />
      <span>{ending ? (picked ? 'Finishing the notes…' : recording ? 'The recording is over' : 'The meeting is over') : recording ? `Notes from ${recording.name}` : 'Meeting notes'}</span>
      {!ending &&
        (recording ? (
          <time title="How far through the recording">
            {recording.length ? `${elapsed(0, recording.done)} of ${elapsed(0, recording.length)}` : 'Reading…'}
          </time>
        ) : (
          <time>{elapsed(started, now)}</time>
        ))}
      {recording && !ending && <b className="flow-read" style={{ ['--read' as string]: read }} aria-hidden="true" />}
      {onPeople && !ending && (
        <label title="With the number of people, voices are never split into more people than there are">
          People
          <select value={people ?? ''} onChange={(e) => onPeople(e.target.value ? Number(e.target.value) : null)} onKeyDown={(e) => e.stopPropagation()}>
            <option value="">Not sure</option>
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

export function Flowstate(props: {
  lines: FlowLine[]
  /** Said and waiting to go; still being said. */
  waiting: string
  interim: string
  level: number
  listening: boolean
  muted: boolean
  onMute: (quiet: boolean) => void
  /** Why it can't work right now, if it can't. */
  problem: string | null
  onLeave: () => void
  /** In a meeting, the voices heard, to name them. */
  voices?: React.ReactNode
  /** Meeting notes: when it started, whether it's being wrapped up, how many people are in it (when the server tells voices apart), its agenda. */
  meeting?: MeetingProps
  /** Guided: the question the assistant asks now. */
  question?: string | null
}) {
  const { lines, waiting, interim, level, listening, muted, onMute, problem, onLeave, voices, meeting, question } = props
  const editor = useEditor()

  // Space mutes: a tap mutes or unmutes, holding mutes while held. It takes Space before the
  // canvas does (Space-drag pans elsewhere; here pan with the middle button or a scroll).
  const latest = useRef({ muted, onMute })
  latest.current = { muted, onMute }
  useEffect(() => {
    const ptm = new PushToMute({ get: () => latest.current.muted, set: (m) => latest.current.onMute(m) })
    const mine = (e: KeyboardEvent) => e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !editor.editing && !typing(e.target)
    const down = (e: KeyboardEvent) => {
      if (!mine(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.repeat) ptm.down()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      e.stopImmediatePropagation()
      ptm.up()
    }
    const away = () => ptm.cancel()
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', away)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', away)
    }
  }, [editor])
  // How to leave shows at first, and again whenever the pointer moves.
  const [awake, setAwake] = useState(true)
  useEffect(() => {
    let t = setTimeout(() => setAwake(false), 5000)
    const wake = () => {
      setAwake(true)
      clearTimeout(t)
      t = setTimeout(() => setAwake(false), 2500)
    }
    window.addEventListener('pointermove', wake)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointermove', wake)
    }
  }, [])

  // The light follows your voice like breath: it rises quickly as you speak and settles slowly,
  // smoothed every frame (straight onto the element, without re-rendering).
  const glow = useRef<HTMLDivElement>(null)
  const target = useRef(0)
  target.current = Math.min(1, level * 1.4)
  useEffect(() => {
    let v = 0
    let raf = 0
    const tick = () => {
      const t = target.current
      v += (t - v) * (t > v ? 0.14 : 0.025)
      if (v < 0.001) v = 0
      glow.current?.style.setProperty('--level', v.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const [full, setFull] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const changed = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  // Guided: the question shows on its own, large, rather than inside the words around it.
  const shown = lines.slice(-3).map((l) => (question && l.text.includes(question) ? { ...l, text: l.text.replace(question, '').trim() } : l))
  const asking = question && meeting === undefined ? question : null
  return (
    <div className="flow no-canvas" role="region" aria-label="Flowstate">
      <div className="flow-replies" aria-live="polite">
        {asking && <p className="flow-question">{asking}</p>}
        {shown.map((l, i) => (
          <p key={l.key} className={`flow-line ${l.state}${i < shown.length - 1 || asking ? ' older' : ''}`} hidden={!l.text && l.state !== 'working'}>
            {l.text || (
              <span className="flow-dots" aria-label="Working">
                <i />
                <i />
                <i />
              </span>
            )}
          </p>
        ))}
        {problem && <p className="flow-line error">{problem}</p>}
        {!shown.length && !problem && !asking && (
          <p className="flow-line hint">
            {meeting?.recording
              ? 'Reading the recording. The notes build up here as it goes: ideas, decisions, and the flows and timelines people describe.'
              : meeting
                ? 'Listening to the meeting. The notes build up here as people talk: ideas, decisions, and the flows and timelines they describe.'
                : editor.guide
                  ? 'Thinking of a first question…'
                  : 'Just talk. Ask for a mind map, a flowchart, a plan… and keep going.'}
          </p>
        )}
      </div>

      {meeting && <MeetingSign {...meeting} listening={(listening || !!meeting.recording) && !muted} />}
      {meeting && !meeting.ending && <Agenda items={meeting.agenda} />}
      {meeting?.ending && !meeting.picked && <MeetingPicker onPick={meeting.onPick} />}

      <div className="flow-voice">
        {voices}
        {(waiting || interim) && (
          <p className="flow-words">
            {waiting} <span>{interim}</span>
          </p>
        )}
        {listening && muted && <p className="flow-muted">{meeting?.recording ? 'Paused. Tap Space to read on.' : 'Muted. Tap Space to listen again.'}</p>}
      </div>
      {/* The sign it's hearing you: a soft light along the bottom that breathes, and rises as you speak. */}
      <div ref={glow} className={`flow-glow${listening && !muted ? ' on' : ''}`} aria-hidden="true" />

      <div className={`flow-leave${awake ? ' awake' : ''}`}>
        {listening && (
          <button type="button" onClick={() => onMute(!muted)} aria-pressed={muted}>
            {meeting?.recording ? (muted ? 'Read on' : 'Pause') : muted ? 'Unmute' : 'Mute'} <kbd>Space</kbd>
          </button>
        )}
        {document.fullscreenEnabled && (
          <button type="button" onClick={() => flowFullScreen(!full)} aria-pressed={full}>
            {full ? 'Leave full screen' : 'Full screen'}
          </button>
        )}
        <button type="button" onClick={onLeave}>
          {meeting ? (meeting.ending ? 'Leave now' : meeting.recording ? 'Stop here' : 'End meeting') : editor.guide ? 'Stop' : 'Leave Flowstate'} <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  )
}
