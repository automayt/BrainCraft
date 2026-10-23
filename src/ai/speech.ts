/**
 * Hearing the person, in Firefox, Chrome and Safari. Two ways:
 *
 * - Recorded here, transcribed by the server (`server`): the microphone's sound is cut into
 *   phrases at the speaker's pauses (ai/phrases.ts) and each goes to the BrainCraft server as
 *   16 kHz WAV, which passes it to a speech-to-text model such as Whisper. Works the same in every
 *   browser; used whenever the server has speech to text set up. With previews on, the phrase is
 *   also transcribed while it's being said, to show the words straight away.
 * - The browser's own recognition (`browser`): Chrome, Edge and Safari have one (Firefox only
 *   behind a setting); it shows words as they're said. Used when the server has none.
 */

import { Downsampler, Phrases, wav } from './phrases'

export interface Hearing {
  /** A finished phrase. */
  final(text: string): void
  /** Words still being said. */
  interim?(text: string): void
  /** The sound level, 0–1, for a meter. */
  level?(v: number): void
  /** What it's doing: listening, or turning a phrase into words. */
  state?(s: 'listening' | 'transcribing'): void
  /** A phrase is being said or turned into words: more is coming, so the turn should wait. */
  holding?(on: boolean): void
  error(message: string): void
}

export interface Ear {
  readonly kind: 'server' | 'browser'
  /** Stops listening; resolves once what was being said has been heard. */
  stop(): Promise<void>
  /** Stops hearing for now (what was said up to then still counts), or starts again. */
  mute(quiet: boolean): void
}

type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

const recognitionClass = (): (new () => Recognition) | null => {
  const w = globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Whether this browser can take the microphone's sound (every current browser, on https or localhost). */
export const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined'

/** Whether this browser recognises speech itself (Chrome, Edge, Safari; Firefox behind a setting). */
export const canRecognise = () => !!recognitionClass()

/** Words, not silence or noise (which come back as nothing, or a stray mark or two). */
const words = (text: string) => /[\p{L}\p{N}]/u.test(text)

/** The browser's own recognition, kept going until stopped (it ends itself after a silence). */
export function browserEar(lang: string, on: Hearing): Ear {
  const Rec = recognitionClass()!
  let stopped = false
  let muted = false
  let ended: (() => void) | null = null
  const r = new Rec()
  r.continuous = true
  r.interimResults = true
  r.lang = lang
  r.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      if (res.isFinal) on.final(res[0].transcript)
      else interim += res[0].transcript
    }
    on.interim?.(interim)
  }
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return
    stopped = true
    on.error(e.error === 'not-allowed' ? 'The microphone isn’t allowed for this page' : `Speech recognition stopped (${e.error})`)
  }
  r.onend = () => {
    if (stopped) ended?.()
    else if (!muted) r.start()
  }
  r.start()
  on.state?.('listening')
  return {
    kind: 'browser',
    stop() {
      stopped = true
      // The last words arrive before it ends.
      const done = new Promise<void>((ok) => {
        ended = ok
        setTimeout(ok, 2000)
      })
      r.stop()
      return done
    },
    mute(quiet) {
      if (quiet === muted || stopped) return
      muted = quiet
      if (quiet) r.stop()
      else tryStart()
    },
  }
  function tryStart() {
    try {
      r.start()
    } catch {
      // Still ending: it starts again from onend.
    }
  }
}

export interface ServerEarOptions {
  /** Sends a recording (WAV) to be turned into words; resolves with them. */
  transcribe(audio: Blob): Promise<string>
  /** A pause this long ends a phrase. */
  pauseMs?: number
  /** Shows the words while they're being said, by transcribing the phrase so far about once a second. */
  preview?: boolean
}

/** Runs on the audio thread: passes the microphone's sound on in batches. */
const TAP = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(2048); this.n = 0 }
    }
    return true
  }
}
registerProcessor('braincraft-tap', Tap)`

/**
 * Listens through the server: the sound is cut into phrases, each sent as WAV and turned into
 * words. Phrases are transcribed side by side but heard in the order they were said.
 */
export async function serverEar(o: ServerEarOptions, on: Hearing): Promise<Ear> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
  // At the microphone's own rate (Firefox won't connect a microphone to a context at another),
  // brought down to 16 kHz here.
  const ctx = new AudioContext()
  let node: AudioWorkletNode
  try {
    const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    node = new AudioWorkletNode(ctx, 'braincraft-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' })
  } catch (err) {
    for (const t of stream.getTracks()) t.stop()
    void ctx.close()
    throw err
  }
  const source = ctx.createMediaStreamSource(stream)
  // Silent, but connected, so the audio thread keeps running it.
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(node)
  node.connect(mute).connect(ctx.destination)
  if (ctx.state === 'suspended') await ctx.resume()

  const down = new Downsampler(ctx.sampleRate)
  let stopped = false
  let muted = false
  /** Phrases begun and not yet heard (or dropped). */
  let open = 0
  const opened = () => {
    if (!open++) on.holding?.(true)
  }
  const closed = () => {
    if (!--open) {
      on.state?.('listening')
      on.holding?.(false)
    }
  }
  /** Phrases are heard in the order they were said, whichever is transcribed first. */
  let delivered: Promise<void> = Promise.resolve()
  let previewing = false

  const phrases = new Phrases(
    { pauseMs: o.pauseMs, previewMs: o.preview ? 1000 : 0 },
    {
      started: opened,
      dropped: closed,
      level: (v) => on.level?.(v),
      phrase: (audio) => {
        on.state?.('transcribing')
        const text = o.transcribe(wav(audio))
        delivered = delivered.then(() =>
          text
            .then(
              (t) => {
                on.interim?.('')
                if (words(t)) on.final(t.trim())
              },
              (err: Error) => {
                if (!stopped) on.error(err.message)
              },
            )
            .finally(closed),
        )
      },
      // One at a time: when the server is slow, previews just come less often.
      preview: (audio, id) => {
        if (previewing || stopped) return
        previewing = true
        o.transcribe(wav(audio))
          .then((t) => {
            if (!stopped && phrases.id === id && words(t)) on.interim?.(t.trim())
          })
          .catch(() => {})
          .finally(() => (previewing = false))
      },
    },
  )
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (!stopped && !muted) phrases.feed(down.push(e.data))
  }
  on.state?.('listening')

  return {
    kind: 'server',
    stop() {
      // What was being said when stopped still counts.
      phrases.end()
      stopped = true
      node.port.onmessage = null
      source.disconnect()
      for (const t of stream.getTracks()) t.stop()
      void ctx.close()
      return delivered
    },
    mute(quiet) {
      if (quiet === muted || stopped) return
      // What was said before muting still goes.
      if (quiet) phrases.end()
      muted = quiet
      on.level?.(0)
    },
  }
}
