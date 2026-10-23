/**
 * Flowstate: the board alone on screen while you talk it into shape. The assistant's few words
 * float at the top as it works; what you're saying shows faintly at the bottom; nothing else.
 * Esc (or leaving full screen) ends it.
 */

import { useEffect, useRef, useState } from 'react'
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
}) {
  const { lines, waiting, interim, level, listening, muted, onMute, problem, onLeave } = props
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
        {!shown.length && !problem && <p className="flow-line hint">Just talk. Ask for a mind map, a flowchart, a plan… and keep going.</p>}
      </div>

      <div className="flow-voice">
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
        <button type="button" onClick={onLeave}>
          Leave Flowstate <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  )
}
