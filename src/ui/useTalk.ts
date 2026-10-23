/**
 * Talking to the assistant: hears the person (see ai/speech.ts), gathers what they say into turns
 * at their pauses (ai/listen.ts) and hands each turn to `say`, one at a time.
 */

import { useEffect, useRef, useState } from 'react'
import { Utterances } from '../ai/listen'
import { browserEar, canRecognise, canRecord, type Ear, serverEar } from '../ai/speech'

export interface TalkOptions {
  /** The BrainCraft server, when it turns speech into words. */
  server: string | null
  serverTranscribes: boolean
  /** The server also transcribes while you speak (words appear as they're said). */
  serverPreviews?: boolean
  /** The server's AI password, if it asks for one. */
  password?: string
  say(text: string): Promise<void>
}

/** How this browser can hear: through the server (any browser), its own recognition, or not at all. */
export function hearingFor(o: Pick<TalkOptions, 'server' | 'serverTranscribes'>): 'server' | 'browser' | null {
  if (o.server && o.serverTranscribes && canRecord()) return 'server'
  return canRecognise() ? 'browser' : null
}

export function useTalk(o: TalkOptions) {
  const [on, setOn] = useState(false)
  const [level, setLevel] = useState(0)
  const [interim, setInterim] = useState('')
  const [state, setState] = useState<'listening' | 'transcribing'>('listening')
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const ear = useRef<Ear | null>(null)
  const turns = useRef<Utterances | null>(null)
  const latest = useRef(o)
  latest.current = o

  /** Stops listening; what was being said still goes, once it's been heard (unless `send` is false). */
  const stop = (send = true) => {
    const e = ear.current
    const u = turns.current
    ear.current = null
    turns.current = null
    setOn(false)
    setInterim('')
    setLevel(0)
    if (!send) u?.stop()
    void (e?.stop() ?? Promise.resolve()).finally(() => send && u?.stop(true))
  }

  const start = async () => {
    setError(null)
    const how = hearingFor(latest.current)
    if (!how) {
      setError('This browser can’t hear you without the server’s speech to text (ask whoever runs it to set BRAINCRAFT_TRANSCRIBE_URL), or use Chrome, Edge or Safari.')
      return
    }
    const u = new Utterances(
      async (text) => {
        setTick((t) => t + 1)
        await latest.current.say(text)
        setTick((t) => t + 1)
      },
      // The server's phrases already end at a pause, and the turn holds while one is heard, so a
      // short wait is enough; the browser's own recognition gives less warning.
      { pauseMs: how === 'server' ? 300 : 1200 },
    )
    turns.current = u
    const lang = navigator.language || 'en-US'
    const hearing = {
      final: (text: string) => {
        setInterim('')
        u.heard(text)
        setTick((t) => t + 1)
      },
      interim: (text: string) => {
        setInterim(text)
        if (text) u.speaking()
      },
      level: setLevel,
      state: setState,
      holding: (on: boolean) => u.hold(on),
      error: (message: string) => {
        setError(message)
        stop(false)
      },
    }
    try {
      if (how === 'server') {
        const { server, password, serverPreviews } = latest.current
        ear.current = await serverEar(
          {
            preview: !!serverPreviews,
            transcribe: async (audio) => {
              const res = await fetch(new URL(`api/ai/transcribe?lang=${encodeURIComponent(lang)}`, server!.endsWith('/') ? server! : `${server}/`), {
                method: 'POST',
                body: audio,
                credentials: 'include',
                headers: { 'content-type': audio.type || 'audio/wav', 'x-braincraft': '1', ...(password ? { 'x-braincraft-ai-password': password } : {}) },
              })
              const out = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
              if (!res.ok) throw new Error(out.error ?? `Speech to text failed (${res.status})`)
              return out.text ?? ''
            },
          },
          hearing,
        )
      } else ear.current = browserEar(lang, hearing)
      setOn(true)
    } catch (err) {
      const e = err as Error
      setError(e.name === 'NotAllowedError' ? 'The microphone isn’t allowed for this page (it needs https, or localhost)' : `Couldn’t start listening: ${e.message}`)
      stop(false)
    }
  }

  // Closing the panel stops listening (what was being said is dropped).
  useEffect(() => () => stop(false), [])

  return {
    on,
    level,
    interim,
    state,
    error,
    /** Said and waiting to go to the assistant. */
    waiting: turns.current?.waiting ?? '',
    sending: turns.current?.sending ?? false,
    start,
    stop,
    /** Sends what's waiting now, without waiting for a pause. */
    flush: () => turns.current?.flush(),
    how: hearingFor(o),
  }
}
