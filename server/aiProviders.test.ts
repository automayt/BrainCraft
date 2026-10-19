import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AiGate } from './aiProxy'
import { CommandRunner, OpenAiProxy, checkChatRequest, fromThisMachine, programOf } from './aiProviders'

function req(headers: Record<string, string> = {}, ip = '127.0.0.1') {
  return { method: 'POST', headers, socket: { remoteAddress: ip } } as unknown as IncomingMessage
}

function res() {
  const chunks: Buffer[] = []
  const w = new Writable({
    write(c: Buffer, _e, done) {
      chunks.push(Buffer.from(c))
      done()
    },
  }) as Writable & { status?: number; text: () => string }
  Object.assign(w, {
    writeHead(status: number) {
      w.status = status
      return w
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
  })
  return w as unknown as ServerResponse & EventEmitter & { status: number; text: () => string }
}

// Node itself stands in for the agent: it's the one program sure to be on the machine.
const node = (code: string) => `"${process.execPath}" -e "${code}"`

describe('the OpenAI-compatible proxy', () => {
  it('checks the request: known fields, an offered model, function tools, a capped length', () => {
    const ok = { model: 'qwen3', messages: [], stream: true, max_tokens: 1000, tools: [{ type: 'function', function: { name: 'x' } }] }
    expect(checkChatRequest(ok, ['qwen3'])).toBeNull()
    expect(checkChatRequest({ ...ok, model: 'gpt-x' }, ['qwen3'])).toMatch(/offers qwen3/)
    expect(checkChatRequest({ ...ok, max_tokens: 64000 }, [])).toMatch(/max_tokens/)
    expect(checkChatRequest({ ...ok, tools: [{ type: 'web_search' }] }, [])).toMatch(/function tools/)
    expect(checkChatRequest({ ...ok, n: 5 }, [])).toMatch(/doesn't pass on "n"/)
  })

  it('passes a request on with the server’s key, and refuses without the password', async () => {
    const seen: { url: string; auth?: string }[] = []
    const fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init?.headers as Record<string, string>)?.authorization })
      return url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: 'qwen3' }] })) : new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }) as unknown as typeof globalThis.fetch
    const p = new OpenAiProxy({ baseUrl: 'http://vllm:8000/v1/', apiKey: 'secret', gate: new AiGate({ password: 'pw' }), fetch })
    expect(await p.models()).toEqual(['qwen3'])
    const r1 = res()
    await p.handle(req(), r1, JSON.stringify({ model: 'qwen3', messages: [] }))
    expect(r1.status).toBe(403)
    const r2 = res()
    await p.handle(req({ 'x-braincraft-ai-password': 'pw' }), r2, JSON.stringify({ model: 'qwen3', messages: [], stream: true }))
    await new Promise((ok) => r2.on('finish', ok))
    expect(r2.status).toBe(200)
    expect(seen.at(-1)).toEqual({ url: 'http://vllm:8000/v1/chat/completions', auth: 'Bearer secret' })
  })
})

describe('the command-line agent', () => {
  it('only answers this machine unless there is a password, never through a proxy', () => {
    expect(fromThisMachine(req())).toBe(true)
    expect(fromThisMachine(req({}, '::1'))).toBe(true)
    expect(fromThisMachine(req({}, '192.168.1.20'))).toBe(false)
    expect(fromThisMachine(req({ 'x-forwarded-for': '8.8.8.8' }))).toBe(false)
    expect(programOf('claude -p --tools ""')).toBe('claude')
    expect(programOf('C:\\tools\\codex.exe exec -')).toBe('codex')
  })

  it('refuses a request from elsewhere when there is no password', async () => {
    const r = res()
    await new CommandRunner({ command: node(''), gate: new AiGate() }).handle(req({}, '10.0.0.5'), r, JSON.stringify({ prompt: 'Hi' }))
    expect(r.status).toBe(403)
    expect(r.text()).toMatch(/BRAINCRAFT_AI_PASSWORD/)
  })

  it('runs the command with the prompt on its input and answers with its output', async () => {
    const r = res()
    await new CommandRunner({ command: node("process.stdin.on('data',d=>process.stdout.write(String(d).toUpperCase()))"), gate: new AiGate() }).handle(req(), r, JSON.stringify({ prompt: 'read the board' }))
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text())).toEqual({ text: 'READ THE BOARD' })
  })

  it('says why it failed, and stops one that runs too long', async () => {
    const r1 = res()
    await new CommandRunner({ command: node("console.error('not logged in');process.exit(3)"), gate: new AiGate() }).handle(req(), r1, JSON.stringify({ prompt: 'x' }))
    expect(r1.status).toBe(502)
    expect(JSON.parse(r1.text()).error).toMatch(/code 3: not logged in/)
    const r2 = res()
    const t = Date.now()
    await new CommandRunner({ command: node('setTimeout(()=>{},20000)'), gate: new AiGate(), timeoutMs: 400 }).handle(req(), r2, JSON.stringify({ prompt: 'x' }))
    expect(r2.status).toBe(502)
    expect(JSON.parse(r2.text()).error).toMatch(/longer than/)
    expect(Date.now() - t).toBeLessThan(5000)
  }, 15000)
})
