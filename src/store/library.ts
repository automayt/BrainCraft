/** Every board saved in this browser, with automatic and named versions of each. */

import { bounds } from '../model/board'
import { fromJson, toJson } from '../model/serialize'
import type { Board, Kind } from '../model/types'
import type { KV } from './kv'

/** One object of a board thumbnail: x, y, w, h in 0–1000 of the board's bounds, plus fill and kind. */
export type ThumbRect = [number, number, number, number, string, Kind]

/** A board shared through a BrainCraft server. */
export interface LiveInfo {
  server: string
  id: string
  /** The key this browser uses (edit or view). */
  key: string
  role: 'edit' | 'view'
  /** Kept by whoever started the session, to hand out view-only links. */
  viewKey?: string
}

export interface BoardMeta {
  id: string
  live?: LiveInfo
  title: string
  /** The board's emoji, if it has one. */
  icon?: string
  created: number
  updated: number
  items: number
  thumb: ThumbRect[]
  /** Aspect ratio (w / h) of the board's content, for the thumbnail. */
  aspect: number
}

export interface VersionMeta {
  at: number
  title: string
  items: number
  /** Versions saved by hand have a name and are never pruned. */
  name?: string
}

/** Automatic versions are taken at most this often while a board changes. */
export const AUTO_VERSION_EVERY = 10 * 60_000
/** Automatic versions kept per board (named ones are kept regardless). */
export const AUTO_VERSIONS_KEPT = 40

const THUMB_LIMIT = 160

export function thumbnail(b: Board): { thumb: ThumbRect[]; aspect: number } {
  const box = bounds(b)
  if (!box || !box.w || !box.h) return { thumb: [], aspect: 16 / 10 }
  const s = 1000 / Math.max(box.w, box.h)
  // Frames first so they sit behind; then the largest objects, which matter most at thumbnail size.
  const items = [...b.items]
    .filter((i) => i.kind !== 'pen')
    .sort((a, z) => Number(z.kind === 'frame') - Number(a.kind === 'frame') || z.w * z.h - a.w * a.h)
    .slice(0, THUMB_LIMIT)
  const thumb = items.map(
    (i): ThumbRect => [
      Math.round((i.x - box.x) * s),
      Math.round((i.y - box.y) * s),
      Math.max(1, Math.round(i.w * s)),
      Math.max(1, Math.round(i.h * s)),
      i.color,
      i.kind,
    ],
  )
  return { thumb, aspect: box.w / box.h }
}

function newId(): string {
  const c = globalThis.crypto
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const metaKey = (id: string) => `meta:${id}`
const boardKey = (id: string) => `board:${id}`
const versionPrefix = (id: string) => `version:${id}:`
// Zero-padded so versions sort by time as strings.
const versionKey = (id: string, at: number) => `${versionPrefix(id)}${String(at).padStart(15, '0')}`

interface StoredVersion extends VersionMeta {
  json: string
}

export class Library {
  readonly kv: KV
  /** Clock, replaceable in tests. */
  now: () => number = Date.now

  constructor(kv: KV) {
    this.kv = kv
  }

  async list(): Promise<BoardMeta[]> {
    const keys = await this.kv.keys('meta:')
    const metas = await Promise.all(keys.map((k) => this.kv.get<BoardMeta>(k)))
    return metas.filter((m): m is BoardMeta => !!m).sort((a, z) => z.updated - a.updated)
  }

  meta(id: string) {
    return this.kv.get<BoardMeta>(metaKey(id))
  }

  async load(id: string): Promise<Board | null> {
    const json = await this.kv.get<string>(boardKey(id))
    if (!json) return null
    try {
      return fromJson(json)
    } catch {
      return null
    }
  }

  async create(board: Board): Promise<string> {
    const id = newId()
    await this.write(id, board, this.now())
    return id
  }

  /** Saves the board, taking an automatic version when the last one is old enough. */
  async save(id: string, board: Board): Promise<void> {
    const prev = await this.meta(id)
    const now = this.now()
    await this.write(id, board, prev?.created ?? now, prev?.live)
    const versions = await this.versions(id)
    const lastAuto = versions.find((v) => !v.name)
    if (!lastAuto || now - lastAuto.at >= AUTO_VERSION_EVERY) await this.addVersion(id, board)
  }

  private async write(id: string, board: Board, created: number, live?: LiveInfo) {
    const json = toJson(board)
    const meta: BoardMeta = {
      id,
      ...(live ? { live } : {}),
      title: board.title || 'Untitled board',
      ...(board.icon ? { icon: board.icon } : {}),
      created,
      updated: this.now(),
      items: board.items.length,
      ...thumbnail(board),
    }
    await this.kv.set(boardKey(id), json)
    await this.kv.set(metaKey(id), meta)
  }

  async setLive(id: string, live: LiveInfo | undefined) {
    const meta = await this.meta(id)
    if (!meta) return
    const next = { ...meta }
    if (live) next.live = live
    else delete next.live
    await this.kv.set(metaKey(id), next)
  }

  /** The board in this browser that is a copy of live board `liveId` on `server`. */
  async findLive(server: string, liveId: string): Promise<BoardMeta | undefined> {
    return (await this.list()).find((m) => m.live?.id === liveId && m.live.server === server)
  }

  async rename(id: string, title: string) {
    const b = await this.load(id)
    if (b) await this.save(id, { ...b, title })
  }

  /** A copy is a separate board: it doesn't join the original's live session. */
  async duplicate(id: string): Promise<string | null> {
    const b = await this.load(id)
    return b ? this.create({ ...b, title: `${b.title} (copy)` }) : null
  }

  async remove(id: string) {
    await this.kv.delete(boardKey(id))
    await this.kv.delete(metaKey(id))
    await this.kv.delete(`handle:${id}`)
    await this.kv.delete(`ai:${id}`)
    await this.kv.delete(`seen:${id}`)
    for (const k of await this.kv.keys(versionPrefix(id))) await this.kv.delete(k)
  }

  // ----- versions ----------------------------------------------------------------

  /** Newest first. */
  async versions(id: string): Promise<VersionMeta[]> {
    const keys = await this.kv.keys(versionPrefix(id))
    const all = await Promise.all(keys.map((k) => this.kv.get<StoredVersion>(k)))
    return all
      .filter((v): v is StoredVersion => !!v)
      .map(({ at, title, items, name }) => ({ at, title, items, ...(name ? { name } : {}) }))
      .reverse()
  }

  /** Saves a version of the board now; named versions are kept forever. */
  async addVersion(id: string, board: Board, name?: string): Promise<VersionMeta> {
    let at = this.now()
    // Two versions in the same millisecond would share a key.
    while (await this.kv.get(versionKey(id, at))) at++
    const v: StoredVersion = { at, title: board.title, items: board.items.length, json: toJson(board), ...(name ? { name } : {}) }
    await this.kv.set(versionKey(id, at), v)
    await this.prune(id)
    return { at, title: v.title, items: v.items, ...(name ? { name } : {}) }
  }

  async loadVersion(id: string, at: number): Promise<Board | null> {
    const v = await this.kv.get<StoredVersion>(versionKey(id, at))
    return v ? fromJson(v.json) : null
  }

  async deleteVersion(id: string, at: number) {
    await this.kv.delete(versionKey(id, at))
  }

  private async prune(id: string) {
    const autos = (await this.versions(id)).filter((v) => !v.name)
    for (const v of autos.slice(AUTO_VERSIONS_KEPT)) await this.kv.delete(versionKey(id, v.at))
  }
}
