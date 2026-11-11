import { describe, expect, it } from 'vitest'
import { splitPhrases } from './recording'

const RATE = 16_000

/** A made-up recording: quiet hiss, with speech-like buzz for each [start, end] (seconds). */
function recording(seconds: number, speech: [number, number][], loud = 0.3): Float32Array {
  const out = new Float32Array(seconds * RATE)
  let seed = 7
  const noise = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647 - 0.5
  }
  for (let k = 0; k < out.length; k++) out[k] = noise() * 0.004
  for (const [a, b] of speech)
    for (let k = Math.round(a * RATE); k < Math.round(b * RATE); k++) {
      const t = k / RATE
      out[k] += loud * Math.sin(2 * Math.PI * 160 * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 4 * t))
    }
  return out
}

const secs = (spans: { start: number; end: number }[]) => spans.map((s) => [Math.round((s.start / RATE) * 10) / 10, Math.round((s.end / RATE) * 10) / 10])

describe('cutting a recording into phrases', () => {
  it('finds each stretch of speech, with a little either side', () => {
    const spans = splitPhrases(recording(12, [[1, 3], [5, 6.5], [9, 11]]))
    expect(spans).toHaveLength(3)
    // To within a frame or two (it looks at the sound 30 ms at a time).
    const want = [
      [0.75, 3.25],
      [4.75, 6.75],
      [8.75, 11.25],
    ]
    secs(spans).forEach(([a, b], k) => {
      expect(Math.abs(a - want[k][0])).toBeLessThan(0.1)
      expect(Math.abs(b - want[k][1])).toBeLessThan(0.1)
    })
  })

  it('keeps a short breath inside a phrase, and drops a click', () => {
    const spans = splitPhrases(recording(8, [[1, 2], [2.2, 3.5], [6, 6.05]]))
    expect(spans).toHaveLength(1)
  })

  it('keeps a pause for thought mid-sentence inside the phrase, so it keeps its sense', () => {
    expect(splitPhrases(recording(8, [[1, 2.5], [3.1, 4.5]]))).toHaveLength(1)
    expect(splitPhrases(recording(8, [[1, 2.5], [4, 5.5]]))).toHaveLength(2)
  })

  it('cuts a long run of talk at its quietest moment', () => {
    // Forty seconds without a pause, with a dip at 20 s.
    const talk = recording(44, [[1, 19.95], [20.05, 41]])
    const spans = splitPhrases(talk, RATE, { pause: 0.45, longest: 25 })
    expect(spans.length).toBeGreaterThanOrEqual(2)
    for (const s of spans) expect((s.end - s.start) / RATE).toBeLessThanOrEqual(25.5)
  })

  it('finds nothing in silence', () => {
    expect(splitPhrases(recording(5, []))).toEqual([])
    expect(splitPhrases(new Float32Array(0))).toEqual([])
  })

  it('hears a quiet speaker on a quiet recording', () => {
    expect(splitPhrases(recording(10, [[2, 4], [6, 8]], 0.03))).toHaveLength(2)
  })
})
