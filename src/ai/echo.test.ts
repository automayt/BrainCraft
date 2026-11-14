import { describe, expect, it } from 'vitest'
import { EARLY_MS, Echo, LATE_MS, Recent } from './echo'
import { RATE } from './phrases'
import { fromSpeakers, hush, together, voice } from './sounds.testing'

const samples = (seconds: number) => Math.round(seconds * RATE)
const BEFORE = samples(LATE_MS / 1000)
const AFTER = samples(EARLY_MS / 1000)

/** The call as `remove` wants it: from a little before the microphone's stretch to a little after. */
const around = (call: Float32Array) => {
  const out = new Float32Array(BEFORE + call.length + AFTER)
  out.set(call, BEFORE)
  return out
}
const power = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return s / Math.max(1, to - from)
}
const apart = (a: Float32Array, b: Float32Array) => power(a.map((v, i) => v - b[i]))
const db = (x: number) => 10 * Math.log10(x)

/** A moment on a call: Bea talks on the call; the microphone hears it from the speakers `lateMs` late. */
const leaked = (seconds: number, who = 2, lateMs = 120, gain = 0.5) => {
  const call = voice(who, seconds, 0.12)
  return { call, echo: fromSpeakers(call, lateMs, gain) }
}

describe('taking the call back out of the microphone', () => {
  it('drops a phrase that was only the call coming out of the speakers', () => {
    const { call, echo } = leaked(3)
    const mic = together(3, [echo], [hush(samples(3))])
    const out = new Echo().remove(mic, around(call), BEFORE)
    expect(out.allCall).toBe(true)
    expect(out.echoed).toBeGreaterThan(1000)
    expect(out.own).toBeLessThan(100)
    expect(out.lag).toBeGreaterThan(80)
    expect(out.lag).toBeLessThan(160)
  })

  it('finds the call however late it is, and a little early', () => {
    for (const late of [20, 300, 700, -80]) {
      const { call, echo } = leaked(3, 4, late)
      const out = new Echo().remove(together(3, [echo], [hush(samples(3))]), around(call), BEFORE)
      expect(out.allCall, `${late} ms late`).toBe(true)
      expect(Math.abs(out.lag! - late), `${late} ms late`).toBeLessThan(40)
    }
  })

  it('leaves the person’s own voice exactly as it was while the call talks', () => {
    const call = voice(2, 4, 0.12)
    for (const seconds of [4, 1.2, 0.5]) {
      const mic = together(seconds, [voice(1, seconds)], [hush(samples(seconds))])
      const out = new Echo().remove(mic, around(call.subarray(0, samples(seconds))), BEFORE)
      expect(out.allCall).toBe(false)
      expect(out.echoed).toBe(0)
      expect([...out.audio]).toEqual([...mic])
    }
  })

  it('leaves the microphone alone when the call played nothing', () => {
    const mic = together(2, [voice(1, 2)], [hush(samples(2))])
    const out = new Echo().remove(mic, around(new Float32Array(samples(2))), BEFORE)
    expect(out.echoed).toBe(0)
    expect([...out.audio]).toEqual([...mic])
  })

  it('keeps the person’s turn and silences the call’s, in one phrase', () => {
    // Ann for two seconds, then the call for three.
    const ann = voice(1, 2)
    const call = together(6, [voice(2, 3, 0.12), 2.6])
    const mic = together(6, [ann], [fromSpeakers(call, 120)], [hush(samples(6))])
    const out = new Echo().remove(mic, around(call), BEFORE)
    expect(out.allCall).toBe(false)
    expect(out.own).toBeGreaterThan(1000)
    expect(out.echoed).toBeGreaterThan(1000)
    // The call's turn is all but gone; Ann's is as it was.
    expect(db(power(out.audio, samples(3), samples(5.5)) / power(mic, samples(3), samples(5.5)))).toBeLessThan(-20)
    expect(db(apart(out.audio.subarray(0, samples(2)), ann) / power(ann))).toBeLessThan(-10)
  })

  it('takes the call out from under the person’s voice, once it has been found', () => {
    const e = new Echo()
    const before = leaked(3, 5)
    expect(e.remove(together(3, [before.echo], [hush(samples(3))]), around(before.call), BEFORE).allCall).toBe(true)
    // Both at once: the call half as loud as Ann.
    const ann = voice(1, 4)
    const { call, echo } = leaked(4, 2, 120, 0.25)
    const mic = together(4, [ann], [echo], [hush(samples(4))])
    const out = e.remove(mic, around(call), BEFORE)
    expect(out.allCall).toBe(false)
    expect(out.own).toBeGreaterThan(1500)
    // What's left is a good deal closer to Ann alone than the microphone was.
    expect(db(apart(mic, ann) / apart(out.audio, ann))).toBeGreaterThan(5)
  })

  it('believes a faint sign of the call only when it comes again as late', () => {
    const e = new Echo()
    // Ann talking over a quiet call: a sign of the call, but a few words can line up by chance.
    const phrase = (who: number, callWho: number) => {
      const ann = voice(who, 4)
      const { call, echo } = leaked(4, callWho, 120, 0.3)
      return { mic: together(4, [ann], [echo], [hush(samples(4))]), call }
    }
    const first = phrase(1, 2)
    const one = e.remove(first.mic, around(first.call), BEFORE)
    expect(one.echoed).toBe(0)
    expect([...one.audio]).toEqual([...first.mic])
    const second = phrase(3, 4)
    const two = e.remove(second.mic, around(second.call), BEFORE)
    expect(two.echoed).toBeGreaterThan(150)
    expect(two.allCall).toBe(false)
  })

  it('doesn’t take the person’s voice for the call when the far end sends it back', () => {
    // Ann's own voice returns in the call 400 ms later: the call "has" her words, but after she said them.
    const ann = voice(1, 4)
    const mic = together(4, [ann], [hush(samples(4))])
    const call = together(4, [ann.map((v) => v * 0.8), 0.4])
    const out = new Echo().remove(mic, around(call), BEFORE)
    expect(out.echoed).toBe(0)
    expect([...out.audio]).toEqual([...mic])
  })

  it('judges a short phrase with the sound before it', () => {
    // Two seconds of the call alone, then "yes" from Ann: only the last half second is the phrase.
    const call = voice(2, 2.5, 0.12)
    const yes = voice(1, 0.45)
    const mic = together(2.5, [fromSpeakers(call.subarray(0, samples(1.9)), 120)], [yes, 2.05], [hush(samples(2.5))])
    const out = new Echo().remove(mic, around(call), BEFORE, samples(2))
    expect(out.audio.length).toBe(samples(0.5))
    expect(out.allCall).toBe(false)
  })

  it('takes the call out of a phrase still being said only where it has been found before', () => {
    const e = new Echo()
    const { call, echo } = leaked(3)
    const mic = together(3, [echo], [hush(samples(3))])
    // Not looked for: left alone.
    expect(e.remove(mic, around(call), BEFORE, 0, false).echoed).toBe(0)
    expect(e.remove(mic, around(call), BEFORE).allCall).toBe(true)
    const next = leaked(2, 6)
    expect(e.remove(together(2, [next.echo], [hush(samples(2))]), around(next.call), BEFORE, 0, false).allCall).toBe(true)
  })
})

describe('the last while of a sound', () => {
  it('keeps what was heard lately, and silence for the rest', () => {
    const r = new Recent(1000)
    const count = Float32Array.from({ length: RATE * 3 }, (_, i) => i)
    for (let at = 0; at < count.length; at += 700) r.push(count.subarray(at, at + 700), (at / RATE) * 1000)
    expect(r.length).toBe(RATE * 3)
    // The last second is there; before it, and after the end, silence.
    expect(Array.from(r.slice(RATE * 3 - 3, RATE * 3 + 2))).toEqual([RATE * 3 - 3, RATE * 3 - 2, RATE * 3 - 1, 0, 0])
    expect(Array.from(r.slice(RATE - 2, RATE + 1))).toEqual([0, 0, 0])
    expect(r.slice(-5, 3).length).toBe(8)
  })

  it('knows when each sample was heard, however unevenly the batches arrive', () => {
    const r = new Recent()
    // It began at 5000 ms; batches of 128 ms arrive 5 to 60 ms late, one on time.
    let late = 17
    for (let n = 1; n <= 40; n++) {
      late = (late * 31 + 7) % 56
      r.push(new Float32Array(2048), 5000 + n * 128 + (n === 9 ? 0 : 5 + late))
    }
    expect(r.timeOf(0)).toBeCloseTo(5000, 5)
    expect(r.timeOf(RATE)).toBeCloseTo(6000, 5)
    expect(r.indexAt(5500)).toBe(RATE / 2)
  })

  it('lines the microphone up with a call that started at another time', () => {
    // The call has been heard since 1000 ms; the microphone since 3250 ms. Batches arrive unevenly.
    const call = new Recent()
    const mic = new Recent()
    const said = voice(2, 8, 0.12)
    const heard = together(5.75, [fromSpeakers(said, 100).subarray(samples(2.25))], [hush(samples(5.75))])
    let jitter = 3
    const push = (r: Recent, sound: Float32Array, start: number) => {
      for (let at = 0; at < sound.length; at += 683) {
        jitter = (jitter * 29 + 11) % 37
        r.push(sound.subarray(at, at + 683), start + ((at + 683) / RATE) * 1000 + (at === 683 * 4 ? 0 : jitter))
      }
    }
    push(call, said, 1000)
    push(mic, heard, 3250)
    const out = new Echo().clean(mic, call, samples(1), samples(4))
    expect(out.allCall).toBe(true)
    expect(Math.abs(out.lag! - 100)).toBeLessThan(40)
  })
})
