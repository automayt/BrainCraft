/**
 * The BrainCraft server: hosts the app, stores shared boards, runs live sessions and the HTTP API.
 *
 *   node dist/braincraft-server.mjs          → http://localhost:8080
 *
 * Settings (environment): PORT, HOST, BRAINCRAFT_DATA (where boards are stored),
 * BRAINCRAFT_STATIC (the built app; defaults to this file's folder).
 *
 * Boards are shared by link, Google-Docs style: each has a secret edit key and a secret
 * view key. Anyone with a key can open the board in that role; nobody can list boards.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { OpError, opsFromText } from '../src/api/ops'
import { type ClientMessage, type ServerMessage } from '../src/collab/protocol'
import { Room, type RoomData } from '../src/collab/room'
import { approxMeasure } from '../src/model/approxMeasure'
import { fromJson } from '../src/model/serialize'

const VERSION = '0.3.0'
const PORT = Number(process.env.PORT ?? 8080)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA = resolve(process.env.BRAINCRAFT_DATA ?? 'braincraft-data')
const STATIC = resolve(process.env.BRAINCRAFT_STATIC ?? dirname(fileURLToPath(import.meta.url)))
const MAX_BODY = 25 * 1024 * 1024
const SAVE_DELAY = 1000

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

mkdirSync(join(DATA, 'boards'), { recursive: true })

// ----- storage ---------------------------------------------------------------------------

const rooms = new Map<string, Room>()
const saveTimers = new Map<string, NodeJS.Timeout>()

const fileOf = (id: string) => join(DATA, 'boards', `${id}.json`)
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
  room.onChange = () => scheduleSave(room)
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

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function cors(req: IncomingMessage, res: ServerResponse) {
  // Keys travel as bearer tokens, not cookies, so any page may call the API.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
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
  const file = existsSync(path) && statSync(path).isFile() ? path : join(STATIC, 'index.html')
  if (!existsSync(file)) return send(res, 404, { error: 'The app is not built here. Run npm run build.' })
  const hashed = /[-.][A-Za-z0-9_-]{8}\.(js|css|woff2?)$/.test(file)
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' })
  res.end(readFileSync(file))
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'boards', id, action]
  if (parts[1] === 'health') return send(res, 200, { ok: true, name: 'braincraft', version: VERSION })

  if (parts[1] !== 'boards') return send(res, 404, { error: 'Not found' })

  // POST /api/boards {board?} → a new shared board and its two keys.
  if (parts.length === 2 && req.method === 'POST') {
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

  const room = parts[2] ? getRoom(parts[2]) : null
  if (!room) return send(res, 404, { error: 'No such board' })
  const role = room.roleFor(keyOf(req, url), safeEqual)
  if (!role) return send(res, 403, { error: 'Missing or wrong key' })

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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api/')) {
    cors(req, res)
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
    api(req, res, url).catch((err) => {
      log('api error', err)
      if (!res.headersSent) send(res, 500, { error: 'Server error' })
    })
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' })
  serveStatic(url, res)
})

// ----- live sessions ---------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const m = /^\/api\/boards\/([^/]+)\/live$/.exec(url.pathname)
  const room = m ? getRoom(m[1]) : null
  const role = room?.roleFor(url.searchParams.get('key'), safeEqual)
  if (!room || !role) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    const id = randomBytes(6).toString('base64url')
    const sendTo = (msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg))
    room.join({ id, role, send: sendTo })
    log('joined', room.data.id, id, role, `(${room.members.size} here)`)
    ws.on('message', (data) => {
      try {
        room.receive(id, JSON.parse(String(data)) as ClientMessage)
      } catch {
        sendTo({ t: 'error', message: 'Bad message' })
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

server.listen(PORT, HOST, () => {
  log(`BrainCraft ${VERSION} on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  log(`boards stored in ${DATA}; app served from ${STATIC}`)
})

// Save everything before exiting.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    for (const [id, t] of saveTimers) {
      clearTimeout(t)
      const room = rooms.get(id)
      if (room) save(room)
    }
    process.exit(0)
  })
}
