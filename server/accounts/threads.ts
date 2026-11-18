/**
 * Each person's conversation with the assistant, kept on the server so it follows them to any
 * device. One per person, private to them (admins can't read it from the app either).
 *
 *   GET    /api/assistant/thread   → { thread } (null when there's none)
 *   PUT    /api/assistant/thread   body: the conversation, as the app keeps it
 *   DELETE /api/assistant/thread   forgets it ("New chat")
 *
 * And each person's assistant settings (which model, which of the server's choices, their own
 * model server's address), so they're the same in another browser and at another address:
 *
 *   GET    /api/assistant/settings → { settings } (null when there are none)
 *   PUT    /api/assistant/settings body: the settings
 *
 * Only what's listed in CHOICES is kept: keys and passwords are left out even when sent.
 *
 * Stored as DATA/accounts/threads/<user id>.json (and <user id>.settings.json). Only for people
 * who may use the AI.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Accounts } from './service'

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** The settings kept: text, each of at most this many characters. Nothing secret is among them. */
const CHOICES = ['mode', 'provider', 'agent', 'model', 'serverModel', 'openaiBase', 'openaiModel', 'review'] as const
const CHOICE_MAX = 400

/** Settings as sent, down to what's kept; null when they aren't settings at all. */
export function keptSettings(raw: unknown): Record<string, string | number | boolean> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const given = raw as Record<string, unknown>
  const out: Record<string, string | number | boolean> = {}
  for (const k of CHOICES) {
    const v = given[k]
    if (typeof v === 'string' && v.length <= CHOICE_MAX) out[k] = v
  }
  if (given.textTools === true) out.textTools = true
  if (typeof given.at === 'number' && Number.isFinite(given.at) && given.at > 0) out.at = given.at
  return out
}

export interface ThreadOptions {
  dir: string
  accounts: Accounts
  /** The biggest conversation kept (bytes of JSON). */
  maxBytes?: number
}

export class AssistantThreads {
  private readonly o: ThreadOptions
  private readonly dir: string
  private readonly max: number

  constructor(o: ThreadOptions) {
    this.o = o
    this.dir = o.dir
    this.max = o.maxBytes ?? 4 * 1024 * 1024
  }

  private file(userId: string) {
    return join(this.dir, `${userId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
  }

  /** Handles /api/assistant/thread and /api/assistant/settings; false for any other route. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, body: () => Promise<string>): Promise<boolean> {
    const settings = url.pathname === '/api/assistant/settings'
    if (url.pathname !== '/api/assistant/thread' && !settings) return false
    const { accounts } = this.o
    if (!accounts.fromApp(req)) return json(res, 403, { error: 'Missing the X-BrainCraft header' }), true
    const me = accounts.userOf(req)
    if (!me) return json(res, 401, { error: 'Sign in first' }), true
    if (!accounts.can(me, 'ai.use')) return json(res, 403, { error: 'You can’t use the assistant on this server. Ask an admin.' }), true
    const file = this.file(me.id)

    if (settings) {
      const kept = file.replace(/\.json$/, '.settings.json')
      if (req.method === 'GET') {
        try {
          return json(res, 200, { settings: keptSettings(JSON.parse(readFileSync(kept, 'utf8'))) }), true
        } catch {
          return json(res, 200, { settings: null }), true
        }
      }
      if (req.method === 'PUT') {
        let given: Record<string, string | number | boolean> | null = null
        try {
          const raw = await body()
          // Far more than settings ever come to: not settings.
          if (Buffer.byteLength(raw) <= 16_000) given = keptSettings(JSON.parse(raw))
        } catch {
          // Not JSON, or too long to read.
        }
        if (!given) return json(res, 400, { error: 'Not settings' }), true
        mkdirSync(this.dir, { recursive: true })
        const tmp = `${kept}.${process.pid}.tmp`
        writeFileSync(tmp, JSON.stringify(given))
        renameSync(tmp, kept)
        return json(res, 200, { ok: true }), true
      }
      return json(res, 405, { error: 'Method not allowed' }), true
    }

    if (req.method === 'GET') {
      try {
        return json(res, 200, { thread: JSON.parse(readFileSync(file, 'utf8')) as unknown }), true
      } catch {
        return json(res, 200, { thread: null }), true
      }
    }
    if (req.method === 'DELETE') {
      rmSync(file, { force: true })
      return json(res, 200, { ok: true }), true
    }
    if (req.method === 'PUT') {
      let raw: string
      try {
        raw = await body()
      } catch {
        return json(res, 413, { error: 'That conversation is too long to keep' }), true
      }
      if (Buffer.byteLength(raw) > this.max) return json(res, 413, { error: 'That conversation is too long to keep' }), true
      let thread: { v?: unknown; messages?: unknown; turns?: unknown }
      try {
        thread = JSON.parse(raw) as typeof thread
      } catch {
        return json(res, 400, { error: 'Not a conversation' }), true
      }
      if (!thread || typeof thread !== 'object' || thread.v !== 1 || !Array.isArray(thread.messages) || !Array.isArray(thread.turns)) return json(res, 400, { error: 'Not a conversation' }), true
      mkdirSync(this.dir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, raw)
      renameSync(tmp, file)
      return json(res, 200, { ok: true }), true
    }
    return json(res, 405, { error: 'Method not allowed' }), true
  }
}
