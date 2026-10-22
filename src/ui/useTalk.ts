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

  const stop = () => {
    ear.current?.stop()
    ear.current = null
    turns.current?.stop(true)
    turns.current = null
    setOn(false)
    setInterim('')
    setLevel(0)
  }

  const start = async () => {
    setError(null)
    const how = hearingFor(latest.current)
    if (!how) {
      setError('This browser can’t hear you without the server’s speech to text (ask whoever runs it to set BRAINCRAFT_TRANSCRIBE_URL), or use Chrome, Edge or Safari.')
      return
    }
    const u = new Utterances(async (text) => {
      setTick((t) => t + 1)
      await latest.current.say(text)
      setTick((t) => t + 1)
    })
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
      error: (message: string) => {
        setError(message)
        stop()
      },
    }
    try {
      if (how === 'server') {
        const { server, password } = latest.current
        ear.current = await serverEar(
          {
            lang,
            transcribe: async (audio) => {
              const res = await fetch(new URL(`api/ai/transcribe?lang=${encodeURIComponent(lang)}`, server!.endsWith('/') ? server! : `${server}/`), {
                method: 'POST',
                body: audio,
                credentials: 'include',
                headers: { 'content-type': audio.type || 'audio/webm', 'x-braincraft': '1', ...(password ? { 'x-braincraft-ai-password': password } : {}) },
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
      stop()
    }
  }

  // Closing the panel stops listening.
  useEffect(() => () => stop(), [])

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
