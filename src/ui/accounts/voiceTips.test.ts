import { describe, expect, it } from 'vitest'
import { VOICE_TIPS, voiceStep } from './voiceTips'

describe('what to change when voices are told apart wrongly', () => {
  it('moves a setting one step, to two places, and never past what’s allowed', () => {
    expect(voiceStep(0.72, 0.04, 0.3, 0.99)).toBe(0.76)
    expect(voiceStep(0.72, -0.04, 0.3, 0.99)).toBe(0.68)
    expect(voiceStep(0.98, 0.04, 0.3, 0.99)).toBe(0.99)
    expect(voiceStep(0.31, -0.04, 0.3, 0.99)).toBe(0.3)
    // Nothing left to move: the example is where it already is.
    expect(voiceStep(0.99, 0.03, 0.3, 0.99)).toBe(0.99)
  })

  it('raises what tells people apart when they’re heard as one, and lowers it when one is heard as several', () => {
    const tip = (re: RegExp) => VOICE_TIPS.find((t) => re.test(t.see))!
    expect(tip(/heard as one person/)).toMatchObject({ key: 'threshold' })
    expect(tip(/heard as one person/).by).toBeGreaterThan(0)
    expect(tip(/turning into several/)).toMatchObject({ key: 'threshold' })
    expect(tip(/turning into several/).by).toBeLessThan(0)
    expect(tip(/ends up as two/)).toMatchObject({ key: 'same' })
    expect(tip(/ends up as two/).by).toBeLessThan(0)
    expect(tip(/remembered person/)).toMatchObject({ key: 'recall' })
    expect(tip(/remembered person/).by).toBeGreaterThan(0)
  })
})
