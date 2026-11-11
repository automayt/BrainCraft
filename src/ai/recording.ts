/**
 * MeetingNotes from a recording: a meeting's audio (or a video of it) is read in the browser,
 * cut into phrases at its pauses, and each phrase goes to the server's speech to text like a
 * phrase heard through the microphone, voices and all. It goes only as fast as the notes keep up.
 */

import { type Ear, type Heard, type Hearing } from './speech'
import { RATE, wav } from './phrases'

/** A stretch of speech in a recording, in samples. */
export interface Span {
  start: number
  end: number
}

export interface SplitOptions {
  /** A pause this long (seconds) ends a phrase. */
  pause?: number
  /** Phrases shorter than this (seconds of speech) are noise. */
  shortest?: number
  /** A phrase longer than this (seconds) is cut at its quietest moment. */
  longest?: number
}

/**
 * Where the speech is in a recording: stretches louder than the room, split at pauses, each with
 * a little lead-in and tail so no word is clipped.
 */
export function splitPhrases(samples: Float32Array, rate = RATE, o: SplitOptions = {}): Span[] {
  const frame = Math.round(rate * 0.03)
  const frames = Math.floor(samples.length / frame)
  if (!frames) return []
  const level = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    for (let k = f * frame; k < (f + 1) * frame; k++) s += samples[k] * samples[k]
    level[f] = Math.sqrt(s / frame)
  }
  // The room's own noise, and how loud speech gets: speech is well above the one, by the other.
  const sorted = Float32Array.from(level).sort()
  const floor = sorted[Math.floor(frames * 0.15)]
  const loud = sorted[Math.floor(frames * 0.95)]
  const gate = Math.max(0.004, floor + (loud - floor) * 0.12, floor * 2)
  // A breath mid-sentence isn't the end of it: phrases cut too short lose their sense (and names).
  const pauseFrames = Math.round((o.pause ?? 0.8) / 0.03)
  const shortest = Math.round((o.shortest ?? 0.3) / 0.03)
  const longest = Math.round((o.longest ?? 25) / 0.03)
  const pad = Math.round(0.25 / 0.03)
  const spans: [number, number][] = []
  let start = -1
  let quiet = 0
  let voiced = 0
  for (let f = 0; f <= frames; f++) {
    const on = f < frames && level[f] >= gate
    if (on) {
      if (start < 0) {
        start = f
        voiced = 0
      }
      voiced++
      quiet = 0
    } else if (start >= 0 && (++quiet >= pauseFrames || f === frames)) {
      const end = f - quiet + 1
      if (voiced >= shortest) spans.push([start, end])
      start = -1
    }
  }
  // Long ones cut where it's quietest, past their first two thirds of the longest.
  const out: Span[] = []
  for (let [a, b] of spans) {
    while (b - a > longest) {
      let cut = a + Math.round(longest * 0.66)
      for (let f = cut; f < a + longest; f++) if (level[f] < level[cut]) cut = f
      out.push({ start: a, end: cut })
      a = cut
    }
    out.push({ start: a, end: b })
  }
  return out.map((s) => ({ start: Math.max(0, (s.start - pad) * frame), end: Math.min(samples.length, (s.end + pad) * frame) }))
}

/** A recording's sound as one channel at 16 kHz. Throws when the browser can't read it. */
export async function decodeRecording(file: Blob): Promise<Float32Array> {
  const bytes = await file.arrayBuffer()
  // Decoded straight to 16 kHz.
  const ctx = new OfflineAudioContext(1, 1, RATE)
  const audio = await ctx.decodeAudioData(bytes)
  const n = audio.length
  if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice()
  const out = new Float32Array(n)
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c)
    for (let k = 0; k < n; k++) out[k] += ch[k] / audio.numberOfChannels
  }
  return out
}

export interface FileEarOptions {
  transcribe(audio: Blob): Promise<Heard>
  /** How far through it is, in ms of the recording. */
  progress?(done: number, length: number): void
  /** True while more is waiting for the assistant than it should take at once: reading waits. */
  backlog?(): boolean
  /** It's all been heard. */
  ended?(): void
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

/** Hears a recording, phrase by phrase, as if it were being said now (each line with when it was said in it). */
export async function fileEar(file: Blob, o: FileEarOptions, on: Hearing): Promise<Ear> {
  on.state?.('transcribing')
  let samples: Float32Array | null = await decodeRecording(file)
  const spans = splitPhrases(samples)
  const length = Math.round((samples.length / RATE) * 1000)
  let stopped = false
  let paused = false
  // What's said holds the turn until a stretch has gathered (or the reading waits for the notes).
  on.holding?.(true)
  o.progress?.(0, length)
  const run = (async () => {
    // Two phrases are with the server at a time; they're heard in order.
    const ahead: Promise<Heard | null>[] = []
    const ask = (s: Span) =>
      o.transcribe(wav(samples!.subarray(s.start, s.end))).catch((err: Error) => {
        if (!stopped) on.error(err.message)
        stopped = true
        return null
      })
    let next = 0
    for (let k = 0; k < spans.length && !stopped; k++) {
      while (next < spans.length && next < k + 2) ahead.push(ask(spans[next++]))
      const heard = await ahead.shift()!
      if (stopped || !heard) break
      if (heard.merged?.length) on.merged?.(heard.merged)
      if (heard.voice !== undefined && heard.name) on.named?.(heard.voice, heard.name)
      if (/[\p{L}\p{N}]/u.test(heard.text)) on.final(heard.text.trim(), heard.voice, Math.round((spans[k].start / RATE) * 1000), heard.unclear)
      o.progress?.(Math.round((spans[k].end / RATE) * 1000), length)
      while (!stopped && (paused || o.backlog?.())) await sleep(300)
    }
    samples = null
    on.holding?.(false)
    on.state?.('listening')
    if (!stopped) {
      o.progress?.(length, length)
      o.ended?.()
    }
  })()
  return {
    kind: 'file',
    stop() {
      stopped = true
      return run
    },
    mute(quiet) {
      paused = quiet
    },
  }
}
