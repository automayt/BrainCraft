import { describe, expect, it } from 'vitest'
import { PushToMute } from './pushToMute'

function setup() {
  let t = 0
  let muted = false
  const seen: boolean[] = []
  const p = new PushToMute({ get: () => muted, set: (m) => seen.push((muted = m)), now: () => t })
  return { p, tick: (ms: number) => (t += ms), muted: () => muted, seen }
}

describe('Space mutes the microphone in Flowstate', () => {
  it('a tap mutes, and another tap unmutes', () => {
    const s = setup()
    s.p.down()
    // Muted from the press, before it's known to be a tap.
    expect(s.muted()).toBe(true)
    s.tick(120)
    s.p.up()
    expect(s.muted()).toBe(true)
    s.tick(5000)
    s.p.down()
    s.tick(100)
    s.p.up()
    expect(s.muted()).toBe(false)
  })

  it('holding mutes only while held', () => {
    const s = setup()
    s.p.down()
    expect(s.muted()).toBe(true)
    s.tick(2000)
    s.p.up()
    expect(s.muted()).toBe(false)
  })

  it('holding while muted leaves it muted, and a key repeat changes nothing', () => {
    const s = setup()
    s.p.down()
    s.p.up()
    s.p.down()
    s.p.down()
    s.tick(1500)
    s.p.up()
    expect(s.muted()).toBe(true)
  })

  it('a hold interrupted by leaving the window puts it back', () => {
    const s = setup()
    s.p.down()
    s.p.cancel()
    expect(s.muted()).toBe(false)
    s.p.up()
    expect(s.muted()).toBe(false)
  })
})
