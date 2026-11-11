import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AiGate } from './aiProxy'
import { req, res } from './accounts/fakes'
import { type Embedder, VoiceBook, Voices, wavSamples } from './speakers'
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

/** Two directions on a flat plane, for voices that are made to grow alike. */
const at = (x: number, y: number) => Float32Array.from([x, y, 0, 0])

function random(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1_000_000) / 1_000_000
  }
}

function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())
}

/** A made-up person: a direction of their own in voiceprint space. */
function person(seed: number, dim = 64): Float32Array {
  const r = random(seed * 7919)
  return Float32Array.from({ length: dim }, () => gauss(r))
}

/** One phrase of theirs: their voice plus noise (`noise` 1 is as much noise as voice, as in a short phrase through a laptop). */
function phrase(of: Float32Array, r: () => number, noise: number): Float32Array {
  const len = Math.hypot(...of)
  return of.map((x) => x / len + (gauss(r) * noise) / Math.sqrt(of.length))
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
  it('numbers voices in the order they’re first heard, once each is heard twice, and knows them again', () => {
    const v = new Voices()
    expect(v.place('m', print(0, 0.05), 3)).toBeNull()
    expect(v.place('m', print(0, 0.08), 3)).toBe(1)
    expect(v.place('m', print(1, 0.05), 3)).toBeNull()
    expect(v.place('m', print(1, 0.07), 3)).toBe(2)
    expect(v.place('m', print(0, 0.12), 2)).toBe(1)
    expect(v.place('m', print(2, 0.05), 2)).toBeNull()
    expect(v.place('m', print(1, 0.15), 4)).toBe(2)
    expect(v.place('m', print(2, 0.06), 2)).toBe(3)
  })

  it('keeps its settings when they’re given as nothing (an unset environment variable)', () => {
    // An undefined threshold once meant nothing was ever like enough: every phrase a new voice.
    const v = new Voices({ threshold: undefined, same: Number('not a number') })
    for (let k = 0; k < 6; k++) v.place('m', print(0, 0.05 + k * 0.01), 3)
    expect(v.place('m', print(0, 0.11), 3)).toBe(1)
  })

  it('hears two people as two voices, however much each phrase wobbles', () => {
    const v = new Voices()
    const r = random(7)
    const me = person(1)
    const brian = person(2)
    const heard: (number | null)[] = []
    // Voices found to be one person are one, as the app takes them.
    const into = new Map<number, number>()
    // Back and forth for a while, each phrase a few seconds long and noisy.
    for (let k = 0; k < 120; k++) {
      heard.push(v.place('m', phrase(k % 3 ? me : brian, r, 1.4), 2 + (k % 4)))
      for (const [from, to] of v.merged('m')) into.set(from, to)
    }
    const final = (x: number): number => (into.has(x) ? final(into.get(x)!) : x)
    const said = heard.map((x) => (x === null ? null : final(x)))
    expect([...new Set(said.filter((x) => x !== null))].sort()).toEqual([1, 2])
    // Few phrases are left as no one known.
    expect(heard.filter((x) => x === null).length).toBeLessThan(15)
    // Nearly every phrase is put to the right one.
    const mine = said.filter((x, k) => k % 3 && x !== null)
    expect(mine.filter((x) => x === mine[0]).length / mine.length).toBeGreaterThan(0.95)
    const his = said.filter((x, k) => !(k % 3) && x !== null)
    expect(his.filter((x) => x === his[0]).length / his.length).toBeGreaterThan(0.95)
    expect(his[0]).not.toBe(mine[0])
  })

  it('won’t make a voice of one odd phrase', () => {
    const v = new Voices()
    v.place('m', print(0), 3)
    v.place('m', print(0, 0.12), 3)
    // A cough, or two people at once: heard once, never again.
    expect(v.place('m', print(9), 3)).toBeNull()
    for (let k = 0; k < 5; k++) expect(v.place('m', print(0, 0.05 + k * 0.02), 3)).toBe(1)
    v.place('m', print(1), 3)
    expect(v.place('m', print(1, 0.12), 3)).toBe(2)
  })

  it('puts a phrase too short to be sure of with the nearest voice, without starting one', () => {
    const v = new Voices()
    expect(v.place('m', print(0), 0.6)).toBeNull()
    expect(v.place('m', print(0), 2)).toBeNull()
    expect(v.place('m', print(0, 0.15), 2)).toBe(1)
    expect(v.place('m', print(0, 0.15), 0.6)).toBe(1)
    expect(v.place('m', print(3), 0.6)).toBe(1)
  })

  it('puts a young voice with one it sounds like', () => {
    const v = new Voices({ threshold: 0.6, same: 0.95 })
    v.place('m', at(1, 0), 3)
    for (let k = 0; k < 6; k++) v.place('m', at(1, 0), 3)
    // Something like it but not quite, twice: a voice of its own for a moment, then known for the same one.
    v.place('m', at(0.55, 0.835), 3)
    v.place('m', at(0.55, 0.835), 3)
    expect(v.place('m', at(0.7, 0.714), 3)).toBe(1)
    expect(v.merged('m')).toEqual([[2, 1]])
  })

  it('puts together voices that turn out to be one person, and says so once, as [the later, the one it went into]', () => {
    const v = new Voices({ threshold: 0.9, same: 0.75 })
    // Each heard enough to be settled, and not alike enough to be one.
    v.place('m', at(1, 0), 3)
    for (let k = 0; k < 4; k++) expect(v.place('m', at(1, 0), 3)).toBe(1)
    v.place('m', at(0.7, 0.71), 3)
    for (let k = 0; k < 4; k++) expect(v.place('m', at(0.7, 0.71), 3)).toBe(2)
    expect(v.merged('m')).toEqual([])
    // Somewhere between the two, heard often: voice 2 was voice 1 all along.
    let merged: [number, number][] = []
    let last: number | null = null
    for (let k = 0; k < 6 && !merged.length; k++) {
      last = v.place('m', at(0.92, 0.38), 3)
      merged = v.merged('m')
    }
    expect(merged).toEqual([[2, 1]])
    expect(last).toBe(1)
    expect(v.place('m', at(0.7, 0.71), 3)).toBe(1)
    expect(v.merged('m')).toEqual([])
  })

  it('never has more voices than the people the app says are there', () => {
    const v = new Voices()
    for (const who of [0, 0, 1, 1]) v.place('m', print(who), 3, 2)
    // A third-sounding phrase, long and heard twice: still one of the two.
    expect([1, 2]).toContain(v.place('m', print(5), 3, 2))
    expect([1, 2]).toContain(v.place('m', print(5, 0.12), 3, 2))
    // Without that, it would have been a third voice.
    const free = new Voices()
    for (const who of [0, 0, 1, 1]) free.place('m', print(who), 3)
    free.place('m', print(5), 3)
    expect(free.place('m', print(5, 0.12), 3)).toBe(3)
  })

  it('keeps each conversation’s voices apart', () => {
    const v = new Voices()
    v.place('a', print(0), 3)
    v.place('a', print(0), 3)
    v.place('b', print(5), 3)
    expect(v.place('b', print(5), 3)).toBe(1)
    v.place('a', print(5), 3)
    expect(v.place('a', print(5), 3)).toBe(2)
  })

  it('stops making voices past the most, giving each phrase its nearest', () => {
    const v = new Voices({ most: 2 })
    for (const who of [0, 0, 1, 1]) v.place('m', print(who), 3)
    expect([1, 2]).toContain(v.place('m', print(2), 3))
    expect([1, 2]).toContain(v.place('m', print(3), 3))
  })

  it('forgets a conversation that’s gone quiet', () => {
    let now = 0
    const v = new Voices({ now: () => now, forgetMs: 1000 })
    v.place('m', print(0), 3)
    v.place('m', print(0), 3)
    now = 5000
    v.place('m', print(4), 3)
    expect(v.place('m', print(4), 3)).toBe(1)
  })

  it('keeps no more conversations than it should', () => {
    let now = 0
    const v = new Voices({ conversations: 3, now: () => now++ })
    for (const c of ['a', 'b', 'c', 'd']) {
      v.place(c, print(0), 3)
      v.place(c, print(0), 3)
    }
    // "a" was the quietest, so it went: its first voice now is a new one.
    v.place('a', print(7), 3)
    expect(v.place('a', print(7), 3)).toBe(1)
  })
})

describe('transcribing with voices', () => {
  const gate = new AiGate({ password: '', equal: (a, b) => a === b, visitor: () => '1.2.3.4', limit: 100 })
  const transcriber = (embed: Embedder['embed'], voices = new Voices()) => {
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
        voices,
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
    return (await r.reply).body as { text?: string; voice?: number; merged?: [number, number][] }
  }

  it('says which voice, when the app asks', async () => {
    const { t, sent } = transcriber(() => print(0))
    // The first phrase is no one yet; heard again, it's a voice.
    expect(await post(t, '/api/ai/transcribe?lang=en&voices=meeting1', wav(2))).toEqual({ text: 'hello' })
    expect(await post(t, '/api/ai/transcribe?lang=en&voices=meeting1', wav(2))).toEqual({ text: 'hello', voice: 1 })
    expect(sent).toEqual(['32000@16000', '32000@16000'])
  })

  it('keeps to the number of people the app says are there', async () => {
    let who = 0
    const { t } = transcriber(() => print(who))
    const say = async (w: number) => {
      who = w
      return post(t, '/api/ai/transcribe?voices=meeting1&people=1', wav(2))
    }
    await say(0)
    expect((await say(0)).voice).toBe(1)
    expect((await say(4)).voice).toBe(1)
  })

  it('says when two voices were one person', async () => {
    let next: Float32Array = at(1, 0)
    const { t } = transcriber(() => next, new Voices({ threshold: 0.9, same: 0.75 }))
    const say = (p: Float32Array) => {
      next = p
      return post(t, '/api/ai/transcribe?voices=meeting1', wav(2))
    }
    for (let k = 0; k < 5; k++) await say(at(1, 0))
    for (let k = 0; k < 4; k++) await say(at(0.7, 0.71))
    expect((await say(at(0.7, 0.71))).voice).toBe(2)
    let reply: { voice?: number; merged?: [number, number][] } = {}
    for (let k = 0; k < 6 && !reply.merged; k++) reply = await say(at(0.92, 0.38))
    expect(reply).toEqual({ text: 'hello', voice: 1, merged: [[2, 1]] })
  })

  it('leaves voices out when the app doesn’t ask (talking alone, or a preview)', async () => {
    const { t, sent } = transcriber(() => print(0))
    expect(await post(t, '/api/ai/transcribe?lang=en', wav(2))).toEqual({ text: 'hello' })
    expect(sent).toEqual([])
  })

  it('still gives the words when the voice can’t be told', async () => {
    const { t } = transcriber(() => {
      throw new Error('model broke')
    })
    expect(await post(t, '/api/ai/transcribe?voices=meeting1', wav(2))).toEqual({ text: 'hello' })
  })

  it('ignores a conversation name that isn’t one', async () => {
    const { t, sent } = transcriber(() => print(0))
    await post(t, '/api/ai/transcribe?voices=../../x', wav(2))
    expect(sent).toEqual([])
  })
})

describe('voices remembered by name', () => {
  const gate = new AiGate({ password: '', equal: (a, b) => a === b, visitor: () => '1.2.3.4', limit: 1000 })
  const setup = (book = new VoiceBook()) => {
    let next = print(0)
    const voices = new Voices({ book })
    const t = new Transcriber({
      baseUrl: 'http://whisper.test/v1',
      model: 'whisper-1',
      gate,
      fetch: (async () => new Response(JSON.stringify({ text: 'hi' }), { status: 200 })) as typeof fetch,
      voices: { embedder: { embed: () => next }, voices, who: () => 'me', book },
    })
    const call = async (method: string, path: string, body?: Buffer) => {
      const r = res()
      const chunk = body ?? Buffer.alloc(0)
      const request = Object.assign(req(method, { 'content-type': body && body[0] === 0x52 ? 'audio/wav' : 'application/json', 'x-braincraft': '1' }), {
        on(event: string, fn: (x?: unknown) => void) {
          if (event === 'data' && chunk.length) fn(chunk)
          if (event === 'end') fn()
          return this
        },
      }) as unknown as IncomingMessage
      const url = new URL(`http://localhost${path}`)
      if (url.pathname === '/api/ai/voices') await t.voicesRoute(request, r, url)
      else await t.handle(request, r, url)
      const out = await r.reply
      return { status: out.status, body: out.body as Record<string, unknown> }
    }
    const say = async (meeting: string, who: number) => {
      next = print(who)
      return (await call('POST', `/api/ai/transcribe?voices=${meeting}`, wav(2))).body
    }
    const name = (meeting: string, voice: number, as: string) => call('POST', `/api/ai/voices?voices=${meeting}`, Buffer.from(JSON.stringify({ voice, name: as })))
    return { book, voices, call, say, name }
  }

  it('knows a voice named in one meeting in the next', async () => {
    const { say, name, book } = setup()
    await say('meeting1', 3)
    expect((await say('meeting1', 3)).voice).toBe(1)
    expect((await name('meeting1', 1, 'Brian')).status).toBe(200)
    expect(book.list().map((v) => v.name)).toEqual(['Brian'])
    // Another day: once he's been heard enough to count, he's Brian.
    await say('meeting2', 3)
    expect(await say('meeting2', 3)).toEqual({ text: 'hi', voice: 1, name: 'Brian' })
    // Someone else isn't.
    await say('meeting2', 9)
    expect(await say('meeting2', 9)).toEqual({ text: 'hi', voice: 2 })
  })

  it('takes a wrong name back when the voice is named again', async () => {
    const { say, name, book } = setup()
    await say('m1-abc', 3)
    await say('m1-abc', 3)
    await name('m1-abc', 1, 'Sam')
    await name('m1-abc', 1, 'Brian')
    expect(book.list().map((v) => v.name)).toEqual(['Brian'])
  })

  it('lists and forgets them', async () => {
    const { say, name, call } = setup()
    await say('meeting1', 3)
    await say('meeting1', 3)
    await name('meeting1', 1, 'Brian')
    expect((await call('GET', '/api/ai/voices')).body.voices).toEqual([expect.objectContaining({ name: 'Brian' })])
    expect((await call('DELETE', '/api/ai/voices?name=Brian')).status).toBe(200)
    expect((await call('GET', '/api/ai/voices')).body.voices).toEqual([])
    expect((await call('DELETE', '/api/ai/voices?name=Brian')).status).toBe(404)
  })

  it('takes a corrected name, and knows the voice by it in the next meeting', async () => {
    const { say, name, call } = setup()
    await say('meeting1', 3)
    await say('meeting1', 3)
    await name('meeting1', 1, 'Brain')
    expect((await call('PATCH', '/api/ai/voices?name=Brain', Buffer.from(JSON.stringify({ name: 'Brian' })))).status).toBe(200)
    expect((await call('GET', '/api/ai/voices')).body.voices).toEqual([expect.objectContaining({ name: 'Brian' })])
    await say('meeting2', 3)
    expect((await say('meeting2', 3)).name).toBe('Brian')
    expect((await call('PATCH', '/api/ai/voices?name=Nobody', Buffer.from(JSON.stringify({ name: 'X' })))).status).toBe(404)
    expect((await call('PATCH', '/api/ai/voices?name=Brian', Buffer.from('{}'))).status).toBe(400)
  })

  it('refuses a name for a voice that isn’t there, or no name', async () => {
    const { name, call } = setup()
    expect((await name('meeting1', 4, 'Sam')).status).toBe(404)
    expect((await call('POST', '/api/ai/voices?voices=meeting1', Buffer.from('{"voice":1}'))).status).toBe(400)
    expect((await call('POST', '/api/ai/voices?voices=../x', Buffer.from('{"voice":1,"name":"Sam"}'))).status).toBe(400)
  })

  it('keeps them in a file, and reads back only what makes sense', () => {
    let saved: unknown = null
    const a = new VoiceBook({ save: (list) => (saved = list) })
    a.learn('Brian', print(3), 4)
    a.flush()
    const b = new VoiceBook({ load: () => [...(saved as unknown[]), { name: 'Bad', sum: ['x'] }, { nope: 1 }, { name: '', sum: [1] }] })
    expect(b.list().map((v) => v.name)).toEqual(['Brian'])
    expect(b.best(print(3))!.name).toBe('Brian')
    expect(new VoiceBook({ load: () => 'not a list' }).list()).toEqual([])
  })

  it('doesn’t give one name to two voices in a meeting', () => {
    const book = new VoiceBook()
    book.learn('Brian', at(1, 0), 4)
    const v = new Voices({ book, threshold: 0.95 })
    v.place('m', at(1, 0), 2)
    expect(v.place('m', at(1, 0), 2)).toBe(1)
    // A second voice that also sounds rather like him (enough to recall him, not to be the same voice here).
    v.place('m', at(0.8, 0.6), 2)
    expect(v.place('m', at(0.8, 0.6), 2)).toBe(2)
    expect(v.nameOf('m', 1)).toBe('Brian')
    expect(v.nameOf('m', 2)).toBeNull()
  })
})
