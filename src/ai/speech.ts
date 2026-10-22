/**
 * Hearing the person, in Firefox, Chrome and Safari. Two ways:
 *
 * - Recorded here, transcribed by the server (`server`): the microphone is recorded phrase by
 *   phrase (a phrase ends at a pause, found from the sound level) and each phrase goes to the
 *   BrainCraft server, which passes it to a speech-to-text model. Works in every browser; used
 *   whenever the server has speech to text set up.
 * - The browser's own recognition (`browser`): Chrome, Edge and Safari have one (Firefox doesn't);
 *   it shows words as they're said. Used when the server has none.
 */

export interface Hearing {
  /** A finished phrase. */
  final(text: string): void
  /** Words still being said (the browser's recognition only). */
  interim?(text: string): void
  /** The sound level, 0–1, for a meter. */
  level?(v: number): void
  /** What it's doing: listening, or turning a phrase into words. */
  state?(s: 'listening' | 'transcribing'): void
  error(message: string): void
}

export interface Ear {
  readonly kind: 'server' | 'browser'
  stop(): void
}

type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

const recognitionClass = (): (new () => Recognition) | null => {
  const w = globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Whether this browser can record the microphone (every current browser, on https or localhost). */
export const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

/** Whether this browser recognises speech itself (Chrome, Edge, Safari; not Firefox). */
export const canRecognise = () => !!recognitionClass()

/** The browser's own recognition, kept going until stopped (it ends itself after a silence). */
export function browserEar(lang: string, on: Hearing): Ear {
  const Rec = recognitionClass()!
  let stopped = false
  const r = new Rec()
  r.continuous = true
  r.interimResults = true
  r.lang = lang
  r.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      if (res.isFinal) on.final(res[0].transcript)
      else interim += res[0].transcript
    }
    on.interim?.(interim)
  }
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return
    stopped = true
    on.error(e.error === 'not-allowed' ? 'The microphone isn’t allowed for this page' : `Speech recognition stopped (${e.error})`)
  }
  r.onend = () => {
    if (!stopped) r.start()
  }
  r.start()
  on.state?.('listening')
  return {
    kind: 'browser',
    stop() {
      stopped = true
      r.stop()
    },
  }
}

/** A recording type this browser makes that transcription servers read (webm in Chrome and Firefox, mp4 in Safari). */
function recordingType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (MediaRecorder.isTypeSupported(t)) return t
  return ''
}

export interface ServerEarOptions {
  lang: string
  /** Sends a recording to be turned into words; resolves with them. */
  transcribe(audio: Blob): Promise<string>
  /** A pause this long ends a phrase. */
  pauseMs?: number
}

/**
 * Records phrase by phrase and has the server transcribe each. A recorder is always running, so the
 * start of a phrase is never lost; a stretch with no speech in it is thrown away rather than sent.
 */
export async function serverEar(o: ServerEarOptions, on: Hearing): Promise<Ear> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const type = recordingType()
  const pauseMs = o.pauseMs ?? 800
  let stopped = false
  let floor = 0.01

  /** The phrase being recorded: its recorder, and how long it has had speech in it. */
  interface Phrase {
    r: MediaRecorder
    chunks: Blob[]
    started: number
    voiced: number
    lastVoice: number
  }
  let phrase: Phrase | null = null

  const begin = () => {
    if (stopped) return
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const p: Phrase = { r, chunks: [], started: performance.now(), voiced: 0, lastVoice: 0 }
    r.ondataavailable = (e) => e.data.size && p.chunks.push(e.data)
    r.onstop = () => {
      // Only a phrase with some speech in it (a quarter of a second, at least) is worth sending.
      if (p.voiced < 250 || !p.chunks.length) return
      const blob = new Blob(p.chunks, { type: r.mimeType || type || 'audio/webm' })
      on.state?.('transcribing')
      o.transcribe(blob).then(
        (text) => {
          on.state?.('listening')
          // Silence and noise come back as nothing, or as a stray mark or two.
          if (/[\p{L}\p{N}]/u.test(text)) on.final(text)
        },
        (err: Error) => on.error(err.message),
      )
    }
    r.start()
    phrase = p
  }

  /** Ends the phrase (sending it if it had speech) and starts the next at once, so nothing is missed. */
  const cut = () => {
    const p = phrase
    phrase = null
    if (p && p.r.state !== 'inactive') p.r.stop()
    begin()
  }

  let last = performance.now()
  // A timer rather than animation frames: listening carries on in a tab that's in the background.
  const timer = setInterval(() => {
    if (stopped) return
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const v of samples) sum += v * v
    const rms = Math.sqrt(sum / samples.length)
    const now = performance.now()
    const dt = Math.min(now - last, 200)
    last = now
    // The room's noise floor, followed slowly; speech is well above it.
    floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.999 + rms * 0.001
    const speaking = rms > Math.max(0.012, floor * 3)
    on.level?.(Math.min(1, rms * 8))
    const p = phrase
    if (!p) return
    if (speaking) {
      p.voiced += dt
      p.lastVoice = now
    }
    const age = now - p.started
    // A pause after speech ends the phrase; so does a long phrase, or a long silence (thrown away).
    if ((p.voiced > 0 && now - p.lastVoice > pauseMs) || age > 25_000 || (p.voiced === 0 && age > 8_000)) cut()
  }, 50)
  begin()
  on.state?.('listening')

  return {
    kind: 'server',
    stop() {
      stopped = true
      clearInterval(timer)
      const p = phrase
      phrase = null
      // What was being said when stopped still counts.
      if (p && p.r.state !== 'inactive') p.r.stop()
      for (const t of stream.getTracks()) t.stop()
      void ctx.close()
    },
  }
}
