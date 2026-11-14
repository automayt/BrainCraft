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
 * microphone then keeping to the speaker's own voice: what the browser leaves of the call in it
 * is taken out here before it's sent (see echo.ts). That is echo removal, and it can be turned
 * off: the microphone is then heard as it is.
 */

import { micOnCall, mixed } from './callAudio'
import { Echo, Recent } from './echo'
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
  /**
   * Echo removal on or off (on to begin with, unless asked otherwise): whether the call is taken
   * out of the microphone once the call is heard too. Off, the microphone is heard as it is.
   */
  removeEcho?(on: boolean): Promise<void>
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

/**
 * The browser's own recognition, kept going until stopped (it ends itself after a silence). Echo
 * removal here is the browser's own echo cancelling, which knows only what the browser plays.
 */
export function browserEar(lang: string, on: Hearing, removeEcho = true): Ear {
  const Rec = recognitionClass()!
  let stopped = false
  let muted = false
  let ended: (() => void) | null = null
  /** Once the call is heard too: the microphone and the call, mixed, which it listens to instead. */
  let both: { track: MediaStreamTrack; ctx: AudioContext; mic: MediaStream; call: MediaStream } | null = null
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
    hearCall: (call) => hearBoth(call),
    async removeEcho(want) {
      if (want === removeEcho) return
      removeEcho = want
      // The microphone again, with or without its echo cancelling.
      if (both) await hearBoth(both.call)
    },
  }
  /** It hears one sound: the person's own voice (the call taken out of the microphone, with echo removal) and the call, together. */
  async function hearBoth(call: MediaStream) {
    // Asked for again when the choice changed meanwhile: that microphone isn't the one wanted.
    for (;;) {
      const wanted = removeEcho
      const mic = await navigator.mediaDevices.getUserMedia({ audio: micOnCall(wanted) })
      const ctx = new AudioContext()
      if (ctx.state === 'suspended') await ctx.resume()
      if (!stopped && wanted === removeEcho) {
        letGo()
        both = { track: mixed(ctx, [mic, call]), ctx, mic, call }
        // Starts again on the two, once it has ended (onend).
        if (!muted) r.stop()
        return
      }
      for (const t of mic.getTracks()) t.stop()
      void ctx.close()
      if (stopped) return
    }
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
  /** Echo removal to begin with (on unless false): see `Ear.removeEcho`. */
  removeEcho?: boolean
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
 * heard too, the microphone and the call are cut into phrases each on their own, and the call is
 * taken out of the microphone's: what it said is heard once, from the call.
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
    /** Its last while, to find the call in the microphone with. */
    recent: Recent
    end(): void
  }
  /** Takes the call out of the microphone's phrases, once the call is heard too (with echo removal on). */
  const echo = new Echo()
  let removeEcho = o.removeEcho !== false
  /** The call's own sound, once it's heard too. */
  let call: Tap | null = null
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
    const recent = new Recent()
    /** Samples heard but not cut into phrases (while muted): a phrase began that much later in the sound than in what was cut. */
    let skipped = 0
    /** A microphone phrase without the call in it: null when the call was all there was. */
    const own = (audio: Float32Array, at: number, look: boolean): Float32Array | null => {
      if (from !== 'me' || !call || !removeEcho) return audio
      const cleaned = echo.clean(recent, call.recent, at + skipped, at + skipped + audio.length, look)
      return cleaned.allCall ? null : cleaned.audio
    }
    const phrases: Phrases = new Phrases(
      { pauseMs: o.pauseMs, previewMs: o.preview ? 1000 : 0 },
      {
        started: opened,
        dropped: closed,
        level: (v) => on.level?.(v),
        phrase: (heard, _id, at) => {
          // Only the call coming out of the speakers: it's heard from the call itself.
          const audio = own(heard, at, true)
          if (!audio) return closed()
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
        preview: (heard, id, at) => {
          if (previewing || stopped) return
          const audio = own(heard, at, false)
          if (!audio) return
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
      const batch = down.push(e.data)
      recent.push(batch, performance.now())
      if (!stopped && !muted) phrases.feed(batch)
      else skipped += batch.length
    }
    let ended = false
    return {
      phrases,
      recent,
      end() {
        if (ended) return
        ended = true
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
  on.state?.('listening')

  /** One change to what's listened to at a time: two at once would leave a microphone open. */
  let changing: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(change: () => Promise<T>): Promise<T> => {
    const next = changing.then(change)
    changing = next.catch(() => {})
    return next
  }
  const letGo = (stream: MediaStream) => {
    for (const t of stream.getTracks()) t.stop()
  }
  /** How the microphone was asked for once the call is heard too: with echo removal, or without. */
  let micRemoves: boolean | null = null
  /**
   * The microphone once the call is heard too: the person's own voice. With echo removal, the
   * browser takes out what it can of the call and the rest is taken out here; without, neither.
   */
  const myMic = async () => {
    const removes = removeEcho
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: micOnCall(removes) }), removes }
  }
  const hearMe = async (own: { stream: MediaStream; removes: boolean }) => {
    mic.end()
    mic = await tap(own.stream, 'me')
    micRemoves = own.removes
    if (stopped) mic.end()
  }

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
    hearCall: (stream) =>
      inTurn(async () => {
        if (stopped) return letGo(stream)
        // The microphone from now on: the person's own voice.
        const own = await myMic()
        if (stopped) {
          letGo(own.stream)
          return letGo(stream)
        }
        let heard: Tap
        try {
          heard = await tap(stream, 'call')
        } catch (err) {
          letGo(own.stream)
          throw err
        }
        await hearMe(own)
        call?.end()
        call = heard
        if (stopped) heard.end()
      }),
    removeEcho(want) {
      removeEcho = want
      // The microphone again, with or without the browser's echo cancelling (unless it's as wanted by its turn).
      return inTurn(async () => {
        if (!call || stopped || micRemoves === removeEcho) return
        const own = await myMic()
        if (stopped) return letGo(own.stream)
        await hearMe(own)
      })
    },
  }
}
