import { describe, expect, it } from 'vitest'
import type { Backend, StopReason, TurnRequest } from './backends'
import { askWhole } from './once'
import { type AiSettings, type ServerAi, connectionFor, reviewSettings, withServerChoice } from './settings'

/** A model that says these in turn, each cut off or not, and keeps what it was asked. */
function model(replies: [string, StopReason][]) {
  const asked: TurnRequest[] = []
  const backend: Backend = {
    label: 'test',
    turn: async (req) => {
      asked.push({ ...req, messages: [...req.messages] })
      const [text, stop] = replies[Math.min(asked.length - 1, replies.length - 1)]
      return { content: text ? [{ type: 'text', text, citations: null }] : [], stop }
    },
  }
  return { backend, asked }
}
const said = (req: TurnRequest, k: number) => {
  const c = req.messages[k].content
  return typeof c === 'string' ? c : c.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
}

describe('a question answered whole', () => {
  it('gives an answer that finished as it is, asking once', async () => {
    const { backend, asked } = model([['Title: Launch\nOutcomes:\n- Decision: Go', 'end_turn']])
    expect(await askWhole(backend, 'system', 'the transcript')).toEqual({ text: 'Title: Launch\nOutcomes:\n- Decision: Go', cut: false })
    expect(asked).toHaveLength(1)
    expect(asked[0].system).toBe('system')
    expect(asked[0].tools).toEqual([])
  })

  it('carries on an answer that ran out of room, from its last whole line', async () => {
    const { backend, asked } = model([
      ['Ideas:\n- 0:10 | Sam | Launch | 1 | First idea\n- 0:40 | Brian | Laun', 'max_tokens'],
      ['- 0:40 | Brian | Launch | 2 | Second idea\nSummary:\nIt moved to June.', 'end_turn'],
    ])
    const out = await askWhole(backend, 'system', 'the transcript')
    // The half-written line is gone, and written again whole.
    expect(out).toEqual({ text: 'Ideas:\n- 0:10 | Sam | Launch | 1 | First idea\n- 0:40 | Brian | Launch | 2 | Second idea\nSummary:\nIt moved to June.', cut: false })
    expect(asked).toHaveLength(2)
    // Asked again with what it wrote, told where to carry on from.
    expect(asked[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(said(asked[1], 0)).toBe('the transcript')
    expect(said(asked[1], 1)).toBe('Ideas:\n- 0:10 | Sam | Launch | 1 | First idea')
    expect(said(asked[1], 2)).toContain('cut off')
    expect(said(asked[1], 2).endsWith('- 0:10 | Sam | Launch | 1 | First idea')).toBe(true)
  })

  it('carries on more than once, and an answer cut within its first line is kept as it is', async () => {
    const { backend, asked } = model([
      ['Title: A very long', 'max_tokens'],
      ['title\nOutcomes:\n- Decision: G', 'max_tokens'],
      ['- Decision: Go', 'end_turn'],
    ])
    const out = await askWhole(backend, 's', 'q')
    expect(out.cut).toBe(false)
    expect(out.text).toBe('Title: A very long\ntitle\nOutcomes:\n- Decision: Go')
    expect(asked).toHaveLength(3)
    expect(asked[2].messages).toHaveLength(5)
  })

  it('gives up after a few goes, with what there is, and says it was cut', async () => {
    const { backend, asked } = model([['- one line\n- half', 'max_tokens']])
    const out = await askWhole(backend, 's', 'q')
    expect(out.cut).toBe(true)
    expect(asked).toHaveLength(5)
    // Every whole line once, and the last go's as far as it got.
    expect(out.text).toBe('- one line\n- one line\n- one line\n- one line\n- one line\n- half')
  })

  it('says so when the model ran out of room before writing anything', async () => {
    const { backend, asked } = model([['', 'max_tokens']])
    await expect(askWhole(backend, 's', 'q')).rejects.toThrow(/ran out of room before it wrote anything/)
    expect(asked).toHaveLength(1)
  })
})

describe('what reviews a meeting', () => {
  const ai: ServerAi = {
    available: true,
    password: false,
    providers: ['openai', 'command'],
    openaiModels: ['fast-model', 'big-model'],
    textTools: false,
    agents: [
      { id: 'claude', label: 'Claude Code (claude -p)' },
      { id: 'codex', label: 'Codex (codex exec)' },
    ],
    agentsLocal: false,
  }
  const s: AiSettings = { mode: 'server', provider: 'openai', serverModel: 'fast-model', model: 'claude-opus-5-5' as AiSettings['model'] }

  it('is what the assistant runs on, unless another of the server’s choices is picked for reviews', () => {
    expect(reviewSettings(s, ai)).toBe(s)
    expect(connectionFor(reviewSettings(s, ai), 'https://bc.example/', ai)).toMatchObject({ kind: 'openai', model: 'fast-model' })
    const codex = reviewSettings({ ...s, review: 'command:codex' }, ai)
    expect(connectionFor(codex, 'https://bc.example/', ai)).toMatchObject({ kind: 'command', agent: 'codex' })
    const big = reviewSettings({ ...s, review: 'openai:big-model' }, ai)
    expect(connectionFor(big, 'https://bc.example/', ai)).toMatchObject({ kind: 'openai', model: 'big-model' })
    // The assistant's own choice is left as it was.
    expect(s).toMatchObject({ provider: 'openai', serverModel: 'fast-model' })
  })

  it('goes back to the assistant’s own when the server no longer offers what was picked', () => {
    expect(reviewSettings({ ...s, review: 'command:gone' }, ai)).toMatchObject({ provider: 'openai', serverModel: 'fast-model' })
    expect(reviewSettings({ ...s, review: 'openai:gone-model' }, ai)).toMatchObject({ provider: 'openai', serverModel: 'fast-model' })
    expect(reviewSettings({ ...s, review: 'anthropic:claude-opus-5-5' }, ai)).toMatchObject({ provider: 'openai' })
    expect(reviewSettings({ ...s, review: 'nonsense' }, ai)).toMatchObject({ provider: 'openai' })
    expect(withServerChoice(s, ai, undefined)).toBeNull()
    expect(withServerChoice(s, ai, 'command:codex')).toMatchObject({ mode: 'server', provider: 'command', agent: 'codex' })
  })

  it('is never the server’s when the assistant runs on your own key or model server', () => {
    const own: AiSettings = { ...s, mode: 'openai', openaiBase: 'http://localhost:8000/v1', openaiModel: 'mine', review: 'command:codex' }
    expect(reviewSettings(own, ai)).toBe(own)
    expect(connectionFor(reviewSettings(own, ai), 'https://bc.example/', ai)).toMatchObject({ kind: 'openai', model: 'mine' })
  })
})
