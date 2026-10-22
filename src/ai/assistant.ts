/**
 * The in-app AI assistant: a chat with a model about the open board (Claude, a model on an
 * OpenAI-compatible server such as vLLM, or a command-line agent on the BrainCraft server; see
 * backends.ts).
 *
 * The model reads the board through the same tools the MCP server offers (read_board, get_object,
 * find). It never changes the board directly: it calls `propose_changes`, which checks the
 * operations against the current board and turns them into a preview the person applies or
 * discards. Applied proposals land in an AI history where each one can be undone on its own.
 */

import Anthropic from '@anthropic-ai/sdk'
import { OpError, type Op, applyOps, maskedIds } from '../api/ops'
import { OPS_GUIDE, TOOL_DEFS, type ToolHost, runTool } from '../api/tools'
import { type Patch, diff } from '../collab/patch'
import { type Measure, layoutAll } from '../model/mindmap'
import type { Rect } from '../model/geom'
import { boardText } from './boardText'
import { maskFor } from '../model/brainstorm'
import type { BoardRef } from '../model/notes'
import { referenceContext } from './references'
import type { Board, Id, Kind } from '../model/types'
import { uid } from '../model/uid'
import { blankBoard, isWiki, pageText } from '../model/wiki'
import { AnthropicBackend, type Backend, BackendError, CommandBackend, INVALID_TOOL, OpenAiBackend } from './backends'

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Most capable (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Faster, lower cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Fastest, lowest cost' },
] as const

export type AiModel = (typeof AI_MODELS)[number]['id']
export const DEFAULT_MODEL: AiModel = 'claude-opus-5-5'

/**
 * How the app reaches a model:
 * - `server`: Claude through the BrainCraft server (its Anthropic key);
 * - `key`: Claude with the person's own Anthropic key;
 * - `openai`: an OpenAI-compatible server (vLLM…), straight from this browser or through the BrainCraft server;
 * - `command`: a command-line agent the BrainCraft server runs (claude -p, codex exec…).
 */
export type AiConnection =
  | { kind: 'server'; base: string; password?: string }
  | { kind: 'key'; apiKey: string }
  | { kind: 'openai'; base: string; apiKey?: string; password?: string; model: string; textTools: boolean; label: string }
  | { kind: 'command'; base: string; password?: string; agent?: string; label: string }

const serverUrl = (base: string, path: string) => new URL(path, base.endsWith('/') ? base : `${base}/`).href

export function makeClient(c: { kind: 'server'; base: string; password?: string } | { kind: 'key'; apiKey: string }): Anthropic {
  if (c.kind === 'key') return new Anthropic({ apiKey: c.apiKey, dangerouslyAllowBrowser: true })
  // The server adds the real key; this placeholder never leaves for Anthropic.
  return new Anthropic({
    apiKey: 'braincraft-server',
    baseURL: serverUrl(c.base, 'api/ai'),
    dangerouslyAllowBrowser: true,
    ...(c.password ? { defaultHeaders: { 'x-braincraft-ai-password': c.password } } : {}),
  })
}

/** The backend for a connection (with the Claude model to use, for the Anthropic ones). */
export function makeBackend(c: AiConnection, model: AiModel = DEFAULT_MODEL): Backend {
  if (c.kind === 'openai') {
    const headers: Record<string, string> = c.password ? { 'x-braincraft-ai-password': c.password } : {}
    return new OpenAiBackend({ base: c.base, apiKey: c.apiKey, headers, model: c.model, textTools: c.textTools, label: c.label })
  }
  if (c.kind === 'command') return new CommandBackend({ base: c.base, password: c.password, agent: c.agent, label: c.label })
  return new AnthropicBackend(makeClient(c), model, AI_MODELS.find((m) => m.id === model)?.label ?? model)
}

export interface Proposal {
  id: string
  summary: string
  ops: Op[]
  /** The changes it makes to the board as it was when proposed. */
  patches: Patch[]
  /** Each changed page's words when proposed, so typing done since is merged in rather than lost. */
  bases?: Record<string, string>
  counts: { added: number; changed: number; removed: number }
  status: 'pending' | 'applied' | 'discarded'
  /** Changes to another board or wiki, or a new one, instead of the open board. */
  target?: Elsewhere
  /** Once applied elsewhere: the board's id in this browser, to open it. */
  opened?: string
}

/** Another board or wiki (by its link key), or a new one to make. */
export interface ElsewhereTarget {
  /** An existing board or wiki, by its link key. */
  board?: string
  /** Or a new one. */
  create?: { kind: 'wiki' | 'board'; title: string }
}
export type Elsewhere = ElsewhereTarget & { title: string; kind: 'wiki' | 'board' }


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
  /** This person's other boards and wikis, to read when a message links one or the model asks. */
  others?(): Others
  /** A file's words (Markdown), for read_file; null when they can't be had from here. */
  fileText?(id: string): Promise<string | null>
}

export interface Others {
  boards: readonly BoardRef[]
  /** The keys links to the open board use. */
  selfKeys: readonly string[]
  read(key: string): Promise<Board | null>
  /** This person's name (their own hidden brainstorm notes stay readable). */
  me: string
  /** The key other boards' links use for the open one (for links back to it). */
  link?: string | null
}

export interface Callbacks {
  /** Streamed answer text. */
  text(delta: string): void
  /** What it's doing ("Reading the board…"), or null when idle. */
  status(s: string | null): void
  proposal(p: Proposal): void
}

const READ_TOOLS = ['read_board', 'get_object', 'find', 'list_pages', 'read_page', 'page_history', 'list_boards']

/** How much of a file read_file gives at once (characters). */
const FILE_CHUNK = 40_000

const FILE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_files',
    description: 'The files kept with the open board or wiki (PDFs, documents, slides, spreadsheets): id, name, kind, size, pages, the wiki page made from it, and its opening words.',
    input_schema: { type: 'object', properties: {} },
    eager_input_streaming: true,
  },
  {
    name: 'read_file',
    description: `A file's words, as Markdown, ${FILE_CHUNK.toLocaleString('en')} characters at a time: pass "from" (a character offset) to read on. Says how long it is in all.`,
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'The file id from list_files' }, from: { type: 'number' } }, required: ['id'] },
    eager_input_streaming: true,
  },
]

/** Read tools take this to read another board or wiki instead of the open one. */
const BOARD_ARG = { type: 'string', description: 'Another board or wiki to read, by its key from list_boards. Leave out for the open one.' }

const READ_BOARD: Anthropic.Beta.BetaTool = {
  name: 'read_board',
  description:
    'Describes the board: title, counts, and one line per object (id, kind, position, size, label, extras such as parent or comment count), then the lines between them. Big boards list the selection, frames, mind-map roots, widgets and what is on screen; pass "area" or "kind" to read other parts. Call this first.',
  input_schema: {
    type: 'object',
    properties: {
      board: BOARD_ARG,
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
- The person's other boards and wikis: list_boards gives their keys; every read tool takes "board" to read one of them. Link a page of this wiki as [[Title]](page:ID), a page elsewhere as [[Title]](board:KEY/page:ID), another board as [[Title]](board:KEY), and an object on another board as [[Label]](board:KEY#ID). Changes only ever go to the open board.
- A message may end with what it links to, already read for you: use that rather than reading it again.
- Boards and wikis work together. Each message says what is open and its key. To change ANOTHER board or wiki, or to make a new one, call propose_elsewhere: for example "make a wiki article from this board" is a new wiki (or a page in an existing wiki the person names) written from what you read on the board, and "turn this page into a board" is a new board with notes, mind maps or flowcharts. A page written from a board should link back to it as [[Board title]](board:KEY), and can show its objects with an embed line on its own, ![[Label]](board:KEY#ID) (or ![[Title]](board:KEY) for the whole board). Write real Markdown pages (headings, lists, tables), not a dump of the objects.
- Files kept with the board (PDFs, documents, slides): list_files, then read_file. To make a wiki page from one, write it with createPage.
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
    // The MCP-only "file" argument is left out; another board is named by "board" instead.
    const properties = { ...Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([k]) => k !== 'file')), ...(t.name === 'list_boards' ? {} : { board: BOARD_ARG }) }
    return {
      name: t.name,
      description: t.name === 'list_boards' ? 'The person’s other boards and wikis: key, title, kind, and a wiki’s pages. Read one by passing its key as "board" to the read tools.' : t.description,
      input_schema: { type: 'object', properties, ...(t.inputSchema.required ? { required: t.inputSchema.required } : {}) },
      eager_input_streaming: true,
    }
  })
  return [
    READ_BOARD,
    ...read,
    ...FILE_TOOLS,
    {
      name: 'propose_elsewhere',
      description:
        'Proposes changes to ANOTHER board or wiki (its key from list_boards), or makes a NEW one ("create": {"kind": "wiki" or "board", "title"}). Use it to write a wiki page from what is on a canvas board, lay out a wiki page’s ideas on a board, add a page to an existing wiki, and so on. The ops are the ones for that kind of board: createPage/updatePage for a wiki, createNote/createFlowchart/… for a board. They are checked, then shown to the person, who applies them (nothing changes until then). An error result means nothing was proposed: fix it and try again.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One line saying what it does, e.g. "A wiki page summarising the Q4 plan board"' },
          board: { type: 'string', description: 'The key of an existing board or wiki (from list_boards). Leave out to make a new one with "create".' },
          create: {
            type: 'object',
            description: 'Make a new board or wiki for these changes',
            properties: { kind: { type: 'string', enum: ['wiki', 'board'] }, title: { type: 'string' } },
            required: ['kind', 'title'],
          },
          ops: { type: 'array', items: { type: 'object' }, description: 'The operations, in order' },
        },
        required: ['summary', 'ops'],
      },
      eager_input_streaming: true,
    },
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
  list_pages: 'Reading the pages…',
  read_page: 'Reading a page…',
  list_boards: 'Looking at your boards…',
  list_files: 'Looking at the files…',
  read_file: 'Reading a file…',
  propose_changes: 'Preparing changes…',
  propose_elsewhere: 'Preparing changes…',
}

/** Counts what a set of patches adds, changes and removes (objects and records). */
export function countChanges(before: Board, patches: Patch[]) {
  const fresh = new Set<string>()
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
    } else if (p.k === 'page') {
      // Wiki pages: new, trashed (or deleted), or renamed and moved.
      const was = before.pages?.find((x) => x.id === p.id)
      if (!was) fresh.add(p.id)
      if (!was) added++
      else if (p.v === null || (p.v.trashed && !was.trashed)) removed++
      else changed++
    } else if (p.k === 'body' && !fresh.has(p.id) && !patches.some((q) => q.k === 'page' && q.id === p.id)) changed++
  }
  return { added, changed, removed }
}

export class Assistant {
  /** Tokens used by this conversation, to show what caching saves. */
  usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  /** The conversation so far, exactly as sent and received (thinking blocks included). */
  messages: Anthropic.Beta.BetaMessageParam[] = []
  /** Where the model runs; it can change between messages (the conversation carries over). */
  backend: Backend
  private host: AssistantHost

  constructor(backend: Backend, host: AssistantHost) {
    this.backend = backend
    this.host = host
  }

  /** Checks a proposal against the board as it is now; returns it, or the reason it doesn't fit. */
  private propose(input: unknown): Proposal | string {
    const x = input as { summary?: unknown; ops?: unknown }
    if (!x || typeof x.summary !== 'string' || !Array.isArray(x.ops) || !x.ops.length || !x.ops.every((o) => o && typeof o === 'object' && typeof (o as Op).op === 'string'))
      return 'propose_changes needs "summary" (text) and "ops" (a non-empty list of operations, each with an "op" field)'
    const before = this.host.board()
    try {
      const view = this.host.readable?.()
      const after = layoutAll(applyOps(before, x.ops as Op[], { measure: this.host.measure, protect: view && maskedIds(view) }).board, this.host.measure)
      const patches = diff(before, after)
      if (!patches.length) return 'Those operations change nothing on the board.'
      const bases = Object.fromEntries(patches.flatMap((p) => (p.k === 'body' ? [[p.id, pageText(before, p.id)]] : [])))
      return { id: uid(), summary: x.summary, ops: x.ops as Op[], patches, ...(Object.keys(bases).length ? { bases } : {}), counts: countChanges(before, patches), status: 'pending' }
    } catch (err) {
      // Anything an op trips over goes back to the model to fix, never out of the conversation.
      if (err instanceof OpError) return err.message
      return `Those operations couldn't be applied: ${(err as Error)?.message ?? String(err)}. Check each field's type.`
    }
  }

  private async runTool(name: string, input: unknown, on: Callbacks): Promise<{ content: string; is_error?: boolean }> {
    if (name === INVALID_TOOL) return { content: String((input as { error?: unknown })?.error ?? 'That tool call could not be read.'), is_error: true }
    if (name === 'propose_changes') {
      const p = this.propose(input)
      if (typeof p === 'string') return { content: p, is_error: true }
      on.proposal(p)
      const { added, changed, removed } = p.counts
      return { content: `Shown to the person as a preview (${added} new, ${changed} changed, ${removed} removed). They will apply or discard it.` }
    }
    if (name === 'list_files' || name === 'read_file') return this.fileTool(name, input)
    if (name === 'propose_elsewhere') {
      const p = await this.proposeElsewhere(input)
      if (typeof p === 'string') return { content: p, is_error: true }
      on.proposal(p)
      const { added, changed, removed } = p.counts
      return { content: `Shown to the person to apply (${added} new, ${changed} changed, ${removed} removed in ${p.target!.kind === 'wiki' ? 'the wiki' : 'the board'} "${p.target!.title}"). Nothing has changed until they do.` }
    }
    if (!READ_TOOLS.includes(name)) return { content: `Unknown tool "${name}"`, is_error: true }
    if (!input || typeof input !== 'object') return { content: 'Tool input must be an object', is_error: true }
    const others = this.host.others?.()
    if (name === 'list_boards') {
      if (!others) return { content: 'Only the open board can be read here.', is_error: true }
      return {
        content: JSON.stringify(
          others.boards.map((b) => ({ key: b.key, title: b.title, kind: b.kind === 'wiki' ? 'wiki' : 'board', ...(b.pages ? { pages: b.pages.map((p) => ({ id: p.id, title: p.title })) } : {}) })),
        ),
      }
    }
    // Another board or wiki: read the same way, from this browser's copy.
    const { board: key, ...rest } = input as { board?: unknown }
    if (key !== undefined && (typeof key !== 'string' || !others?.selfKeys.includes(key))) {
      if (typeof key !== 'string' || !others) return { content: '"board" must be a key from list_boards', is_error: true }
      const raw = await others.read(key)
      if (!raw) return { content: `No board with the key "${key}". Call list_boards for the keys.`, is_error: true }
      const other = maskFor(raw, others.me)
      if (name === 'read_board' && !isWiki(other)) return { content: boardText(other, { kind: (rest as { kind?: Kind }).kind }) }
      try {
        const out = await runTool({ ...hostFor(this.host), where: () => `the ${isWiki(other) ? 'wiki' : 'board'} "${other.title}"`, board: () => other }, name, rest as Record<string, unknown>)
        return { content: typeof out === 'string' ? out : JSON.stringify(out) }
      } catch (err) {
        return { content: (err as Error).message, is_error: true }
      }
    }
    input = rest
    // A wiki is read as its page tree (the generic tool describes it).
    if (name === 'read_board' && !isWiki(this.host.board())) {
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

  /** Checks changes for another board or wiki (or a new one); returns the proposal, or what's wrong. */
  private async proposeElsewhere(input: unknown): Promise<Proposal | string> {
    const x = (input ?? {}) as { summary?: unknown; board?: unknown; create?: { kind?: unknown; title?: unknown }; ops?: unknown }
    if (typeof x.summary !== 'string' || !Array.isArray(x.ops) || !x.ops.length || !x.ops.every((o) => o && typeof o === 'object' && typeof (o as Op).op === 'string'))
      return 'propose_elsewhere needs "summary" (text) and "ops" (a non-empty list of operations, each with an "op" field)'
    const others = this.host.others?.()
    if (!others) return 'Other boards can’t be changed from here.'
    let base: Board | null
    let target: Elsewhere
    if (x.create !== undefined) {
      const kind = x.create?.kind
      if (kind !== 'wiki' && kind !== 'board') return '"create" needs "kind": "wiki" or "board", and a "title"'
      if (typeof x.create.title !== 'string' || !x.create.title.trim()) return '"create" needs a "title"'
      base = blankBoard(kind, x.create.title)
      target = { create: { kind, title: base.title }, title: base.title, kind }
    } else {
      if (typeof x.board !== 'string') return 'Say which board with "board" (a key from list_boards), or make a new one with "create".'
      if (others.selfKeys.includes(x.board)) return 'That is the open board: use propose_changes for it.'
      base = await others.read(x.board)
      if (!base) return `No board with the key "${x.board}". Call list_boards for the keys.`
      target = { board: x.board, title: base.title, kind: isWiki(base) ? 'wiki' : 'board' }
    }
    try {
      const after = layoutAll(applyOps(base, x.ops as Op[], { measure: this.host.measure, protect: maskedIds(maskFor(base, others.me)) }).board, this.host.measure)
      const patches = diff(base, after)
      if (!patches.length) return 'Those operations change nothing there.'
      return { id: uid(), summary: x.summary, ops: x.ops as Op[], patches: [], counts: countChanges(base, patches), status: 'pending', target }
    } catch (err) {
      if (err instanceof OpError) return err.message
      return `Those operations couldn't be applied: ${(err as Error)?.message ?? String(err)}. Check each field's type.`
    }
  }

  /** list_files and read_file: the open board's files. */
  private async fileTool(name: string, input: unknown): Promise<{ content: string; is_error?: boolean }> {
    const files = (this.host.board().files ?? []).filter((f) => !f.trashed)
    if (name === 'list_files') {
      if (!files.length) return { content: 'This board has no files.' }
      return {
        content: JSON.stringify(
          files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, ...(f.pages ? { pages: f.pages } : {}), ...(f.page ? { page: f.page } : {}), readable: !!f.chars, ...(f.excerpt ? { opening: f.excerpt } : {}) })),
        ),
      }
    }
    const x = (input ?? {}) as { id?: unknown; from?: unknown }
    const f = files.find((y) => y.id === x.id)
    if (!f) return { content: `No file with the id "${String(x.id)}". Call list_files for the ids.`, is_error: true }
    if (!f.chars) return { content: `No words could be read from ${f.name} (a picture, a scanned PDF, or a kind of file BrainCraft can't read).`, is_error: true }
    const text = await this.host.fileText?.(f.id).catch(() => null)
    if (text === null || text === undefined) return { content: `${f.name} can't be read from here (it may be only in the browser that added it).`, is_error: true }
    const from = typeof x.from === 'number' && x.from > 0 ? Math.floor(x.from) : 0
    const part = text.slice(from, from + FILE_CHUNK)
    const more = from + FILE_CHUNK < text.length
    return { content: `${f.name}: characters ${from}–${from + part.length} of ${text.length}${more ? ` (read on with "from": ${from + FILE_CHUNK})` : ''}\n\n${part}` }
  }

  /** Sends a message and runs the conversation until the model has answered. */
  async send(text: string, on: Callbacks, signal?: AbortSignal, images: AiImage[] = []): Promise<void> {
    const sel = this.host.selection()
    const others = this.host.others?.()
    const open = this.host.board()
    const where = `[Open: ${isWiki(open) ? 'the wiki' : 'the canvas board'} ${JSON.stringify(open.title)}${others?.link ? `, key ${others.link}` : ''}]`
    const context = `${where} ${sel.length ? `[Selected object ids: ${sel.join(', ')}]` : '[Nothing selected]'}`
    // What the message links to (objects, pages, other boards), read and sent along.
    on.status('Reading what you linked…')
    const linked = await referenceContext(text, {
      board: () => this.host.readable?.() ?? this.host.board(),
      selfKeys: others?.selfKeys ?? [],
      boards: others?.boards ?? [],
      read: (key) => others?.read(key) ?? Promise.resolve(null),
      me: others?.me ?? '',
    }).catch(() => '')
    this.messages.push({
      role: 'user',
      content: [
        // Pictures first, then the words about them.
        ...images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType, data: img.data } })),
        { type: 'text', text: `${context}\n\n${text}${linked ? `\n\n${linked}` : ''}` },
      ],
    })
    let jsonRetries = 0
    // This step's tool results so far, kept if the request stops partway.
    let done: Anthropic.Beta.BetaToolResultBlockParam[] = []
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        on.status(step === 0 ? 'Thinking…' : 'Working…')
        let message: Awaited<ReturnType<Backend['turn']>>
        try {
          message = await this.backend.turn({ system: SYSTEM, messages: this.messages, tools: TOOLS }, (delta) => {
            on.status(null)
            on.text(delta)
          }, signal)
          jsonRetries = 0
          this.tally(message.usage)
        } catch (err) {
          // Only a tool input that couldn't be parsed is worth re-asking; API errors go to the person.
          if (err instanceof Anthropic.APIError || err instanceof BackendError || signal?.aborted || jsonRetries++ >= 2) throw err
          continue
        }

        if (message.stop === 'refusal') {
          this.messages.push({ role: 'assistant', content: message.content })
          on.text('\n\n_The model declined this request._')
          return
        }
        // A reply with nothing in it would make the next request invalid.
        if (!message.content.length) {
          on.text('_The model gave no answer. Try again, or ask differently._')
          return
        }
        this.messages.push({ role: 'assistant', content: message.content })
        if (message.stop === 'pause_turn') continue
        const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        if (!uses.length) return
        if (message.stop === 'max_tokens') {
          // A tool call cut off by the length limit may look complete; never run it.
          this.messages.push({
            role: 'user',
            content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Your output was cut off by the length limit. Make the request smaller and try again.' })),
          })
          continue
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
        done = results
        for (const u of uses) {
          on.status(STATUS[u.name] ?? 'Working…')
          const r = await this.runTool(u.name, u.input, on).catch((err: unknown) => ({ content: `That tool failed: ${(err as Error)?.message ?? String(err)}`, is_error: true }))
          results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) })
        }
        // Every result for one turn goes back in a single message.
        this.messages.push({ role: 'user', content: results })
        done = []
      }
      on.text('\n\n_Stopped after too many steps._')
    } finally {
      this.answerOpenToolCalls(done)
      on.status(null)
    }
  }

  /**
   * A request stopped mid-step (aborted, or an error) can leave Claude's tool calls without
   * results, which would make every later request invalid; answer them as not run (keeping the
   * results of any that did run, such as a proposal already on screen).
   */
  private answerOpenToolCalls(done: Anthropic.Beta.BetaToolResultBlockParam[] = []) {
    const last = this.messages[this.messages.length - 1]
    if (last?.role !== 'assistant' || !Array.isArray(last.content)) return
    const uses = last.content.filter((b) => b.type === 'tool_use')
    if (!uses.length) return
    this.messages.push({
      role: 'user',
      content: uses.map(
        (u) =>
          done.find((r) => r.tool_use_id === (u as Anthropic.Beta.BetaToolUseBlock).id) ?? {
            type: 'tool_result' as const,
            tool_use_id: (u as Anthropic.Beta.BetaToolUseBlock).id,
            is_error: true,
            content: 'Not run: the request was stopped.',
          },
      ),
    })
  }

  private tally(u: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | undefined) {
    if (!u) return
    this.usage.input += u.input
    this.usage.cacheRead += u.cacheRead ?? 0
    this.usage.cacheWrite += u.cacheWrite ?? 0
    this.usage.output += u.output
  }

  reset() {
    this.messages = []
    this.usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  }
}

/** A short, human message for an API failure. */
export function describeError(err: unknown): string {
  // The BrainCraft server's own refusals (its password, its hourly limit) say exactly what's wrong.
  const said = (err as { error?: { error?: { message?: unknown } } })?.error?.error?.message
  const server = typeof said === 'string' && /AI password|from this address/.test(said) ? `The BrainCraft server says: ${said}.` : ''
  if (err instanceof BackendError) return err.message
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in the AI settings.'
  if (err instanceof Anthropic.PermissionDeniedError) return server || 'This key or server isn’t allowed to use that model (or the server password is wrong).'
  if (err instanceof Anthropic.RateLimitError) return server || 'Rate limited by the API. Wait a moment and try again.'
  if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the AI service. Check your connection or the BrainCraft server.'
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status ?? 'unknown'}): ${err.message}`
  if ((err as Error)?.name === 'AbortError' || err instanceof Anthropic.APIUserAbortError) return 'Stopped.'
  return (err as Error)?.message ?? String(err)
}
