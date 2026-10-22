/**
 * Speech to text for talking to the assistant, in every browser (Firefox has no speech recognition
 * of its own): the app records a phrase and sends it here, and this passes it to an OpenAI-
 * compatible transcription endpoint, such as Whisper served by vLLM on your own machines, or a
 * hosted one.
 *
 *   POST /api/ai/transcribe?lang=en-US   body: the recording (audio/webm, audio/ogg, audio/mp4…)
 *   → { "text": "what was said" }
 *
 * Settings: BRAINCRAFT_TRANSCRIBE_URL (the endpoint's base, e.g. http://localhost:8000/v1),
 * BRAINCRAFT_TRANSCRIBE_MODEL (default whisper-1), BRAINCRAFT_TRANSCRIBE_KEY (if it needs one).
 * Who may use it is decided like the rest of the AI (signed in with "Use the AI", or the AI password).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AiGate } from './aiProxy'

export interface TranscribeOptions {
  baseUrl: string
  model: string
  apiKey?: string
  gate: AiGate
  /** The biggest recording taken (bytes). */
  maxBytes?: number
  timeoutMs?: number
  fetch?: typeof fetch
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** File names the endpoint knows the format by. */
const EXT: Record<string, string> = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac' }

class TooBig extends Error {}

/** The request's body, or TooBig past `limit` (read to its end either way, so the answer arrives). */
function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const declared = Number(req.headers['content-length'])
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size <= limit) chunks.push(c)
    })
    req.on('end', () => (size > limit || declared > limit ? fail(new TooBig()) : ok(Buffer.concat(chunks))))
    req.on('error', fail)
  })
}

export class Transcriber {
  private o: Required<Omit<TranscribeOptions, 'apiKey'>> & { apiKey?: string }

  constructor(o: TranscribeOptions) {
    this.o = { maxBytes: 15 * 1024 * 1024, timeoutMs: 60_000, fetch: globalThis.fetch.bind(globalThis), ...o, baseUrl: o.baseUrl.replace(/\/+$/, '') }
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
    const no = this.o.gate.check(req)
    if (no) return json(res, no.status, { error: no.error })
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const ext = EXT[type]
    if (!ext) return json(res, 415, { error: 'Send the recording as audio (webm, ogg, mp4, mp3 or wav)' })
    let audio: Buffer
    try {
      audio = await readRaw(req, this.o.maxBytes)
    } catch (err) {
      if (err instanceof TooBig) return json(res, 413, { error: 'That recording is too long' })
      throw err
    }
    if (audio.length < 100) return json(res, 400, { error: 'The recording is empty' })
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type }), `speech.${ext}`)
    form.append('model', this.o.model)
    form.append('response_format', 'json')
    // "en-US" → "en": the language the speaker set, so short phrases aren't misheard as another.
    const lang = /^([a-z]{2,3})(?:[-_][A-Za-z]{2,4})?$/.exec(url.searchParams.get('lang') ?? '')?.[1]
    if (lang) form.append('language', lang)
    let r: Response
    try {
      r = await this.o.fetch(`${this.o.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(this.o.timeoutMs),
      })
    } catch (err) {
      return json(res, 502, { error: `Couldn’t reach the transcription server (${(err as Error).message})` })
    }
    if (!r.ok) {
      const said = await r.text().catch(() => '')
      return json(res, 502, { error: `The transcription server said ${r.status}${said ? `: ${said.slice(0, 200)}` : ''}` })
    }
    const out = (await r.json().catch(() => ({}))) as { text?: unknown }
    return json(res, 200, { text: typeof out.text === 'string' ? out.text.trim() : '' })
  }
}
