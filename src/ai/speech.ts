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
 *
 * In a meeting on a call, either can hear the call's own sound too (see callAudio.ts), the
 * microphone then keeping to the speaker's own voice.
 */

import { MIC_ON_CALL, mixed } from './callAudio'
import { Downsampler, Phrases, wav } from './phrases'

/** Where a phrase was heard, once the call is heard too: the microphone (the person here) or the call. */
export type HeardFrom = 'me' | 'call'

export interface Hearing {
  /**
   * A finished phrase, which voice said it (when the server can tell voices apart), when, in a
   * recording (ms), whether speech to text wasn't sure of some of it (marked "[unclear: …]"), and,
   * once the call is heard too, whether it came from the microphone or the call.
   */
  final(text: string, voice?: number, at?: number, unclear?: boolean, from?: HeardFrom): void
  /** The server knows who a voice is: named here, or in an earlier meeting. */
  named?(voice: number, name: string): void
  /** Voices the server found to be one person: each [later, earlier] is the earlier one from now on. */
  merged?(pairs: [number, number][]): void
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
  readonly kind: 'server' | 'browser' | 'file'
  /** Stops listening; resolves once what was being said has been heard. */
  stop(): Promise<void>
  /** Stops hearing for now (what was said up to then still counts), or starts again. */
  mute(quiet: boolean): void
  /**
   * Hears a call's own sound as well (and the microphone, from then on, only the person here):
   * every voice heard once, from where it was said.
   */
  hearCall?(call: MediaStream): Promise<void>
}

type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  /** Chrome can listen to a sound of the page's choosing rather than the microphone. */
  start(track?: MediaStreamTrack): void
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
  /** Once the call is heard too: the microphone and the call, mixed, which it listens to instead. */
  let both: { track: MediaStreamTrack; ctx: AudioContext; mic: MediaStream } | null = null
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
    if (stopped) {
      letGo()
      ended?.()
    } else if (!muted) tryStart()
  }
  const begin = () => (both ? r.start(both.track) : r.start())
  begin()
  on.state?.('listening')
  return {
    kind: 'browser',
    stop() {
      stopped = true
      // The last words arrive before it ends.
      const done = new Promise<void>((ok) => {
        ended = ok
        setTimeout(() => {
          letGo()
          ok()
        }, 2000)
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
    async hearCall(call) {
      // It hears one sound: the person's own voice (the call taken out of the microphone) and the call, together.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: MIC_ON_CALL })
      const ctx = new AudioContext()
      if (ctx.state === 'suspended') await ctx.resume()
      letGo()
      both = { track: mixed(ctx, [mic, call]), ctx, mic }
      // Starts again on the two, once it has ended (onend).
      if (!muted && !stopped) r.stop()
    },
  }
  function tryStart() {
    try {
      begin()
    } catch {
      // Still ending: it starts again from onend.
    }
  }
  function letGo() {
    if (!both) return
    for (const t of both.mic.getTracks()) t.stop()
    void both.ctx.close()
    both = null
  }
}

/** A phrase turned into words, and which voice said it, when the server can tell. */
export interface Heard {
  text: string
  voice?: number
  /** Who that voice is, when the server knows. */
  name?: string
  /** Voices found to be one person since the last phrase: [the later one, the one it went into]. */
  merged?: [number, number][]
  /** Some of it wasn't heard clearly (marked "[unclear: …]" in the text). */
  unclear?: boolean
}

export interface ServerEarOptions {
  /**
   * Sends a recording (WAV) to be turned into words; resolves with them. `preview`: a phrase still
   * being said. `from`: once the call is heard too, where it was heard (the microphone's phrases
   * are the person's own, so whose voice it is needn't be asked).
   */
  transcribe(audio: Blob, preview?: boolean, from?: HeardFrom): Promise<Heard>
  /** A pause this long ends a phrase. */
  pauseMs?: number
  /** Shows the words while they're being said, by transcribing the phrase so far about once a second. */
  preview?: boolean
  /**
   * Hearing a meeting: the other people come out of the computer's speakers, so the microphone
   * keeps that sound rather than taking it away as an echo (until the call is heard on its own).
   */
  meeting?: boolean
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
 * words. Phrases are transcribed side by side but heard in the order they were said. With the call
 * heard too, the microphone and the call are cut into phrases each on their own.
 */
export async function serverEar(o: ServerEarOptions, on: Hearing): Promise<Ear> {
  const first = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: !o.meeting, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })

  let stopped = false
  let muted = false
  /** Phrases begun and not yet heard (or dropped), from every source. */
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

  /** A sound being listened to: cut into phrases, each sent to be turned into words. */
  interface Tap {
    phrases: Phrases
    end(): void
  }
  const tap = async (stream: MediaStream, from?: HeardFrom): Promise<Tap> => {
    // Each sound at its own rate (Firefox won't connect a sound to a context at another), brought
    // down to 16 kHz here.
    const rate = stream.getAudioTracks()[0]?.getSettings().sampleRate
    const ctx = rate ? new AudioContext({ sampleRate: rate }) : new AudioContext()
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
    const silent = ctx.createGain()
    silent.gain.value = 0
    source.connect(node)
    node.connect(silent).connect(ctx.destination)
    if (ctx.state === 'suspended') await ctx.resume()
    const down = new Downsampler(ctx.sampleRate)
    const phrases: Phrases = new Phrases(
      { pauseMs: o.pauseMs, previewMs: o.preview ? 1000 : 0 },
      {
        started: opened,
        dropped: closed,
        level: (v) => on.level?.(v),
        phrase: (audio) => {
          on.state?.('transcribing')
          const text = o.transcribe(wav(audio), false, from)
          delivered = delivered.then(() =>
            text
              .then(
                (t) => {
                  on.interim?.('')
                  if (t.merged?.length) on.merged?.(t.merged)
                  if (t.voice !== undefined && t.name) on.named?.(t.voice, t.name)
                  if (words(t.text)) on.final(t.text.trim(), t.voice, undefined, t.unclear, from)
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
          o.transcribe(wav(audio), true, from)
            .then((t) => {
              if (!stopped && phrases.id === id && words(t.text)) on.interim?.(t.text.trim())
            })
            .catch(() => {})
            .finally(() => (previewing = false))
        },
      },
    )
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!stopped && !muted) phrases.feed(down.push(e.data))
    }
    return {
      phrases,
      end() {
        // What was being said still counts.
        phrases.end()
        node.port.onmessage = null
        source.disconnect()
        for (const t of stream.getTracks()) t.stop()
        void ctx.close()
      },
    }
  }

  let mic = await tap(first)
  let call: Tap | null = null
  on.state?.('listening')

  return {
    kind: 'server',
    stop() {
      stopped = true
      mic.end()
      call?.end()
      return delivered
    },
    mute(quiet) {
      if (quiet === muted || stopped) return
      // What was said before muting still goes.
      if (quiet) {
        mic.phrases.end()
        call?.phrases.end()
      }
      muted = quiet
      on.level?.(0)
    },
    async hearCall(stream) {
      // The microphone from now on: the person's own voice, the call taken out of it.
      const own = await navigator.mediaDevices.getUserMedia({ audio: MIC_ON_CALL })
      if (stopped) {
        for (const t of own.getTracks()) t.stop()
        return
      }
      const heard = await tap(stream, 'call')
      mic.end()
      mic = await tap(own, 'me')
      call?.end()
      call = heard
    },
  }
}
