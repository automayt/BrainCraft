import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AiProxy, checkRequest } from './aiProxy'

function req(headers: Record<string, string> = {}, ip = '1.2.3.4') {
  return { method: 'POST', headers, socket: { remoteAddress: ip } } as unknown as IncomingMessage
}

/** A response that collects what's written. */
function res() {
  const chunks: Buffer[] = []
  const w = new Writable({
    write(c: Buffer, _e, done) {
      chunks.push(Buffer.from(c))
      done()
    },
  }) as Writable & { status?: number; head?: Record<string, string>; text: () => string }
  Object.assign(w, {
    writeHead(status: number, head: Record<string, string>) {
      w.status = status
      w.head = head
      return w
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
  })
  return w as unknown as ServerResponse & EventEmitter & { status: number; head: Record<string, string>; text: () => string }
}

const done = (r: Writable) => new Promise<void>((ok) => (r.writableFinished ? ok() : r.on('finish', () => ok())))

const body = JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 1000, messages: [{ role: 'user', content: 'Hi' }], stream: true })

describe('AI proxy', () => {
  it('checks the model, max_tokens and tools', () => {
    expect(checkRequest({ model: 'claude-opus-5-5', max_tokens: 100 })).toBeNull()
    expect(checkRequest({ model: 'some-other-model', max_tokens: 100 })).toMatch(/only offers/)
    expect(checkRequest({ model: 'claude-opus-5-5', max_tokens: 64000 })).toMatch(/max_tokens/)
    expect(checkRequest({ model: 'claude-opus-5-5', max_tokens: 100, tools: [{ type: 'web_search_20260209', name: 'web_search' }] })).toMatch(/Server tools/)
    expect(checkRequest({ model: 'claude-opus-5-5', max_tokens: 100, tools: [{ name: 'read_board', input_schema: {} }] })).toBeNull()
    // Only the fields the app sends: nothing that could reach paid server features.
    expect(checkRequest({ model: 'claude-opus-5-5', max_tokens: 100, messages: [], thinking: { type: 'adaptive' }, output_config: {}, cache_control: {}, stream: true, fallbacks: 'default' })).toBeNull()
    expect(checkRequest({ model: 'claude-opus-5-5', max_tokens: 100, mcp_servers: [{ url: 'https://x' }] })).toMatch(/mcp_servers/)
  })

  it('counts requests by the server’s idea of who is asking, and limits wrong passwords', async () => {
    const proxy = new AiProxy({ apiKey: 'k', fetch: (async () => new Response('{}')) as unknown as typeof fetch, now: () => 1000, visitor: () => 'everyone' })
    let last = res()
    for (let i = 0; i < 121; i++) {
      last = res()
      await proxy.handle(req({}, `9.9.9.${i % 200}`), last, body)
    }
    expect(last.status).toBe(429)
    const locked = new AiProxy({ apiKey: 'k', password: 'pw', fetch: (async () => new Response('{}')) as unknown as typeof fetch, now: () => 1000 })
    for (let i = 0; i < 20; i++) await locked.handle(req({ 'x-braincraft-ai-password': `guess${i}` }), res(), body)
    const right = res()
    await locked.handle(req({ 'x-braincraft-ai-password': 'pw' }), right, body)
    expect(right.status).toBe(429)
  })

  it('adds the key and streams the reply through', async () => {
    let sent: { url: string; init: RequestInit } | null = null
    const proxy = new AiProxy({
      apiKey: 'sk-secret',
      fetch: (async (url: string, init: RequestInit) => {
        sent = { url, init }
        return new Response('event: message_start\ndata: {}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1' } })
      }) as typeof fetch,
    })
    const r = res()
    await proxy.handle(req({ 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'x-api-key': 'braincraft-server' }), r, body)
    await done(r)
    expect(sent!.url).toBe('https://api.anthropic.com/v1/messages')
    const h = sent!.init.headers as Record<string, string>
    expect(h['x-api-key']).toBe('sk-secret')
    expect(h['anthropic-beta']).toBe('server-side-fallback-2026-07-01')
    expect(r.status).toBe(200)
    expect(r.head['content-type']).toBe('text/event-stream')
    expect(r.text()).toContain('message_start')
  })

  it('asks for the password when one is set', async () => {
    const proxy = new AiProxy({ apiKey: 'k', password: 'pw', fetch: (async () => new Response('{}')) as unknown as typeof fetch })
    const wrong = res()
    await proxy.handle(req({ 'x-braincraft-ai-password': 'nope' }), wrong, body)
    expect(wrong.status).toBe(403)
    expect(JSON.parse(wrong.text())).toMatchObject({ type: 'error', error: { type: 'permission_error' } })
    const right = res()
    await proxy.handle(req({ 'x-braincraft-ai-password': 'pw' }), right, body)
    await done(right)
    expect(right.status).toBe(200)
  })

  it('limits requests per address without a password', async () => {
    const proxy = new AiProxy({ apiKey: 'k', fetch: (async () => new Response('{}')) as unknown as typeof fetch, now: () => 1000 })
    let last = res()
    for (let i = 0; i < 121; i++) {
      last = res()
      await proxy.handle(req(), last, body)
    }
    expect(last.status).toBe(429)
    const other = res()
    await proxy.handle(req({}, '5.6.7.8'), other, body)
    expect(other.status).toBe(200)
  })
})
