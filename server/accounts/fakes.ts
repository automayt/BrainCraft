/** Fake requests and responses for testing the accounts routes without a network. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const tempDir = () => mkdtempSync(join(tmpdir(), 'braincraft-accounts-'))

export interface Reply {
  status: number
  headers: Record<string, string | string[]>
  body: Record<string, unknown>
}

/** A request with a method, headers (a cookie jar's cookie, say) and the app's header by default. */
export function req(method: string, headers: Record<string, string> = {}, ip = '127.0.0.1'): IncomingMessage {
  return { method, headers: { host: 'localhost:8080', ...(method === 'GET' ? {} : { 'x-braincraft': '1' }), ...headers }, socket: { remoteAddress: ip } } as unknown as IncomingMessage
}

export function res(): ServerResponse & { reply: Promise<Reply> } {
  let done: (r: Reply) => void = () => {}
  const reply = new Promise<Reply>((ok) => (done = ok))
  let status = 200
  let headers: Record<string, string | string[]> = {}
  const r = {
    writeHead(s: number, h: Record<string, string | string[]> = {}) {
      status = s
      headers = h
      return r
    },
    end(text?: string) {
      let body: Record<string, unknown> = {}
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        body = { text }
      }
      done({ status, headers, body })
    },
    on() {
      return r
    },
  }
  return Object.assign(r, { reply }) as unknown as ServerResponse & { reply: Promise<Reply> }
}

/** The session cookie a reply sets, as a Cookie header. */
export function cookieOf(reply: Reply): string {
  const set = reply.headers['set-cookie']
  const first = (Array.isArray(set) ? set : [set ?? '']).find((c) => c.startsWith('braincraft_session=')) ?? ''
  return first.split(';')[0]
}
