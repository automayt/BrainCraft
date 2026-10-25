/** Live moments over the board: floating emotes, cursor chat, the emote picker and the shared timer. */

import { useEffect, useRef, useState } from 'react'
import { toScreen } from '../model/camera'
import { REACTIONS } from '../model/reactions'
import { LiveViewerBanner } from './Boards'
import { CatchUpBanner } from './CatchUp'
import { WhatsNew } from './WhatsNew'
import { ServerNotice } from './ServerNotice'
import { useEditor } from './useEditor'

export const EMOTES = REACTIONS

function Bubble({ x, y, color, text, name }: { x: number; y: number; color: string; text: string; name?: string }) {
  return (
    <div className="chat-bubble" style={{ transform: `translate(${x + 16}px, ${y + 18}px)`, background: color }}>
      {name && <small>{name}</small>}
      {text}
    </div>
  )
}

function ChatInput({ x, y, color }: { x: number; y: number; color: string }) {
  const editor = useEditor()
  const [text, setText] = useState('')
  return (
    <form
      className="chat-bubble chat-input no-canvas"
      style={{ transform: `translate(${x + 16}px, ${y + 18}px)`, background: color }}
      onSubmit={(e) => {
        e.preventDefault()
        editor.say(text)
      }}
    >
      <input
        autoFocus
        value={text}
        maxLength={140}
        placeholder={editor.sendSignal ? 'Say something…' : 'Say something (others see it in a live session)'}
        aria-label="Cursor chat"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => editor.setChatting(false)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') editor.setChatting(false)
        }}
      />
    </form>
  )
}

function EmotePicker() {
  const editor = useEditor()
  const at = editor.emotePicker
  if (!at) return null
  return (
    <>
      <div className="scrim no-canvas" onPointerDown={() => editor.closeEmotePicker()} />
      <div className="emote-picker no-canvas" role="menu" aria-label="Send an emote" style={{ left: at.x, top: at.y }}>
        {EMOTES.map((e, k) => (
          <button key={e} role="menuitem" title={`${e}  (${k + 1})`} onClick={() => editor.emote(e)}>
            {e}
          </button>
        ))}
      </div>
    </>
  )
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A short two-note chime when the timer runs out. */
function chime() {
  try {
    const ctx = new AudioContext()
    for (const [k, freq] of [880, 1320].entries()) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, ctx.currentTime + k * 0.18)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + k * 0.18 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + k * 0.18 + 0.5)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + k * 0.18)
      o.stop(ctx.currentTime + k * 0.18 + 0.55)
    }
    setTimeout(() => void ctx.close(), 1500)
  } catch {
    // No sound, no matter.
  }
}

function TimerBadge() {
  const editor = useEditor()
  const t = editor.timer
  const [, tick] = useState(0)
  const [done, setDone] = useState<string | null>(null)
  const rang = useRef<number | null>(null)
  useEffect(() => {
    if (!t) return
    const id = setInterval(() => {
      tick((n) => n + 1)
      if (Date.now() >= t.endsAt && rang.current !== t.endsAt) {
        rang.current = t.endsAt
        chime()
        setDone(`Time’s up!`)
        editor.setTimer(null)
        setTimeout(() => setDone(null), 5000)
      }
    }, 250)
    return () => clearInterval(id)
  }, [t, editor])
  if (!t && !done) return null
  const left = t ? t.endsAt - Date.now() : 0
  // Screen readers hear the start, the last minute and the end, not every second.
  const say = done ?? (!t ? '' : left <= 60_000 ? 'One minute left' : `Timer: ${Math.round(t.totalMs / 60_000)} minutes`)
  return (
    <div className={`timer-badge no-canvas${done ? ' done' : ''}${t && left < 10_000 ? ' ending' : ''}`} role="timer">
      <span className="sr-only" aria-live="polite">
        {say}
      </span>
      {done ? (
        <strong>{done}</strong>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 9v4l2.5 2.5M9 2h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <strong>{mmss(left)}</strong>
          <span className="timer-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(0, Math.min(100, (100 * left) / t!.totalMs))}%` }} />
          </span>
          {/* The server only takes timer changes from people who can edit. */}
          {!editor.readOnly && (
            <>
              <button title="One more minute" onClick={() => editor.startTimer(Math.ceil(left / 1000) + 60)}>
                +1 min
              </button>
              <button title="Stop the timer" aria-label="Stop the timer" onClick={() => editor.startTimer(null)}>
                ×
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

export function Moments() {
  const editor = useEditor()
  const out: React.ReactNode[] = []
  for (const e of editor.emotes) {
    const s = toScreen(editor.camera, e.at)
    out.push(
      <div key={e.key} className="emote" style={{ left: s.x, top: s.y, ['--emote-color' as string]: e.color }}>
        {e.emoji}
      </div>,
    )
  }
  for (const [who, c] of editor.chats) {
    if (who === 'me') {
      if (!editor.pointer || editor.chatting) continue
      const s = toScreen(editor.camera, editor.pointer)
      out.push(<Bubble key="me" x={s.x} y={s.y} color={editor.myColor} text={c.text} />)
    } else {
      const p = editor.peers.get(who)
      if (!p?.cursor) continue
      const s = toScreen(editor.camera, p.cursor)
      out.push(<Bubble key={who} x={s.x} y={s.y} color={p.color} text={c.text} />)
    }
  }
  const me = editor.pointer ? toScreen(editor.camera, editor.pointer) : { x: editor.viewport.w / 2 - 120, y: editor.viewport.h / 2 }
  return (
    <>
      <div className="moments-layer">{out}</div>
      {editor.chatting && <ChatInput x={me.x} y={me.y} color={editor.myColor} />}
      <EmotePicker />
      {/* Clear of a side panel (comments, a page beside the board). */}
      <div className="top-stack" style={editor.rightInset ? { right: 76 + editor.rightInset } : undefined}>
        <LiveViewerBanner />
        <ServerNotice />
        {!editor.catchUp && <WhatsNew />}
        <CatchUpBanner />
        <TimerBadge />
      </div>
    </>
  )
}
