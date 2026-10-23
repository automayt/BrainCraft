/**
 * Cutting speech into phrases for speech to text: the microphone's sound, brought down to 16 kHz
 * mono (what Whisper and its kind listen at), is followed sample by sample; a phrase ends at a
 * pause after speech, and is handed on as plain WAV, which every transcription server reads,
 * whichever browser recorded it. Pure logic, timed by the samples themselves, so it's tested
 * without a microphone.
 */

export const RATE = 16_000

/** Brings sound down to `to` Hz by averaging (enough of a filter for speech). */
export class Downsampler {
  private acc = 0
  private n = 0
  private pos = 0
  private readonly ratio: number

  constructor(from: number, to = RATE) {
    this.ratio = from / to
  }

  push(input: Float32Array): Float32Array {
    const out = new Float32Array(Math.ceil(input.length / this.ratio) + 1)
    let k = 0
    for (const s of input) {
      this.acc += s
      this.n++
      if (++this.pos >= this.ratio) {
        out[k++] = this.acc / this.n
        this.acc = 0
        this.n = 0
        this.pos -= this.ratio
      }
    }
    return out.subarray(0, k)
  }
}

/** Samples as a 16-bit mono WAV file. */
export function wav(samples: Float32Array, rate = RATE): Blob {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (at: number, s: string) => [...s].forEach((c, i) => data.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  data.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true) // PCM
  data.setUint16(22, 1, true) // mono
  data.setUint32(24, rate, true)
  data.setUint32(28, rate * 2, true)
  data.setUint16(32, 2, true)
  data.setUint16(34, 16, true)
  text(36, 'data')
  data.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true))
  return new Blob([data.buffer], { type: 'audio/wav' })
}

export interface PhraseOptions {
  /** A pause this long after speech ends the phrase. */
  pauseMs?: number
  /** A phrase is cut at this length even without a pause. */
  maxMs?: number
  /** Less speech than this in a phrase is a cough or a click: dropped. */
  minVoicedMs?: number
  /** Sound kept from just before speech starts, so its first sound isn't clipped. */
  prerollMs?: number
  /** While a phrase is being said, what's been said so far is offered this often (0: never). */
  previewMs?: number
}

export interface PhraseEvents {
  /** Someone started speaking: a phrase is under way. */
  started?(): void
  /** A finished phrase (after `started`). */
  phrase(audio: Float32Array, id: number): void
  /** The phrase turned out to be too little to send (after `started`). */
  dropped?(): void
  /** The phrase so far, while it's still being said. */
  preview?(audio: Float32Array, id: number): void
  level?(v: number): void
}

const ms = (n: number) => (n / RATE) * 1000
const samples = (t: number) => Math.round((t / 1000) * RATE)

export class Phrases {
  private chunks: Float32Array[] = []
  private length = 0
  private voiced = 0
  private silence = 0
  private active = false
  private sincePreview = 0
  private voicedSincePreview = false
  private floor = 0.01
  /** The number of the phrase being said (each cut moves on to the next). */
  id = 1
  private readonly o: Required<PhraseOptions>
  private readonly on: PhraseEvents

  constructor(o: PhraseOptions, on: PhraseEvents) {
    this.on = on
    this.o = { pauseMs: o.pauseMs ?? 700, maxMs: o.maxMs ?? 25_000, minVoicedMs: o.minVoicedMs ?? 250, prerollMs: o.prerollMs ?? 400, previewMs: o.previewMs ?? 0 }
  }

  /** The next stretch of sound, at 16 kHz. */
  feed(input: Float32Array) {
    if (!input.length) return
    let sum = 0
    for (const v of input) sum += v * v
    const rms = Math.sqrt(sum / input.length)
    const dt = ms(input.length)
    // The room's noise floor, followed slowly; speech is well above it.
    this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.999 + rms * 0.001
    const speaking = rms > Math.max(0.012, this.floor * 3)
    this.on.level?.(Math.min(1, rms * 8))
    this.chunks.push(input)
    this.length += input.length
    if (speaking) {
      this.voiced += dt
      this.silence = 0
      this.voicedSincePreview = true
      if (!this.active && this.voiced >= 150) {
        this.active = true
        this.on.started?.()
      }
    } else this.silence += dt
    // Before any speech, only a moment of sound is kept, to start the phrase with.
    if (!this.voiced) this.trim(samples(this.o.prerollMs))
    if ((this.voiced && this.silence >= this.o.pauseMs) || ms(this.length) >= this.o.maxMs) return this.end()
    this.sincePreview += dt
    if (this.o.previewMs && this.active && this.voicedSincePreview && this.sincePreview >= this.o.previewMs) {
      this.sincePreview = 0
      this.voicedSincePreview = false
      this.on.preview?.(this.audio(), this.id)
    }
  }

  /** Ends the phrase now (at a pause, or on stopping): sent if it had enough speech in it. */
  end() {
    // Most of the closing silence is left off.
    const keep = this.length - Math.max(0, samples(this.silence - 300))
    const audio = this.audio(keep)
    const enough = this.voiced >= this.o.minVoicedMs
    const id = this.id
    const was = this.active
    this.chunks = []
    this.length = 0
    this.voiced = 0
    this.silence = 0
    this.active = false
    this.sincePreview = 0
    this.voicedSincePreview = false
    if (!was) return
    this.id++
    if (enough) this.on.phrase(audio, id)
    else this.on.dropped?.()
  }

  private audio(n = this.length): Float32Array {
    const out = new Float32Array(Math.max(0, n))
    let at = 0
    for (const c of this.chunks) {
      if (at >= out.length) break
      out.set(c.subarray(0, out.length - at), at)
      at += c.length
    }
    return out
  }

  private trim(keep: number) {
    while (this.chunks.length > 1 && this.length - this.chunks[0].length >= keep) this.length -= this.chunks.shift()!.length
  }
}
