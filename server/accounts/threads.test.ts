import { describe, expect, it } from 'vitest'
import { cookieOf, req, res, tempDir } from './fakes'
import { Accounts } from './service'
import { AssistantThreads } from './threads'

/** A server with accounts and kept conversations; an admin (Ann) and one person (Sam). */
async function server() {
  const dir = tempDir()
  const accounts = new Accounts({ dir })
  const threads = new AssistantThreads({ dir: `${dir}/threads`, accounts, maxBytes: 2000 })
  const call = async (method: string, path: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = res()
    const url = new URL(`http://localhost:8080${path}`)
    const raw = async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body))
    if (!(await accounts.handle(req(method, { cookie, ...headers }), r, url, raw))) {
      if (!(await threads.handle(req(method, { cookie, ...headers }), r, url, raw))) return { status: 404, headers: {}, body: {} }
    }
    return r.reply
  }
  const ann = cookieOf(await call('POST', '/api/auth/setup', '', { email: 'ann@x.org', name: 'Ann', password: 'a long password' }))
  const made = await call('POST', '/api/admin/users', ann, { email: 'sam@x.org', name: 'Sam' })
  const sam = cookieOf(await call('POST', '/api/auth/reset', '', { token: String(made.body.link).split('#reset=')[1], password: 'Sam long password' }))
  return { call, ann, sam }
}

const thread = (words: string) => ({ v: 1, messages: [{ role: 'user', content: [{ type: 'text', text: words }] }], turns: [{ role: 'user', text: words, proposals: [] }] })

describe('conversations kept with your account', () => {
  it('keeps each person’s own conversation, and forgets it on New chat', async () => {
    const s = await server()
    expect((await s.call('GET', '/api/assistant/thread', s.sam)).body).toEqual({ thread: null })
    expect((await s.call('PUT', '/api/assistant/thread', s.sam, thread('plan the launch'))).status).toBe(200)
    expect((await s.call('PUT', '/api/assistant/thread', s.ann, thread('Ann’s own'))).status).toBe(200)
    expect((await s.call('GET', '/api/assistant/thread', s.sam)).body).toEqual({ thread: thread('plan the launch') })
    // Private: Ann (an admin) gets her own, never Sam's.
    expect((await s.call('GET', '/api/assistant/thread', s.ann)).body).toEqual({ thread: thread('Ann’s own') })
    expect((await s.call('DELETE', '/api/assistant/thread', s.sam)).status).toBe(200)
    expect((await s.call('GET', '/api/assistant/thread', s.sam)).body).toEqual({ thread: null })
  })

  it('takes only a signed-in person’s conversation, from the app, within its size', async () => {
    const s = await server()
    expect((await s.call('GET', '/api/assistant/thread', '')).status).toBe(401)
    expect((await s.call('PUT', '/api/assistant/thread', s.sam, thread('hi'), { 'x-braincraft': '' })).status).toBe(403)
    expect((await s.call('PUT', '/api/assistant/thread', s.sam, { v: 2 })).status).toBe(400)
    expect((await s.call('PUT', '/api/assistant/thread', s.sam, 'not json')).status).toBe(400)
    expect((await s.call('PUT', '/api/assistant/thread', s.sam, thread('x'.repeat(3000)))).status).toBe(413)
  })

  it('is only for people who may use the assistant', async () => {
    const s = await server()
    // Everyone may, out of the box; take it away from the Everyone group.
    expect((await s.call('PATCH', '/api/admin/groups/everyone', s.ann, { permissions: ['boards.create'] })).status).toBe(200)
    expect((await s.call('GET', '/api/assistant/thread', s.sam)).status).toBe(403)
  })
})

describe('assistant settings kept with your account', () => {
  const mine = { mode: 'openai', model: 'claude-opus-5-5', openaiBase: 'http://models.example:8000/v1', openaiModel: 'big-model', textTools: true, review: 'command:codex', at: 7 }

  it('keeps each person’s own, and gives them back', async () => {
    const s = await server()
    expect((await s.call('GET', '/api/assistant/settings', s.sam)).body).toEqual({ settings: null })
    expect((await s.call('PUT', '/api/assistant/settings', s.sam, mine)).status).toBe(200)
    expect((await s.call('PUT', '/api/assistant/settings', s.ann, { mode: 'server', provider: 'command', agent: 'claude', at: 3 })).status).toBe(200)
    expect((await s.call('GET', '/api/assistant/settings', s.sam)).body).toEqual({ settings: mine })
    // Private: Ann (an admin) gets her own, never Sam's.
    expect((await s.call('GET', '/api/assistant/settings', s.ann)).body).toEqual({ settings: { mode: 'server', provider: 'command', agent: 'claude', at: 3 } })
    // Changed again: the newer is what's kept.
    expect((await s.call('PUT', '/api/assistant/settings', s.sam, { ...mine, openaiModel: 'bigger-model', at: 9 })).status).toBe(200)
    expect((await s.call('GET', '/api/assistant/settings', s.sam)).body.settings).toMatchObject({ openaiModel: 'bigger-model', at: 9 })
  })

  it('never keeps a key or a password, even when sent one', async () => {
    const s = await server()
    await s.call('PUT', '/api/assistant/settings', s.sam, { ...mine, apiKey: 'sk-ant-secret', openaiKey: 'sk-secret', password: 'server-secret', extra: { anything: 'else' }, openaiBase: 'x'.repeat(500) })
    const got = (await s.call('GET', '/api/assistant/settings', s.sam)).body
    expect(JSON.stringify(got)).not.toMatch(/secret|anything/)
    // What's too long to be an address isn't kept either; the rest is.
    expect(got.settings).toEqual({ mode: 'openai', model: 'claude-opus-5-5', openaiModel: 'big-model', textTools: true, review: 'command:codex', at: 7 })
  })

  it('takes only settings, from the app, from someone signed in who may use the assistant', async () => {
    const s = await server()
    expect((await s.call('GET', '/api/assistant/settings', '')).status).toBe(401)
    expect((await s.call('PUT', '/api/assistant/settings', s.sam, mine, { 'x-braincraft': '' })).status).toBe(403)
    expect((await s.call('PUT', '/api/assistant/settings', s.sam, 'not json')).status).toBe(400)
    expect((await s.call('PUT', '/api/assistant/settings', s.sam, [1, 2])).status).toBe(400)
    expect((await s.call('PUT', '/api/assistant/settings', s.sam, { ...mine, review: 'x'.repeat(20_000) })).status).toBe(400)
    expect((await s.call('DELETE', '/api/assistant/settings', s.sam)).status).toBe(405)
    expect((await s.call('GET', '/api/assistant/settings', s.sam)).body).toEqual({ settings: null })
    await s.call('PATCH', '/api/admin/groups/everyone', s.ann, { permissions: ['boards.create'] })
    expect((await s.call('GET', '/api/assistant/settings', s.sam)).status).toBe(403)
  })

  it('is kept apart from the conversation', async () => {
    const s = await server()
    await s.call('PUT', '/api/assistant/thread', s.sam, thread('plan the launch'))
    await s.call('PUT', '/api/assistant/settings', s.sam, mine)
    // New chat forgets the conversation, not the settings.
    await s.call('DELETE', '/api/assistant/thread', s.sam)
    expect((await s.call('GET', '/api/assistant/thread', s.sam)).body).toEqual({ thread: null })
    expect((await s.call('GET', '/api/assistant/settings', s.sam)).body).toEqual({ settings: mine })
  })
})
