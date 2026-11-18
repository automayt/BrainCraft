import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AiSettings, type ServerAi, choiceName, connectionFor, hasSettings, loadSettings, notOffered, readSettings, saveSettings, savedChoice } from './settings'
import { choicesOf, keepSettings, newer, settingsHere, syncSettings, withKept } from './settingsStore'

const MODEL = 'claude-opus-5-5' as AiSettings['model']
const SERVER = 'https://bc.example/'

/** A browser's storage, and a server that keeps settings (or refuses, or can't be reached). */
function world(o: { kept?: Record<string, unknown> | null; status?: number; down?: boolean } = {}) {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  const sent: { method: string; url: string; body: unknown }[] = []
  let kept = o.kept ?? null
  vi.stubGlobal('fetch', async (url: string, init: { method?: string; body?: string } = {}) => {
    if (o.down) throw new Error('offline')
    const method = init.method ?? 'GET'
    sent.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined })
    if (o.status) return { ok: false, status: o.status, json: async () => ({ error: 'no' }) }
    if (method === 'PUT') kept = JSON.parse(init.body!) as Record<string, unknown>
    return { ok: true, status: 200, json: async () => (method === 'GET' ? { settings: kept } : { ok: true }) }
  })
  return { store, sent, kept: () => kept }
}
const mine: AiSettings = { mode: 'openai', model: MODEL, openaiBase: 'http://models.example:8000/v1', openaiModel: 'big-model', openaiKey: 'sk-secret', apiKey: 'sk-ant-secret', password: 'server-secret', textTools: true, review: 'command:codex' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('what’s kept with the account', () => {
  it('is everything chosen, and nothing secret', () => {
    const kept = choicesOf({ ...mine, at: 5 })
    expect(kept).toEqual({ mode: 'openai', model: MODEL, openaiBase: 'http://models.example:8000/v1', openaiModel: 'big-model', textTools: true, review: 'command:codex', at: 5 })
    expect(JSON.stringify(kept)).not.toMatch(/secret/)
  })

  it('comes back with this browser’s own keys and passwords, checked like anything read', () => {
    const here: AiSettings = { mode: 'server', model: MODEL, apiKey: 'my-key', password: 'my-password' }
    const back = withKept(here, { ...choicesOf(mine), at: 9, apiKey: 'someone-else’s', mode: 'nonsense', provider: 'made-up' })
    expect(back).toMatchObject({ mode: 'server', openaiBase: 'http://models.example:8000/v1', openaiModel: 'big-model', review: 'command:codex', textTools: true, at: 9, apiKey: 'my-key', password: 'my-password' })
    expect(back.provider).toBeUndefined()
    expect(back.openaiKey).toBeUndefined()
    expect(withKept(here, 'not settings')).toMatchObject({ mode: 'server', apiKey: 'my-key' })
  })

  it('goes by whichever was changed last', () => {
    const at = (n?: number): AiSettings => ({ mode: 'server', model: MODEL, ...(n ? { at: n } : {}) })
    expect(newer(at(), false, null)).toBe('same')
    expect(newer(at(5), true, null)).toBe('here')
    expect(newer(at(), false, { at: 3 })).toBe('kept')
    // A browser with none takes the account's, dated or not.
    expect(newer(at(), false, {})).toBe('kept')
    expect(newer(at(5), true, { at: 9 })).toBe('kept')
    expect(newer(at(9), true, { at: 5 })).toBe('here')
    expect(newer(at(5), true, { at: 5 })).toBe('same')
    // Settings from before they were dated are the older.
    expect(newer(at(), true, { at: 1 })).toBe('kept')
  })
})

describe('settings in a browser and with the account', () => {
  beforeEach(() => vi.useFakeTimers())

  it('come to a browser that has none: a new browser, or the server at a new address', async () => {
    const w = world({ kept: { ...choicesOf(mine), at: 7 } })
    expect(hasSettings()).toBe(false)
    const got = await settingsHere(SERVER)
    expect(got).toMatchObject({ mode: 'openai', openaiBase: 'http://models.example:8000/v1', openaiModel: 'big-model', review: 'command:codex', at: 7 })
    // Kept here now, so the next read needs no server.
    expect(loadSettings()).toEqual(got)
    expect(w.sent.map((s) => s.method)).toEqual(['GET'])
    await settingsHere(SERVER)
    expect(w.sent).toHaveLength(1)
  })

  it('go up to the account when this browser’s are the newer, or the account has none', async () => {
    const w = world()
    saveSettings({ ...mine, at: 4 })
    expect(await syncSettings(SERVER)).toMatchObject({ openaiModel: 'big-model', openaiKey: 'sk-secret' })
    await vi.runAllTimersAsync()
    expect(w.sent.map((s) => s.method)).toEqual(['GET', 'PUT'])
    expect(w.sent[1].url).toBe('https://bc.example/api/assistant/settings')
    expect(w.kept()).toEqual(choicesOf({ ...mine, at: 4 }))
    expect(JSON.stringify(w.sent)).not.toMatch(/secret/)
  })

  it('replace this browser’s when the account’s are the newer, keeping its keys', async () => {
    world({ kept: { mode: 'server', provider: 'command', agent: 'codex', model: MODEL, at: 20 } })
    saveSettings({ ...mine, at: 4 })
    expect(await syncSettings(SERVER)).toMatchObject({ mode: 'server', provider: 'command', agent: 'codex', at: 20, openaiKey: 'sk-secret', apiKey: 'sk-ant-secret', password: 'server-secret' })
    expect(loadSettings()).toMatchObject({ provider: 'command', agent: 'codex', openaiKey: 'sk-secret' })
  })

  it('stay as they are here when there’s no account, no server, or it can’t be reached', async () => {
    for (const o of [{ status: 401 }, { status: 404 }, { status: 403 }, { down: true }]) {
      const w = world(o)
      saveSettings({ ...mine, at: 4 })
      expect(await syncSettings(SERVER)).toMatchObject({ openaiModel: 'big-model', at: 4 })
      expect(w.sent.filter((s) => s.method === 'PUT')).toEqual([])
      vi.unstubAllGlobals()
    }
    const w = world()
    saveSettings({ ...mine, at: 4 })
    expect(await syncSettings(null)).toMatchObject({ openaiModel: 'big-model' })
    expect(w.sent).toEqual([])
  })

  it('are kept a moment after the last change, once, without keys', async () => {
    const w = world()
    keepSettings(SERVER, { ...mine, openaiModel: 'b', at: 1 })
    keepSettings(SERVER, { ...mine, openaiModel: 'bi', at: 2 })
    keepSettings(SERVER, { ...mine, openaiModel: 'big', at: 3 })
    expect(w.sent).toEqual([])
    // Still typing: it waits from the last change, not the first.
    await vi.advanceTimersByTimeAsync(500)
    keepSettings(SERVER, { ...mine, openaiModel: 'big', at: 3 })
    await vi.advanceTimersByTimeAsync(500)
    expect(w.sent).toEqual([])
    await vi.advanceTimersByTimeAsync(300)
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0]).toMatchObject({ method: 'PUT', body: { openaiModel: 'big', at: 3 } })
    expect(JSON.stringify(w.sent)).not.toMatch(/secret/)
  })
})

describe('a choice the server isn’t offering just now', () => {
  const ai = (o: Partial<ServerAi> = {}): ServerAi => ({ available: true, password: false, providers: ['openai', 'command'], openaiModels: ['fast-model', 'big-model'], textTools: false, agents: [{ id: 'codex', label: 'Codex (codex exec)' }], agentsLocal: false, ...o })
  const s: AiSettings = { mode: 'server', model: MODEL, provider: 'openai', serverModel: 'big-model', review: 'command:codex' }

  it('is named as it was chosen', () => {
    expect(savedChoice(s)).toBe('openai:big-model')
    expect(savedChoice({ ...s, provider: 'command', agent: 'codex' })).toBe('command:codex')
    expect(savedChoice({ ...s, provider: 'anthropic' })).toBe(`anthropic:${MODEL}`)
    expect(savedChoice({ mode: 'server', model: MODEL })).toBeUndefined()
    expect(choiceName('openai:big-model')).toBe('big-model on the server’s model server')
    expect(choiceName('openai:')).toBe('the server’s model server')
    expect(choiceName('command:codex')).toBe('Codex')
    expect(choiceName('command:claude')).toBe('Claude Code')
    expect(choiceName('command:custom')).toBe('custom')
  })

  it('is found missing, and is still in the settings', () => {
    expect(notOffered(s, ai())).toEqual({})
    // The model server is down: its models aren't listed, or it isn't offered at all.
    expect(notOffered(s, ai({ openaiModels: ['fast-model'] }))).toEqual({ own: 'openai:big-model' })
    expect(notOffered(s, ai({ providers: ['command'], openaiModels: [] }))).toEqual({ own: 'openai:big-model' })
    // Codex isn't installed any more.
    expect(notOffered(s, ai({ agents: [] }))).toEqual({ review: 'command:codex' })
    expect(notOffered(s, ai({ available: false, providers: [], openaiModels: [], agents: [] }))).toEqual({ own: 'openai:big-model', review: 'command:codex' })
    // Something else is used meanwhile, and the settings still say what was chosen.
    const down = ai({ openaiModels: ['fast-model'] })
    expect(connectionFor(s, SERVER, down)).toMatchObject({ kind: 'openai', model: 'fast-model' })
    expect(s).toMatchObject({ provider: 'openai', serverModel: 'big-model' })
    // Your own key or model server isn't the server's to offer.
    expect(notOffered({ ...s, mode: 'openai' }, ai({ available: false, providers: [] }))).toEqual({})
  })

  it('reads settings back dated, and without what isn’t a setting', () => {
    expect(readSettings({ mode: 'openai', openaiBase: 'x', at: 12, review: 'command:codex', junk: 1 })).toMatchObject({ mode: 'openai', openaiBase: 'x', at: 12, review: 'command:codex' })
    expect(readSettings({ at: 'yesterday' }).at).toBeUndefined()
    expect(readSettings(null)).toMatchObject({ mode: 'server', model: expect.any(String) })
  })
})
