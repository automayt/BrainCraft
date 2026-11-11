/**
 * A meeting played back: the board as it grew, step by step, with what was said appearing as it
 * was said and what the assistant noted at the top. Play, pause, drag to any moment, speed it up.
 * Space plays or pauses; Esc closes it.
 */

import { useEffect, useRef, useState } from 'react'
import { clock } from '../model/meeting'
import { useEditor } from './useEditor'

const SPEEDS = [1, 2, 4, 8, 16, 32]

export function MeetingReplay() {
  const editor = useEditor()
  const r = editor.replay
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(8)
  // Where it is, redrawn every frame here (the board itself changes only at each step).
  const [, setNow] = useState(0)
  const latest = useRef({ playing, speed })
  latest.current = { playing, speed }

  // Time moves on while playing, at its speed; at the end it stops.
  useEffect(() => {
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const rep = editor.replay
      if (rep && latest.current.playing) {
        const at = rep.at + dt * latest.current.speed
        editor.replayTo(at)
        setNow(at)
        if (at >= rep.record.length) setPlaying(false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [editor])

  const toggle = () => {
    // Played to the end: again from the start.
    const rep = editor.replay
    if (!playing && rep && rep.at >= rep.record.length) editor.replayTo(0)
    setPlaying(!playing)
  }

  // Space plays and pauses, Esc closes; nothing else reaches the board meanwhile.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const control = (e.target as Element | null)?.closest?.('button, input, select')
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        editor.stopReplay()
      } else if (e.key === ' ' && !control) {
        e.preventDefault()
        e.stopImmediatePropagation()
        toggle()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })

  if (!r) return null
  const { record, at } = r
  const said = record.lines.filter((l) => l.at <= at).slice(-3)
  const step = r.step > 0 ? record.steps[r.step - 1] : null
  const noted = step?.noted && at - step.at < 12_000 ? step.noted : null

  return (
    <div className="flow replay no-canvas" role="region" aria-label={`Replay of ${record.title}`}>
      <div className="flow-replies" aria-live="polite">
        <p className="replay-title">{record.title}</p>
        {noted && (
          <p key={r.step} className="flow-line">
            {noted}
          </p>
        )}
      </div>
      <div className="flow-voice">
        {said.length > 0 && (
          <ol className="replay-said">
            {said.map((l, k) => (
              <li key={`${l.at}:${k}`} className={k < said.length - 1 ? 'older' : undefined}>
                {l.who && <b>{l.who}</b>} {l.text}
              </li>
            ))}
          </ol>
        )}
        <div className="replay-bar">
          <button type="button" className="replay-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <rect x="2.5" y="2" width="3" height="10" rx="1" fill="currentColor" />
                <rect x="8.5" y="2" width="3" height="10" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M3.5 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5Z" fill="currentColor" />
              </svg>
            )}
          </button>
          <time>{clock(at)}</time>
          <input
            type="range"
            min={0}
            max={Math.max(1, record.length)}
            step={1000}
            value={Math.min(at, record.length)}
            onChange={(e) => {
              editor.replayTo(Number(e.target.value))
              setNow(Number(e.target.value))
            }}
            aria-label="Where in the meeting"
            style={{ ['--done' as string]: record.length ? Math.min(1, at / record.length) : 0 }}
          />
          <time>{clock(record.length)}</time>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button type="button" className="replay-close" onClick={() => editor.stopReplay()}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
