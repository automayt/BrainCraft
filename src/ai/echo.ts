/**
 * Taking the call back out of the microphone. With a call heard on its own (callAudio.ts), the
 * microphone should hold only the person here. Mostly the browser sees to that; where it can't (a
 * call in another app, a browser that only takes out its own sound, loud speakers), the call comes
 * out of the speakers, into the microphone, and is heard twice: once from the call, once as the
 * person here.
 *
 * So each microphone phrase is checked against what the call was playing at the time. The call's
 * sound reaches the microphone a little late and coloured by the speakers and the room. How late
 * is found by trying each lag and seeing how much of the microphone's sound the call explains
 * there; the colouring by fitting, at each pitch, the few echoes that best turn the call into what
 * the microphone heard. That fit is taken away. What is left is the person's own voice: kept, with
 * the stretches that were only the call silenced. A phrase with nothing left was all call, and is
 * dropped.
 *
 * Only what the call can explain is ever taken away, and only once the call has plainly been found
 * in the microphone, so a voice the call didn't play is safe. Pure logic on samples at 16 kHz,
 * tested without a microphone.
 */

import { RATE } from './phrases'

const N = 512
const HOP = N / 2
const BINS = N / 2 + 1
/** The echoes fitted at each pitch: one frame early (should the lag be a little out) to five late. */
const EARLY = 1
const TAPS = 7
/** The call reaches the microphone between this much early (clocks a little out) and this much late. */
export const EARLY_MS = 150
export const LATE_MS = 850

const ms = (n: number) => (n / RATE) * 1000
const samples = (t: number) => Math.round((t / 1000) * RATE)

// ---- the sound kept, and when it was heard ---------------------------------------------------------

/**
 * The last while of a sound, and when each sample of it was heard. Samples arrive in batches, a
 * little late and unevenly; the batch that arrived soonest for its place says when the sound began.
 */
export class Recent {
  private readonly buf: Float32Array
  /** Samples heard so far. */
  length = 0
  /** When the first sample was heard, going by each of the last few seconds' soonest batch. */
  private readonly starts: { second: number; start: number }[] = []

  constructor(keepMs = 40_000) {
    this.buf = new Float32Array(samples(keepMs))
  }

  /** The next batch, which arrived at `now` (ms). */
  push(batch: Float32Array, now: number) {
    const size = this.buf.length
    for (let i = 0; i < batch.length; i++) this.buf[(this.length + i) % size] = batch[i]
    this.length += batch.length
    const start = now - ms(this.length)
    const second = Math.floor(now / 1000)
    const last = this.starts[this.starts.length - 1]
    if (last && last.second === second) last.start = Math.min(last.start, start)
    else {
      this.starts.push({ second, start })
      if (this.starts.length > 20) this.starts.shift()
    }
  }

  private get start() {
    let best = Infinity
    for (const s of this.starts) best = Math.min(best, s.start)
    return best === Infinity ? 0 : best
  }

  /** When sample `i` was heard (ms). */
  timeOf(i: number) {
    return this.start + ms(i)
  }

  /** The sample heard at `time`. */
  indexAt(time: number) {
    return Math.round(((time - this.start) / 1000) * RATE)
  }

  /** Samples `from` to `to`: silence where they're no longer kept, or not heard yet. */
  slice(from: number, to: number): Float32Array {
    const out = new Float32Array(Math.max(0, to - from))
    const size = this.buf.length
    const first = Math.max(from, this.length - size, 0)
    for (let i = first; i < Math.min(to, this.length); i++) out[i - from] = this.buf[i % size]
    return out
  }
}

// ---- pitches -------------------------------------------------------------------------------------

const WINDOW = Float64Array.from({ length: N }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)))
const COS = Float64Array.from({ length: N / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / N))
const SIN = Float64Array.from({ length: N / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / N))
const REVERSED = (() => {
  const r = new Uint16Array(N)
  const bits = Math.log2(N)
  for (let i = 0; i < N; i++) {
    let x = i
    let y = 0
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1)
      x >>= 1
    }
    r[i] = y
  }
  return r
})()

/** In place: N samples to N pitches (or back, unscaled, with `inverse`). */
function fft(re: Float64Array, im: Float64Array, inverse = false) {
  for (let i = 0; i < N; i++) {
    const j = REVERSED[i]
    if (j > i) {
      const a = re[i]
      re[i] = re[j]
      re[j] = a
      const b = im[i]
      im[i] = im[j]
      im[j] = b
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1
    const stride = N / size
    for (let at = 0; at < N; at += size)
      for (let k = 0; k < half; k++) {
        const c = COS[k * stride]
        const s = inverse ? SIN[k * stride] : -SIN[k * stride]
        const i = at + k
        const j = i + half
        const xr = re[j] * c - im[j] * s
        const xi = re[j] * s + im[j] * c
        re[j] = re[i] - xr
        im[j] = im[i] - xi
        re[i] += xr
        im[i] += xi
      }
  }
}

/** A sound as frames of pitches: frame t is centred on sample t × HOP. */
interface Frames {
  count: number
  /** [frame × BINS + pitch] */
  re: Float64Array
  im: Float64Array
}

function frames(sound: Float32Array): Frames {
  const count = Math.floor(sound.length / HOP) + 1
  const out = { count, re: new Float64Array(count * BINS), im: new Float64Array(count * BINS) }
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let t = 0; t < count; t++) {
    const from = t * HOP - HOP
    for (let i = 0; i < N; i++) {
      const at = from + i
      re[i] = at >= 0 && at < sound.length ? sound[at] * WINDOW[i] : 0
      im[i] = 0
    }
    fft(re, im)
    out.re.set(re.subarray(0, BINS), t * BINS)
    out.im.set(im.subarray(0, BINS), t * BINS)
  }
  return out
}

function sound(f: Frames, length: number): Float32Array {
  const out = new Float32Array(length)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let t = 0; t < f.count; t++) {
    for (let k = 0; k < BINS; k++) {
      re[k] = f.re[t * BINS + k]
      im[k] = f.im[t * BINS + k]
    }
    for (let k = 1; k < N / 2; k++) {
      re[N - k] = re[k]
      im[N - k] = -im[k]
    }
    fft(re, im, true)
    const from = t * HOP - HOP
    for (let i = 0; i < N; i++) {
      const at = from + i
      if (at >= 0 && at < length) out[at] += (re[i] / N) * WINDOW[i]
    }
  }
  return out
}

// ---- how late the call reaches the microphone -----------------------------------------------------

/** The pitches speech is mostly made of (about 250 Hz to 3.5 kHz): enough to tell how late the call is. */
const LOW = 8
const HIGH = 112

/**
 * How late the call is in the microphone, in frames, and how much of the microphone's sound a
 * single echo of the call that late explains (0 to 1). Someone else's voice explains next to
 * nothing at any lag, so the person here talking over it doesn't hide it. `offset`: the call's
 * frame that goes with the microphone's first, were it not late at all.
 */
function lateness(mic: Frames, call: Frames, offset: number, earliest: number, latest: number): { lag: number; explains: number; usual: number } {
  let total = 0
  for (let t = 0; t < mic.count; t++) for (let k = LOW; k < HIGH; k++) total += mic.re[t * BINS + k] ** 2 + mic.im[t * BINS + k] ** 2
  const scores: number[] = []
  let best = { lag: 0, explains: 0 }
  if (!total) return { ...best, usual: 0 }
  for (let lag = earliest; lag <= latest; lag++) {
    let explained = 0
    for (let k = LOW; k < HIGH; k++) {
      let cr = 0
      let ci = 0
      let power = 0
      for (let t = 0; t < mic.count; t++) {
        const from = t + offset - lag
        if (from < 0 || from >= call.count) continue
        const xr = call.re[from * BINS + k]
        const xi = call.im[from * BINS + k]
        const mr = mic.re[t * BINS + k]
        const mi = mic.im[t * BINS + k]
        cr += xr * mr + xi * mi
        ci += xr * mi - xi * mr
        power += xr * xr + xi * xi
      }
      if (power) explained += (cr * cr + ci * ci) / power
    }
    const explains = explained / total
    scores.push(explains)
    if (explains > best.explains) best = { lag, explains }
  }
  scores.sort((x, y) => x - y)
  return { ...best, usual: scores[scores.length >> 1] ?? 0 }
}

// ---- the fit -------------------------------------------------------------------------------------

/** Solves A h = b in place (A is TAPS × TAPS, complex, as [row × TAPS + col]). */
function solve(ar: Float64Array, ai: Float64Array, br: Float64Array, bi: Float64Array) {
  const n = TAPS
  for (let p = 0; p < n; p++) {
    let top = p
    let most = 0
    for (let r = p; r < n; r++) {
      const size = ar[r * n + p] * ar[r * n + p] + ai[r * n + p] * ai[r * n + p]
      if (size > most) {
        most = size
        top = r
      }
    }
    if (!most) continue
    if (top !== p) {
      for (let c = 0; c < n; c++) {
        const x = ar[p * n + c]
        ar[p * n + c] = ar[top * n + c]
        ar[top * n + c] = x
        const y = ai[p * n + c]
        ai[p * n + c] = ai[top * n + c]
        ai[top * n + c] = y
      }
      const x = br[p]
      br[p] = br[top]
      br[top] = x
      const y = bi[p]
      bi[p] = bi[top]
      bi[top] = y
    }
    const pr = ar[p * n + p]
    const pi = ai[p * n + p]
    for (let r = p + 1; r < n; r++) {
      // factor = A[r][p] / A[p][p]
      const fr = (ar[r * n + p] * pr + ai[r * n + p] * pi) / most
      const fi = (ai[r * n + p] * pr - ar[r * n + p] * pi) / most
      if (!fr && !fi) continue
      for (let c = p; c < n; c++) {
        ar[r * n + c] -= fr * ar[p * n + c] - fi * ai[p * n + c]
        ai[r * n + c] -= fr * ai[p * n + c] + fi * ar[p * n + c]
      }
      br[r] -= fr * br[p] - fi * bi[p]
      bi[r] -= fr * bi[p] + fi * br[p]
    }
  }
  for (let p = n - 1; p >= 0; p--) {
    let sr = br[p]
    let si = bi[p]
    for (let c = p + 1; c < n; c++) {
      sr -= ar[p * n + c] * br[c] - ai[p * n + c] * bi[c]
      si -= ar[p * n + c] * bi[c] + ai[p * n + c] * br[c]
    }
    const pr = ar[p * n + p]
    const pi = ai[p * n + p]
    const size = pr * pr + pi * pi
    br[p] = size ? (sr * pr + si * pi) / size : 0
    bi[p] = size ? (si * pr - sr * pi) / size : 0
  }
}

/**
 * The call as the microphone heard it: at each pitch, the mix of the call's frames (one early to
 * five late) that comes closest to the microphone's, over the whole stretch. `shift`: the call's
 * frame that goes with the microphone's first, late as it is.
 */
function heardCall(mic: Frames, call: Frames, shift: number, weight?: Float64Array): Frames {
  const T = mic.count
  const out = { count: T, re: new Float64Array(T * BINS), im: new Float64Array(T * BINS) }
  const ar = new Float64Array(TAPS * TAPS)
  const ai = new Float64Array(TAPS * TAPS)
  const br = new Float64Array(TAPS)
  const bi = new Float64Array(TAPS)
  const xr = new Float64Array(TAPS)
  const xi = new Float64Array(TAPS)
  for (let k = 0; k < BINS; k++) {
    ar.fill(0)
    ai.fill(0)
    br.fill(0)
    bi.fill(0)
    let power = 0
    for (let t = 0; t < T; t++) {
      for (let j = 0; j < TAPS; j++) {
        const from = t + shift + EARLY - j
        const ok = from >= 0 && from < call.count
        xr[j] = ok ? call.re[from * BINS + k] : 0
        xi[j] = ok ? call.im[from * BINS + k] : 0
      }
      const w = weight ? weight[t] : 1
      const mr = mic.re[t * BINS + k] * w
      const mi = mic.im[t * BINS + k] * w
      power += (xr[EARLY] * xr[EARLY] + xi[EARLY] * xi[EARLY]) * w
      for (let i = 0; i < TAPS; i++) {
        // conj(x[i]) × m, and conj(x[i]) × x[j]
        br[i] += xr[i] * mr + xi[i] * mi
        bi[i] += xr[i] * mi - xi[i] * mr
        const wr = xr[i] * w
        const wi = xi[i] * w
        for (let j = i; j < TAPS; j++) {
          ar[i * TAPS + j] += wr * xr[j] + wi * xi[j]
          ai[i * TAPS + j] += wr * xi[j] - wi * xr[j]
        }
      }
    }
    if (!power) continue
    // The other half mirrors it; a little weight on small echoes steadies a pitch the call barely played.
    const steady = power * 1e-3 + 1e-12
    for (let i = 0; i < TAPS; i++) {
      ar[i * TAPS + i] += steady
      for (let j = 0; j < i; j++) {
        ar[i * TAPS + j] = ar[j * TAPS + i]
        ai[i * TAPS + j] = -ai[j * TAPS + i]
      }
    }
    solve(ar, ai, br, bi)
    for (let t = 0; t < T; t++) {
      let yr = 0
      let yi = 0
      for (let j = 0; j < TAPS; j++) {
        const from = t + shift + EARLY - j
        if (from < 0 || from >= call.count) continue
        const cr = call.re[from * BINS + k]
        const ci = call.im[from * BINS + k]
        yr += br[j] * cr - bi[j] * ci
        yi += br[j] * ci + bi[j] * cr
      }
      out.re[t * BINS + k] = yr
      out.im[t * BINS + k] = yi
    }
  }
  return out
}

// ---- a phrase, without the call --------------------------------------------------------------------

/** The microphone with the fitted call taken away, and how each frame came out of it. */
interface Taken {
  rest: Frames
  /** How much of each frame's sound the call explained (0 to 1). */
  explained: Float64Array
  /** How loud each frame was, and how loud what's left of it is (as samples are). */
  loud: Float64Array
  left: Float64Array
}

/**
 * Takes the call, as fitted, away from the microphone. Frame by frame, since how loud the call is
 * in it may change (the microphone's own levelling, a hand on the volume): each frame loses as much
 * of the fitted call as fits it best.
 */
function takeAway(mic: Frames, call: Frames, shift: number, weight?: Float64Array): Taken {
  const c = heardCall(mic, call, shift, weight)
  const T = mic.count
  const rest = { count: T, re: mic.re.slice(), im: mic.im.slice() }
  const explained = new Float64Array(T)
  const loud = new Float64Array(T)
  const left = new Float64Array(T)
  for (let t = 0; t < T; t++) {
    let cross = 0
    let callPower = 0
    let micPower = 0
    for (let k = 0; k < BINS; k++) {
      const i = t * BINS + k
      cross += c.re[i] * mic.re[i] + c.im[i] * mic.im[i]
      callPower += c.re[i] * c.re[i] + c.im[i] * c.im[i]
      micPower += mic.re[i] * mic.re[i] + mic.im[i] * mic.im[i]
    }
    const gain = callPower ? Math.max(0, Math.min(8, cross / callPower)) : 0
    let power = 0
    for (let k = 0; k < BINS; k++) {
      const i = t * BINS + k
      rest.re[i] -= gain * c.re[i]
      rest.im[i] -= gain * c.im[i]
      power += rest.re[i] * rest.re[i] + rest.im[i] * rest.im[i]
    }
    explained[t] = micPower ? 1 - power / micPower : 0
    // As loud as the samples were: a frame's pitches (half of them kept) sum to N × HOP / 2 times
    // its samples' mean square.
    loud[t] = Math.sqrt((2 * micPower) / (N * HOP))
    left[t] = Math.sqrt((2 * power) / (N * HOP))
  }
  return { rest, explained, loud, left }
}

export interface Cleaned {
  /** The phrase with the call taken out of it: the phrase itself, untouched, when it held none. */
  audio: Float32Array
  /** How much of its speech was the call's (ms): 0 when it held none. */
  echoed: number
  /** How much of the person's own speech is left in it (ms). */
  own: number
  /** All of it was the call: nothing of the person's own to hear. */
  allCall: boolean
  /** How late the call was in the microphone (ms), when it was found there. */
  lag?: number
}

export interface EchoOptions {
  /** As much sound as this before the phrase is weighed with it, so a short phrase is judged on more. */
  lookBackMs?: number
  /** Sound this loud is speech (as in cutting phrases). */
  speech?: number
}

/** A frame is the call's when the call explains this much of its sound; the person's own when it explains less than `OWN`. */
const CALLS = 0.7
const OWN = 0.55
/** With less of the person's own speech than this left, a phrase the call was in was all call. */
const ALL_CALL_MS = 150

/** Takes the call out of microphone phrases, remembering how late it arrives from one phrase to the next. */
export class Echo {
  private readonly o: Required<EchoOptions>
  /** How late the call is in the microphone (frames), once it has been found there. */
  private lag: number | null = null
  /** How late it seemed the last time there was a sign of it. */
  private seen: number | null = null

  constructor(o: EchoOptions = {}) {
    this.o = { lookBackMs: o.lookBackMs ?? 6000, speech: o.speech ?? 0.012 }
  }

  /**
   * The microphone's samples `from` to `to` (a phrase), without the call. The two sounds are lined
   * up by when they were heard.
   */
  clean(mic: Recent, call: Recent, from: number, to: number, look = true): Cleaned {
    const start = Math.max(0, from - samples(this.o.lookBackMs))
    // The call that could be in it: from the latest it can arrive before, to the earliest after.
    const before = samples(LATE_MS)
    const at = call.indexAt(mic.timeOf(start))
    return this.remove(mic.slice(start, to), call.slice(at - before, at + (to - start) + samples(EARLY_MS)), before, from - start, look)
  }

  /**
   * `mic`: a stretch of the microphone ending with the phrase, which starts `phraseAt` samples in.
   * `call`: the call from `before` samples before that stretch to a little after it. Without
   * `look` (a phrase still being said, heard many times over), the call is only taken out where
   * it has been found before: how late it is isn't looked for again.
   */
  remove(mic: Float32Array, call: Float32Array, before: number, phraseAt = 0, look = true): Cleaned {
    const phrase = mic.subarray(phraseAt)
    const untouched = (): Cleaned => ({ audio: phrase.slice(), echoed: 0, own: this.spoken(phrase), allCall: false })
    // A call that played nothing can't be in it.
    if ((!look && this.lag === null) || !this.spoken(call)) return untouched()

    // The call's frames on the microphone's grid.
    const skip = before % HOP
    const offset = (before - skip) / HOP
    const m = frames(mic)
    const heard = frames(call.subarray(skip))
    let clear = false
    if (look) {
      const found = lateness(m, heard, offset, -Math.ceil(samples(EARLY_MS) / HOP), offset)
      // A sign of it: it explains some of the sound, and far more than at most other lags (where
      // only chance explains anything). A few words can line up with the call by chance, though,
      // so it's believed when it's unmistakable, or as late as the last time there was a sign.
      const sign = found.explains >= 0.03 && found.explains >= 10 * found.usual
      if (sign) {
        if (found.explains >= 0.3 || (this.seen !== null && Math.abs(found.lag - this.seen) <= 1)) this.lag = found.lag
        this.seen = found.lag
      }
      clear = sign && found.lag === this.lag
    }
    // The call has never been found in the microphone: nothing to take out.
    if (this.lag === null) return untouched()
    const lag = this.lag

    // Fitted again, going mostly by the frames the first fit found to be the call's, so the
    // person's own voice, talking over it, doesn't blur the fit.
    let taken = takeAway(m, heard, offset - lag)
    if (clear)
      taken = takeAway(
        m,
        heard,
        offset - lag,
        taken.explained.map((v) => Math.max(0.02, v) ** 2),
      )
    const { rest, explained, loud, left } = taken

    // Whose each frame is: the call's, the person's own, or neither (quiet, or too mixed to say).
    const first = Math.floor(phraseAt / HOP)
    let own = 0
    let echoed = 0
    const maybe = new Uint8Array(m.count)
    const calls = new Uint8Array(m.count)
    for (let t = first; t < m.count; t++) {
      if (explained[t] >= CALLS && loud[t] > this.o.speech) {
        calls[t] = 1
        echoed++
      } else if (explained[t] < OWN && left[t] > this.o.speech) maybe[t] = 1
    }
    // A voice lasts: a stray frame the call didn't explain (a click, the start of a word) isn't one.
    const mine = new Uint8Array(m.count)
    for (let t = first; t < m.count; t++) {
      let near = 0
      for (let u = Math.max(first, t - 3); u <= Math.min(m.count - 1, t + 3); u++) near += maybe[u]
      if (maybe[t] && near >= 4) {
        mine[t] = 1
        own++
      }
    }
    // Barely any of it was the call: the phrase as it was.
    if (ms(echoed * HOP) < 150) return untouched()

    // What's left of the call is silenced: where the call was, and a moment either side of it. The
    // person's own speech stays, with a moment either side of that.
    const spread = (marks: Uint8Array, by: number) => {
      const out = new Uint8Array(m.count)
      const n = Math.ceil(samples(by) / HOP)
      for (let t = first; t < m.count; t++) if (marks[t]) out.fill(1, Math.max(first, t - n), Math.min(m.count, t + n + 1))
      return out
    }
    const keep = spread(mine, 200)
    const gone = spread(calls, 100)
    for (let t = 0; t < m.count; t++)
      if (t < first || (gone[t] && !keep[t]))
        for (let k = 0; k < BINS; k++) {
          rest.re[t * BINS + k] = 0
          rest.im[t * BINS + k] = 0
        }
    const audio = sound(rest, mic.length).slice(phraseAt)
    return { audio, echoed: ms(echoed * HOP), own: ms(own * HOP), allCall: ms(own * HOP) < ALL_CALL_MS, lag: ms(lag * HOP) }
  }

  /** How much of a sound is as loud as speech (ms). */
  private spoken(a: Float32Array): number {
    let n = 0
    for (let at = 0; at + HOP <= a.length; at += HOP) {
      let sum = 0
      for (let i = at; i < at + HOP; i++) sum += a[i] * a[i]
      if (Math.sqrt(sum / HOP) > this.o.speech) n++
    }
    return ms(n * HOP)
  }
}
