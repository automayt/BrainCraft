/**
 * Talking to the assistant: hears the person (see ai/speech.ts), gathers what they say into turns
 * at their pauses (ai/listen.ts) and hands each turn to `say`, one at a time.
 */

import { useEffect, useRef, useState } from 'react'
import { Utterances } from '../ai/listen'
import { fileEar } from '../ai/recording'
import { type CallInput, callInputs, canShareSound, captureCall, captureInput, echoRemovalWanted, wantEchoRemoval } from '../ai/callAudio'
import { browserEar, canRecognise, canRecord, type Ear, type Heard, type HeardFrom, serverEar } from '../ai/speech'

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
  /**
   * Hearing a meeting rather than someone talking to the assistant: longer stretches go at a time,
   * and the sound from the computer's speakers (the other people on a call) is kept.
   */
  meeting?: boolean
  /** How many people are in the meeting, when known: never more voices than that. */
  people?: number | null
  /** The person here, by name: once a call is heard too, what the microphone hears is theirs. */
  me?: string
  say(text: string): Promise<void>
  /** Each line as it's heard: who said it (a voice number), from a recording, when (ms into it), and whether some of it was unclear. */
  line?(l: { text: string; voice?: number; at?: number; unclear?: boolean }): void
  /**
   * What speech to text should know before each phrase: the names and terms in use, and what was
   * said just before (each phrase is heard on its own, and without this names come out garbled).
   */
  context?(): string
  /** Reading a recording: how far through it is (ms). */
  progress?(done: number, length: number): void
  /** A recording has all been heard. */
  ended?(): void
}

/** A voice heard in this conversation, and what it's called. */
export interface HeardVoice {
  n: number
  name: string
}

/** Who said a phrase, as the assistant reads it: only once there's more than one voice. */
export function voiceLine(text: string, voice: number | undefined, voices: readonly HeardVoice[]): string {
  if (voices.length < 2) return text
  if (voice === undefined) return `[Not sure who] ${text}`
  const name = voices.find((v) => v.n === voice)?.name ?? `Voice ${voice}`
  return `[${name}] ${text}`
}

/** A voice's own name, rather than the number it was given. */
const named = (v: HeardVoice) => !/^Voice \d+$/.test(v.name)

/**
 * Two voices found to be one person (`from` is `into` from now on): the voices as they are after,
 * and what the assistant is told so it can change the name on what it made.
 */
export function sameVoice(voices: readonly HeardVoice[], from: number, into: number): { voices: HeardVoice[]; told: string[] } {
  const a = voices.find((v) => v.n === from)
  if (!a || from === into) return { voices: [...voices], told: [] }
  const b = voices.find((v) => v.n === into)
  const name = b && named(b) ? b.name : named(a) ? a.name : (b?.name ?? `Voice ${into}`)
  const rest = voices.filter((v) => v.n !== from && v.n !== into)
  const after = [...rest, { n: into, name }].sort((x, y) => x.n - y.n)
  const told = [a.name, b?.name].filter((old): old is string => !!old && old !== name).map((old) => `[${old} is ${name}]`)
  return { voices: after, told }
}

/** How this browser can hear: through the server (any browser), its own recognition, or not at all. */
export function hearingFor(o: Pick<TalkOptions, 'server' | 'serverTranscribes'>): 'server' | 'browser' | null {
  if (o.server && o.serverTranscribes && canRecord()) return 'server'
  return canRecognise() ? 'browser' : null
}

/** Where the call's sound came from last time, in this browser. */
const CALL_FROM = 'braincraft.callFrom'
const lastCallFrom = (): string | null => {
  try {
    return localStorage.getItem(CALL_FROM)
  } catch {
    return null
  }
}

/** An address on the BrainCraft server. */
const serverUrl = (server: string, path: string) => new URL(path, server.endsWith('/') ? server : `${server}/`)

export function useTalk(o: TalkOptions) {
  const [on, setOn] = useState(false)
  const [level, setLevel] = useState(0)
  const [interim, setInterim] = useState('')
  const [state, setState] = useState<'listening' | 'transcribing'>('listening')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  /** The call's own sound, while it's heard too, and where from. */
  const [call, setCall] = useState<{ stream: MediaStream; label: string } | null>(null)
  /** Inputs the call's sound could come from, kept up to date while listening. */
  const [inputs, setInputs] = useState<CallInput[]>([])
  /** Echo removal: the call taken out of the microphone once it's heard too. On, unless turned off in this browser. */
  const [echo, setEcho] = useState(echoRemovalWanted)
  const echoRef = useRef(echo)
  echoRef.current = echo
  const [, setTick] = useState(0)
  /** The voices heard so far in this conversation, in the order they were first heard. */
  const [voices, setVoices] = useState<HeardVoice[]>([])
  const voicesRef = useRef<HeardVoice[]>([])
  /** Voices found to be someone already heard: each is that one from then on. */
  const same = useRef(new Map<number, number>())
  const whose = (n: number): number => {
    for (let k = 0, at = n; k < 20; k++) {
      const next = same.current.get(at)
      if (next === undefined) return at
      at = next
    }
    return n
  }
  /** Names the server gave voices before they were first heard here. */
  const known = useRef(new Map<number, string>())
  /** The conversation the server knows this talk's voices by. */
  const conversationRef = useRef('')
  /** A voice's name: the assistant hears it, and changes it on what it made. A name another voice has makes them one. */
  const callVoice = (n: number, name: string) => {
    n = whose(n)
    const was = voicesRef.current.find((v) => v.n === n)
    const clean = name.replace(/[[\]\n]+/g, ' ').trim().slice(0, 40)
    if (!was || !clean || clean === was.name) return
    // Someone else's name: the two were one person.
    const other = voicesRef.current.find((v) => v.n !== n && v.name.toLowerCase() === clean.toLowerCase())
    if (other) return merge(n, other.n)
    voicesRef.current = voicesRef.current.map((v) => (v.n === n ? { ...v, name: clean } : v))
    setVoices(voicesRef.current)
    turns.current?.heard(`[${was.name} is ${clean}]`)
    setTick((t) => t + 1)
  }
  /** Two voices are one person: the assistant hears so. */
  const merge = (from: number, into: number) => {
    from = whose(from)
    into = whose(into)
    if (from === into) return
    same.current.set(from, into)
    const { voices: after, told } = sameVoice(voicesRef.current, from, into)
    voicesRef.current = after
    setVoices(after)
    for (const t of told) turns.current?.heard(t)
    setTick((t) => t + 1)
  }
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
    setCall(null)
    setOn(false)
    setMuted(false)
    setInterim('')
    setLevel(0)
    if (!send) u?.stop()
    void (e?.stop() ?? Promise.resolve()).finally(() => send && u?.stop(true))
  }

  /** Starts listening, or, given a recording, reads that instead. */
  const start = async (recording?: File) => {
    setError(null)
    setMuted(false)
    const how = recording ? (latest.current.server && latest.current.serverTranscribes ? 'server' : null) : hearingFor(latest.current)
    if (!how) {
      setError(
        recording
          ? 'Notes from a recording need the server’s speech to text (ask whoever runs it to set BRAINCRAFT_TRANSCRIBE_URL).'
          : 'This browser can’t hear you without the server’s speech to text (ask whoever runs it to set BRAINCRAFT_TRANSCRIBE_URL), or use Chrome, Edge or Safari.',
      )
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
      // In a meeting, longer stretches at a time: enough said to make sense of.
      // A recording is read as fast as the notes keep up: a stretch at a time.
      recording ? { pauseMs: 500, maxWaitMs: 4000 } : latest.current.meeting ? { pauseMs: 2500, maxWaitMs: 30_000 } : { pauseMs: how === 'server' ? 300 : 1200 },
    )
    turns.current = u
    const lang = navigator.language || 'en-US'
    // Each time it starts is a conversation of its own, with its own voices.
    const conversation = Math.random().toString(36).slice(2, 12)
    conversationRef.current = conversation
    voicesRef.current = []
    same.current = new Map()
    known.current = new Map()
    setVoices([])
    const hearing = {
      merged: (pairs: [number, number][]) => {
        for (const [from, into] of pairs) merge(from, into)
      },
      // Someone the server knows: their name, now or once their voice is first heard here.
      named: (n: number, name: string) => {
        if (voicesRef.current.some((v) => v.n === whose(n))) {
          const v = voicesRef.current.find((x) => x.n === whose(n))!
          // A name given here stays.
          if (/^Voice \d+$/.test(v.name)) callVoice(n, name)
        } else known.current.set(n, name)
      },
      final: (text: string, heardAs?: number, at?: number, unclear?: boolean, from?: HeardFrom) => {
        setInterim('')
        // With the call heard too, the microphone is the person here: their own voice, numbered 0.
        if (from === 'me') {
          heardAs = 0
          if (!voicesRef.current.some((v) => v.n === 0)) known.current.set(0, (latest.current.me ?? '').replace(/[[\]\n]+/g, ' ').trim().slice(0, 40) || 'Me')
        }
        const voice = heardAs === undefined ? undefined : whose(heardAs)
        let line = text
        if (voice !== undefined && !voicesRef.current.some((v) => v.n === voice)) {
          const first = voicesRef.current.length === 1 ? voicesRef.current[0] : null
          const name = known.current.get(voice)
          // Already known by that name (the same person, numbered twice): one voice.
          const twin = name ? voicesRef.current.find((v) => v.name.toLowerCase() === name.toLowerCase()) : undefined
          if (twin) same.current.set(voice, twin.n)
          else {
            voicesRef.current = [...voicesRef.current, { n: voice, name: name ?? `Voice ${voice}` }]
            setVoices(voicesRef.current)
            // A second voice: what was said before it was all the first one's.
            if (first) u.heard(`[Until now, everything was said by ${first.name}.]`)
          }
        }
        const who = voice === undefined ? undefined : whose(voice)
        line = voiceLine(line, who, voicesRef.current)
        latest.current.line?.({ text, ...(who !== undefined ? { voice: who } : {}), ...(at !== undefined ? { at } : {}), ...(unclear ? { unclear: true } : {}) })
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
      const { server, password, serverPreviews } = latest.current
      const transcribe = async (audio: Blob, preview?: boolean, from?: HeardFrom): Promise<Heard> => {
        const { people } = latest.current
        const context = preview ? '' : (latest.current.context?.() ?? '').slice(-800)
        // The microphone's phrases are the person's own once the call is heard on its own: only the
        // call's voices are told apart (one fewer person among them).
        const others = from === 'call' && people ? Math.max(1, people - 1) : people
        const voicesToo = latest.current.serverVoices && !preview && from !== 'me' ? `&voices=${conversation}${others ? `&people=${others}` : ''}` : ''
        const res = await fetch(serverUrl(server!, `api/ai/transcribe?lang=${encodeURIComponent(lang)}${voicesToo}`), {
          method: 'POST',
          body: audio,
          credentials: 'include',
          headers: {
            'content-type': audio.type || 'audio/wav',
            'x-braincraft': '1',
            ...(password ? { 'x-braincraft-ai-password': password } : {}),
            ...(context ? { 'x-transcribe-context': encodeURIComponent(context) } : {}),
          },
        })
        const out = (await res.json().catch(() => ({}))) as { text?: string; voice?: number; name?: unknown; merged?: unknown; unclear?: unknown; error?: string }
        if (!res.ok) throw new Error(out.error ?? `Speech to text failed (${res.status})`)
        const merged = Array.isArray(out.merged) ? out.merged.filter((m): m is [number, number] => Array.isArray(m) && m.length === 2 && m.every((x) => Number.isInteger(x) && x > 0)) : []
        const name = typeof out.name === 'string' ? out.name.replace(/[[\]\n]+/g, ' ').trim().slice(0, 40) : ''
        return { text: out.text ?? '', ...(typeof out.voice === 'number' ? { voice: out.voice } : {}), ...(name ? { name } : {}), ...(merged.length ? { merged } : {}), ...(out.unclear === true ? { unclear: true } : {}) }
      }
      if (recording)
        ear.current = await fileEar(
          recording,
          {
            transcribe,
            progress: (done, length) => latest.current.progress?.(done, length),
            // Enough waiting for the assistant's next turn: read on once it's taken.
            backlog: () => (turns.current?.waiting.length ?? 0) > 2500,
            ended: () => latest.current.ended?.(),
          },
          hearing,
        )
      // In a meeting people pause mid-sentence more: a longer pause ends a phrase, so it keeps its sense.
      else if (how === 'server')
        ear.current = await serverEar({ preview: !!serverPreviews, meeting: !!latest.current.meeting, removeEcho: echoRef.current, transcribe, ...(latest.current.meeting ? { pauseMs: 1000 } : {}) }, hearing)
      else ear.current = browserEar(lang, hearing, echoRef.current)
      setOn(true)
    } catch (err) {
      const e = err as Error
      setError(
        recording
          ? `Couldn’t read ${recording.name}: ${e.name === 'EncodingError' ? 'this browser can’t read its sound (try an mp3, m4a, wav or mp4)' : e.message}`
          : e.name === 'NotAllowedError'
            ? 'The microphone isn’t allowed for this page (it needs https, or localhost)'
            : `Couldn’t start listening: ${e.message}`,
      )
      stop(false)
    }
  }

  // While listening (the microphone allowed, so inputs have their names), the inputs there are.
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!on || !md?.enumerateDevices) return
    let live = true
    const load = () =>
      void md
        .enumerateDevices()
        .then((d) => live && setInputs(callInputs(d)))
        .catch(() => {})
    load()
    md.addEventListener?.('devicechange', load)
    return () => {
      live = false
      md.removeEventListener?.('devicechange', load)
    }
  }, [on])

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
    /** Stops listening, and resolves once everything said has been heard and the assistant has had it all. */
    finish: async () => {
      const e = ear.current
      const u = turns.current
      ear.current = null
      turns.current = null
      setOn(false)
      setMuted(false)
      setInterim('')
      setLevel(0)
      await (e?.stop() ?? Promise.resolve()).catch(() => {})
      await u?.stop(true)
    },
    /** The voices heard in this conversation (two or more: a meeting). */
    voices,
    /** The server tells voices apart here. */
    voicesOn: hearingFor(o) === 'server' && !!o.serverVoices,
    /**
     * Names a voice; the assistant hears it, and changes the voice to the name on the board. The
     * server remembers the voice by that name, to know them in later meetings.
     */
    nameVoice: (n: number, name: string) => {
      const clean = name.replace(/[[\]\n]+/g, ' ').trim().slice(0, 40)
      if (!clean) return
      callVoice(n, clean)
      const { server, password, serverVoices } = latest.current
      if (server && serverVoices && conversationRef.current)
        void fetch(serverUrl(server, `api/ai/voices?voices=${conversationRef.current}`), {
          method: 'POST',
          body: JSON.stringify({ voice: n, name: clean }),
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-braincraft': '1', ...(password ? { 'x-braincraft-ai-password': password } : {}) },
        }).catch(() => {})
    },
    /**
     * A voice worked out from what was said ("Voice 2" is Sam, from "thanks, Sam" and the answer):
     * named for this meeting, unless it has a name already. The server isn't taught it, as nobody
     * named it.
     */
    guessVoice: (label: string, name: string) => {
      const v = voicesRef.current.find((x) => x.name.toLowerCase() === label.trim().toLowerCase())
      if (v && !named(v)) callVoice(v.n, name)
    },
    /** Where the call's sound is heard from, while it is: "a shared tab or screen", or an input's name. */
    call: call?.label ?? null,
    /** The call's sound could be shared here (Chrome and Edge). */
    canShare: on && canShareSound() && !!ear.current?.hearCall,
    /** Inputs the call's sound could come from (a loopback, Stereo Mix, a virtual cable…), while listening. */
    inputs: on && ear.current?.hearCall ? inputs : [],
    /** Where the call's sound came from last time, in this browser ("share", or an input). */
    lastCall: lastCallFrom(),
    /**
     * Hears the call's own sound too, from a share of the call's tab or the screen ("share") or from
     * an input; the microphone then keeps to the person's own voice.
     */
    hearCall: async (from: string) => {
      const e = ear.current
      if (!e?.hearCall) return
      let stream: MediaStream
      try {
        stream = from === 'share' ? await captureCall() : await captureInput(from)
      } catch (err) {
        const x = err as Error
        if (x.name !== 'NotAllowedError' && x.name !== 'AbortError') setError(from === 'share' ? x.message : `Couldn’t open that input: ${x.message}`)
        return
      }
      if (ear.current !== e) {
        for (const t of stream.getTracks()) t.stop()
        return
      }
      try {
        await e.hearCall(stream)
      } catch (err) {
        for (const t of stream.getTracks()) t.stop()
        setError(`Couldn’t hear the call: ${(err as Error).message}`)
        return
      }
      // Stopped listening meanwhile: the call went with it.
      if (ear.current !== e) return
      try {
        localStorage.setItem(CALL_FROM, from)
      } catch {
        // Asked again next time.
      }
      const label = from === 'share' ? 'a shared tab or screen' : (inputs.find((i) => i.id === from)?.label ?? 'another input')
      setCall({ stream, label })
      // Stopped from the browser's sharing bar, or the input unplugged: the call isn't heard any more.
      stream.getAudioTracks()[0].addEventListener('ended', () => setCall((c) => (c?.stream === stream ? null : c)))
    },
    /** Echo removal: whether the call is taken out of the microphone once it's heard too. */
    echo,
    /** Turns echo removal on or off, now and for next time in this browser. */
    setEcho: (remove: boolean) => {
      setEcho(remove)
      wantEchoRemoval(remove)
      void ear.current?.removeEcho?.(remove).catch((err: Error) => setError(`Couldn’t change the microphone: ${err.message}`))
    },
    /** What a voice is called now (after any merges and names). */
    nameOf: (n: number) => voicesRef.current.find((v) => v.n === whose(n))?.name ?? `Voice ${whose(n)}`,
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
