/**
 * Made-up sounds for tests: voices that rise and fall and pause as speech does, and a room for a
 * call to come out of the speakers into. Each is the same every run.
 */

import { RATE } from './phrases'

const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * Someone talking for `seconds`: syllables of a buzz whose pitch and vowel change, some hiss, and
 * a pause between words now and then. Each `who` is a different voice saying different things.
 */
export function voice(who: number, seconds: number, level = 0.06): Float32Array {
  const rnd = random(who * 7919 + 13)
  const out = new Float32Array(Math.round(seconds * RATE))
  const pitch = 95 + rnd() * 110
  let at = Math.round(rnd() * 0.1 * RATE)
  let phase = 0
  while (at < out.length) {
    const length = Math.round((0.11 + rnd() * 0.2) * RATE)
    const f0 = pitch * (0.85 + rnd() * 0.3)
    const bend = (rnd() - 0.5) * 0.25
    // A vowel: two or three pitches it rings at.
    const rings = [300 + rnd() * 500, 900 + rnd() * 1400, 2300 + rnd() * 900]
    const hiss = rnd() < 0.3 ? 0.5 + rnd() : 0.08
    const harmonics = Math.floor(3800 / f0)
    const loud = Array.from({ length: harmonics }, (_, h) => {
      const f = f0 * (h + 1)
      return rings.reduce((s, r, i) => s + Math.exp(-(((f - r) / (120 + i * 60)) ** 2)) / (i + 1), 0.02) * (0.6 + rnd() * 0.8)
    })
    for (let i = 0; i < length && at + i < out.length; i++) {
      const shape = Math.sin((Math.PI * i) / length) ** 0.7
      phase += (2 * Math.PI * f0 * (1 + (bend * i) / length)) / RATE
      let v = 0
      for (let h = 0; h < harmonics; h++) v += loud[h] * Math.sin(phase * (h + 1))
      out[at + i] = shape * (v + hiss * (rnd() - 0.5))
    }
    at += length + Math.round((rnd() < 0.18 ? 0.25 + rnd() * 0.35 : 0.02 + rnd() * 0.08) * RATE)
  }
  // As loud as asked, going by its louder half.
  const frames: number[] = []
  for (let i = 0; i + 320 <= out.length; i += 320) {
    let s = 0
    for (let j = i; j < i + 320; j++) s += out[j] * out[j]
    frames.push(s / 320)
  }
  frames.sort((a, b) => b - a)
  const top = frames.slice(0, Math.max(1, frames.length >> 1))
  const now = Math.sqrt(top.reduce((s, v) => s + v, 0) / top.length) || 1
  return out.map((v) => (v * level) / now)
}

/** A sound as a microphone hears it from the speakers: `lateMs` late, a few bounces, a short tail, quieter. */
export function fromSpeakers(played: Float32Array, lateMs: number, gain = 0.5, seed = 1): Float32Array {
  const rnd = random(seed)
  const late = Math.round((lateMs / 1000) * RATE)
  const taps: [number, number][] = [
    [0, 1],
    [37, 0.45],
    [160, -0.3],
    [410, 0.2],
    [900, -0.12],
  ]
  for (let i = 0; i < 40; i++) taps.push([Math.floor(20 + rnd() * 1500), (rnd() - 0.5) * 0.12])
  const out = new Float32Array(played.length)
  for (const [d, g] of taps) for (let i = Math.max(0, late + d); i < Math.min(out.length, played.length + late + d); i++) out[i] += played[i - late - d] * g * gain
  return out
}

/** A room's hush. */
export function hush(samples: number, level = 0.0015, seed = 3): Float32Array {
  const rnd = random(seed)
  return Float32Array.from({ length: samples }, () => (rnd() - 0.5) * 3.46 * level)
}

/** Sounds on top of each other, each starting `at` seconds in. */
export function together(seconds: number, ...parts: [sound: Float32Array, at?: number][]): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (const [s, at = 0] of parts) {
    const from = Math.round(at * RATE)
    for (let i = 0; i < s.length && from + i < out.length; i++) if (from + i >= 0) out[from + i] += s[i]
  }
  return out
}
