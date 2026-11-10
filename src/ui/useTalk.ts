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
  /** The server tells voices apart (see server/speakers.ts). */
  serverVoices?: boolean
  say(text: string): Promise<void>
}

/** A voice heard in this conversation, and what it's called. */
export interface HeardVoice {
  n: number
  name: string
}

/** Who said a phrase, as the assistant reads it: only once there's more than one voice. */
export function voiceLine(text: string, voice: number | undefined, voices: readonly HeardVoice[]): string {
  if (voice === undefined || voices.length < 2) return text
  const name = voices.find((v) => v.n === voice)?.name ?? `Voice ${voice}`
  return `[${name}] ${text}`
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
  const [muted, setMuted] = useState(false)
  const [, setTick] = useState(0)
  /** The voices heard so far in this conversation, in the order they were first heard. */
  const [voices, setVoices] = useState<HeardVoice[]>([])
  const voicesRef = useRef<HeardVoice[]>([])
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
    setMuted(false)
    setInterim('')
    setLevel(0)
    if (!send) u?.stop()
    void (e?.stop() ?? Promise.resolve()).finally(() => send && u?.stop(true))
  }

  const start = async () => {
    setError(null)
    setMuted(false)
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
    // Each time it starts is a conversation of its own, with its own voices.
    const conversation = Math.random().toString(36).slice(2, 12)
    voicesRef.current = []
    setVoices([])
    const hearing = {
      final: (text: string, voice?: number) => {
        setInterim('')
        let line = text
        if (voice !== undefined && !voicesRef.current.some((v) => v.n === voice)) {
          const first = voicesRef.current.length === 1 ? voicesRef.current[0] : null
          voicesRef.current = [...voicesRef.current, { n: voice, name: `Voice ${voice}` }]
          setVoices(voicesRef.current)
          // A second voice: what was said before it was all the first one's.
          if (first) u.heard(`[Until now, everything was said by ${first.name}.]`)
        }
        line = voiceLine(line, voice, voicesRef.current)
        u.heard(line)
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
            transcribe: async (audio, preview) => {
              const voicesToo = latest.current.serverVoices && !preview ? `&voices=${conversation}` : ''
              const res = await fetch(new URL(`api/ai/transcribe?lang=${encodeURIComponent(lang)}${voicesToo}`, server!.endsWith('/') ? server! : `${server}/`), {
                method: 'POST',
                body: audio,
                credentials: 'include',
                headers: { 'content-type': audio.type || 'audio/wav', 'x-braincraft': '1', ...(password ? { 'x-braincraft-ai-password': password } : {}) },
              })
              const out = (await res.json().catch(() => ({}))) as { text?: string; voice?: number; error?: string }
              if (!res.ok) throw new Error(out.error ?? `Speech to text failed (${res.status})`)
              return { text: out.text ?? '', ...(typeof out.voice === 'number' ? { voice: out.voice } : {}) }
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
    /** The voices heard in this conversation (two or more: a meeting). */
    voices,
    /** Names a voice; the assistant hears it, and changes the voice to the name on the board. */
    nameVoice: (n: number, name: string) => {
      const was = voicesRef.current.find((v) => v.n === n)
      const clean = name.replace(/[[\]\n]+/g, ' ').trim().slice(0, 40)
      if (!was || !clean || clean === was.name) return
      voicesRef.current = voicesRef.current.map((v) => (v.n === n ? { ...v, name: clean } : v))
      setVoices(voicesRef.current)
      turns.current?.heard(`[${was.name} is ${clean}]`)
      setTick((t) => t + 1)
    },
    muted,
    /** Stops hearing for now (what was said up to then still goes), or starts again. */
    mute: (quiet: boolean) => {
      if (!ear.current) return
      ear.current.mute(quiet)
      setMuted(quiet)
      if (quiet) {
        setInterim('')
        setLevel(0)
      }
    },
    how: hearingFor(o),
  }
}
