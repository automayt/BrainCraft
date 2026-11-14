import { describe, expect, it } from 'vitest'
import { callInputs, echoRemovalWanted, micOnCall, wantEchoRemoval } from './callAudio'

describe('inputs the call could come from', () => {
  it('lists real inputs, those carrying the computer’s sound first, without the stand-ins for the default', () => {
    const d = (deviceId: string, label: string, kind = 'audioinput') => ({ deviceId, label, kind: kind as MediaDeviceKind })
    const out = callInputs([
      d('default', 'Default - Microphone (USB Audio)'),
      d('communications', 'Communications - Microphone (USB Audio)'),
      d('mic', 'Microphone (USB Audio) (1c75:af90)'),
      d('loop', 'Loopback (USB Audio)'),
      d('mix', 'Stereo Mix (Realtek(R) Audio)'),
      d('spk', 'Speakers', 'audiooutput'),
      d('nameless', ''),
    ])
    expect(out.map((i) => i.id)).toEqual(['loop', 'mix', 'mic'])
    expect(out.find((i) => i.id === 'mic')).toEqual({ id: 'mic', label: 'Microphone (USB Audio)', likely: false })
    expect(out[0].likely).toBe(true)
  })
})

describe('echo removal, as chosen', () => {
  it('is on unless it was turned off in this browser, and is remembered', () => {
    const kept = new Map<string, string>()
    const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) }
    expect(echoRemovalWanted(store)).toBe(true)
    wantEchoRemoval(false, store)
    expect(echoRemovalWanted(store)).toBe(false)
    wantEchoRemoval(true, store)
    expect(echoRemovalWanted(store)).toBe(true)
    expect(kept.size).toBe(0)
  })

  it('is on where nothing can be remembered', () => {
    expect(echoRemovalWanted(null)).toBe(true)
    const blocked = () => {
      throw new Error('blocked')
    }
    expect(echoRemovalWanted({ getItem: blocked })).toBe(true)
    expect(() => wantEchoRemoval(false, { setItem: blocked, removeItem: blocked })).not.toThrow()
  })

  it('asks the microphone for echo cancelling only with echo removal on', () => {
    expect(micOnCall().echoCancellation).toBe(true)
    expect(micOnCall(false).echoCancellation).toBe(false)
    // Noise is still reduced either way.
    expect(micOnCall(false).noiseSuppression).toBe(true)
  })
})
