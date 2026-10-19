/**
 * The assistant's other server-side providers, beside the Anthropic proxy (aiProxy.ts):
 *
 * - OpenAiProxy: POST /api/ai/openai/chat/completions → an OpenAI-compatible server (vLLM and the
 *   like) at OPENAI_BASE_URL, with OPENAI_API_KEY if it needs one. Only chat completions, function
 *   tools and a capped max_tokens; the model must be one the server offers.
 * - CommandRunner: POST /api/ai/command → runs BRAINCRAFT_AI_COMMAND (say `claude -p --tools ""` or
 *   `codex exec --skip-git-repo-check -`) once per step, the prompt on its standard input, its
 *   standard output the answer. It runs in an empty scratch folder, one or two at a time, with a
 *   time and size limit. An agent can do a lot on this machine, so without BRAINCRAFT_AI_PASSWORD
 *   only requests from this machine itself may use it.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { AiGate } from './aiProxy'

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

// ----- OpenAI-compatible ----------------------------------------------------------------------------

const MAX_TOKENS = 32000
/** The request fields the app sends (and harmless ones like them). */
const FIELDS = new Set(['model', 'messages', 'tools', 'tool_choice', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'stop', 'seed'])

export interface OpenAiProxyOptions {
  /** The API's base, ending in /v1 (OPENAI_BASE_URL). */
  baseUrl: string
  apiKey?: string
  /** The models offered (OPENAI_MODEL); when empty, whatever the upstream server lists. */
  models?: string[]
  gate: AiGate
  fetch?: typeof fetch
  now?: () => number
}

/** Checks a chat-completions request; the reason it's refused, or null. */
export function checkChatRequest(body: unknown, models: string[]): string | null {
  if (!body || typeof body !== 'object') return 'Send a JSON chat-completions request'
  const b = body as { model?: unknown; messages?: unknown; tools?: unknown; max_tokens?: unknown; max_completion_tokens?: unknown }
  const extra = Object.keys(body).find((k) => !FIELDS.has(k))
  if (extra) return `This server doesn't pass on "${extra}"`
  if (typeof b.model !== 'string' || (models.length && !models.includes(b.model))) return models.length ? `This server offers ${models.join(', ')}` : 'Say which model'
  if (!Array.isArray(b.messages)) return 'messages must be a list'
  for (const k of ['max_tokens', 'max_completion_tokens'] as const) {
    const v = b[k]
    if (v !== undefined && (typeof v !== 'number' || v < 1 || v > MAX_TOKENS)) return `${k} must be between 1 and ${MAX_TOKENS}`
  }
  if (b.tools !== undefined && (!Array.isArray(b.tools) || b.tools.some((t) => !t || typeof t !== 'object' || (t as { type?: unknown }).type !== 'function')))
    return 'Only function tools are passed on'
  return null
}

export class OpenAiProxy {
  private o: OpenAiProxyOptions
  private listed: { at: number; models: string[] } | null = null

  constructor(o: OpenAiProxyOptions) {
    this.o = o
  }

  private get base() {
    return this.o.baseUrl.replace(/\/+$/, '')
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}) }
  }

  /** The models on offer: the configured ones, or what the upstream server lists (asked at most once a minute). */
  async models(): Promise<string[]> {
    if (this.o.models?.length) return this.o.models
    const now = (this.o.now ?? Date.now)()
    if (this.listed && now - this.listed.at < 60_000) return this.listed.models
    let models: string[] = []
    try {
      const res = await (this.o.fetch ?? fetch)(`${this.base}/models`, { headers: this.headers(), signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const j = (await res.json()) as { data?: { id?: unknown }[] }
        models = (j.data ?? []).flatMap((m) => (typeof m.id === 'string' ? [m.id] : []))
      }
    } catch {
      // Not reachable right now: nothing listed, and asked again next time.
    }
    this.listed = { at: now, models }
    return models
  }

  /** Handles /api/ai/openai/chat/completions with the body already read. */
  async handle(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
    const reply = (status: number, message: string) => send(res, status, { error: { message } })
    if (req.method !== 'POST') return reply(405, 'Use POST')
    const denied = this.o.gate.check(req)
    if (denied) return reply(denied.status, denied.error)
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return reply(400, 'Send a JSON chat-completions request')
    }
    const bad = checkChatRequest(body, await this.models())
    if (bad) return reply(400, bad)
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    let upstream: Response
    try {
      upstream = await (this.o.fetch ?? fetch)(`${this.base}/chat/completions`, { method: 'POST', headers: this.headers(), body: raw, signal: abort.signal })
    } catch (err) {
      if (abort.signal.aborted) return
      return reply(502, `Couldn't reach the model server: ${(err as Error).message}`)
    }
    const out: Record<string, string> = { 'cache-control': 'no-store' }
    const type = upstream.headers.get('content-type')
    if (type) out['content-type'] = type
    res.writeHead(upstream.status, out)
    if (!upstream.body) return void res.end()
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).on('error', () => res.destroy()).pipe(res)
  }
}

// ----- a command-line agent ---------------------------------------------------------------------------

export interface CommandOptions {
  /** The command line, run by the shell (BRAINCRAFT_AI_COMMAND). Set by the server's owner only. */
  command: string
  gate: AiGate
  /** How long one step may take (BRAINCRAFT_AI_TIMEOUT, seconds). */
  timeoutMs?: number
  /** The most it may print. */
  maxOutput?: number
  /** How many may run at once. */
  concurrency?: number
  /** Starts the process (a stand-in in tests). */
  spawn?: typeof spawn
}

/** The longest prompt accepted: the whole conversation, board description included. */
const MAX_PROMPT = 2_000_000

/** Whether a request comes from this machine itself (and not through a proxy on it). */
export function fromThisMachine(req: IncomingMessage): boolean {
  if (req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['x-real-ip']) return false
  const ip = req.socket.remoteAddress ?? ''
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

/** The program a command line runs ("claude", "codex"), to name it in the app. */
export const programOf = (command: string) => command.trim().split(/\s+/)[0]?.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/i, '') ?? ''

export class CommandRunner {
  private o: Required<Omit<CommandOptions, 'spawn'>> & { spawn: typeof spawn }
  private running = 0

  constructor(o: CommandOptions) {
    this.o = { timeoutMs: 300_000, maxOutput: 2_000_000, concurrency: 2, spawn, ...o }
  }

  get program() {
    return programOf(this.o.command)
  }

  async handle(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
    const reply = (status: number, message: string) => send(res, status, { error: message })
    if (req.method !== 'POST') return reply(405, 'Use POST')
    // An agent can read files and run programs here: from elsewhere, only with the password.
    if (!this.o.gate.hasPassword && !fromThisMachine(req))
      return reply(403, 'This server runs a command-line agent for the assistant, so it only answers this machine. Its owner can set BRAINCRAFT_AI_PASSWORD to let others use it.')
    const denied = this.o.gate.check(req)
    if (denied) return reply(denied.status, denied.error)
    let prompt: unknown
    try {
      prompt = (JSON.parse(raw) as { prompt?: unknown }).prompt
    } catch {
      return reply(400, 'Send {"prompt": "…"}')
    }
    if (typeof prompt !== 'string' || !prompt.trim()) return reply(400, 'Send {"prompt": "…"}')
    if (prompt.length > MAX_PROMPT) return reply(413, 'That conversation is too long for the agent')
    if (this.running >= this.o.concurrency) return reply(429, 'The agent is busy with other requests; try again in a moment')

    this.running++
    const dir = await mkdtemp(join(tmpdir(), 'braincraft-ai-'))
    try {
      const out = await this.run(prompt, dir, res)
      if (out === null) return
      if ('error' in out) return reply(502, out.error)
      send(res, 200, { text: out.text })
    } finally {
      this.running--
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Runs the command once: its output, why it failed, or null if the request went away. */
  private run(prompt: string, cwd: string, res: ServerResponse): Promise<{ text: string } | { error: string } | null> {
    return new Promise((done) => {
      const windows = process.platform === 'win32'
      const child = this.o.spawn(this.o.command, { shell: true, cwd, env: process.env, windowsHide: true, detached: !windows, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      let over = false
      let settled = false
      const finish = (v: { text: string } | { error: string } | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        done(v)
      }
      // The shell and everything it started: an agent left running would keep working (and costing).
      const stop = () => {
        if (child.exitCode !== null || !child.pid) return
        try {
          if (windows) this.o.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
          else process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
      const timer = setTimeout(() => {
        stop()
        finish({ error: `The agent took longer than ${Math.round(this.o.timeoutMs / 1000)} seconds and was stopped` })
      }, this.o.timeoutMs)
      res.on('close', () => {
        if (!res.writableEnded) {
          stop()
          finish(null)
        }
      })
      child.stdout?.on('data', (c: Buffer) => {
        out += c.toString('utf8')
        if (out.length > this.o.maxOutput && !over) {
          over = true
          stop()
          finish({ error: 'The agent wrote too much and was stopped' })
        }
      })
      child.stderr?.on('data', (c: Buffer) => {
        err = (err + c.toString('utf8')).slice(-4000)
      })
      child.on('error', (e) => finish({ error: `Couldn't start the agent: ${e.message}` }))
      child.on('close', (code) => {
        if (code === 0) finish({ text: out.trim() })
        else finish({ error: `The agent stopped with code ${code}${err.trim() ? `: ${err.trim().split('\n').slice(-3).join(' ')}` : ''}` })
      })
      child.stdin?.on('error', () => {})
      child.stdin?.end(prompt)
    })
  }
}
