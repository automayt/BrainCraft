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
  /** How alike two voices must become to be taken for one person, and put together. */
  same?: number
  /** Voices one conversation can have; past that, a phrase goes to its nearest. */
  most?: number
  /** A phrase shorter than this (seconds) goes with the nearest voice already heard, but never starts one. */
  shortest?: number
  /** A new voice counts once it's been heard this many times, so one odd phrase doesn't make one. */
  heardTimes?: number
  /** Conversations remembered at once, and for how long after their last phrase. */
  conversations?: number
  forgetMs?: number
  now?: () => number
}

interface Voice {
  /** Its number (1, 2…), or 0 while it's only a maybe: heard once, and not yet again. */
  n: number
  /** The running total of its phrases' voiceprints, each made unit length. */
  sum: Float32Array
  heard: number
  at: number
}

interface Talk {
  at: number
  voices: Voice[]
  next: number
  /** How many people the app says are in it, when it knows. */
  people: number | null
  /** Voices found to be one person since the app last asked: [the later one, the one it went into]. */
  merged: [number, number][]
}

/** Maybes kept per conversation, and how long one waits to be heard again. */
const MAYBES = 8
const MAYBE_MS = 10 * 60_000
/** A voice heard fewer times than this is still young: what it sounds like isn't settled, so it's put with another more readily. */
const YOUNG = 5

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

/** Settings given as undefined (an unset environment variable) keep their defaults. */
const given = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(typeof v === 'number' && !Number.isFinite(v)))) as Partial<T>

/**
 * The voices heard in each conversation, so each phrase can be put to one. A phrase joins the
 * voice it's most like when it's like enough; otherwise it may be someone new, but it only becomes
 * a voice once a second phrase sounds like it (until then it's said to be no one known). Voices
 * that grow alike are found to be one person and put together, and when the app says how many
 * people there are, there are never more voices than that.
 */
export class Voices {
  private o: Required<VoicesOptions>
  private talks = new Map<string, Talk>()

  constructor(o: VoicesOptions = {}) {
    this.o = { threshold: 0.35, same: 0.5, most: 12, shortest: 1.2, heardTimes: 2, conversations: 500, forgetMs: 8 * 60 * 60_000, now: Date.now, ...given(o) }
  }

  /**
   * Which voice said a phrase (1, 2…), or null when it can't be known yet. `people`: how many
   * are in the conversation, when the app knows.
   */
  place(conversation: string, print: Float32Array, seconds: number, people?: number | null): number | null {
    const now = this.o.now()
    this.forget(now)
    let talk = this.talks.get(conversation)
    if (!talk) {
      talk = { at: now, voices: [], next: 1, people: null, merged: [] }
      this.talks.set(conversation, talk)
    }
    talk.at = now
    if (people !== undefined) talk.people = people && people > 0 ? Math.min(people, this.o.most) : null
    // Maybes not heard again for a while were someone passing, or a noise.
    talk.voices = talk.voices.filter((v) => v.n || now - v.at < MAYBE_MS)
    const p = unit(print)
    const fits = talk.voices.filter((v) => v.sum.length === p.length)
    const known = fits.filter((v) => v.n)
    const nearest = (among: Voice[]) => {
      let best: Voice | null = null
      let score = -Infinity
      for (const v of among) {
        const s = cosine(v.sum, p)
        if (s > score) {
          score = s
          best = v
        }
      }
      return { best, score }
    }
    const most = talk.people ?? this.o.most
    // Everyone's been heard: it's one of them.
    if (known.length >= most) {
      talk.voices = talk.voices.filter((v) => v.n)
      const { best, score } = nearest(known)
      if (!best) return null
      // Only a phrase that sounds like them shapes what they sound like.
      return score >= this.o.threshold ? this.join(talk, best, p, now) : best.n
    }
    // A voice already known has first claim; a maybe gets only what no one known sounds like.
    const mine = nearest(known)
    if (mine.best && mine.score >= this.o.threshold) return this.join(talk, mine.best, p, now)
    const maybe = nearest(fits.filter((v) => !v.n))
    if (maybe.best && maybe.score >= this.o.threshold) return this.join(talk, maybe.best, p, now)
    // Too short to be sure it's someone new: the nearest voice already known, left as it was.
    if (seconds < this.o.shortest) return mine.best?.n ?? null
    // Maybe someone new: a voice once heard again.
    talk.voices.push({ n: 0, sum: Float32Array.from(p), heard: 1, at: now })
    const maybes = talk.voices.filter((v) => !v.n)
    if (maybes.length > MAYBES) talk.voices.splice(talk.voices.indexOf(maybes[0]), 1)
    return null
  }

  /** Voices found to be one person since last asked, as [the later one, the one it went into]. */
  merged(conversation: string): [number, number][] {
    const talk = this.talks.get(conversation)
    if (!talk?.merged.length) return []
    const out = talk.merged
    talk.merged = []
    return out
  }

  private join(talk: Talk, v: Voice, p: Float32Array, now: number): number | null {
    for (let i = 0; i < p.length; i++) v.sum[i] += p[i]
    v.heard++
    v.at = now
    if (!v.n) {
      if (v.heard < this.o.heardTimes) return null
      v.n = talk.next++
    }
    // Grown like another voice: they were one person all along, and the earlier number stays.
    let into = v
    for (const w of [...talk.voices]) {
      if (w === into || !w.n || !talk.voices.includes(w) || w.sum.length !== into.sum.length || cosine(w.sum, into.sum) < (Math.min(w.heard, into.heard) < YOUNG ? this.o.threshold : this.o.same)) continue
      const [keep, drop] = w.n < into.n ? [w, into] : [into, w]
      for (let i = 0; i < keep.sum.length; i++) keep.sum[i] += drop.sum[i]
      keep.heard += drop.heard
      keep.at = now
      talk.voices.splice(talk.voices.indexOf(drop), 1)
      talk.merged.push([drop.n, keep.n])
      into = keep
    }
    return into.n
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
