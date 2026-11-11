import { describe, expect, it } from 'vitest'
import { callInputs } from './callAudio'

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
