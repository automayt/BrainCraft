/**
 * The AI proxy: lets the app's assistant use the server owner's Anthropic API key without
 * the key ever reaching a browser. The app's Anthropic client points its base URL at
 * /api/ai, so it calls POST /api/ai/v1/messages; this adds the key and streams the reply back.
 *
 * Only the Messages endpoint, only the models the app offers, a capped max_tokens, and no
 * server tools (web search and the like). With BRAINCRAFT_AI_PASSWORD set, callers must send
 * it; without one, each address gets a modest request budget.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
const MAX_TOKENS = 32000
/** Requests per address per window, when there's no password. */
const RATE = { limit: 120, windowMs: 60 * 60 * 1000 }

export interface AiProxyOptions {
  apiKey: string
  password?: string
  /** Where the Anthropic API lives (ANTHROPIC_BASE_URL); defaults to https://api.anthropic.com. */
  baseUrl?: string
  fetch?: typeof fetch
  now?: () => number
  equal?: (a: string, b: string) => boolean
  /** Who's asking, for the request budget (the server's own rule, which knows about proxies). */
  visitor?: (req: IncomingMessage) => string
}

/** The request fields the app sends (and harmless ones like it); anything else could reach paid server features. */
const FIELDS = new Set(['model', 'max_tokens', 'messages', 'system', 'tools', 'tool_choice', 'thinking', 'output_config', 'cache_control', 'stream', 'temperature', 'top_p', 'top_k', 'stop_sequences', 'metadata', 'fallbacks'])
/** Wrong passwords per address per window, before it has to wait. */
const PASSWORD_TRIES = 20

type Reject = { status: number; error: string }

/** Checks a Messages request body; returns the reason it's refused, or null. */
export function checkRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Send a JSON Messages API request'
  const b = body as { model?: unknown; max_tokens?: unknown; tools?: unknown }
  const extra = Object.keys(body).find((k) => !FIELDS.has(k))
  if (extra) return `This server doesn't pass on "${extra}"`
  if (typeof b.model !== 'string' || !AI_MODELS.includes(b.model)) return `This server only offers ${AI_MODELS.join(', ')}`
  if (typeof b.max_tokens !== 'number' || b.max_tokens < 1 || b.max_tokens > MAX_TOKENS) return `max_tokens must be between 1 and ${MAX_TOKENS}`
  if (b.tools !== undefined) {
    if (!Array.isArray(b.tools)) return 'tools must be a list'
    if (b.tools.some((t) => !t || typeof t !== 'object' || 'type' in t)) return 'Server tools are not available through this server'
  }
  return null
}

export class AiProxy {
  private hits = new Map<string, number[]>()
  private fails = new Map<string, number[]>()
  private o: Required<AiProxyOptions>

  constructor(o: AiProxyOptions) {
    this.o = {
      password: '',
      baseUrl: 'https://api.anthropic.com',
      fetch: globalThis.fetch.bind(globalThis),
      now: Date.now,
      equal: (a, b) => a === b,
      visitor: (req) => req.socket.remoteAddress ?? 'unknown',
      ...(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as AiProxyOptions),
    }
  }

  /** Counts one use against `who` in `map`; false once there have been `limit` in the window. */
  private count(map: Map<string, number[]>, who: string, limit: number): boolean {
    const now = this.o.now()
    // Forget addresses whose window is over, so the map can't grow without end.
    if (map.size > 10_000) for (const [k, ts] of map) if (!ts.some((t) => now - t < RATE.windowMs)) map.delete(k)
    const recent = (map.get(who) ?? []).filter((t) => now - t < RATE.windowMs)
    if (recent.length >= limit) return false
    recent.push(now)
    map.set(who, recent)
    return true
  }

  private gate(req: IncomingMessage): Reject | null {
    const who = this.o.visitor(req)
    if (this.o.password) {
      if ((this.fails.get(who)?.filter((t) => this.o.now() - t < RATE.windowMs).length ?? 0) >= PASSWORD_TRIES)
        return { status: 429, error: 'Too many wrong AI passwords from this address; try again later' }
      const given = req.headers['x-braincraft-ai-password']
      if (typeof given !== 'string' || !this.o.equal(given, this.o.password)) {
        this.count(this.fails, who, Infinity)
        return { status: 403, error: 'Wrong or missing AI password' }
      }
      return null
    }
    if (!this.count(this.hits, who, RATE.limit)) return { status: 429, error: 'Too many AI requests from this address; try again later' }
    return null
  }

  /** Handles /api/ai/v1/messages with the request body already read. */
  async handle(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
    const reply = (status: number, error: string) => {
      // The Anthropic error shape, so the app's SDK raises its usual typed errors.
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ type: 'error', error: { type: status === 429 ? 'rate_limit_error' : status === 403 ? 'permission_error' : 'invalid_request_error', message: error } }))
    }
    if (req.method !== 'POST') return reply(405, 'Use POST')
    const denied = this.gate(req)
    if (denied) return reply(denied.status, denied.error)
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return reply(400, 'Send a JSON Messages API request')
    }
    const bad = checkRequest(body)
    if (bad) return reply(400, bad)

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': this.o.apiKey,
      'anthropic-version': String(req.headers['anthropic-version'] ?? '2023-06-01'),
    }
    const beta = req.headers['anthropic-beta']
    if (typeof beta === 'string' && beta) headers['anthropic-beta'] = beta

    const abort = new AbortController()
    res.on('close', () => abort.abort())
    let upstream: Response
    try {
      upstream = await this.o.fetch(`${this.o.baseUrl.replace(/\/+$/, '')}/v1/messages`, { method: 'POST', headers, body: raw, signal: abort.signal })
    } catch (err) {
      if (abort.signal.aborted) return
      return reply(502, `Couldn't reach Anthropic: ${(err as Error).message}`)
    }
    const out: Record<string, string> = { 'cache-control': 'no-store' }
    for (const h of ['content-type', 'request-id', 'retry-after']) {
      const v = upstream.headers.get(h)
      if (v) out[h] = v
    }
    res.writeHead(upstream.status, out)
    if (!upstream.body) return void res.end()
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).on('error', () => res.destroy()).pipe(res)
  }
}
