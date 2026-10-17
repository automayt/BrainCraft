/**
 * The in-app AI assistant: a chat with Claude about the open board.
 *
 * Claude reads the board through the same tools the MCP server offers (read_board, get_object,
 * find). It never changes the board directly: it calls `propose_changes`, which checks the
 * operations against the current board and turns them into a preview the person applies or
 * discards. Applied proposals land in an AI history where each one can be undone on its own.
 */

import Anthropic from '@anthropic-ai/sdk'
import { OpError, type Op, applyOps } from '../api/ops'
import { OPS_GUIDE, TOOL_DEFS, type ToolHost, runTool } from '../api/tools'
import { type Patch, diff } from '../collab/patch'
import { type Measure, layoutAll } from '../model/mindmap'
import type { Rect } from '../model/geom'
import { boardText } from './boardText'
import type { Board, Id, Kind } from '../model/types'
import { uid } from '../model/uid'

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Most capable (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Faster, lower cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Fastest, lowest cost' },
] as const

export type AiModel = (typeof AI_MODELS)[number]['id']
export const DEFAULT_MODEL: AiModel = 'claude-opus-5-5'

/** How the app reaches Claude: through the BrainCraft server (its key) or with the person's own key. */
export type AiConnection = { kind: 'server'; base: string; password?: string } | { kind: 'key'; apiKey: string }

export function makeClient(c: AiConnection): Anthropic {
  if (c.kind === 'key') return new Anthropic({ apiKey: c.apiKey, dangerouslyAllowBrowser: true })
  // The server adds the real key; this placeholder never leaves for Anthropic.
  return new Anthropic({
    apiKey: 'braincraft-server',
    baseURL: new URL('api/ai', c.base.endsWith('/') ? c.base : `${c.base}/`).href,
    dangerouslyAllowBrowser: true,
    ...(c.password ? { defaultHeaders: { 'x-braincraft-ai-password': c.password } } : {}),
  })
}

export interface Proposal {
  id: string
  summary: string
  ops: Op[]
  /** The changes it makes to the board as it was when proposed. */
  patches: Patch[]
  counts: { added: number; changed: number; removed: number }
  status: 'pending' | 'applied' | 'discarded'
}

/** A picture sent with a message (a sketch or photo from the board). */
export interface AiImage {
  mediaType: 'image/png' | 'image/jpeg'
  /** Base64, without the data: prefix. */
  data: string
}

/** What the assistant needs from the app. */
export interface AssistantHost {
  board(): Board
  measure: Measure
  selection(): Id[]
  /** The part of the board on screen. */
  view?(): Rect
  /** The board as the person may see it (other people's hidden brainstorm notes blank), for reading. */
  readable?(): Board
}

export interface Callbacks {
  /** Streamed answer text. */
  text(delta: string): void
  /** What it's doing ("Reading the board…"), or null when idle. */
  status(s: string | null): void
  proposal(p: Proposal): void
}

const READ_TOOLS = ['read_board', 'get_object', 'find']

const READ_BOARD: Anthropic.Beta.BetaTool = {
  name: 'read_board',
  description:
    'Describes the board: title, counts, and one line per object (id, kind, position, size, label, extras such as parent or comment count), then the lines between them. Big boards list the selection, frames, mind-map roots, widgets and what is on screen; pass "area" or "kind" to read other parts. Call this first.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', description: 'Only objects of this kind (sticky, text, rect, ellipse, frame, mind, flow, comment, image, pen, table, kanban, timeline, data)' },
      area: {
        type: 'object',
        description: 'Only objects touching this rectangle, in board coordinates',
        properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
        required: ['x', 'y', 'w', 'h'],
      },
    },
  },
  eager_input_streaming: true,
}
const MAX_STEPS = 12

const SYSTEM = `You are the assistant inside BrainCraft, an infinite whiteboard with sticky notes, shapes, text, frames, mind maps, flowcharts, tables, Kanban boards, timelines, database views (one dataset shown as table/board/timeline), comments and object descriptions.

You help the person think and organise: answer questions about their board, summarise, find gaps, and build or restructure content.

How to work:
- Look before you answer: use read_board first, then get_object or find for detail. Each user message lists what they have selected; "this", "these" or "it" usually means the selection.
- To change the board, call propose_changes with operations and a one-line summary. Never claim you changed anything yourself: the person sees your proposal as a preview and applies or discards it. Prefer one well-formed proposal per request; if it is rejected with an error, fix the operations and propose again.
- Place new content in free space unless asked otherwise: omit "at" to put it beside existing content, or place it just right of or below the relevant objects (positions and sizes come from read_board).
- When you mention an object, link it as @[Label](#id) using its numeric id, so the person can click to it.
- Be brief. Short paragraphs or bullets, no preamble.

${OPS_GUIDE}`

function hostFor(h: AssistantHost): ToolHost {
  const no = () => {
    throw new Error('Not available here')
  }
  return {
    where: () => `the board "${h.board().title}" open in BrainCraft`,
    board: () => h.readable?.() ?? h.board(),
    apply: no,
    listBoards: no,
    openBoard: no,
    createBoard: no,
  }
}

function buildTools(): Anthropic.Beta.BetaTool[] {
  const read: Anthropic.Beta.BetaTool[] = TOOL_DEFS.filter((t) => READ_TOOLS.includes(t.name) && t.name !== 'read_board').map((t) => {
    // The assistant always works on the open board, so the MCP-only "file" argument is left out.
    const properties = Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([k]) => k !== 'file'))
    return {
      name: t.name,
      description: t.description,
      input_schema: { type: 'object', properties, ...(t.inputSchema.required ? { required: t.inputSchema.required } : {}) },
      eager_input_streaming: true,
    }
  })
  return [
    READ_BOARD,
    ...read,
    {
      name: 'propose_changes',
      description:
        'Proposes changes to the board as a batch of operations (see the operations guide in the system prompt). They are checked against the board, then shown to the person as a preview to apply or discard. An error result means nothing was proposed: fix the operations and try again.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One line saying what the changes do, e.g. "Group the 12 stickies into 4 themed frames"' },
          ops: { type: 'array', items: { type: 'object' }, description: 'The operations, in order' },
        },
        required: ['summary', 'ops'],
      },
      eager_input_streaming: true,
    },
  ]
}

/** Built once: tools render first in the prompt, so they must stay byte-identical for caching. */
const TOOLS = buildTools()

const STATUS: Record<string, string> = {
  read_board: 'Reading the board…',
  get_object: 'Looking closer…',
  find: 'Searching…',
  propose_changes: 'Preparing changes…',
}

/** Counts what a set of patches adds, changes and removes (objects and records). */
export function countChanges(before: Board, patches: Patch[]) {
  let added = 0
  let changed = 0
  let removed = 0
  for (const p of patches) {
    if (p.k === 'item') {
      const existed = before.items.some((i) => i.id === p.id)
      if (p.v === null) removed++
      else if (existed) changed++
      else added++
    } else if (p.k === 'rec') {
      if (p.v === null) removed++
      else added++
    }
  }
  return { added, changed, removed }
}

export class Assistant {
  /** Tokens used by this conversation, to show what caching saves. */
  usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  /** The conversation so far, exactly as sent and received (thinking blocks included). */
  messages: Anthropic.Beta.BetaMessageParam[] = []
  model: AiModel
  private client: Anthropic
  private host: AssistantHost

  constructor(client: Anthropic, host: AssistantHost, model: AiModel = DEFAULT_MODEL) {
    this.client = client
    this.host = host
    this.model = model
  }

  /** Checks a proposal against the board as it is now; returns it, or the reason it doesn't fit. */
  private propose(input: unknown): Proposal | string {
    const x = input as { summary?: unknown; ops?: unknown }
    if (!x || typeof x.summary !== 'string' || !Array.isArray(x.ops) || !x.ops.length || !x.ops.every((o) => o && typeof o === 'object' && typeof (o as Op).op === 'string'))
      return 'propose_changes needs "summary" (text) and "ops" (a non-empty list of operations, each with an "op" field)'
    const before = this.host.board()
    try {
      const after = layoutAll(applyOps(before, x.ops as Op[], { measure: this.host.measure }).board, this.host.measure)
      const patches = diff(before, after)
      if (!patches.length) return 'Those operations change nothing on the board.'
      return { id: uid(), summary: x.summary, ops: x.ops as Op[], patches, counts: countChanges(before, patches), status: 'pending' }
    } catch (err) {
      // Anything an op trips over goes back to Claude to fix, never out of the conversation.
      if (err instanceof OpError) return err.message
      return `Those operations couldn't be applied: ${(err as Error)?.message ?? String(err)}. Check each field's type.`
    }
  }

  private async runTool(name: string, input: unknown, on: Callbacks): Promise<{ content: string; is_error?: boolean }> {
    if (name === 'propose_changes') {
      const p = this.propose(input)
      if (typeof p === 'string') return { content: p, is_error: true }
      on.proposal(p)
      const { added, changed, removed } = p.counts
      return { content: `Shown to the person as a preview (${added} new, ${changed} changed, ${removed} removed). They will apply or discard it.` }
    }
    if (!READ_TOOLS.includes(name)) return { content: `Unknown tool "${name}"`, is_error: true }
    if (!input || typeof input !== 'object') return { content: 'Tool input must be an object', is_error: true }
    if (name === 'read_board') {
      const x = input as { kind?: unknown; area?: unknown }
      const a = x.area as Record<string, unknown> | undefined
      if (a !== undefined && (typeof a !== 'object' || !['x', 'y', 'w', 'h'].every((k) => typeof a?.[k] === 'number')))
        return { content: '"area" needs numbers x, y, w and h', is_error: true }
      if (x.kind !== undefined && typeof x.kind !== 'string') return { content: '"kind" must be text', is_error: true }
      const text = boardText(this.host.readable?.() ?? this.host.board(), {
        kind: x.kind as Kind | undefined,
        area: a as Rect | undefined,
        focus: this.host.selection(),
        view: this.host.view?.(),
      })
      return { content: text }
    }
    try {
      const out = await runTool(hostFor(this.host), name, input as Record<string, unknown>)
      return { content: typeof out === 'string' ? out : JSON.stringify(out) }
    } catch (err) {
      return { content: (err as Error).message, is_error: true }
    }
  }

  /** Sends a message and runs the conversation until Claude has answered. */
  async send(text: string, on: Callbacks, signal?: AbortSignal, images: AiImage[] = []): Promise<void> {
    const sel = this.host.selection()
    const context = sel.length ? `[Selected object ids: ${sel.join(', ')}]` : '[Nothing selected]'
    this.messages.push({
      role: 'user',
      content: [
        // Pictures first, then the words about them.
        ...images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType, data: img.data } })),
        { type: 'text', text: `${context}\n\n${text}` },
      ],
    })
    let jsonRetries = 0
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        on.status(step === 0 ? 'Thinking…' : 'Working…')
        const fallbacks = this.model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        const stream = this.client.beta.messages.stream(
          {
            model: this.model,
            max_tokens: 32000,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
            // The conversation grows each step; automatic caching re-reads all of it at a tenth of the price.
            cache_control: { type: 'ephemeral' },
            tools: TOOLS,
            messages: this.messages,
            ...fallbacks,
          },
          { signal },
        )
        stream.on('text', (delta) => {
          on.status(null)
          on.text(delta)
        })
        let message: Anthropic.Beta.BetaMessage
        try {
          message = await stream.finalMessage()
          jsonRetries = 0
          this.tally(message.usage)
        } catch (err) {
          // Only a tool input that couldn't be parsed is worth re-asking; API errors go to the person.
          if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 2) throw err
          continue
        }

        if (message.stop_reason === 'refusal') {
          this.messages.push({ role: 'assistant', content: message.content })
          on.text('\n\n_Claude declined this request._')
          return
        }
        this.messages.push({ role: 'assistant', content: message.content })
        if (message.stop_reason === 'pause_turn') continue
        const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        if (!uses.length) return
        if (message.stop_reason === 'max_tokens') {
          // A tool call cut off by the length limit may look complete; never run it.
          this.messages.push({
            role: 'user',
            content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Your output was cut off by the length limit. Make the request smaller and try again.' })),
          })
          continue
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
        for (const u of uses) {
          on.status(STATUS[u.name] ?? 'Working…')
          const r = await this.runTool(u.name, u.input, on).catch((err: unknown) => ({ content: `That tool failed: ${(err as Error)?.message ?? String(err)}`, is_error: true }))
          results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) })
        }
        // Every result for one turn goes back in a single message.
        this.messages.push({ role: 'user', content: results })
      }
      on.text('\n\n_Stopped after too many steps._')
    } finally {
      this.answerOpenToolCalls()
      on.status(null)
    }
  }

  /**
   * A request stopped mid-step (aborted, or an error) can leave Claude's tool calls without
   * results, which would make every later request invalid; answer them as not run.
   */
  private answerOpenToolCalls() {
    const last = this.messages[this.messages.length - 1]
    if (last?.role !== 'assistant' || !Array.isArray(last.content)) return
    const uses = last.content.filter((b) => b.type === 'tool_use')
    if (!uses.length) return
    this.messages.push({
      role: 'user',
      content: uses.map((u) => ({ type: 'tool_result' as const, tool_use_id: (u as Anthropic.Beta.BetaToolUseBlock).id, is_error: true, content: 'Not run: the request was stopped.' })),
    })
  }

  private tally(u: Anthropic.Beta.BetaUsage | undefined) {
    if (!u) return
    this.usage.input += u.input_tokens ?? 0
    this.usage.cacheRead += u.cache_read_input_tokens ?? 0
    this.usage.cacheWrite += u.cache_creation_input_tokens ?? 0
    this.usage.output += u.output_tokens ?? 0
  }

  reset() {
    this.messages = []
    this.usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  }
}

/** A short, human message for an API failure. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in the AI settings.'
  if (err instanceof Anthropic.PermissionDeniedError) return 'This key or server isn’t allowed to use that model (or the server password is wrong).'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and try again.'
  if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the AI service. Check your connection or the BrainCraft server.'
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status ?? 'unknown'}): ${err.message}`
  if ((err as Error)?.name === 'AbortError' || err instanceof Anthropic.APIUserAbortError) return 'Stopped.'
  return (err as Error)?.message ?? String(err)
}
