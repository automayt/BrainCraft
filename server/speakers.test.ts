import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AiGate } from './aiProxy'
import { req, res } from './accounts/fakes'
import { type Embedder, Voices, wavSamples } from './speakers'
import { Transcriber } from './transcribe'

/** A 16-bit WAV of `seconds` of sound, as the app sends, with `channels` channels. */
function wav(seconds: number, rate = 16000, channels = 1, value = 0.25): Buffer {
  const frames = Math.round(seconds * rate)
  const data = Buffer.alloc(frames * 2 * channels)
  for (let k = 0; k < frames * channels; k++) data.writeInt16LE(Math.round(value * 32767), k * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'ascii')
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8, 'ascii')
  head.write('fmt ', 12, 'ascii')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(channels, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2 * channels, 28)
  head.writeUInt16LE(2 * channels, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36, 'ascii')
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/** A voiceprint near one of a few made-up voices: `who` picks the direction, `wobble` a little noise. */
function print(who: number, wobble = 0.1, dim = 32): Float32Array {
  const v = new Float32Array(dim)
  v[who] = 1
  for (let k = 0; k < dim; k++) v[k] += Math.sin(k * 7.3 + who * 3.1 + wobble * 50) * wobble
  return v
}

describe('reading the app’s recordings', () => {
  it('takes the samples and their rate', () => {
    const s = wavSamples(wav(0.5))!
    expect(s.rate).toBe(16000)
    expect(s.samples).toHaveLength(8000)
    expect(s.samples[0]).toBeCloseTo(0.25, 3)
  })

  it('takes the first channel of a stereo one', () => {
    expect(wavSamples(wav(0.25, 8000, 2))!.samples).toHaveLength(2000)
  })

  it('says no to what isn’t a 16-bit WAV', () => {
    expect(wavSamples(Buffer.from('not a recording at all, just some words here and more'))).toBeNull()
    const eight = wav(0.1)
    eight.writeUInt16LE(8, 34)
    expect(wavSamples(eight)).toBeNull()
    expect(wavSamples(wav(0.1).subarray(0, 20))).toBeNull()
  })

  it('stops at the end of the file, whatever the header claims', () => {
    const cut = wav(1).subarray(0, 44 + 1000)
    expect(wavSamples(cut)!.samples).toHaveLength(500)
  })
})

describe('telling voices apart', () => {
  it('numbers voices in the order they’re first heard, and knows them again', () => {
    const v = new Voices()
    expect(v.place('m', print(0, 0.05), 3)).toBe(1)
    expect(v.place('m', print(1, 0.05), 3)).toBe(2)
    expect(v.place('m', print(0, 0.12), 2)).toBe(1)
    expect(v.place('m', print(2, 0.05), 2)).toBe(3)
    expect(v.place('m', print(1, 0.15), 4)).toBe(2)
  })

  it('keeps each conversation’s voices apart', () => {
    const v = new Voices()
    v.place('a', print(0), 3)
    expect(v.place('b', print(5), 3)).toBe(1)
    expect(v.place('a', print(5), 3)).toBe(2)
  })

  it('won’t start a new voice on a phrase too short to be sure of', () => {
    const v = new Voices()
    expect(v.place('m', print(0), 0.6)).toBeNull()
    expect(v.place('m', print(0), 2)).toBe(1)
    expect(v.place('m', print(0, 0.15), 0.6)).toBe(1)
    expect(v.place('m', print(3), 0.6)).toBeNull()
  })

  it('stops making voices past the most, giving each phrase its nearest', () => {
    const v = new Voices({ most: 2 })
    v.place('m', print(0), 3)
    v.place('m', print(1), 3)
    expect(v.place('m', print(2), 3)).not.toBeNull()
    expect([1, 2]).toContain(v.place('m', print(3), 3))
  })

  it('forgets a conversation that’s gone quiet', () => {
    let now = 0
    const v = new Voices({ now: () => now, forgetMs: 1000 })
    v.place('m', print(0), 3)
    now = 5000
    expect(v.place('m', print(4), 3)).toBe(1)
  })

  it('keeps no more conversations than it should', () => {
    let now = 0
    const v = new Voices({ conversations: 3, now: () => now++ })
    for (const c of ['a', 'b', 'c', 'd']) v.place(c, print(0), 3)
    // "a" was the quietest, so it went: its first voice now is a new one.
    expect(v.place('a', print(7), 3)).toBe(1)
  })
})

describe('transcribing with voices', () => {
  const gate = new AiGate({ password: '', equal: (a, b) => a === b, visitor: () => '1.2.3.4', limit: 100 })
  const transcriber = (embed: Embedder['embed']) => {
    const sent: string[] = []
    const t = new Transcriber({
      baseUrl: 'http://whisper.test/v1',
      model: 'whisper-1',
      gate,
      fetch: (async () => new Response(JSON.stringify({ text: ' hello ' }), { status: 200 })) as typeof fetch,
      voices: {
        embedder: {
          embed: (s, r) => {
            sent.push(`${s.length}@${r}`)
            return embed(s, r)
          },
        },
        voices: new Voices(),
        who: () => 'me',
      },
    })
    return { t, sent }
  }
  const post = async (t: Transcriber, path: string, body: Buffer) => {
    const r = res()
    const request = Object.assign(req('POST', { 'content-type': 'audio/wav', 'x-braincraft': '1' }), {
      [Symbol.asyncIterator]: async function* () {
        yield body
      },
      on(event: string, fn: (x?: unknown) => void) {
        if (event === 'data') fn(body)
        if (event === 'end') fn()
        return this
      },
    }) as unknown as IncomingMessage
    await t.handle(request, r, new URL(`http://localhost${path}`))
    return r.reply
  }

  it('says which voice, when the app asks', async () => {
    const { t, sent } = transcriber(() => print(0))
    const reply = await post(t, '/api/ai/transcribe?lang=en&voices=meeting1', wav(2))
    expect(reply.body).toEqual({ text: 'hello', voice: 1 })
    expect(sent).toEqual(['32000@16000'])
  })

  it('leaves voices out when the app doesn’t ask (talking alone, or a preview)', async () => {
    const { t, sent } = transcriber(() => print(0))
    expect((await post(t, '/api/ai/transcribe?lang=en', wav(2))).body).toEqual({ text: 'hello' })
    expect(sent).toEqual([])
  })

  it('still gives the words when the voice can’t be told', async () => {
    const { t } = transcriber(() => {
      throw new Error('model broke')
    })
    expect((await post(t, '/api/ai/transcribe?voices=meeting1', wav(2))).body).toEqual({ text: 'hello' })
  })

  it('ignores a conversation name that isn’t one', async () => {
    const { t, sent } = transcriber(() => print(0))
    await post(t, '/api/ai/transcribe?voices=../../x', wav(2))
    expect(sent).toEqual([])
  })
})
