/**
 * Who said it: in a meeting, each phrase sent to be turned into words is also matched to a voice
 * heard earlier in the same conversation ("Voice 2"), so the assistant knows who said what. The app
 * lets people name the voices.
 *
 * A speaker-recognition model turns a phrase into a voiceprint (a list of numbers that's close for
 * the same voice and far apart for different ones); Voices groups them. The model runs here, on the
 * processor, through the sherpa-onnx library, so there's nothing else to run. It's optional: set
 * BRAINCRAFT_SPEAKER_MODEL to the model file (see docs/AI.md) and install the library
 * (`npm install sherpa-onnx-node`, which the app's package.json lists as optional).
 */

/** Turns some sound into a voiceprint; null when there's too little to tell. */
export interface Embedder {
  embed(samples: Float32Array, rate: number): Float32Array | null
}

/** Loads the speaker-recognition model. Throws, saying why, when it can't. */
export async function loadEmbedder(model: string, threads = 1): Promise<Embedder> {
  // Optional, and native: loaded only when wanted, and never bundled.
  const name = 'sherpa-onnx-node'
  const mod = (await import(/* @vite-ignore */ name)) as { default?: SherpaModule } & SherpaModule
  const sherpa = mod.SpeakerEmbeddingExtractor ? mod : mod.default!
  const extractor = new sherpa.SpeakerEmbeddingExtractor({ model, numThreads: threads, debug: 0 })
  return {
    embed(samples, rate) {
      const stream = extractor.createStream()
      stream.acceptWaveform({ samples, sampleRate: rate })
      stream.inputFinished()
      return extractor.isReady(stream) ? Float32Array.from(extractor.compute(stream, false)) : null
    },
  }
}

interface SherpaModule {
  SpeakerEmbeddingExtractor: new (config: { model: string; numThreads: number; debug: number }) => {
    createStream(): { acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void; inputFinished(): void }
    isReady(s: unknown): boolean
    compute(s: unknown, external?: boolean): Float32Array
  }
}

/** The sound in a WAV file the app sends (16-bit, mono or more), as samples from -1 to 1; null when it isn't one. */
export function wavSamples(buf: Buffer): { samples: Float32Array; rate: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let at = 12
  let rate = 0
  let channels = 0
  let bits = 0
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4)
    const size = buf.readUInt32LE(at + 4)
    const body = at + 8
    if (id === 'fmt ' && body + 16 <= buf.length) {
      if (buf.readUInt16LE(body) !== 1) return null
      channels = buf.readUInt16LE(body + 2)
      rate = buf.readUInt32LE(body + 4)
      bits = buf.readUInt16LE(body + 14)
    } else if (id === 'data') {
      if (bits !== 16 || !channels || !rate) return null
      const end = Math.min(buf.length, body + size)
      const frames = Math.floor((end - body) / (2 * channels))
      const samples = new Float32Array(frames)
      // The first channel is enough to know a voice.
      for (let k = 0; k < frames; k++) samples[k] = buf.readInt16LE(body + k * 2 * channels) / 32768
      return { samples, rate }
    }
    at = body + size + (size % 2)
  }
  return null
}

export interface VoicesOptions {
  /** How alike a phrase must be to a voice to be that voice (cosine similarity, 0–1). */
  threshold?: number
  /** Voices one conversation can have; past that, a phrase goes to its nearest. */
  most?: number
  /** A phrase shorter than this (seconds) is matched to a voice already heard, but never starts one. */
  shortest?: number
  /** Conversations remembered at once, and for how long after their last phrase. */
  conversations?: number
  forgetMs?: number
  now?: () => number
}

interface Voice {
  /** The running total of its phrases' voiceprints, each made unit length. */
  sum: Float32Array
  n: number
}

const unit = (v: Float32Array) => {
  let s = 0
  for (const x of v) s += x * x
  const len = Math.sqrt(s) || 1
  return v.map((x) => x / len)
}

const cosine = (a: Float32Array, b: Float32Array) => {
  let dot = 0
  let aa = 0
  let bb = 0
  for (let k = 0; k < a.length; k++) {
    dot += a[k] * b[k]
    aa += a[k] * a[k]
    bb += b[k] * b[k]
  }
  return dot / (Math.sqrt(aa * bb) || 1)
}

/** The voices heard in each conversation, so each phrase can be put to one. */
export class Voices {
  private o: Required<VoicesOptions>
  private talks = new Map<string, { at: number; voices: Voice[] }>()

  constructor(o: VoicesOptions = {}) {
    this.o = { threshold: 0.5, most: 12, shortest: 1.2, conversations: 500, forgetMs: 8 * 60 * 60_000, now: Date.now, ...o }
  }

  /** Which voice said a phrase (1, 2…), or null when it's too short to start a new one. */
  place(conversation: string, print: Float32Array, seconds: number): number | null {
    const now = this.o.now()
    this.forget(now)
    let talk = this.talks.get(conversation)
    if (!talk) {
      talk = { at: now, voices: [] }
      this.talks.set(conversation, talk)
    }
    talk.at = now
    const p = unit(print)
    let best = -1
    let score = -Infinity
    talk.voices.forEach((v, k) => {
      if (v.sum.length !== p.length) return
      const s = cosine(v.sum, p)
      if (s > score) {
        score = s
        best = k
      }
    })
    const join = (k: number) => {
      const v = talk.voices[k]
      for (let i = 0; i < p.length; i++) v.sum[i] += p[i]
      v.n++
      return k + 1
    }
    if (best >= 0 && score >= this.o.threshold) return join(best)
    // Too short to be sure it's someone new.
    if (seconds < this.o.shortest) return null
    if (talk.voices.length >= this.o.most) return best >= 0 ? join(best) : null
    talk.voices.push({ sum: Float32Array.from(p), n: 1 })
    return talk.voices.length
  }

  private forget(now: number) {
    for (const [k, t] of this.talks) if (now - t.at > this.o.forgetMs) this.talks.delete(k)
    // The longest quiet go first.
    while (this.talks.size >= this.o.conversations) {
      let oldest: string | undefined
      let at = Infinity
      for (const [k, t] of this.talks)
        if (t.at < at) {
          at = t.at
          oldest = k
        }
      if (oldest === undefined) break
      this.talks.delete(oldest)
    }
  }
}
