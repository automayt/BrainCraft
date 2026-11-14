import { afterEach, describe, expect, it, vi } from 'vitest'
import { RATE } from './phrases'
import { fromSpeakers, hush, together, voice } from './sounds.testing'
import { browserEar, type HeardFrom, serverEar } from './speech'

/** The browser's sound, stood in for: each sound listened to hands its batches on when the test says. */
function browser() {
  const taps: { port: { onmessage: ((e: { data: Float32Array }) => void) | null } }[] = []
  /** Each time the microphone was asked for: how, and whether it has been let go since. */
  const mics: { echoCancellation: unknown; stopped: boolean }[] = []
  const sound = (kept = { stopped: false }) => {
    const track = { getSettings: () => ({ sampleRate: RATE }), stop: () => void (kept.stopped = true) }
    return { getAudioTracks: () => [track], getTracks: () => [track] }
  }
  const stream = sound()
  class Context {
    sampleRate = RATE
    state = 'running'
    destination = {}
    audioWorklet = { addModule: async () => {} }
    createMediaStreamSource = () => ({ connect() {}, disconnect() {} })
    createGain = () => ({ gain: { value: 1 }, connect: () => ({ connect() {} }) })
    createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [{}] } })
    close = async () => {}
  }
  class Node {
    port = { onmessage: null as ((e: { data: Float32Array }) => void) | null }
    constructor() {
      taps.push(this)
    }
    connect() {
      return { connect() {} }
    }
  }
  const getUserMedia = async (asked: { audio: MediaTrackConstraints }) => {
    const mic = { echoCancellation: asked.audio.echoCancellation, stopped: false }
    mics.push(mic)
    return sound(mic)
  }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('AudioContext', Context)
  vi.stubGlobal('AudioWorkletNode', Node)
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  /** Plays sounds into taps side by side, a batch at a time, as the audio thread would. */
  const play = (sounds: [tap: number, sound: Float32Array][]) => {
    const length = Math.max(...sounds.map(([, s]) => s.length))
    for (let at = 0; at < length; at += 2048) {
      now += (2048 / RATE) * 1000
      for (const [tap, s] of sounds) if (at < s.length) taps[tap].port.onmessage?.({ data: s.slice(at, at + 2048) })
    }
  }
  return { stream: stream as unknown as MediaStream, play, mics }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('hearing a call and the microphone', () => {
  it('hears what the call said once, from the call, though it also came out of the speakers', async () => {
    const b = browser()
    const sent: (HeardFrom | undefined)[] = []
    const heard: [string, HeardFrom | undefined][] = []
    const ear = await serverEar(
      {
        meeting: true,
        pauseMs: 500,
        transcribe: async (_audio, _preview, from) => {
          sent.push(from)
          return { text: from === 'call' ? 'what Bea said' : 'what Ann said' }
        },
      },
      { final: (text, _voice, _at, _unclear, from) => heard.push([text, from]), error: (m) => expect(m).toBe('') },
    )
    // The call is heard too: its sound (tap 1), and the microphone again, for Ann alone (tap 2).
    await ear.hearCall!(b.stream)

    // Bea talks on the call for three seconds, and comes out of the speakers into the microphone.
    // After a pause Ann answers, and the call is quiet.
    const bea = voice(2, 3, 0.12)
    const ann = voice(1, 2)
    const call = together(8, [bea])
    const mic = together(8, [fromSpeakers(bea, 110)], [ann, 4.5], [hush(8 * RATE)])
    b.play([
      [1, call],
      [2, mic],
    ])
    await ear.stop()

    // Bea's words from the call only; Ann's from the microphone. Bea's echo wasn't even sent.
    expect(heard.filter(([, from]) => from === 'me')).toEqual([['what Ann said', 'me']])
    expect(heard.filter(([, from]) => from === 'call').length).toBeGreaterThan(0)
    expect(heard[heard.length - 1]).toEqual(['what Ann said', 'me'])
    expect(sent.filter((from) => from === 'me').length).toBe(1)
  })

  it('keeps the two lined up after a stretch on mute', async () => {
    const b = browser()
    const heard: (HeardFrom | undefined)[] = []
    const ear = await serverEar(
      { meeting: true, pauseMs: 500, transcribe: async () => ({ text: 'words' }) },
      { final: (_t, _v, _a, _u, from) => heard.push(from), error: (m) => expect(m).toBe('') },
    )
    await ear.hearCall!(b.stream)
    // Muted while Ann says something aside: nothing is heard, but the sound still goes by.
    ear.mute(true)
    b.play([
      [1, new Float32Array(3 * RATE)],
      [2, together(3, [voice(1, 3)], [hush(3 * RATE)])],
    ])
    ear.mute(false)
    expect(heard).toEqual([])
    // Listening again: Bea goes on, out of the speakers as before. Still only heard from the call.
    const bea = voice(2, 3, 0.12)
    b.play([
      [1, together(4.5, [bea])],
      [2, together(4.5, [fromSpeakers(bea, 110)], [hush(4.5 * RATE)])],
    ])
    await ear.stop()
    expect(heard.length).toBeGreaterThan(0)
    expect(heard.every((from) => from === 'call')).toBe(true)
  })

  it('still hears the person when the call is quiet, or was never in the microphone', async () => {
    const b = browser()
    const heard: (HeardFrom | undefined)[] = []
    const ear = await serverEar(
      { meeting: true, pauseMs: 500, transcribe: async () => ({ text: 'words' }) },
      { final: (_t, _v, _a, _u, from) => heard.push(from), error: (m) => expect(m).toBe('') },
    )
    await ear.hearCall!(b.stream)
    // Bea talks on the call, which stays out of the microphone (headphones, or the browser took it out); Ann talks over her.
    b.play([
      [1, together(6, [voice(2, 5, 0.12)])],
      [2, together(6, [voice(1, 1.5), 1], [voice(3, 0.5), 4], [hush(6 * RATE)])],
    ])
    await ear.stop()
    expect(heard.filter((f) => f === 'me').length).toBe(2)
    expect(heard.filter((f) => f === 'call').length).toBeGreaterThan(0)
  })
})

describe('echo removal, on or off', () => {
  it('hears the microphone as it is when off, and takes the call out again when back on', async () => {
    const b = browser()
    let sent: (HeardFrom | undefined)[] = []
    const ear = await serverEar(
      {
        meeting: true,
        pauseMs: 500,
        removeEcho: false,
        transcribe: async (_audio, _preview, from) => {
          sent.push(from)
          return { text: 'words' }
        },
      },
      { final() {}, error: (m) => expect(m).toBe('') },
    )
    await ear.hearCall!(b.stream)
    // Bea talks on the call and comes out of the speakers, each time; the microphone is tap `mic`.
    const said = (mic: number) => {
      sent = []
      const bea = voice(2, 3, 0.12)
      b.play([
        [1, together(4.5, [bea])],
        [mic, together(4.5, [fromSpeakers(bea, 110)], [hush(4.5 * RATE)])],
      ])
      return sent
    }
    // Off: the browser isn't asked to cancel echo, and what the speakers played is heard as the person's too.
    expect(b.mics[b.mics.length - 1].echoCancellation).toBe(false)
    const off = said(2)
    expect(off).toContain('me')
    expect(off).toContain('call')

    // On: the microphone is asked for again, with echo cancelling, and the call is taken out here.
    await ear.removeEcho!(true)
    expect(b.mics[b.mics.length - 1].echoCancellation).toBe(true)
    const back = said(3)
    expect(back).not.toContain('me')
    expect(back).toContain('call')

    // Off again, mid-meeting.
    await ear.removeEcho!(false)
    expect(b.mics[b.mics.length - 1].echoCancellation).toBe(false)
    expect(said(4)).toContain('me')

    // Only the microphone in use is still open; none once it stops.
    expect(b.mics.map((m) => m.stopped)).toEqual([...b.mics.slice(1).map(() => true), false])
    await ear.stop()
    expect(b.mics.every((m) => m.stopped)).toBe(true)
  })

  it('leaves no microphone open when it’s switched twice at once', async () => {
    const b = browser()
    const ear = await serverEar({ meeting: true, transcribe: async () => ({ text: 'words' }) }, { final() {}, error: (m) => expect(m).toBe('') })
    await ear.hearCall!(b.stream)
    const before = b.mics.length
    await Promise.all([ear.removeEcho!(false), ear.removeEcho!(true)])
    // As it was, so the microphone in use is still the one that cancels echo: asked for once more at most.
    expect(b.mics.length - before).toBeLessThanOrEqual(1)
    expect(b.mics[b.mics.length - 1].echoCancellation).toBe(true)
    expect(b.mics.filter((m) => !m.stopped).length).toBe(1)
    await ear.stop()
    expect(b.mics.every((m) => m.stopped)).toBe(true)
  })

  it('is chosen before the call is heard too, and nothing changes until it is', async () => {
    const b = browser()
    const ear = await serverEar({ meeting: true, transcribe: async () => ({ text: 'words' }) }, { final() {}, error: (m) => expect(m).toBe('') })
    await ear.removeEcho!(false)
    // The room's microphone, as it was.
    expect(b.mics.length).toBe(1)
    await ear.hearCall!(b.stream)
    expect(b.mics[b.mics.length - 1].echoCancellation).toBe(false)
    await ear.stop()
  })

  it('is the browser’s own echo cancelling, with its own recognition', async () => {
    const b = browser()
    class Recognition {
      onend: (() => void) | null = null
      start() {}
      stop() {
        this.onend?.()
      }
    }
    vi.stubGlobal('SpeechRecognition', Recognition)
    const ear = browserEar('en-US', { final() {}, error: (m) => expect(m).toBe('') })
    await ear.hearCall!(b.stream)
    expect(b.mics.map((m) => [m.echoCancellation, m.stopped])).toEqual([[true, false]])
    await ear.removeEcho!(false)
    expect(b.mics.map((m) => [m.echoCancellation, m.stopped])).toEqual([
      [true, true],
      [false, false],
    ])
    await ear.stop()
    expect(b.mics.every((m) => m.stopped)).toBe(true)
  })
})
