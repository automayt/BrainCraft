/**
 * Where the assistant's thinking happens. The conversation is kept in one shape (the Anthropic
 * Messages format: text, tool calls, tool results); each backend turns it into what its model
 * understands and the reply back into that shape:
 *
 * - Anthropic: Claude through the Messages API, with your key or the BrainCraft server's.
 * - OpenAI-compatible: any server speaking the chat-completions API (vLLM, for instance), with its
 *   own tool calling, or with tools described in the text for models that have none.
 * - Command: a command-line agent the BrainCraft server runs once per step (`claude -p`,
 *   `codex exec`, …), given the whole conversation as text, with tools described in the text.
 */

import Anthropic from '@anthropic-ai/sdk'
import { uid } from '../model/uid'

export type Message = Anthropic.Beta.BetaMessageParam
export type Block = Anthropic.Beta.BetaContentBlock
export type Tool = Anthropic.Beta.BetaTool

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn'

export interface TurnResult {
  content: Block[]
  stop: StopReason
  usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }
}

export interface TurnRequest {
  system: string
  messages: Message[]
  tools: Tool[]
}

export interface Backend {
  /** What to call it in the panel ("Claude Opus 5.5", "qwen3 on vLLM", "claude -p on the server"). */
  readonly label: string
  /** Runs one step: the conversation so far → the model's reply, streaming its words to `onText`. */
  turn(req: TurnRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<TurnResult>
}

/** A failure worth showing the person rather than retrying (a refused request, a server error). */
export class BackendError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'BackendError'
    this.status = status
  }
}

// ----- Anthropic ---------------------------------------------------------------------------------

export class AnthropicBackend implements Backend {
  readonly label: string
  private client: Anthropic
  private model: string
  constructor(client: Anthropic, model: string, label: string) {
    this.client = client
    this.model = model
    this.label = label
  }

  async turn(req: TurnRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<TurnResult> {
    const fallbacks = this.model.includes('haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        // The conversation grows each step; automatic caching re-reads all of it at a tenth of the price.
        cache_control: { type: 'ephemeral' },
        tools: req.tools,
        messages: req.messages,
        ...fallbacks,
      },
      { signal },
    )
    stream.on('text', onText)
    const m = await stream.finalMessage()
    const u = m.usage
    return {
      content: m.content,
      stop: (m.stop_reason as StopReason | null) ?? 'end_turn',
      usage: u && { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
    }
  }
}

// ----- tools described in the text -----------------------------------------------------------------

/** How a model without tool calling is told about the tools. */
export function textToolPrompt(tools: Tool[]): string {
  const list = tools.map((t) => `- ${t.name}: ${t.description}\n  input (JSON Schema): ${JSON.stringify(t.input_schema)}`).join('\n')
  return `# Tools

You can use these tools to read and change the board:

${list}

To use a tool, write a block like this in your reply, and then stop writing:

\`\`\`tool
{"name": "read_board", "input": {}}
\`\`\`

You may put several tool blocks in one reply. The results come back in the next message. When you need no more tools, just answer in plain words (no tool block).`
}

/** A reply with its tool blocks taken out: the words, and the tool calls. */
export function parseToolBlocks(text: string): { text: string; uses: { name: string; input: unknown }[] } {
  const uses: { name: string; input: unknown }[] = []
  const words = text.replace(/```tool[ \t]*\n([\s\S]*?)```/g, (_, body: string) => {
    try {
      const v = JSON.parse(body.trim()) as { name?: unknown; input?: unknown }
      if (typeof v?.name !== 'string') throw new Error('it has no "name"')
      uses.push({ name: v.name, input: v.input ?? {} })
    } catch (err) {
      uses.push({ name: INVALID_TOOL, input: { error: `That tool block isn't valid JSON (${(err as Error).message}). Write {"name": "...", "input": {...}}.` } })
    }
    return ''
  })
  return { text: words.replace(/\n{3,}/g, '\n\n').trim(), uses }
}

/** The name given to a tool block that couldn't be read, so the model hears why. */
export const INVALID_TOOL = 'invalid_tool_block'

/**
 * Passes a reply's words through as they stream, holding back anything from a ```tool block on
 * (and the last few characters, which might be the start of one).
 */
export class FenceFilter {
  private seen = ''
  private shown = 0
  private out: (delta: string) => void
  constructor(out: (delta: string) => void) {
    this.out = out
  }

  push(delta: string) {
    this.seen += delta
    const fence = this.seen.indexOf('```tool')
    const until = fence >= 0 ? fence : Math.max(this.shown, this.seen.length - 7)
    if (until > this.shown) {
      this.out(this.seen.slice(this.shown, until))
      this.shown = until
    }
  }

  /** The reply is complete: shows what's left of its words (never a tool block). */
  end() {
    if (this.seen.indexOf('```tool') >= 0) return
    if (this.seen.length > this.shown) this.out(this.seen.slice(this.shown))
    this.shown = this.seen.length
  }
}

/** Tool names by call id, so a tool result can say which tool it answers. */
function toolNames(messages: Message[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') names.set(b.id, b.name)
  return names
}

const resultText = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text) : '')).join('\n') : ''

/** One message's content as plain text, tool calls as tool blocks and results labelled. */
function asText(m: Message, names: Map<string, string>): string {
  if (typeof m.content === 'string') return m.content
  const parts: string[] = []
  for (const b of m.content) {
    if (b.type === 'text') parts.push(b.text)
    else if (b.type === 'image') parts.push('[A picture was attached here, but this assistant can’t see pictures.]')
    else if (b.type === 'tool_use') parts.push(`\`\`\`tool\n${JSON.stringify({ name: b.name, input: b.input })}\n\`\`\``)
    else if (b.type === 'tool_result') parts.push(`${b.is_error ? 'Error from' : 'Result of'} ${names.get(b.tool_use_id) ?? 'a tool'}:\n${resultText(b.content)}`)
  }
  return parts.join('\n\n')
}

/** The reply of a model told about tools in the text, as content blocks. */
function fromText(text: string, cut: boolean): TurnResult {
  const { text: words, uses } = parseToolBlocks(text)
  const content: Block[] = []
  if (words) content.push({ type: 'text', text: words, citations: null } as Block)
  for (const u of uses) content.push({ type: 'tool_use', id: `t_${uid()}`, name: u.name, input: u.input } as Block)
  return { content, stop: cut ? 'max_tokens' : uses.length ? 'tool_use' : 'end_turn' }
}

// ----- OpenAI-compatible (vLLM and others) ---------------------------------------------------------

export interface OpenAiOptions {
  /** The API's base, ending in /v1 (e.g. http://localhost:8000/v1), or the BrainCraft server's proxy. */
  base: string
  apiKey?: string
  /** Sent as headers (the BrainCraft server's AI password). */
  headers?: Record<string, string>
  model: string
  /** Describe tools in the text, for models served without tool calling. */
  textTools?: boolean
  label: string
  fetch?: typeof fetch
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/** The conversation as chat-completions messages. */
export function toChatMessages(system: string, messages: Message[], tools: Tool[], textTools: boolean): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: textTools ? `${system}\n\n${textToolPrompt(tools)}` : system }]
  const names = toolNames(messages)
  for (const m of messages) {
    if (textTools || typeof m.content === 'string') {
      const text = asText(m, names)
      out.push(m.role === 'assistant' ? { role: 'assistant', content: text } : { role: 'user', content: text })
      continue
    }
    if (m.role === 'assistant') {
      const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n')
      const calls = m.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }] : []))
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
      continue
    }
    // A person's message: tool results first (each its own message, right after the calls), then words and pictures.
    for (const b of m.content) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: `${b.is_error ? 'Error: ' : ''}${resultText(b.content)}` })
    const parts: ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] = []
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ type: 'text', text: b.text })
      else if (b.type === 'image' && b.source.type === 'base64') parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } })
    }
    if (parts.length) out.push({ role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => (p as { text: string }).text).join('\n\n') : parts })
  }
  return out
}

/** Reads a server-sent-events stream, calling `on` with each data line's JSON. */
async function readEvents(body: ReadableStream<Uint8Array>, on: (data: unknown) => void) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        on(JSON.parse(data))
      } catch {
        // A line that isn't JSON (a keep-alive) is skipped.
      }
    }
  }
}

/** A failed response's message: the API's own words when it gives them. */
async function failure(res: Response, what: string): Promise<BackendError> {
  let said = ''
  try {
    const j = (await res.json()) as { error?: { message?: unknown } | string; message?: unknown }
    said = typeof j.error === 'string' ? j.error : typeof j.error?.message === 'string' ? j.error.message : typeof j.message === 'string' ? j.message : ''
  } catch {
    // No JSON body.
  }
  return new BackendError(`${what} returned an error (${res.status})${said ? `: ${said}` : ''}`, res.status)
}

export class OpenAiBackend implements Backend {
  readonly label: string
  private o: OpenAiOptions
  constructor(o: OpenAiOptions) {
    this.o = o
    this.label = o.label
  }

  async turn(req: TurnRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<TurnResult> {
    const textTools = !!this.o.textTools
    const body = {
      model: this.o.model,
      messages: toChatMessages(req.system, req.messages, req.tools, textTools),
      ...(textTools ? {} : { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 8192,
    }
    const f = this.o.fetch ?? globalThis.fetch.bind(globalThis)
    let res: Response
    try {
      res = await f(`${this.o.base.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}), ...this.o.headers },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new BackendError(`Couldn’t reach the model server at ${this.o.base} (${(err as Error).message}). Is it running, and does it allow this page’s address (CORS)?`)
    }
    if (!res.ok || !res.body) throw await failure(res, 'The model server')

    let text = ''
    let finish = ''
    let usage: TurnResult['usage']
    const calls: { id: string; name: string; args: string }[] = []
    const filter = new FenceFilter(onText)
    await readEvents(res.body, (raw) => {
      const d = raw as {
        choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      if (d.usage) usage = { input: d.usage.prompt_tokens ?? 0, output: d.usage.completion_tokens ?? 0 }
      const c = d.choices?.[0]
      if (!c) return
      if (c.delta?.content) {
        text += c.delta.content
        if (textTools) filter.push(c.delta.content)
        else onText(c.delta.content)
      }
      for (const t of c.delta?.tool_calls ?? []) {
        const k = t.index ?? calls.length
        calls[k] ??= { id: t.id ?? `t_${uid()}`, name: '', args: '' }
        if (t.id) calls[k].id = t.id
        if (t.function?.name) calls[k].name += t.function.name
        if (t.function?.arguments) calls[k].args += t.function.arguments
      }
      if (c.finish_reason) finish = c.finish_reason
    })
    if (textTools) {
      filter.end()
      return { ...fromText(text, finish === 'length'), usage }
    }
    const content: Block[] = []
    if (text.trim()) content.push({ type: 'text', text, citations: null } as Block)
    for (const c of calls.filter(Boolean)) {
      let input: unknown
      try {
        input = c.args.trim() ? JSON.parse(c.args) : {}
      } catch {
        content.push({ type: 'tool_use', id: c.id, name: INVALID_TOOL, input: { error: `The input for ${c.name} wasn’t valid JSON. Try again with valid JSON.` } } as Block)
        continue
      }
      content.push({ type: 'tool_use', id: c.id, name: c.name, input } as Block)
    }
    const stop: StopReason = finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
    return { content, stop, usage }
  }
}

// ----- a command-line agent on the BrainCraft server -------------------------------------------------

/** The whole conversation as one prompt, for an agent that takes text in and gives text back. */
export function commandPrompt(req: TurnRequest): string {
  const names = toolNames(req.messages)
  const turns = req.messages.map((m) => `## ${m.role === 'assistant' ? 'You (the assistant)' : 'The person (and tool results)'}\n\n${asText(m, names)}`)
  return `${req.system}

${textToolPrompt(req.tools)}

# Important

You are answering inside BrainCraft's assistant panel. Use only the tools above (as tool blocks); you have no other way to see or change the board, and any tools of your own must not be used. Reply with your next message only.

# The conversation so far

${turns.join('\n\n')}

## You (the assistant)
`
}

export interface CommandOptions {
  /** The BrainCraft server. */
  base: string
  password?: string
  /** Which of its agents ("claude", "codex", "custom"); the first when left out. */
  agent?: string
  label: string
  fetch?: typeof fetch
}

export class CommandBackend implements Backend {
  readonly label: string
  private o: CommandOptions
  constructor(o: CommandOptions) {
    this.o = o
    this.label = o.label
  }

  async turn(req: TurnRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<TurnResult> {
    const f = this.o.fetch ?? globalThis.fetch.bind(globalThis)
    let res: Response
    try {
      const url = new URL('api/ai/command', this.o.base.endsWith('/') ? this.o.base : `${this.o.base}/`)
      if (this.o.agent) url.searchParams.set('agent', this.o.agent)
      res = await f(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.o.password ? { 'x-braincraft-ai-password': this.o.password } : {}) },
        body: JSON.stringify({ prompt: commandPrompt(req) }),
        signal,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new BackendError(`Couldn’t reach the BrainCraft server (${(err as Error).message}).`)
    }
    if (!res.ok) throw await failure(res, 'The BrainCraft server')
    const { text } = (await res.json()) as { text?: unknown }
    if (typeof text !== 'string') throw new BackendError('The BrainCraft server sent an empty answer.')
    const out = fromText(text, false)
    const words = out.content.find((b) => b.type === 'text')
    if (words && words.type === 'text') onText(words.text)
    return out
  }
}
