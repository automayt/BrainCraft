import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AiGate } from './aiProxy'
import { Transcriber } from './transcribe'

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
})
