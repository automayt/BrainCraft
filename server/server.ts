/**
 * The BrainCraft server: hosts the app, stores shared boards, runs live sessions and the HTTP API.
 *
 *   node dist/braincraft-server.mjs          → http://localhost:8080
 *
 * Settings (environment): PORT, HOST, BRAINCRAFT_DATA (where boards are stored),
 * BRAINCRAFT_STATIC (the built app; defaults to this file's folder).
 * The in-app AI assistant, for everyone using this server (see docs/AI.md), runs with any of:
 * ANTHROPIC_API_KEY (Claude), OPENAI_BASE_URL (an OpenAI-compatible server such as vLLM, with
 * OPENAI_API_KEY and OPENAI_MODEL if needed), BRAINCRAFT_AI_COMMAND (a command-line agent such as
 * `claude -p` or `codex exec`). BRAINCRAFT_AI_PASSWORD makes people enter a password first.
 *
 * Boards are shared by link: each has a secret edit key and a secret view key. Anyone with a key
 * can open the board in that role; nobody can list boards.
 *
 * With BRAINCRAFT_ACCOUNTS=1, people sign in instead (see docs/ACCOUNTS.md): admins manage users
 * and groups, groups carry permissions, each board has an owner and an access list, and the keys
 * stop working. BRAINCRAFT_ADMINS, BRAINCRAFT_PUBLIC_URL, BRAINCRAFT_ALLOWED_ORIGINS and the
 * BRAINCRAFT_OIDC_* settings go with it.
 *
 * HTTPS: BRAINCRAFT_TLS_CERT and BRAINCRAFT_TLS_KEY (PEM files) make the server speak HTTPS itself;
 * renewed certificates are picked up without a restart. Or put it behind a proxy that does
 * (see docs/HTTPS.md).
 *
 * Backups, for taking back a mistake: every board that changed gets a saved version at most every
 * three hours (BRAINCRAFT_BACKUP_EVERY minutes), and the newest five of each are kept
 * (BRAINCRAFT_BACKUP_KEEP), in BRAINCRAFT_DATA/backups or BRAINCRAFT_BACKUP_DIR;
 * BRAINCRAFT_BACKUPS=off turns them off (see docs/BACKUPS.md).
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { AiGate, AiProxy } from './aiProxy'
import { Transcriber } from './transcribe'
import { CommandRunner, OpenAiProxy, programOf } from './aiProviders'
import { agentsFromEnv } from './aiAgents'
import { AccountBoards } from './accounts/boards'
import { AssistantThreads } from './accounts/threads'
import { cleanAppName, DEFAULT_APP_NAME } from './accounts/store'
import { BoardFiles } from './boardFiles'
import { Backups } from './backups'
import { versionRoute } from './backupRoutes'
import { readBoard, sendRead } from './boardReads'
import { answerForm, readForm } from './forms'
import { type BoardStats, boardStats, eventOf, Usage, usageCsv } from './usage'
import { boardWrite } from './boardWrites'
import { docsPage, openApiSpec } from './openapi'
import { Accounts } from './accounts/service'
import { ssoFromEnv } from './accounts/oidc'
import { DevIdp } from './accounts/devIdp'
import { BusyError, PreviewCache, unfurl, UnfurlError } from './unfurl'
import { OpError, opsFromText } from '../src/api/ops'
import { type ClientMessage, type Role, type ServerMessage } from '../src/collab/protocol'
import { Room, type RoomData } from '../src/collab/room'
import { approxMeasure } from '../src/model/approxMeasure'
import { fromJson } from '../src/model/serialize'

const VERSION = '0.4.0'
const PORT = Number(process.env.PORT ?? 8080)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA = resolve(process.env.BRAINCRAFT_DATA ?? 'braincraft-data')
const STATIC = resolve(process.env.BRAINCRAFT_STATIC ?? dirname(fileURLToPath(import.meta.url)))
const MAX_BODY = 25 * 1024 * 1024
const AI_KEY = process.env.ANTHROPIC_API_KEY?.trim() || ''
const AI_PASSWORD = process.env.BRAINCRAFT_AI_PASSWORD?.trim() || ''
const SAVE_DELAY = 1000

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

mkdirSync(join(DATA, 'boards'), { recursive: true })

/** Day-by-day counts for the admin's usage page (usage.ts). */
const usage = new Usage(join(DATA, 'usage.json'))
let statsCache: { at: number; stats: BoardStats } | null = null

/** The bytes of boards' files (PDFs, documents…), beside the boards. */
const files = new BoardFiles(join(DATA, 'files'), {
  file: (Number(process.env.BRAINCRAFT_MAX_FILE_MB) || 50) * 1024 * 1024,
  board: (Number(process.env.BRAINCRAFT_MAX_BOARD_FILES_MB) || 1024) * 1024 * 1024,
  text: 2_000_000,
})

// ----- storage ---------------------------------------------------------------------------

const rooms = new Map<string, Room>()
const saveTimers = new Map<string, NodeJS.Timeout>()

const fileOf = (id: string) => join(DATA, 'boards', `${id}.json`)
const boardIds = () => readdirSync(join(DATA, 'boards')).flatMap((f) => (f.endsWith('.json') ? [f.slice(0, -5)] : []))

/** Saved versions of every board (see backups.ts). */
const backups = /^(0|off|false|no)$/i.test(process.env.BRAINCRAFT_BACKUPS ?? '')
  ? null
  : new Backups({
      dir: resolve(process.env.BRAINCRAFT_BACKUP_DIR?.trim() || join(DATA, 'backups')),
      data: DATA,
      every: Math.max(5, Number(process.env.BRAINCRAFT_BACKUP_EVERY) || 180) * 60_000,
      keep: Math.min(100, Math.max(1, Math.floor(Number(process.env.BRAINCRAFT_BACKUP_KEEP)) || 5)),
      log,
      host: {
        ids: boardIds,
        data: (id) => rooms.get(id)?.data ?? readStored(id),
        open: (id) => rooms.has(id),
        filesDir: (id) => join(DATA, 'files', id),
      },
    })

/** A board as stored on disk, without opening its room. */
function readStored(id: string): RoomData | null {
  try {
    return JSON.parse(readFileSync(fileOf(id), 'utf8')) as RoomData
  } catch {
    return null
  }
}
const validId = (id: string) => /^[A-Za-z0-9_-]{6,64}$/.test(id)
const newKey = () => randomBytes(18).toString('base64url')

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function save(room: Room) {
  const path = fileOf(room.data.id)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(room.data))
  renameSync(tmp, path)
  accountBoards?.index(room)
}

function scheduleSave(room: Room) {
  clearTimeout(saveTimers.get(room.data.id))
  saveTimers.set(
    room.data.id,
    setTimeout(() => {
      saveTimers.delete(room.data.id)
      try {
        save(room)
      } catch (err) {
        log('could not save board', room.data.id, err)
      }
    }, SAVE_DELAY),
  )
}

function makeRoom(data: RoomData): Room {
  const room = new Room(data, approxMeasure)
  room.onChange = (edited) => {
    if (edited) usage.edited(data.id)
    scheduleSave(room)
  }
  rooms.set(data.id, room)
  return room
}

function getRoom(id: string): Room | null {
  if (!validId(id)) return null
  const open = rooms.get(id)
  if (open) return open
  const path = fileOf(id)
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as RoomData
    // Re-validate the board as stored, the same way files are opened.
    data.board = fromJson(JSON.stringify(data.board))
    return makeRoom(data)
  } catch (err) {
    log('could not read board', id, err)
    return null
  }
}

/** Rooms nobody is in are dropped from memory (they stay on disk). */
setInterval(() => {
  for (const [id, room] of rooms) if (!room.members.size && !saveTimers.has(id)) rooms.delete(id)
}, 60_000).unref()

// ----- HTTP ------------------------------------------------------------------------------

const previews = new PreviewCache()
const PREVIEWS_PER_MINUTE = 60
/** Pages being fetched at once, across everyone. */
const PREVIEWS_AT_ONCE = 8
let previewsRunning = 0
const previewUse = new Map<string, { start: number; count: number }>()
/** Behind a proxy (see docs/SERVER.md), the visitor's address is in X-Forwarded-For. */
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.BRAINCRAFT_TRUST_PROXY ?? '')

/** Who's asking, for rate limits: the visitor's address, with IPv6 grouped by its /64 network. */
function visitor(req: IncomingMessage): string {
  const forwarded = TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : ''
  const ip = forwarded || req.socket.remoteAddress || ''
  return ip.includes(':') && !ip.startsWith('::ffff:') ? ip.split(':').slice(0, 4).join(':') : ip
}

/** A few friends pasting links never get near this; a script hammering the server does. */
function previewAllowed(who: string, now = Date.now()): boolean {
  const use = previewUse.get(who)
  if (!use || now - use.start > 60_000) {
    // Forget visitors whose minute is over, rather than resetting everyone.
    if (previewUse.size > 10_000) for (const [k, u] of previewUse) if (now - u.start > 60_000) previewUse.delete(k)
    previewUse.set(who, { start: now, count: 1 })
    return true
  }
  return ++use.count <= PREVIEWS_PER_MINUTE
}

/** At most `limit` uses per visitor per `windowMs` (forgetting visitors whose window is over). */
function limiter(limit: number, windowMs: number) {
  const use = new Map<string, { start: number; count: number }>()
  return (who: string, now = Date.now()): boolean => {
    const u = use.get(who)
    if (!u || now - u.start > windowMs) {
      if (use.size > 10_000) for (const [k, x] of use) if (now - x.start > windowMs) use.delete(k)
      use.set(who, { start: now, count: 1 })
      return true
    }
    return ++u.count <= limit
  }
}

/** Starting live sessions: plenty for friends, not enough for a script to fill the disk. */
const boardCreateAllowed = limiter(30, 60 * 60_000)
/** Answers to shared forms: a whole class can answer from one address, a script can't flood a board. */
const formAnswerAllowed = limiter(200, 60 * 60_000)

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin
  if (accounts) {
    // Signed-in browsers carry a cookie: only the server's own pages (and ones its owner allows) may call.
    if (!origin || !ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ''))) return
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  } else {
    // Keys travel as bearer tokens, not cookies, so any page may call the API.
    res.setHeader('Access-Control-Allow-Origin', origin ?? '*')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  // Echo what the caller asks for: the Anthropic SDK sends its own headers to the AI proxy.
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'content-type, authorization')
  res.setHeader('Vary', 'Origin')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        fail(new Error('Body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')))
    req.on('error', fail)
  })
}

function keyOf(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim()
  return url.searchParams.get('key')
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

function serveStatic(url: URL, res: ServerResponse) {
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const path = normalize(join(STATIC, rel))
  // Never serve anything outside the app folder.
  if (!path.startsWith(STATIC + sep) && path !== STATIC) return send(res, 404, { error: 'Not found' })
  const found = existsSync(path) && statSync(path).isFile()
  // A piece of the app that isn't here (one an open tab knew before an update) is missing, not the
  // app's page: answering with the page would make the tab try to run HTML as code.
  if (!found && rel.startsWith('/assets/')) return send(res, 404, { error: 'Not found: the app was updated since this page was opened. Reload it.' })
  const file = found ? path : join(STATIC, 'index.html')
  if (!existsSync(file)) return send(res, 404, { error: 'The app is not built here. Run npm run build.' })
  const hashed = /[-.][A-Za-z0-9_-]{8}\.(js|css|woff2?)$/.test(file)
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' })
  // The page's own title is the app's name here, so the tab is right before the app starts.
  if (file.endsWith('index.html')) return res.end(readFileSync(file, 'utf8').replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(appName())}</title>`))
  res.end(readFileSync(file))
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ----- accounts ------------------------------------------------------------------------------

const ACCOUNTS = /^(1|true|yes)$/i.test(process.env.BRAINCRAFT_ACCOUNTS ?? '')
/** The app's name for this server, when set in the environment (admins can change it in the app). */
const ENV_APP_NAME = cleanAppName(process.env.BRAINCRAFT_APP_NAME)
const list = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const PUBLIC_URL = process.env.BRAINCRAFT_PUBLIC_URL?.trim().replace(/\/+$/, '') || undefined
const accounts = ACCOUNTS
  ? new Accounts({
      dir: join(DATA, 'accounts'),
      admins: list(process.env.BRAINCRAFT_ADMINS),
      publicUrl: PUBLIC_URL,
      trustProxy: TRUST_PROXY,
      visitor,
      sso: await ssoFromEnv(process.env, PUBLIC_URL ?? `http://localhost:${PORT}`),
      allowedDomains: list(process.env.BRAINCRAFT_OIDC_ALLOWED_DOMAINS),
      ...(ENV_APP_NAME ? { appName: ENV_APP_NAME } : {}),
    })
  : null
/** What the app is called here: an admin's choice (with accounts), else BRAINCRAFT_APP_NAME, else BrainCraft. */
const appName = () => accounts?.appName() ?? ENV_APP_NAME ?? DEFAULT_APP_NAME
/** The pretend sign-in provider, for trying single sign-on on this computer (BRAINCRAFT_DEV_IDP=1). */
const devIdp = accounts?.sso && /^(1|true|yes)$/i.test(process.env.BRAINCRAFT_DEV_IDP ?? '') ? new DevIdp(`${PUBLIC_URL ?? `http://localhost:${PORT}`}/dev-idp`) : null
const ALLOWED_ORIGINS = list(process.env.BRAINCRAFT_ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, ''))
/** Each person's conversation with the assistant, so it follows them (accounts only). */
const assistantThreads = accounts ? new AssistantThreads({ dir: join(DATA, 'accounts', 'threads'), accounts }) : null
const accountBoards = accounts
  ? new AccountBoards(
      accounts,
      {
        get: getRoom,
        create(board, owner) {
          const id = randomBytes(9).toString('base64url')
          const now = Date.now()
          const room = makeRoom({ id, board, version: 0, editKey: newKey(), viewKey: newKey(), nextSlot: 1, created: now, updated: now, owner, access: [] })
          save(room)
          log('created board', id)
          return room
        },
        remove(id, by) {
          try {
            backups?.deleting(id, by)
          } catch (err) {
            log('couldn’t keep a last backup of', id, err)
          }
          rooms.delete(id)
          clearTimeout(saveTimers.get(id))
          saveTimers.delete(id)
          rmSync(fileOf(id), { force: true })
          files.removeBoard(id)
          log('deleted board', id)
          return true
        },
        ids: boardIds,
        ...(backups ? { backups } : {}),
        revive(data) {
          data.board = fromJson(JSON.stringify(data.board))
          const room = makeRoom(data)
          save(room)
          log('put back board', data.id)
          return room
        },
        loaded: (id) => rooms.get(id) ?? null,
        files: (room, req, res, rest, canEdit) => files.handle(room.data.id, room.data.board, req, res, rest, canEdit),
        peek: readStored,
      },
      ALLOWED_ORIGINS,
    )
  : null

const aiGate = new AiGate({
  password: AI_PASSWORD,
  equal: safeEqual,
  visitor,
  accounts: accounts && ((req) => {
    const u = accounts.userOf(req)
    return !u ? 'signin' : accounts.can(u, 'ai.use') ? 'yes' : 'no'
  }),
})
const aiProxy = AI_KEY ? new AiProxy({ apiKey: AI_KEY, gate: aiGate, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined }) : null
const OPENAI_BASE = process.env.OPENAI_BASE_URL?.trim() || ''
const openAiProxy = OPENAI_BASE
  ? new OpenAiProxy({
      baseUrl: OPENAI_BASE,
      apiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
      models: (process.env.OPENAI_MODEL ?? '').split(',').map((m) => m.trim()).filter(Boolean),
      gate: aiGate,
    })
  : null
/** Speech to text for talking to the assistant (any OpenAI-compatible transcription endpoint). */
const TRANSCRIBE_URL = process.env.BRAINCRAFT_TRANSCRIBE_URL?.trim() || ''
/** Words shown while they're said: the phrase so far is transcribed about once a second (best when you run the speech-to-text server yourself). */
const TRANSCRIBE_PREVIEW = /^(1|true|on|yes)$/i.test(process.env.BRAINCRAFT_TRANSCRIBE_PREVIEW?.trim() ?? '')
const transcriber = TRANSCRIBE_URL
  ? new Transcriber({
      baseUrl: TRANSCRIBE_URL,
      model: process.env.BRAINCRAFT_TRANSCRIBE_MODEL?.trim() || 'whisper-1',
      apiKey: process.env.BRAINCRAFT_TRANSCRIBE_KEY?.trim() || undefined,
      // Its own budget: talking sends a phrase every few seconds (and with previews, one a second).
      gate: new AiGate({ password: AI_PASSWORD, equal: safeEqual, visitor, limit: TRANSCRIBE_PREVIEW ? 20_000 : 2000, accounts: accounts && ((req) => {
        const u = accounts.userOf(req)
        return !u ? 'signin' : accounts.can(u, 'ai.use') ? 'yes' : 'no'
      }) }),
    })
  : null
/** The model needs the tools described in the text (served without tool calling). */
const AI_TEXT_TOOLS = /^(1|true|yes)$/i.test(process.env.BRAINCRAFT_AI_TEXT_TOOLS ?? '')
const AI_COMMAND = process.env.BRAINCRAFT_AI_COMMAND?.trim() || ''
const AI_TIMEOUT_MS = (Number(process.env.BRAINCRAFT_AI_TIMEOUT) || 300) * 1000
/**
 * Command-line agents, by id: the owner's BRAINCRAFT_AI_COMMAND ("custom"), and Claude Code and Codex
 * when they're installed here (see aiAgents.ts; BRAINCRAFT_AI_AGENTS=off turns that off).
 */
const agents = new Map<string, { label: string; program: string; runner: CommandRunner }>()
if (AI_COMMAND)
  agents.set('custom', { label: `${programOf(AI_COMMAND)} (this server's agent command)`, program: programOf(AI_COMMAND), runner: new CommandRunner({ command: AI_COMMAND, gate: aiGate, timeoutMs: AI_TIMEOUT_MS }) })
for (const a of agentsFromEnv(process.env))
  if (!AI_COMMAND || programOf(AI_COMMAND) !== a.program) agents.set(a.id, { label: a.label, program: a.program, runner: new CommandRunner({ command: a.command, gate: aiGate, timeoutMs: AI_TIMEOUT_MS }) })
const commandRunner = agents.size ? [...agents.values()][0].runner : null
const aiProviders = [...(aiProxy ? ['anthropic'] : []), ...(openAiProxy ? ['openai'] : []), ...(agents.size ? ['command'] : [])]

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'boards', id, action]
  res.once('finish', () => {
    const e = eventOf(req.method ?? 'GET', parts, res.statusCode, String(res.getHeader('location') ?? ''))
    if (e) usage.count(e)
  })
  const someone = accounts?.userOf(req)
  if (someone) usage.seen(someone.id)
  if (parts[1] === 'health')
    return send(res, 200, {
      ok: true,
      name: 'braincraft',
      version: VERSION,
      ai: aiProviders.length > 0,
      aiPassword: !!AI_PASSWORD,
      aiProviders,
      ...(openAiProxy ? { aiModels: await openAiProxy.models(), aiTextTools: AI_TEXT_TOOLS } : {}),
      ...(agents.size
        ? {
            aiCommand: [...agents.values()][0].program,
            aiAgents: [...agents].map(([id, a]) => ({ id, label: a.label })),
            // Agents answer only this machine until there's a password or accounts.
            aiAgentsLocal: !aiGate.guarded,
          }
        : {}),
      previews: true,
      accounts: !!accounts,
      backups: !!backups,
      transcribe: !!transcriber,
      transcribePreview: !!transcriber && TRANSCRIBE_PREVIEW,
      appName: appName(),
    })

  // The API described: OpenAPI for tools, and the same as a page to read.
  if ((parts[1] === 'openapi.json' || parts[1] === 'docs') && parts.length === 2) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' })
    const spec = openApiSpec({ version: VERSION, accounts: !!accounts, backups: !!backups, ai: { anthropic: !!aiProxy, openai: !!openAiProxy, command: !!commandRunner, transcribe: !!transcriber } })
    if (parts[1] === 'openapi.json') return send(res, 200, spec)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(docsPage(spec))
  }

  // GET/POST /api/forms/:board/:item → a shared form, for people who never open the board (see forms.ts).
  if (parts[1] === 'forms' && parts.length === 4) {
    if (accounts && !accounts.userOf(req)) return send(res, 401, { error: 'Sign in first' })
    const room = getRoom(parts[2])
    if (req.method === 'GET') return sendRead(res, readForm(room, parts[3]))
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
    if (accounts && !accounts.fromApp(req)) return send(res, 403, { error: 'Missing the X-BrainCraft header' })
    if (!formAnswerAllowed(visitor(req))) return send(res, 429, { error: 'Too many answers from here. Try again in an hour.' })
    return sendRead(res, answerForm(room, parts[3], await readBody(req)))
  }

  // GET /api/admin/usage[.csv]?days= → admins: activity day by day, features in use, storage.
  if (accounts && parts[1] === 'admin' && (parts[2] === 'usage' || parts[2] === 'usage.csv') && parts.length === 3) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' })
    if (someone?.role !== 'admin') return send(res, someone ? 403 : 401, { error: 'Only admins can see usage' })
    const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days')) || 30))
    const report = usage.report(days)
    if (parts[2] === 'usage.csv') {
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="usage.csv"', 'cache-control': 'no-store' })
      return res.end(usageCsv(report))
    }
    // Reading every board is a bit of work: once a minute is plenty.
    if (!statsCache || Date.now() - statsCache.at > 60_000)
      statsCache = { at: Date.now(), stats: boardStats({ boardsDir: join(DATA, 'boards'), filesDir: join(DATA, 'files'), loaded: (id) => rooms.get(id)?.data.board ?? null, read: fromJson }) }
    // The busiest boards by name, for the boards still here.
    const busiest = report.busiest.flatMap((b) => {
      const e = accounts.store.boards[b.id]
      return e ? [{ ...b, title: e.title || 'Untitled', kind: e.kind === 'wiki' ? 'wiki' : 'board' }] : []
    })
    return send(res, 200, { ...report, busiest, ...statsCache.stats, people: accounts.store.users.filter((u) => !u.disabled).length })
  }

  // GET /api/admin/backups → how the backups stand; POST → a version of every board now;
  // GET /api/admin/backup → everything this server keeps, as a .tar.gz.
  if (accounts && parts[1] === 'admin' && (parts[2] === 'backups' || parts[2] === 'backup') && parts.length === 3) {
    if (someone?.role !== 'admin') return send(res, someone ? 403 : 401, { error: 'Only admins can do that' })
    if (!backups) return send(res, 404, { error: 'Backups are off on this server (BRAINCRAFT_BACKUPS)' })
    if (parts[2] === 'backups' && req.method === 'GET') return send(res, 200, backups.status())
    if (parts[2] === 'backups' && req.method === 'POST') {
      if (!accounts.fromApp(req)) return send(res, 403, { error: 'Missing the X-BrainCraft header' })
      let saved = 0
      for (const id of boardIds()) {
        const before = backups.versions(id)[0]?.id
        if (backups.snapshot(id, 'manual', { by: someone.name })?.id !== before) saved++
      }
      return send(res, 200, { saved, ...backups.status() })
    }
    if (parts[2] === 'backup' && req.method === 'GET') {
      const day = new Date().toISOString().slice(0, 10)
      accounts.log(req, someone, { action: 'backup.download', text: `${someone.name} downloaded a backup of the whole server` })
      res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="braincraft-backup-${day}.tar.gz"`, 'cache-control': 'no-store' })
      const out = backups.archive((name, why) => log('left out of the backup:', name, why))
      out.on('error', (err) => {
        log('backup download failed', err)
        res.destroy(err)
      })
      return void out.pipe(res)
    }
    return send(res, 405, { error: 'Method not allowed' })
  }

  // Accounts: sign-in, admin, people, and boards by access instead of keys.
  if (accounts) {
    const body = () => readBody(req)
    if (await accounts.handle(req, res, url, body)) return
    if (await accountBoards!.handle(req, res, url, body)) return
    if (await assistantThreads!.handle(req, res, url, body)) return
  }

  // GET /api/unfurl?url=… → a link preview: title, description, picture and site name.
  if (parts[1] === 'unfurl') {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' })
    if (accounts && !accounts.userOf(req)) return send(res, 401, { error: 'Sign in first' })
    if (!previewAllowed(visitor(req))) return send(res, 429, { error: 'Too many link previews at once. Try again in a minute.' })
    const target = url.searchParams.get('url') ?? ''
    try {
      return send(
        res,
        200,
        await previews.get(target, async (u) => {
          if (previewsRunning >= PREVIEWS_AT_ONCE) throw new BusyError('The server is busy reading other pages. Try again soon.')
          previewsRunning++
          try {
            return await unfurl(u)
          } finally {
            previewsRunning--
          }
        }),
      )
    } catch (err) {
      // 503: worth trying again later; 422: this link won't get a preview.
      const temporary = err instanceof UnfurlError && err.temporary
      return send(res, temporary ? 503 : 422, { error: err instanceof UnfurlError ? err.message : 'That page couldn’t be read' })
    }
  }

  // The assistant's providers: POST /api/ai/v1/messages (Claude, this server's key),
  // /api/ai/openai/chat/completions (an OpenAI-compatible server), /api/ai/command (an agent).
  if (parts[1] === 'ai') {
    const body = async () => (req.method === 'POST' ? await readBody(req) : '')
    if (url.pathname === '/api/ai/v1/messages') {
      if (!aiProxy) return send(res, 404, { error: 'Claude is not set up on this server (ANTHROPIC_API_KEY)' })
      return aiProxy.handle(req, res, await body())
    }
    if (url.pathname === '/api/ai/openai/chat/completions') {
      if (!openAiProxy) return send(res, 404, { error: 'No model server is set up on this server (OPENAI_BASE_URL)' })
      return openAiProxy.handle(req, res, await body())
    }
    if (url.pathname === '/api/ai/transcribe') {
      if (!transcriber) return send(res, 404, { error: 'Speech to text isn’t set up on this server (BRAINCRAFT_TRANSCRIBE_URL)' })
      return transcriber.handle(req, res, url)
    }
    if (url.pathname === '/api/ai/command') {
      if (!agents.size) return send(res, 404, { error: 'No command-line agent here: install Claude Code or Codex on the server, or set BRAINCRAFT_AI_COMMAND' })
      const id = url.searchParams.get('agent')
      const agent = id ? agents.get(id) : [...agents.values()][0]
      if (!agent) return send(res, 404, { error: `No agent "${id}" here. This server has: ${[...agents.keys()].join(', ')}` })
      return agent.runner.handle(req, res, await body())
    }
    return send(res, 404, { error: 'Not found' })
  }

  if (parts[1] !== 'boards') return send(res, 404, { error: 'Not found' })

  // POST /api/boards {board?} → a new shared board and its two keys.
  if (parts.length === 2 && req.method === 'POST') {
    if (!boardCreateAllowed(visitor(req))) return send(res, 429, { error: 'Too many new live boards from here. Try again in an hour.' })
    let board = fromJson(JSON.stringify({ version: 1, title: 'Untitled board', items: [], connectors: [], nextId: 1 }))
    const body = await readBody(req)
    if (body.trim()) {
      try {
        const raw = JSON.parse(body) as { board?: unknown }
        if (raw.board) board = fromJson(JSON.stringify(raw.board))
      } catch (err) {
        return send(res, 400, { error: `Not a BrainCraft board: ${(err as Error).message}` })
      }
    }
    const id = randomBytes(9).toString('base64url')
    const now = Date.now()
    const room = makeRoom({ id, board, version: 0, editKey: newKey(), viewKey: newKey(), nextSlot: 1, created: now, updated: now })
    save(room)
    log('created board', id)
    return send(res, 201, { id, editKey: room.data.editKey, viewKey: room.data.viewKey })
  }

  // GET /api/boards/:id/key?parent=ID, with the parent board's key → the key to this child board
  // giving the same rights (view or edit), so a card on a shared board opens the board it leads to.
  if (parts.length === 4 && parts[3] === 'key' && req.method === 'GET') {
    const child = getRoom(parts[2])
    const parentId = url.searchParams.get('parent') ?? ''
    const parent = parentId ? getRoom(parentId) : null
    const rights = parent?.roleFor(keyOf(req, url), safeEqual)
    // The same answer for no such board, a wrong key and a board that isn't this one's child.
    if (!child || !parent || !rights || child.data.board.parent?.key !== parent.data.id) return send(res, 404, { error: 'No such board' })
    return send(res, 200, { id: child.data.id, key: rights === 'edit' ? child.data.editKey : child.data.viewKey, role: rights })
  }

  const room = parts[2] ? getRoom(parts[2]) : null
  if (!room) return send(res, 404, { error: 'No such board' })
  const role = room.roleFor(keyOf(req, url), safeEqual)
  if (!role) return send(res, 403, { error: 'Missing or wrong key' })

  // Saved versions, and putting one back (see backupRoutes.ts).
  if (!backups && parts[3] === 'versions') return send(res, 404, { error: 'Backups are off on this server' })
  if (backups && parts[3] === 'versions' && (await versionRoute(backups, room, req.method ?? 'GET', parts.slice(3), { canEdit: role === 'edit' }, () => readBody(req), res))) return

  // Files kept with the board (see boardFiles.ts).
  if (parts[3] === 'files' && (await files.handle(room.data.id, room.data.board, req, res, parts.slice(4), role === 'edit'))) return

  // Exports, and writing wiki pages one by one (see boardWrites.ts).
  if (parts.length > 3 && (await boardWrite(room, req.method ?? 'GET', parts.slice(3), url.searchParams, () => readBody(req), { canEdit: role === 'edit' }, res))) return

  // GET /api/boards/:id/objects, /search, /mermaid, /pages… → reads (see boardReads.ts).
  if (parts.length > 3 && req.method === 'GET') {
    const read = readBoard(room.data.board, parts.slice(3), url.searchParams)
    if (read) return sendRead(res, read)
  }

  // GET /api/boards/:id → the board.
  if (parts.length === 3 && req.method === 'GET') {
    return send(res, 200, { id: room.data.id, role, version: room.data.version, board: room.data.board, people: room.members.size })
  }

  // POST /api/boards/:id/ops {ops} → apply operations (edit key).
  if (parts[3] === 'ops' && req.method === 'POST') {
    if (role !== 'edit') return send(res, 403, { error: 'This key can only view the board' })
    const ops = opsFromText(await readBody(req))
    if (!ops) return send(res, 400, { error: 'Send {"ops": [...]} (see docs/API.md)' })
    try {
      const results = room.applyOps(ops)
      return send(res, 200, { version: room.data.version, results })
    } catch (err) {
      return send(res, err instanceof OpError ? 422 : 500, { error: (err as Error).message })
    }
  }
  return send(res, 405, { error: 'Method not allowed' })
}

/** The request's address, or null when it's garbage (a bad "%" escape, or a malformed absolute URL). */
function parseUrl(req: IncomingMessage): URL | null {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    decodeURIComponent(url.pathname)
    return url
  } catch {
    return null
  }
}

function onRequest(req: IncomingMessage, res: ServerResponse) {
  // One malformed request must never take the server down for everyone.
  try {
    handle(req, res)
  } catch (err) {
    log('request error', err)
    if (!res.headersSent) send(res, 400, { error: 'Bad request' })
  }
}

// HTTPS, when given a certificate and its key (PEM files).
const TLS_CERT = process.env.BRAINCRAFT_TLS_CERT?.trim()
const TLS_KEY = process.env.BRAINCRAFT_TLS_KEY?.trim()
if (!!TLS_CERT !== !!TLS_KEY) {
  console.error('BRAINCRAFT_TLS_CERT and BRAINCRAFT_TLS_KEY go together: set both (or neither).')
  process.exit(1)
}
const readTls = () => ({ cert: readFileSync(TLS_CERT!), key: readFileSync(TLS_KEY!) })
const tlsServer = TLS_CERT ? createTlsServer(readTls(), onRequest) : null
const server = tlsServer ?? createServer(onRequest)
if (tlsServer) {
  // Certificates renew (Let's Encrypt every 60-90 days): use the new one when its file changes.
  let stamp = statSync(TLS_CERT!).mtimeMs
  setInterval(() => {
    try {
      const now = statSync(TLS_CERT!).mtimeMs
      if (now === stamp) return
      tlsServer.setSecureContext(readTls())
      stamp = now
      log('picked up the renewed certificate')
    } catch (err) {
      log('couldn’t read the renewed certificate; still using the old one', err)
    }
  }, 60 * 60_000).unref()
}

function handle(req: IncomingMessage, res: ServerResponse) {
  const url = parseUrl(req)
  if (!url) return send(res, 400, { error: 'Bad request' })
  if (url.pathname.startsWith('/api/')) {
    cors(req, res)
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
    api(req, res, url).catch((err) => {
      log('api error', err)
      if (!res.headersSent) send(res, 500, { error: 'Server error' })
    })
    return
  }
  if (devIdp && url.pathname.startsWith('/dev-idp/')) {
    devIdp.handle(req, res, url, () => readBody(req)).catch((err) => {
      log('test provider error', err)
      if (!res.headersSent) send(res, 500, { error: 'Server error' })
    })
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' })
  serveStatic(url, res)
}

// ----- live sessions ---------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY })

server.on('upgrade', (req, socket, head) => {
  let room: Room | null = null
  let role: Role | null = null
  let user: { id: string; name: string } | undefined
  let manages: boolean | undefined
  try {
    const url = parseUrl(req)
    const m = url && /^\/api\/boards\/([^/]+)\/live$/.exec(url.pathname)
    room = m ? getRoom(m[1]) : null
    if (accountBoards && room) {
      // With accounts, the session decides (and the page must be the server's own).
      const who = accountBoards.socket(req, room)
      role = who?.role ?? null
      user = who ? { id: who.user.id, name: who.user.name } : undefined
      manages = who ? who.level === 'manage' : undefined
    } else role = room?.roleFor(url!.searchParams.get('key'), safeEqual) ?? null
  } catch (err) {
    log('upgrade error', err)
  }
  if (!room || !role) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    const id = randomBytes(6).toString('base64url')
    const sendTo = (msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg))
    room.join({ id, role, send: sendTo, ...(user ? { user } : {}), ...(manages !== undefined ? { manages } : {}) })
    usage.count('board.open')
    if (user) usage.seen(user.id)
    log('joined', room.data.id, id, role, `(${room.members.size} here)`)
    ws.on('message', (data) => {
      let msg: ClientMessage | undefined
      try {
        msg = JSON.parse(String(data)) as ClientMessage
        room.receive(id, msg)
      } catch {
        const seq = msg?.t === 'patch' && typeof msg.seq === 'number' ? msg.seq : undefined
        sendTo({ t: 'error', message: 'Bad message', seq })
      }
    })
    // Keep connections through proxies that drop idle sockets.
    const ping = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 25_000)
    ws.on('close', () => {
      clearInterval(ping)
      room.leave(id)
      log('left', room.data.id, id, `(${room.members.size} here)`)
    })
  })
})

// Backups: a first round soon after starting (every board), then every ten minutes.
if (backups) {
  setTimeout(() => void backups.pass(), 30_000).unref()
  setInterval(() => void backups.pass(), 10 * 60_000).unref()
}

// A last line of defence: log a stray error rather than drop every friend's live session.
process.on('uncaughtException', (err) => log('unexpected error', err))

server.listen(PORT, HOST, () => {
  log(`BrainCraft ${VERSION} on ${tlsServer ? 'https' : 'http'}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  log(`boards stored in ${DATA}; app served from ${STATIC}`)
  log(backups ? `backups in ${backups.dir}` : 'backups off')
  log(
    accounts
      ? `accounts on${accounts.sso ? ` with single sign-on (${accounts.sso.label})` : ''}${devIdp ? ' — TEST PROVIDER at /dev-idp: anyone can sign in as anyone, never use this for real' : ''}${accounts.needsSetup ? ' — open the server to create the first admin' : ''}`
      : 'accounts off: boards are shared by link (set BRAINCRAFT_ACCOUNTS=1 for sign-in)',
  )
  log(
    aiProviders.length
      ? `AI assistant on: ${[aiProxy && 'Claude', openAiProxy && `model server at ${OPENAI_BASE}`, agents.size && `${[...agents.values()].map((a) => a.label).join(' and ')}${aiGate.guarded ? '' : ' (this machine only, until BRAINCRAFT_AI_PASSWORD is set)'}`].filter(Boolean).join(', ')}${AI_PASSWORD ? ' (password required)' : ''}`
      : 'AI assistant off (install Claude Code or Codex here, or set ANTHROPIC_API_KEY, OPENAI_BASE_URL or BRAINCRAFT_AI_COMMAND)',
  )
})

// Save everything before exiting.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    for (const [id, t] of saveTimers) {
      clearTimeout(t)
      const room = rooms.get(id)
      if (room) save(room)
    }
    accounts?.store.flush()
    accounts?.store.saveBoards()
    usage.save()
    process.exit(0)
  })
}
