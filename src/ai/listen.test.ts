import { describe, expect, it } from 'vitest'
import { Utterances } from './listen'

/** A clock and timers that only move when told. */
function clock() {
  let now = 0
  let timers: { at: number; f: () => void; id: number }[] = []
  let next = 1
  return {
    now: () => now,
    setTimer: (f: () => void, ms: number) => {
      const id = next++
      timers.push({ at: now + ms, f, id })
      return id
    },
    clearTimer: (id: unknown) => {
      timers = timers.filter((t) => t.id !== id)
    },
    /** Moves time on, running timers that come due. */
    async tick(ms: number) {
      now += ms
      for (;;) {
        const due = timers.filter((t) => t.at <= now).sort((a, z) => a.at - z.at)[0]
        if (!due) break
        timers = timers.filter((t) => t !== due)
        due.f()
        await Promise.resolve()
      }
    },
  }
}

describe('talking to the assistant', () => {
  it('sends what was said once the speaker pauses, phrases together', async () => {
    const c = clock()
    const sent: string[] = []
    const u = new Utterances(async (t) => void sent.push(t), { ...c, pauseMs: 1000 })
    u.heard('a mind map about')
    await c.tick(500)
    u.heard('our product launch')
    await c.tick(900)
    // Still within the pause after the second phrase.
    expect(sent).toEqual([])
    await c.tick(200)
    expect(sent).toEqual(['a mind map about our product launch'])
  })

  it('keeps talking from waiting for ever, and holds what is said while the assistant answers', async () => {
    const c = clock()
    const sent: string[] = []
    let finish: () => void = () => {}
    const u = new Utterances(
      (t) => {
        sent.push(t)
        return new Promise<void>((done) => (finish = done))
      },
      { ...c, pauseMs: 1000, maxWaitMs: 3000 },
    )
    // Phrase after phrase, never pausing a whole second: three seconds after the first, it all goes.
    for (let k = 0; k < 5; k++) {
      u.heard(`point ${k}`)
      await c.tick(800)
    }
    expect(sent).toEqual(['point 0 point 1 point 2 point 3'])
    expect(u.sending).toBe(true)
    // Said while the assistant is busy: it waits, then goes after a pause.
    u.heard('and another')
    await c.tick(5000)
    expect(sent).toHaveLength(1)
    expect(u.waiting).toBe('point 4 and another')
    finish()
    await Promise.resolve()
    await Promise.resolve()
    await c.tick(1000)
    expect(sent[1]).toBe('point 4 and another')
  })

  it('sends at once when asked, and nothing after stopping', async () => {
    const c = clock()
    const sent: string[] = []
    const u = new Utterances(async (t) => void sent.push(t), { ...c, pauseMs: 1000 })
    u.heard('make it a flowchart')
    u.flush()
    await Promise.resolve()
    expect(sent).toEqual(['make it a flowchart'])
    u.heard('unsent words')
    u.stop()
    await c.tick(5000)
    u.heard('after stopping')
    await c.tick(5000)
    expect(sent).toEqual(['make it a flowchart'])
  })
})

describe('waiting for a phrase still being heard', () => {
  it('holds what was said while the next phrase is said and transcribed, then goes a short pause after', async () => {
    const c = clock()
    const sent: string[] = []
    const u = new Utterances(async (t) => void sent.push(t), { ...c, pauseMs: 300, maxWaitMs: 10_000 })
    u.heard('a flowchart for onboarding')
    // They carry on talking before the pause is up: the next phrase is being said, then transcribed.
    await c.tick(200)
    u.hold(true)
    await c.tick(2000)
    expect(sent).toEqual([])
    u.heard('starting with the signup form')
    u.hold(false)
    await c.tick(299)
    expect(sent).toEqual([])
    await c.tick(1)
    expect(sent).toEqual(['a flowchart for onboarding starting with the signup form'])
  })

  it('still sends after the longest wait if a phrase never ends', async () => {
    const c = clock()
    const sent: string[] = []
    const u = new Utterances(async (t) => void sent.push(t), { ...c, pauseMs: 300, maxWaitMs: 5000 })
    u.heard('a timeline')
    u.hold(true)
    await c.tick(4999)
    expect(sent).toEqual([])
    await c.tick(1)
    expect(sent).toEqual(['a timeline'])
  })
})
