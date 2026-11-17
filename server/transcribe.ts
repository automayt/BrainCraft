/**
 * Speech to text for talking to the assistant, in every browser (Firefox has no speech recognition
 * of its own): the app records a phrase and sends it here, and this passes it to an OpenAI-
 * compatible transcription endpoint, such as Whisper served by vLLM on your own machines, or a
 * hosted one.
 *
 *   POST /api/ai/transcribe?lang=en-US&voices=ID&people=3&phrase=17   body: the recording (audio/webm, audio/ogg, audio/mp4…)
 *   → { "text": "what was said", "voice": 2, "name": "Sam", "merged": [[3, 1]], "was": [["15", 2]] }
 *
 * With a speaker-recognition model (speakers.ts) and `voices` naming the conversation, a WAV
 * recording also says which voice said it, as heard so far in that conversation; `people`, when
 * the app knows how many are in it, keeps it to that many voices. "merged" lists voices found to
 * be one person since the last reply: each later one went into the earlier. Someone new only counts
 * as a voice once they've been heard again, so their first phrase comes back with no voice; with
 * `phrase` (the app's own name for each phrase), "was" then says which earlier phrases that voice
 * had said, once it counts. "name" is who the voice
 * is, once it's been named, here or in an earlier meeting (VoiceBook remembers voices by name):
 *
 *   POST /api/ai/voices?voices=ID   {"voice": 2, "name": "Sam"}   names a voice, and remembers it
 *   GET /api/ai/voices                                            the voices remembered: [{name, heard, updated}]
 *   DELETE /api/ai/voices?name=Sam                                forgets one
 *   PATCH /api/ai/voices?name=Sam   {"name": "Samira"}            corrects a remembered name
 *
 * Two headers (URI-encoded) are passed on as the endpoint's prompt, so each phrase is heard in
 * context: X-Transcribe-Context, what was said just before, and after it X-Transcribe-Terms, the
 * names and terms in use. Words the endpoint wasn't sure of come back marked "[unclear: …]" (with "unclear":
 * true).
 *
 * Speech to text given sound that isn't clear speech says something anyway: a phrase over and
 * over, a stock line, or what it was just given (the last line said, one of the terms). So a
 * phrase said over and over comes back said once, and an answer that only says what it was given,
 * or a short one it wasn't sure of, is asked for once more with nothing given: clear speech is
 * heard the same both times, and anything else is settled by the second hearing (see
 * src/ai/heardOnce.ts).
 *
 * Settings: BRAINCRAFT_TRANSCRIBE_URL (the endpoint's base, e.g. http://localhost:8000/v1),
 * BRAINCRAFT_TRANSCRIBE_MODEL (default whisper-1), BRAINCRAFT_TRANSCRIBE_KEY (if it needs one).
 * Who may use it is decided like the rest of the AI (signed in with "Use the AI", or the AI password).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Words, doubtful, isStock, saidBefore, settled, withoutLoops } from '../src/ai/heardOnce'
import type { AiGate } from './aiProxy'
import { type Embedder, type VoiceBook, type Voices, cleanName, wavSamples } from './speakers'

export interface TranscribeOptions {
  baseUrl: string
  model: string
  apiKey?: string
  gate: AiGate
  /** The biggest recording taken (bytes). */
  maxBytes?: number
  timeoutMs?: number
  fetch?: typeof fetch
  /** Who said what: the speaker-recognition model, the voices heard, and whose conversation it is. */
  voices?: { embedder: Embedder; voices: Voices; who: (req: IncomingMessage) => string; book?: VoiceBook | null }
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

/**
 * The context the app sent for a phrase (URI-encoded, as headers carry only plain text), at most
 * `max` characters: the last of what was said, or (`start`) the first of a list of terms.
 */
export function contextOf(header: string | string[] | undefined, max = 800, start = false): string {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw || max <= 0) return ''
  try {
    const text = decodeURIComponent(raw).replace(/[\u0000-\u001f]+/g, ' ').trim()
    return (start ? text.slice(0, max) : text.slice(-max)).trim()
  } catch {
    return ''
  }
}

/** The prompt speech to text takes in is short: the terms and what was said share this many characters. */
const PROMPT_MAX = 800
const TERMS_MAX = 300

/** What speech to text makes of silence and noise when it has to say something. */
const MADE_UP = /^\W*(thanks? (you )?(so much )?for watching|please subscribe|subtitles? by|transcribed by|amara\.org|♪+)\W*$/i

/**
 * The words from a transcription endpoint's answer. A phrase it said over and over is said once.
 * With its stretches (verbose_json), those it was likely making up over silence are left out, and
 * those it wasn't sure of are marked "[unclear: …]" so the notes don't take them for what was said.
 */
export function readTranscript(out: unknown): { text: string; unclear: boolean } {
  const { text, unclear } = readWords(out)
  return { text, unclear }
}

/** The same, with how sure it was of its least sure stretch, where the endpoint says. */
export function readWords(out: unknown): Words {
  const o = (out ?? {}) as { text?: unknown; segments?: unknown }
  const whole = typeof o.text === 'string' ? o.text.trim() : ''
  if (!Array.isArray(o.segments) || !o.segments.length) {
    const once = withoutLoops(whole).text
    return { text: MADE_UP.test(once) ? '' : once, unclear: false }
  }
  const kept: string[] = []
  let least: number | undefined
  for (const s of o.segments as { text?: unknown; avg_logprob?: unknown; no_speech_prob?: unknown; compression_ratio?: unknown }[]) {
    const said = typeof s?.text === 'string' ? s.text.trim() : ''
    if (!said || MADE_UP.test(said)) continue
    const { text: t, looped } = withoutLoops(said)
    const sure = typeof s.avg_logprob === 'number' ? s.avg_logprob : 0
    const silent = typeof s.no_speech_prob === 'number' ? s.no_speech_prob : 0
    const loops = typeof s.compression_ratio === 'number' ? s.compression_ratio : 1
    // Most likely silence it put words to.
    if (silent > 0.6 && sure < -0.7) continue
    // A stock line ("Thank you.") it wasn't sure of, or over what may have been silence. Said
    // clearly it comes back far surer (about -0.2); over a room's noise, about -0.8 to -0.9, and
    // without any sign of silence, so how sure it was is what tells them apart.
    if (isStock(t) && (silent > 0.4 || sure < -0.6)) continue
    // Going round in some way other than one phrase over and over (that was folded to one saying).
    if (sure < -1 || (loops > 2.4 && !looped)) kept.push(`[unclear: ${t.replace(/[[\]]/g, '')}]`)
    else kept.push(t)
    if (typeof s.avg_logprob === 'number') least = Math.min(least ?? 0, s.avg_logprob)
  }
  // The same thing in one stretch after another is a loop too.
  const text = withoutLoops(kept.join(' ').replace(/\s+/g, ' ').trim()).text
  return { text, unclear: /\[unclear: /.test(text), ...(least !== undefined ? { sure: least } : {}) }
}

export class Transcriber {
  /** Asks for how sure it was of each stretch, until the endpoint says it can't. */
  private detailed = true
  private o:Required<Omit<TranscribeOptions, 'apiKey' | 'voices'>> & Pick<TranscribeOptions, 'apiKey' | 'voices'>

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
    // "en-US" → "en": the language the speaker set, so short phrases aren't misheard as another.
    const lang = /^([a-z]{2,3})(?:[-_][A-Za-z]{2,4})?$/.exec(url.searchParams.get('lang') ?? '')?.[1]
    // The words in use (names, terms on the board) and what was said just before: each phrase is
    // heard on its own, and without these, names and terms come out garbled.
    const terms = contextOf(req.headers['x-transcribe-terms'], TERMS_MAX, true)
    const before = contextOf(req.headers['x-transcribe-context'], PROMPT_MAX - terms.length)
    // What was said first, then the terms, nearest the speech: tried on one sentence cut 36 ways,
    // a term was spelled right 29 times this way round, about half the time the other way, and
    // hardly ever with no terms at all.
    const stop = (s: string) => (s && !/[.!?…]$/.test(s) ? `${s}.` : s)
    const both = [terms ? stop(before) : before, stop(terms)].filter(Boolean).join(' ')
    const ask = (format: 'verbose_json' | 'json', prompt = both) => {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(audio)], { type }), `speech.${ext}`)
      form.append('model', this.o.model)
      form.append('response_format', format)
      form.append('temperature', '0')
      if (lang) form.append('language', lang)
      if (prompt) form.append('prompt', prompt)
      return this.o.fetch(`${this.o.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(this.o.timeoutMs),
      })
    }
    let r: Response
    // How sure it was of each stretch comes with the detailed answer, when the endpoint gives one.
    const asked = ask(this.detailed ? 'verbose_json' : 'json')
    // While the words are worked out elsewhere: whose voice it is.
    const heard = this.voiceOf(req, url, audio)
    try {
      r = await asked
      if (!r.ok && this.detailed && (r.status === 400 || r.status === 422)) {
        this.detailed = false
        r = await ask('json')
      }
    } catch (err) {
      return json(res, 502, { error: `Couldn’t reach the transcription server (${(err as Error).message})` })
    }
    if (!r.ok) {
      const said = await r.text().catch(() => '')
      return json(res, 502, { error: `The transcription server said ${r.status}${said ? `: ${said.slice(0, 200)}` : ''}` })
    }
    let words = readWords(await r.json().catch(() => ({})))
    // It may only be saying what it was given (the last line said, or one of the terms), as it
    // does over sound that isn't clear speech; and a short answer it wasn't sure of is what a
    // noise gets as readily as a few mumbled words. Either is heard once more with nothing given:
    // clear speech comes out the same both times.
    const echoed = saidBefore(words.text, before) || saidBefore(words.text, terms)
    if (both && words.text && (echoed || doubtful(words))) {
      const plain = await ask(this.detailed ? 'verbose_json' : 'json', '')
        .then((p) => (p.ok ? (p.json() as Promise<unknown>) : null))
        .catch(() => null)
      // Couldn't ask again: what it said stands.
      if (plain) words = settled(words, readWords(plain), echoed)
    }
    return json(res, 200, {
      text: words.text,
      ...(words.unclear ? { unclear: true } : {}),
      ...(heard?.voice ? { voice: heard.voice } : {}),
      ...(heard?.name ? { name: heard.name } : {}),
      ...(heard?.merged.length ? { merged: heard.merged } : {}),
      ...(heard?.placed.length ? { was: heard.placed } : {}),
    })
  }

  /** The voices remembered by name: naming one in a conversation, listing them, forgetting one. */
  async voicesRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
    const v = this.o.voices
    if (!v) return json(res, 404, { error: 'This server doesn’t tell voices apart (see BRAINCRAFT_SPEAKER_MODEL)' })
    const no = this.o.gate.check(req)
    if (no) return json(res, no.status, { error: no.error })
    if (req.method === 'GET') return json(res, 200, { voices: v.book?.list() ?? [] })
    if (req.method === 'DELETE') {
      const name = cleanName(url.searchParams.get('name') ?? '')
      if (!name) return json(res, 400, { error: 'Say which voice to forget (?name=)' })
      return v.book?.forget(name) ? json(res, 200, { forgot: name }) : json(res, 404, { error: `No voice called “${name}” is remembered` })
    }
    if (req.method === 'PATCH') {
      // A remembered voice's name corrected: ?name=Old with {"name": "New"}.
      const from = cleanName(url.searchParams.get('name') ?? '')
      let to = ''
      try {
        const body = JSON.parse((await readRaw(req, 2048)).toString('utf8') || '{}') as { name?: unknown }
        to = typeof body.name === 'string' ? cleanName(body.name) : ''
      } catch {
        to = ''
      }
      if (!from || !to) return json(res, 400, { error: 'Send ?name=Old with {"name": "New"}' })
      return v.book?.rename(from, to) ? json(res, 200, { renamed: from, name: to }) : json(res, 404, { error: `No voice called “${from}” is remembered` })
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
    const talk = url.searchParams.get('voices') ?? ''
    if (!/^[\w-]{6,40}$/.test(talk)) return json(res, 400, { error: 'Say which conversation (?voices=)' })
    let body: { voice?: unknown; name?: unknown }
    try {
      body = JSON.parse((await readRaw(req, 2048)).toString('utf8') || '{}') as typeof body
    } catch {
      return json(res, 400, { error: 'Send {"voice": 2, "name": "Sam"}' })
    }
    const n = Number(body.voice)
    const name = typeof body.name === 'string' ? cleanName(body.name) : ''
    if (!Number.isInteger(n) || n < 1 || !name) return json(res, 400, { error: 'Send {"voice": 2, "name": "Sam"}' })
    if (!v.voices.name(`${v.who(req)} ${talk}`, n, name)) return json(res, 404, { error: 'That voice isn’t in this conversation (any more)' })
    return json(res, 200, { voice: n, name })
  }

  /** Which voice said a recording, in the conversation the app named (null when it can't tell), and voices since found to be one. */
  private voiceOf(req: IncomingMessage, url: URL, audio: Buffer): { voice: number | null; name: string | null; merged: [number, number][]; placed: [string, number][] } | null {
    const v = this.o.voices
    const talk = url.searchParams.get('voices')
    if (!v || !talk || !/^[\w-]{6,40}$/.test(talk)) return null
    const sound = wavSamples(audio)
    if (!sound) return null
    const conversation = `${v.who(req)} ${talk}`
    const people = /^\d{1,2}$/.test(url.searchParams.get('people') ?? '') ? Number(url.searchParams.get('people')) : null
    const phrase = /^[\w-]{1,24}$/.test(url.searchParams.get('phrase') ?? '') ? url.searchParams.get('phrase')! : undefined
    try {
      const print = v.embedder.embed(sound.samples, sound.rate)
      const voice = print ? v.voices.place(conversation, print, sound.samples.length / sound.rate, people, phrase) : null
      return { voice, name: voice ? v.voices.nameOf(conversation, voice) : null, merged: v.voices.merged(conversation), placed: v.voices.placed(conversation) }
    } catch {
      return null
    }
  }
}
