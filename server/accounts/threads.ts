/**
 * Each person's conversation with the assistant, kept on the server so it follows them to any
 * device. One per person, private to them (admins can't read it from the app either).
 *
 *   GET    /api/assistant/thread   → { thread } (null when there's none)
 *   PUT    /api/assistant/thread   body: the conversation, as the app keeps it
 *   DELETE /api/assistant/thread   forgets it ("New chat")
 *
 * Stored as DATA/accounts/threads/<user id>.json. Only for people who may use the AI.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Accounts } from './service'

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
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

  /** Handles /api/assistant/thread; false for any other route. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, body: () => Promise<string>): Promise<boolean> {
    if (url.pathname !== '/api/assistant/thread') return false
    const { accounts } = this.o
    if (!accounts.fromApp(req)) return json(res, 403, { error: 'Missing the X-BrainCraft header' }), true
    const me = accounts.userOf(req)
    if (!me) return json(res, 401, { error: 'Sign in first' }), true
    if (!accounts.can(me, 'ai.use')) return json(res, 403, { error: 'You can’t use the assistant on this server. Ask an admin.' }), true
    const file = this.file(me.id)

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
