/**
 * Flowstate: the board alone on screen while you talk it into shape. The assistant's few words
 * float at the top as it works; what you're saying shows faintly at the bottom; nothing else.
 * Esc (or leaving full screen) ends it.
 */

import { useEffect, useRef, useState } from 'react'

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
  /** Why it can't work right now, if it can't. */
  problem: string | null
  onLeave: () => void
}) {
  const { lines, waiting, interim, level, listening, problem, onLeave } = props
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
      </div>
      {/* The sign it's hearing you: a soft light along the bottom that breathes, and rises as you speak. */}
      <div ref={glow} className={`flow-glow${listening ? ' on' : ''}`} aria-hidden="true" />

      <div className={`flow-leave${awake ? ' awake' : ''}`}>
        <button type="button" onClick={onLeave}>
          Leave Flowstate <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  )
}
