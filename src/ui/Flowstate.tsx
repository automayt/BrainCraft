/**
 * Flowstate: the board alone on screen while you talk it into shape. The rest fades away; the
 * assistant's few words float at the top as it works; what you're saying shows faintly at the
 * bottom. It stays in the window unless you ask for full screen. Esc ends it.
 *
 * Meeting notes is Flowstate hearing a meeting: the assistant takes the notes, a small sign at the
 * top left says it's listening and for how long, and Esc ends the meeting (the notes are finished
 * and framed, then it leaves).
 */

import { useEffect, useRef, useState } from 'react'
import { flowFullScreen } from './flowFullScreen'
import { PushToMute } from './pushToMute'
import { useEditor } from './useEditor'

/** Typing somewhere (a sticky being edited, a field), where Space is a space. */
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

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

/** The sign that a meeting is being heard: how long for, and how many people are in it. */
function MeetingSign({ started, ending, people, onPeople, listening }: { started: number; ending: boolean; people: number | null; onPeople?: (n: number | null) => void; listening: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className={`flow-meeting${listening && !ending ? ' on' : ''}`} role="status" aria-label="Meeting notes">
      <i aria-hidden="true" />
      <span>{ending ? 'Finishing the notes…' : 'Meeting notes'}</span>
      {!ending && <time>{elapsed(started, now)}</time>}
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
  /** Meeting notes: when it started, whether it's being wrapped up, and how many people are in it (when the server tells voices apart). */
  meeting?: { started: number; ending: boolean; people: number | null; onPeople?: (n: number | null) => void }
}) {
  const { lines, waiting, interim, level, listening, muted, onMute, problem, onLeave, voices, meeting } = props
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

  const shown = lines.slice(-3)
  return (
    <div className="flow no-canvas" role="region" aria-label="Flowstate">
      <div className="flow-replies" aria-live="polite">
        {shown.map((l, i) => (
          <p key={l.key} className={`flow-line ${l.state}${i < shown.length - 1 ? ' older' : ''}`}>
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
        {!shown.length && !problem && (
          <p className="flow-line hint">{meeting ? 'Listening to the meeting. The notes build up here as people talk: ideas, decisions, and the flows and timelines they describe.' : 'Just talk. Ask for a mind map, a flowchart, a plan… and keep going.'}</p>
        )}
      </div>

      {meeting && <MeetingSign {...meeting} listening={listening && !muted} />}

      <div className="flow-voice">
        {voices}
        {(waiting || interim) && (
          <p className="flow-words">
            {waiting} <span>{interim}</span>
          </p>
        )}
        {listening && muted && <p className="flow-muted">Muted. Tap Space to listen again.</p>}
      </div>
      {/* The sign it's hearing you: a soft light along the bottom that breathes, and rises as you speak. */}
      <div ref={glow} className={`flow-glow${listening && !muted ? ' on' : ''}`} aria-hidden="true" />

      <div className={`flow-leave${awake ? ' awake' : ''}`}>
        {listening && (
          <button type="button" onClick={() => onMute(!muted)} aria-pressed={muted}>
            {muted ? 'Unmute' : 'Mute'} <kbd>Space</kbd>
          </button>
        )}
        {document.fullscreenEnabled && (
          <button type="button" onClick={() => flowFullScreen(!full)} aria-pressed={full}>
            {full ? 'Leave full screen' : 'Full screen'}
          </button>
        )}
        <button type="button" onClick={onLeave}>
          {meeting ? (meeting.ending ? 'Leave now' : 'End meeting') : 'Leave Flowstate'} <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  )
}
