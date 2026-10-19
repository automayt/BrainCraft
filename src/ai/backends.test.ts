import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, newItem } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { Assistant, type Proposal, describeError } from './assistant'
import { BackendError, CommandBackend, FenceFilter, INVALID_TOOL, type Message, OpenAiBackend, commandPrompt, parseToolBlocks, toChatMessages } from './backends'
import { connectionFor } from './settings'

const tools = [{ name: 'read_board', description: 'Describes the board', input_schema: { type: 'object' as const, properties: {} } }]

/** A fetch that answers chat completions with server-sent events, one reply per call, and keeps what was sent. */
function sseFetch(replies: object[][]) {
  const sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
  const f = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> })
    const chunks = replies[sent.length - 1] ?? []
    const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  return { f, sent }
}

const delta = (d: object, finish: string | null = null) => ({ choices: [{ delta: d, finish_reason: finish }] })

describe('talking to OpenAI-compatible servers', () => {
  it('turns the conversation into chat messages: tool calls, their results, pictures', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }, { type: 'text', text: 'What is this?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 'c1', name: 'read_board', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Board "Ideas": 2 objects' }] },
    ]
    const chat = toChatMessages('Be brief.', messages, tools, false)
    expect(chat[0]).toEqual({ role: 'system', content: 'Be brief.' })
    expect(chat[1]).toEqual({ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }, { type: 'text', text: 'What is this?' }] })
    expect(chat[2]).toEqual({ role: 'assistant', content: 'Let me look.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_board', arguments: '{}' } }] })
    expect(chat[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'Board "Ideas": 2 objects' })
    // Without tool calling, the tools are described in the system prompt and calls written as blocks.
    const text = toChatMessages('Be brief.', messages, tools, true)
    expect(String(text[0].content)).toContain('```tool')
    expect(text[2]).toMatchObject({ role: 'assistant', content: expect.stringContaining('"name":"read_board"') })
    expect(text[3]).toMatchObject({ role: 'user', content: expect.stringContaining('Result of read_board:') })
  })

  it('streams words and gathers tool calls split across chunks', async () => {
    const { f, sent } = sseFetch([
      [
        delta({ content: 'Looking' }),
        delta({ content: '…' }),
        delta({ tool_calls: [{ index: 0, id: 'c9', function: { name: 'read_', arguments: '{"ki' } }] }),
        delta({ tool_calls: [{ index: 0, function: { name: 'board', arguments: 'nd":"sticky"}' } }] }, 'tool_calls'),
        { choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } },
      ],
    ])
    const b = new OpenAiBackend({ base: 'http://localhost:8000/v1/', apiKey: 'k', model: 'qwen3', label: 'qwen3', fetch: f })
    let streamed = ''
    const r = await b.turn({ system: 'S', messages: [{ role: 'user', content: 'Hi' }], tools }, (d) => (streamed += d))
    expect(streamed).toBe('Looking…')
    expect(r.stop).toBe('tool_use')
    expect(r.content.at(-1)).toMatchObject({ type: 'tool_use', id: 'c9', name: 'read_board', input: { kind: 'sticky' } })
    expect(r.usage).toEqual({ input: 120, output: 30 })
    expect(sent[0].url).toBe('http://localhost:8000/v1/chat/completions')
    expect(sent[0].headers.authorization).toBe('Bearer k')
    expect(sent[0].body).toMatchObject({ model: 'qwen3', stream: true, tools: [{ type: 'function', function: { name: 'read_board' } }] })
  })

  it('reads tool blocks out of the words for a model without tool calling, never showing them', async () => {
    const { f } = sseFetch([[delta({ content: 'One moment.\n``' }), delta({ content: '`tool\n{"name": "read_board", "input": {}}\n```' }, 'stop')]])
    const b = new OpenAiBackend({ base: 'http://x/v1', model: 'm', textTools: true, label: 'm', fetch: f })
    let streamed = ''
    const r = await b.turn({ system: 'S', messages: [{ role: 'user', content: 'Hi' }], tools }, (d) => (streamed += d))
    expect(streamed).not.toContain('```')
    expect(streamed.trim()).toBe('One moment.')
    expect(r.stop).toBe('tool_use')
    expect(r.content.map((c) => c.type)).toEqual(['text', 'tool_use'])
  })

  it('reports a server error in plain words', async () => {
    const f = (async () => new Response(JSON.stringify({ error: { message: '"auto" tool choice requires --enable-auto-tool-choice' } }), { status: 400 })) as unknown as typeof fetch
    const b = new OpenAiBackend({ base: 'http://x/v1', model: 'm', label: 'm', fetch: f })
    const err = await b.turn({ system: 'S', messages: [{ role: 'user', content: 'Hi' }], tools }, () => {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BackendError)
    expect(describeError(err)).toMatch(/400.*enable-auto-tool-choice/)
  })

  it('runs the whole assistant loop on such a server: read, propose, answer', async () => {
    let b = emptyBoard('Ideas')
    ;[b] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'Fast checkout' }))
    const { f, sent } = sseFetch([
      [delta({ tool_calls: [{ index: 0, id: 'a', function: { name: 'read_board', arguments: '{}' } }] }, 'tool_calls')],
      [delta({ tool_calls: [{ index: 0, id: 'b', function: { name: 'propose_changes', arguments: JSON.stringify({ summary: 'Add a note', ops: [{ op: 'createNote', text: 'Saved carts' }] }) } }] }, 'tool_calls')],
      [delta({ content: 'Added a note.' }, 'stop')],
    ])
    const proposals: Proposal[] = []
    let text = ''
    const a = new Assistant(new OpenAiBackend({ base: 'http://x/v1', model: 'm', label: 'm', fetch: f }), { board: () => b, measure: fakeMeasure, selection: () => [] })
    await a.send('Add an idea', { text: (t) => (text += t), status: () => {}, proposal: (p) => proposals.push(p) })
    expect(proposals).toHaveLength(1)
    expect(text).toBe('Added a note.')
    const third = sent[2].body.messages as { role: string; content: string }[]
    expect(third.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'b' })
    expect(third[3]).toMatchObject({ role: 'tool', content: expect.stringContaining('Board "Ideas"') })
  })
})

describe('tools described in the text', () => {
  it('finds tool blocks, and says when one can’t be read', () => {
    const r = parseToolBlocks('Sure.\n```tool\n{"name": "find", "input": {"query": "x"}}\n```\n```tool\n{oops}\n```')
    expect(r.text).toBe('Sure.')
    expect(r.uses[0]).toEqual({ name: 'find', input: { query: 'x' } })
    expect(r.uses[1].name).toBe(INVALID_TOOL)
    expect(parseToolBlocks('Just words, with ```code``` in them.')).toEqual({ text: 'Just words, with ```code``` in them.', uses: [] })
  })

  it('holds back a tool block as it streams, but never ordinary words', () => {
    let shown = ''
    const f = new FenceFilter((d) => (shown += d))
    for (const c of ['Hel', 'lo there', '\n`', '``to', 'ol\n{}```']) f.push(c)
    f.end()
    expect(shown).toBe('Hello there\n')
    shown = ''
    const g = new FenceFilter((d) => (shown += d))
    g.push('All done.')
    g.end()
    expect(shown).toBe('All done.')
  })
})

describe('a command-line agent on the server', () => {
  it('sends the whole conversation as one prompt and reads its tool blocks back', async () => {
    const sent: { url: string; body: { prompt: string }; headers: Record<string, string> }[] = []
    const f = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> })
      return new Response(JSON.stringify({ text: 'Checking.\n```tool\n{"name":"read_board","input":{}}\n```' }), { status: 200 })
    }) as unknown as typeof fetch
    const b = new CommandBackend({ base: 'http://srv:8080', password: 'pw', label: 'claude on this server', fetch: f })
    let shown = ''
    const r = await b.turn({ system: 'You help.', messages: [{ role: 'user', content: 'What’s here?' }], tools }, (d) => (shown += d))
    expect(sent[0].url).toBe('http://srv:8080/api/ai/command')
    expect(sent[0].headers['x-braincraft-ai-password']).toBe('pw')
    expect(sent[0].body.prompt).toContain('You help.')
    expect(sent[0].body.prompt).toContain('What’s here?')
    expect(sent[0].body.prompt).toContain('read_board: Describes the board')
    expect(shown).toBe('Checking.')
    expect(r.stop).toBe('tool_use')
    expect(commandPrompt({ system: 'S', messages: [{ role: 'user', content: 'Hi' }], tools }).trimEnd().endsWith('## You (the assistant)')).toBe(true)
  })
})

describe('choosing where the assistant runs', () => {
  const ai = { available: true, password: false, providers: ['anthropic', 'openai', 'command'] as ('anthropic' | 'openai' | 'command')[], openaiModels: ['qwen3', 'llama'], textTools: true, command: 'claude' }
  const base = { model: 'claude-opus-5-5' as const }
  it('picks the server’s provider and model, or your own model server', () => {
    expect(connectionFor({ ...base, mode: 'server' }, 'http://s/', ai)).toEqual({ kind: 'server', base: 'http://s/' })
    expect(connectionFor({ ...base, mode: 'server', provider: 'openai', serverModel: 'llama' }, 'http://s/', ai)).toMatchObject({ kind: 'openai', base: 'http://s/api/ai/openai', model: 'llama', textTools: true })
    expect(connectionFor({ ...base, mode: 'server', provider: 'command' }, 'http://s/', ai)).toMatchObject({ kind: 'command', base: 'http://s/', label: 'claude on this server' })
    expect(connectionFor({ ...base, mode: 'openai', openaiBase: 'http://localhost:8000/v1', openaiModel: 'qwen3' }, null, ai)).toMatchObject({ kind: 'openai', base: 'http://localhost:8000/v1', model: 'qwen3', textTools: false })
    expect(connectionFor({ ...base, mode: 'openai', openaiBase: 'http://localhost:8000/v1' }, null, ai)).toBeNull()
    expect(connectionFor({ ...base, mode: 'server' }, 'http://s/', { ...ai, password: true })).toBeNull()
  })
})
