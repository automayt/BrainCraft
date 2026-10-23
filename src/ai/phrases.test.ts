import { describe, expect, it } from 'vitest'
import { Downsampler, Phrases, RATE, wav } from './phrases'

/** `ms` of sound at 16 kHz: a tone loud enough to be speech, or near silence. */
const sound = (ms: number, loud: boolean) => {
  const a = new Float32Array((ms / 1000) * RATE)
  for (let i = 0; i < a.length; i++) a[i] = loud ? 0.3 * Math.sin(i / 5) : 0.001 * Math.sin(i)
  return a
}
/** Fed in 64 ms batches, as the microphone delivers it. */
const feed = (p: Phrases, ms: number, loud: boolean) => {
  for (let t = 0; t < ms; t += 64) p.feed(sound(Math.min(64, ms - t), loud))
}
const seconds = (a: Float32Array) => a.length / RATE

describe('cutting speech into phrases', () => {
  it('ends a phrase at a pause, keeping a moment before it and little of the silence after', () => {
    const got: Float32Array[] = []
    const events: string[] = []
    const p = new Phrases({ pauseMs: 700 }, { started: () => events.push('started'), phrase: (a) => (got.push(a), events.push('phrase')) })
    feed(p, 3000, false)
    feed(p, 1500, true)
    feed(p, 600, false)
    expect(got).toEqual([])
    feed(p, 200, false)
    expect(events).toEqual(['started', 'phrase'])
    // 1.5 s of speech, with about 0.4 s before it and 0.3 s after: not the 3 s of silence first.
    expect(seconds(got[0])).toBeGreaterThan(2.1)
    expect(seconds(got[0])).toBeLessThan(2.4)
  })

  it('drops a click or a cough, and cuts a phrase that never pauses', () => {
    const got: Float32Array[] = []
    let dropped = 0
    const p = new Phrases({ pauseMs: 700, maxMs: 5000 }, { phrase: (a) => got.push(a), dropped: () => dropped++ })
    feed(p, 200, true)
    feed(p, 1000, false)
    expect(got).toEqual([])
    expect(dropped).toBe(1)
    feed(p, 7000, true)
    expect(got.length).toBe(1)
    expect(seconds(got[0])).toBeLessThanOrEqual(5.1)
  })

  it('offers the phrase so far while it is being said, numbered so a late answer can be told apart', () => {
    const previews: { s: number; id: number }[] = []
    const ids: number[] = []
    const p = new Phrases({ previewMs: 1000 }, { phrase: (_a, id) => ids.push(id), preview: (a, id) => previews.push({ s: seconds(a), id }) })
    feed(p, 3200, true)
    expect(previews.map((x) => x.id)).toEqual([1, 1, 1])
    expect(previews[2].s).toBeGreaterThan(previews[0].s)
    feed(p, 1000, false)
    expect(ids).toEqual([1])
    expect(p.id).toBe(2)
    // No new speech, no new previews.
    expect(previews.length).toBe(3)
  })

  it('ends what was being said when stopped', () => {
    const got: Float32Array[] = []
    const p = new Phrases({}, { phrase: (a) => got.push(a) })
    feed(p, 800, true)
    p.end()
    expect(got.length).toBe(1)
    p.end()
    expect(got.length).toBe(1)
  })
})

describe('16 kHz WAV', () => {
  it('brings 48 kHz down to 16 kHz', () => {
    const d = new Downsampler(48_000)
    const a = d.push(new Float32Array(4800).fill(0.5))
    expect(a.length).toBe(1600)
    expect(a[10]).toBeCloseTo(0.5)
    // 44.1 kHz carries the remainder over from batch to batch.
    const e = new Downsampler(44_100)
    let n = 0
    for (let k = 0; k < 10; k++) n += e.push(new Float32Array(4410)).length
    expect(Math.abs(n - 16_000)).toBeLessThanOrEqual(1)
  })

  it('writes a mono 16-bit WAV file', async () => {
    const b = wav(new Float32Array([0, 1, -1, 2]))
    expect(b.type).toBe('audio/wav')
    const v = new DataView(await b.arrayBuffer())
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF')
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16_000)
    expect(v.getUint32(40, true)).toBe(8)
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32767, 32767])
  })
})

describe('phrase settings left unset', () => {
  it('uses the usual pause', () => {
    const got: Float32Array[] = []
    const p = new Phrases({ pauseMs: undefined, previewMs: 0 }, { phrase: (a) => got.push(a) })
    feed(p, 1000, true)
    feed(p, 800, false)
    expect(got.length).toBe(1)
  })
})
