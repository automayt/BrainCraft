/**
 * BrainCraft MCP server: lets AI assistants (Claude Desktop, Claude Code, Cursor…) read and edit boards.
 *
 * Two ways to reach a board:
 *  - Live: the BrainCraft tab in your browser pairs with this server once (it opens a link this server
 *    prints); tool calls are relayed to the tab and run on the board you're looking at.
 *  - File: pass `file` to any tool to work on a .braincraft file on disk; no browser needed.
 *
 * No dependencies: MCP over stdio (newline-delimited JSON-RPC) and a tiny localhost HTTP server.
 * Settings (environment): BRAINCRAFT_URL (the app's address), BRAINCRAFT_PORT, BRAINCRAFT_DIR, BRAINCRAFT_TOKEN.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { applyOps } from '../src/api/ops'
import { type BoardInfo, OPS_GUIDE, TOOL_DEFS, type ToolHost, ToolError, runTool } from '../src/api/tools'
import { emptyBoard } from '../src/model/board'
import { layoutAll } from '../src/model/mindmap'
import { approxMeasure as measure } from '../src/model/approxMeasure'
import { fromJson, toJson } from '../src/model/serialize'
import { TEMPLATES, boardFromTemplate } from '../src/model/templates'

const VERSION = '0.3.0'
const APP_URL = process.env.BRAINCRAFT_URL ?? 'https://automayt.github.io/BrainCraft/'
const FIRST_PORT = Number(process.env.BRAINCRAFT_PORT ?? 4319)
const DIR = resolve(process.env.BRAINCRAFT_DIR ?? process.cwd())
const CALL_TIMEOUT = 30_000

const log = (...a: unknown[]) => console.error('[braincraft-mcp]', ...a)

// ----- pairing token: kept in ~/.braincraft so the browser only pairs once ----------------

function loadToken(): string {
  const dir = join(homedir(), '.braincraft')
  const file = join(dir, 'mcp-token')
  try {
    const t = readFileSync(file, 'utf8').trim()
    if (/^[A-Za-z0-9_-]{16,}$/.test(t)) return t
  } catch {
    // First run.
  }
  const t = randomBytes(18).toString('base64url')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, t, { mode: 0o600 })
  } catch (err) {
    log('could not save the pairing token; the browser will need pairing again next time', err)
  }
  return t
}

const TOKEN = process.env.BRAINCRAFT_TOKEN ?? loadToken()
let port = FIRST_PORT
const pairLink = () => `${APP_URL}#ai=${port}.${TOKEN}`

// ----- the browser link: Server-Sent Events out, POSTed results back ----------------------

let client: ServerResponse | null = null
let clientSince = 0
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function cors(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  // Chrome asks before a public page talks to localhost (Private Network Access).
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c: string) => {
      body += c
      if (body.length > 20_000_000) req.destroy()
    })
    req.on('end', () => ok(body))
    req.on('error', fail)
  })
}

const http = createServer(async (req, res) => {
  cors(req, res)
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
  } catch {
    // A malformed request mustn't end the server (and the assistant's connection with it).
    return void res.writeHead(400).end()
  }
  if (req.method === 'OPTIONS') return void res.writeHead(204).end()
  if (url.pathname === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return void res.end(JSON.stringify({ name: 'braincraft-mcp', version: VERSION, browser: !!client }))
  }
  if (url.searchParams.get('token') !== TOKEN) return void res.writeHead(403).end('Wrong pairing token')

  if (url.pathname === '/events' && req.method === 'GET') {
    // One tab at a time: the newest connection wins.
    client?.end()
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': connected\n\n')
    client = res
    clientSince = Date.now()
    log('browser connected')
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
    req.on('close', () => {
      clearInterval(ping)
      if (client === res) {
        client = null
        log('browser disconnected')
      }
    })
    return
  }
  if (url.pathname === '/result' && req.method === 'POST') {
    try {
      const reply = JSON.parse(await readBody(req)) as { id: string; ok: boolean; result?: unknown; error?: string }
      const p = pending.get(reply.id)
      if (p) {
        clearTimeout(p.timer)
        pending.delete(reply.id)
        if (reply.ok) p.resolve(reply.result)
        else p.reject(new ToolError(reply.error ?? 'The browser reported an error'))
      }
      return void res.writeHead(204).end()
    } catch {
      return void res.writeHead(400).end()
    }
  }
  res.writeHead(404).end()
})

function listen(tries = 10) {
  http.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && tries > 0) {
      port++
      listen(tries - 1)
    } else log('could not start the browser link:', err.message)
  })
  http.listen(port, '127.0.0.1', () => log(`browser link on http://127.0.0.1:${port} — pair with ${pairLink()}`))
}

let nextCall = 1
function callBrowser(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const c = client
  if (!c) return Promise.reject(notConnected())
  const id = String(nextCall++)
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      fail(new ToolError('The browser did not answer in time. Is the BrainCraft tab still open?'))
    }, CALL_TIMEOUT)
    pending.set(id, { resolve: ok, reject: fail, timer })
    c.write(`event: call\ndata: ${JSON.stringify({ id, tool, args })}\n\n`)
  })
}

function notConnected() {
  return new ToolError(
    `No BrainCraft tab is connected. Ask the person to open this link once to pair their browser: ${pairLink()}\n` +
      `Or work on a file directly by passing "file" (a path to a .braincraft file; relative paths are in ${DIR}).`,
  )
}

// ----- file mode ----------------------------------------------------------------------------

function filePath(f: string) {
  const p = resolve(DIR, f)
  const path = extname(p) ? p : `${p}.braincraft`
  // Only board files: a mistaken (or misled) path can't overwrite anything else on this computer.
  if (extname(path).toLowerCase() !== '.braincraft') throw new ToolError(`"${f}" isn't a .braincraft file. Board files end in .braincraft.`)
  return path
}

function writeAtomic(path: string, text: string) {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

function fileHost(f: string): ToolHost {
  const path = filePath(f)
  const load = () => {
    if (!existsSync(path)) throw new ToolError(`${path} does not exist. Use create_board with this file to make it.`)
    return layoutAll(fromJson(readFileSync(path, 'utf8')), measure)
  }
  const info = (title: string): BoardInfo => ({ id: path, title })
  return {
    where: () => `the file ${path}`,
    board: load,
    apply: (ops) => {
      const { board, results } = applyOps(load(), ops, { measure })
      writeAtomic(path, toJson(layoutAll(board, measure)))
      return results
    },
    listBoards: async () => listFiles(),
    openBoard: async () => {
      throw new ToolError('In file mode there is nothing to open: pass "file" to each tool instead.')
    },
    createBoard: async (title, template) => {
      if (existsSync(path) && statSync(path).size > 0) throw new ToolError(`${path} already exists`)
      const t = TEMPLATES.find((x) => x.id === (template ?? 'blank')) ?? TEMPLATES[0]
      const b = template ? boardFromTemplate(t, measure) : emptyBoard()
      writeAtomic(path, toJson({ ...b, title }))
      return info(title)
    },
  }
}

function listFiles(): BoardInfo[] {
  try {
    return readdirSync(DIR)
      .filter((n) => n.endsWith('.braincraft') || n.endsWith('.braincraft.json'))
      .map((n) => {
        const path = join(DIR, n)
        let title = basename(n, extname(n))
        try {
          title = fromJson(readFileSync(path, 'utf8')).title
        } catch {
          // Show the file name.
        }
        return { id: path, title, updated: statSync(path).mtime.toISOString() }
      })
  } catch {
    return []
  }
}

/** Tools that only exist here, not in the browser. */
const SERVER_TOOLS = [
  {
    name: 'connect_browser',
    title: 'Connect browser',
    description: 'Whether a BrainCraft browser tab is connected, and the one-time link that pairs a browser with this server.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
]

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'connect_browser') {
    return client
      ? { connected: true, since: new Date(clientSince).toISOString(), note: 'Tools act on the board open in that tab.' }
      : { connected: false, pairLink: pairLink(), note: 'Ask the person to open pairLink in the browser they use for BrainCraft. It only needs doing once.' }
  }
  if (!TOOL_DEFS.some((t) => t.name === name)) throw new ToolError(`Unknown tool "${name}"`)
  if (typeof args.file === 'string' && args.file.trim()) {
    const { file, ...rest } = args
    return runTool(fileHost(file as string), name, rest)
  }
  if (name === 'list_boards' && !client) return { browser: false, files: listFiles(), note: notConnected().message }
  return callBrowser(name, args)
}

// ----- MCP over stdio -------------------------------------------------------------------------

type Json = Record<string, unknown>

const send = (msg: Json) => process.stdout.write(`${JSON.stringify(msg)}\n`)
const reply = (id: unknown, result: unknown) => send({ jsonrpc: '2.0', id, result })
const replyError = (id: unknown, code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } })

const INSTRUCTIONS = `BrainCraft is an infinite whiteboard with sticky notes, mind maps, flowcharts, tables, Kanban boards and timelines.
Start with read_board to see what's there. Make changes with apply_ops: one call can build a whole layout, and it is one undo step for the person.
Tools act on the board open in the person's browser once it is paired (see connect_browser), or on a .braincraft file when you pass "file".

${OPS_GUIDE}`

async function handle(msg: Json) {
  const { id, method } = msg
  const params = (msg.params ?? {}) as Json
  const isRequest = id !== undefined && id !== null
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'braincraft', title: 'BrainCraft', version: VERSION },
          instructions: INSTRUCTIONS,
        })
      case 'ping':
        return reply(id, {})
      case 'tools/list':
        return reply(id, {
          tools: [
            ...TOOL_DEFS.map((t) => ({
              name: t.name,
              title: t.title,
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: { readOnlyHint: !!t.readOnly, destructiveHint: t.name === 'apply_ops' },
            })),
            ...SERVER_TOOLS,
          ],
        })
      case 'tools/call': {
        const name = String(params.name)
        try {
          const result = await callTool(name, (params.arguments ?? {}) as Json)
          const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          return reply(id, { content: [{ type: 'text', text }] })
        } catch (err) {
          // Tool failures go back to the model as results it can read and fix.
          return reply(id, { content: [{ type: 'text', text: (err as Error).message }], isError: true })
        }
      }
      case 'resources/list':
        return reply(id, { resources: [] })
      case 'prompts/list':
        return reply(id, { prompts: [] })
      default:
        if (isRequest) replyError(id, -32601, `Method not found: ${String(method)}`)
    }
  } catch (err) {
    if (isRequest) replyError(id, -32603, (err as Error).message)
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let msg: Json
  try {
    msg = JSON.parse(line) as Json
  } catch {
    return replyError(null, -32700, 'Parse error')
  }
  void handle(msg)
})
process.stdin.on('end', () => process.exit(0))

listen()
