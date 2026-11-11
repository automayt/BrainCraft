import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AiGate } from './aiProxy'
import { Transcriber, contextOf, readTranscript } from './transcribe'

describe('speech to text for talking to the assistant', () => {
  const asked: { url: string; auth?: string; model?: string; language?: string; file?: { type: string; name: string; size: number } }[] = []
  let answer: () => Response = () => Response.json({ text: '  a mind map about the launch ' })
  const t = new Transcriber({
    baseUrl: 'http://stt.local/v1/',
    model: 'whisper-large-v3',
    apiKey: 'k',
    gate: new AiGate({ password: 'pw', equal: (a, b) => a === b }),
    maxBytes: 5000,
    fetch: (async (url: string, init: RequestInit) => {
      const form = init.body as FormData
      const file = form.get('file') as File
      asked.push({
        url,
        auth: (init.headers as Record<string, string>).authorization,
        model: String(form.get('model')),
        language: form.get('language') ? String(form.get('language')) : undefined,
        file: { type: file.type, name: file.name, size: file.size },
      })
      return answer()
    }) as typeof fetch,
  })
  let server: Server
  let base = ''
  beforeAll(async () => {
    server = createServer((req, res) => void t.handle(req, res, new URL(req.url ?? '/', 'http://x')))
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    const a = server.address()
    base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
  })
  afterAll(() => server.close())

  const post = (body: BodyInit, type = 'audio/webm;codecs=opus', password = 'pw', lang = 'en-US') =>
    fetch(`${base}/api/ai/transcribe?lang=${lang}`, { method: 'POST', body, headers: { 'content-type': type, 'x-braincraft-ai-password': password } })

  it('passes a recording to the transcription endpoint and gives back the words', async () => {
    const r = await post(new Uint8Array(400).fill(1))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ text: 'a mind map about the launch' })
    expect(asked.at(-1)).toEqual({ url: 'http://stt.local/v1/audio/transcriptions', auth: 'Bearer k', model: 'whisper-large-v3', language: 'en', file: { type: 'audio/webm', name: 'speech.webm', size: 400 } })
    // Safari records mp4.
    await post(new Uint8Array(400), 'audio/mp4')
    expect(asked.at(-1)!.file!.name).toBe('speech.mp4')
  })

  it('takes only audio, within its size, from people who may use the AI', async () => {
    expect((await post(new Uint8Array(400), 'text/html')).status).toBe(415)
    expect((await post(new Uint8Array(6000))).status).toBe(413)
    expect((await post(new Uint8Array(10))).status).toBe(400)
    expect((await post(new Uint8Array(400), 'audio/webm', 'wrong')).status).toBe(403)
  })

  it('says so when the transcription server fails', async () => {
    answer = () => new Response('model not loaded', { status: 503 })
    const r = await post(new Uint8Array(400))
    expect(r.status).toBe(502)
    expect(((await r.json()) as { error: string }).error).toMatch(/503: model not loaded/)
  })

  it('asks how sure it was, with what came before, and falls back when the endpoint can’t say', async () => {
    const formats: string[] = []
    const prompts: string[] = []
    let detailed = true
    const t2 = new Transcriber({
      baseUrl: 'http://stt.local/v1',
      model: 'w',
      gate: new AiGate({ equal: (a, b) => a === b }),
      fetch: (async (_url: string, init: RequestInit) => {
        const form = init.body as FormData
        formats.push(String(form.get('response_format')))
        prompts.push(String(form.get('prompt') ?? ''))
        if (form.get('response_format') === 'verbose_json' && !detailed) return new Response('unknown format', { status: 400 })
        if (form.get('response_format') === 'json') return Response.json({ text: 'Book Kubernetes venue' })
        return Response.json({ text: 'Book Kubernetes venue', segments: [{ text: ' Book the venue.', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.2 }] })
      }) as typeof fetch,
    })
    const s2 = createServer((req, res) => void t2.handle(req, res, new URL(req.url ?? '/', 'http://x')))
    await new Promise<void>((ok) => s2.listen(0, '127.0.0.1', ok))
    const a = s2.address()
    const url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/api/ai/transcribe`
    const say = () => fetch(url, { method: 'POST', body: new Uint8Array(400).fill(1), headers: { 'content-type': 'audio/wav', 'x-transcribe-context': encodeURIComponent('Sam, Kubernetes. We were saying') } })
    expect(await (await say()).json()).toEqual({ text: 'Book the venue.' })
    expect(formats).toEqual(['verbose_json'])
    expect(prompts).toEqual(['Sam, Kubernetes. We were saying'])
    detailed = false
    expect(await (await say()).json()).toEqual({ text: 'Book Kubernetes venue' })
    // Asked once more in detail, then plainly from then on.
    expect(formats).toEqual(['verbose_json', 'verbose_json', 'json'])
    await say()
    expect(formats.at(-1)).toBe('json')
    s2.close()
  })
})

describe('reading what speech to text heard', () => {
  it('marks what it wasn’t sure of, and drops what it made up over silence', () => {
    expect(
      readTranscript({
        text: 'whole',
        segments: [
          { text: ' We move the launch to May.', avg_logprob: -0.3, no_speech_prob: 0.02, compression_ratio: 1.3 },
          { text: ' Cooper Netties cluster', avg_logprob: -1.4, no_speech_prob: 0.1, compression_ratio: 1.1 },
          { text: ' Thank you.', avg_logprob: -0.9, no_speech_prob: 0.8, compression_ratio: 1 },
          { text: ' Thanks for watching!', avg_logprob: -0.2, no_speech_prob: 0.1, compression_ratio: 1 },
        ],
      }),
    ).toEqual({ text: 'We move the launch to May. [unclear: Cooper Netties cluster]', unclear: true })
    expect(readTranscript({ text: ' Thanks for watching! ' })).toEqual({ text: '', unclear: false })
    expect(readTranscript({ text: ' hello ' })).toEqual({ text: 'hello', unclear: false })
    expect(readTranscript(null)).toEqual({ text: '', unclear: false })
  })

  it('takes the context the app sent, as plain words', () => {
    expect(contextOf(encodeURIComponent('Sam, Brian.\nWe said'))).toBe('Sam, Brian. We said')
    expect(contextOf('%E0%A4%A')).toBe('')
    expect(contextOf(undefined)).toBe('')
    expect(contextOf(encodeURIComponent('x'.repeat(2000)))).toHaveLength(800)
  })
})
