/**
 * The bytes of a board's files, and the text read out of them, kept beside the board on disk:
 *
 *   GET    /api/boards/:id/files/:file              the file (?download=1 to save it)
 *   GET    /api/boards/:id/files/:file/text         its words, as Markdown
 *   PUT    /api/boards/:id/files/:file              its bytes (the body), type in Content-Type (edit)
 *   PUT    /api/boards/:id/files/:file/text         its words (edit)
 *   DELETE /api/boards/:id/files/:file              deletes both (edit)
 *
 * The board keeps each file's details (name, size, who added it); this only keeps bytes, so whoever
 * may open the board may read its files, and whoever may edit it may add and delete them. The caller
 * has checked that much already. Files open in the browser only when they're safe to show (PDFs,
 * pictures, plain text), and always in a sandbox; everything else downloads.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { getFile, isFileId } from '../src/model/files'
import type { Board } from '../src/model/types'

/** Types a browser may show in place (from a sandbox); the rest download. */
const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp|avif)|text\/plain)$/

export interface FileLimits {
  /** The biggest file, in bytes. */
  file: number
  /** All of one board's files together, in bytes. */
  board: number
  /** The most text kept for one file, in characters. */
  text: number
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

class TooBig extends Error {}

function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) return fail(new TooBig())
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        fail(new TooBig())
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => ok(Buffer.concat(chunks)))
    req.on('error', fail)
  })
}

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`

export class BoardFiles {
  private dir: string
  private limits: FileLimits

  constructor(dir: string, limits: FileLimits) {
    this.dir = dir
    this.limits = limits
    mkdirSync(dir, { recursive: true })
  }

  private folder(board: string) {
    return join(this.dir, board)
  }

  /** Bytes kept for a board's files so far. */
  used(board: string): number {
    try {
      return readdirSync(this.folder(board)).reduce((n, f) => n + statSync(join(this.folder(board), f)).size, 0)
    } catch {
      return 0
    }
  }

  /** Forgets every file of a board (when the board is deleted). */
  removeBoard(board: string) {
    rmSync(this.folder(board), { recursive: true, force: true })
  }

  private write(board: string, name: string, data: Buffer | string) {
    mkdirSync(this.folder(board), { recursive: true })
    const path = join(this.folder(board), name)
    writeFileSync(`${path}.tmp`, data)
    renameSync(`${path}.tmp`, path)
  }

  /**
   * Handles /api/boards/:id/files/… for a board the asker may open (`rest` is what follows "files").
   * False when it isn't a file route.
   */
  async handle(boardId: string, board: Board, req: IncomingMessage, res: ServerResponse, rest: string[], canEdit: boolean): Promise<boolean> {
    const [id, part, ...more] = rest
    if (!isFileId(id) || more.length || (part !== undefined && part !== 'text')) return false
    const m = req.method ?? 'GET'
    const bytesPath = join(this.folder(boardId), `${id}.bin`)
    const textPath = join(this.folder(boardId), `${id}.md`)
    const typePath = join(this.folder(boardId), `${id}.type`)

    if (m === 'GET') {
      if (part === 'text') {
        try {
          res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
          return res.end(readFileSync(textPath)), true
        } catch {
          return json(res, 404, { error: 'No words were kept for that file' }), true
        }
      }
      let data: Buffer
      try {
        data = readFileSync(bytesPath)
      } catch {
        return json(res, 404, { error: 'That file isn’t on the server' }), true
      }
      const meta = getFile(board, id)
      let type = 'application/octet-stream'
      try {
        type = readFileSync(typePath, 'utf8')
      } catch {
        type = meta?.type ?? type
      }
      const name = meta?.name ?? `${id}`
      const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
      const inline = INLINE.test(type) && !new URL(req.url ?? '/', 'http://x').searchParams.has('download')
      res.writeHead(200, {
        'content-type': type,
        'content-length': data.length,
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        // Whatever is in it can't run as this site.
        'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=3600',
      })
      return res.end(data), true
    }

    if (!canEdit) return json(res, 403, { error: 'You can only view this board, so you can’t change its files' }), true

    if (m === 'PUT') {
      try {
        if (part === 'text') {
          const text = (await readRaw(req, this.limits.text * 4)).toString('utf8').slice(0, this.limits.text)
          this.write(boardId, `${id}.md`, text)
          return json(res, 200, { ok: true, chars: text.length }), true
        }
        const type = String(req.headers['content-type'] ?? '').split(';')[0].trim()
        const room = this.limits.board - this.used(boardId) + (statSafe(bytesPath) ?? 0)
        const data = await readRaw(req, Math.min(this.limits.file, Math.max(0, room)))
        this.write(boardId, `${id}.bin`, data)
        this.write(boardId, `${id}.type`, /^[\w.+-]{1,60}\/[\w.+-]{1,100}$/.test(type) ? type : 'application/octet-stream')
        return json(res, 200, { ok: true, size: data.length }), true
      } catch (err) {
        if (err instanceof TooBig) {
          const full = this.limits.board - this.used(boardId) < this.limits.file
          return json(res, 413, { error: full ? `This board’s files are using all the space it has (${mb(this.limits.board)})` : `That file is bigger than this server takes (${mb(this.limits.file)})` }), true
        }
        throw err
      }
    }

    if (m === 'DELETE' && part === undefined) {
      for (const p of [bytesPath, textPath, typePath]) rmSync(p, { force: true })
      return json(res, 200, { ok: true }), true
    }
    return json(res, 405, { error: 'Method not allowed' }), true
  }
}

function statSafe(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}
