/**
 * Backups of every board and wiki on the server, kept beside the data (or on another disk, with
 * BRAINCRAFT_BACKUP_DIR):
 *
 *   boards/<id>/index.json           the board's versions, newest first
 *   boards/<id>/<version>.json.gz    a version: the board as stored, with its owner, access and keys
 *   boards/<id>/deleted.json         when (and by whom) a board was deleted, until it's put back
 *   files/<id>/<file>.*              copies of the board's files, so a version's files come back too
 *   server/<day>.tar.gz              people, groups and settings, once a day
 *
 * They're for taking back a mistake, not an archive. A board that changed gets a new version at most
 * every three hours (BRAINCRAFT_BACKUP_EVERY minutes), and always just before it's deleted or put
 * back to an earlier version; only the newest five of a board are kept (BRAINCRAFT_BACKUP_KEEP). A
 * deleted board's versions stay for 90 days, so it can be put back.
 */

import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { RoomData } from '../src/collab/room'
import { folderEntries, tarGz } from './tar'

export const HOUR = 60 * 60_000
export const DAY = 24 * HOUR
/** A changed board gets a new version at most this often (unless asked for one). */
export const BACKUP_EVERY = 3 * HOUR
/** Versions kept of each board: the newest ones. */
export const BACKUP_KEEP = 5
/** How long a deleted board's versions are kept, so it can be put back. */
export const DELETED_KEEP = 90 * DAY
/** Daily copies of people, groups and settings kept. */
export const SERVER_KEEP = 7

export type Reason = 'auto' | 'manual' | 'before-restore' | 'before-delete'

export interface Version {
  /** Sortable and safe as a file name: 20261027-140000-ab12. */
  id: string
  at: number
  reason: Reason
  /** Who asked for it (a version someone made, or the restore or delete that made it). */
  by?: string
  /** What they called it ("Before the reorg"). */
  note?: string
  title: string
  kind?: 'wiki'
  /** Objects on a board, or pages in a wiki. */
  objects: number
  /** The board's own "last changed" when this was taken. */
  updated: number
  hash: string
  bytes: number
  /** The board's files at the time (their ids), copied under files/. */
  files: string[]
}

export interface Deleted {
  id: string
  title: string
  kind?: 'wiki'
  at: number
  by?: string
  owner?: string
  access?: RoomData['access']
}

/** What the server gives this: its boards, however it keeps them. */
export interface BackupHost {
  /** Every board id on disk. */
  ids(): string[]
  /** A board as it is now: the open room's data, or what's on disk. */
  data(id: string): RoomData | null
  /** Whether a board's room is open (only those can have changed since the server started). */
  open(id: string): boolean
  /** The folder with a board's files. */
  filesDir(id: string): string
}

export interface BackupOptions {
  dir: string
  host: BackupHost
  /** The server's data folder: for the daily copy of people and settings, and the full download. */
  data: string
  every?: number
  /** How many versions of each board to keep. */
  keep?: number
  now?: () => number
  log?: (...a: unknown[]) => void
}

const VERSION_ID = /^\d{8}-\d{6}-[a-z0-9]{4}$/
export const isVersionId = (s: string) => VERSION_ID.test(s)
const BOARD_ID = /^[A-Za-z0-9_-]{6,64}$/

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
function stamp(at: number) {
  const d = new Date(at)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

/** Which versions to keep: the newest few, whatever made them. */
export function retained(versions: Version[], keep = BACKUP_KEEP): Set<string> {
  return new Set(
    [...versions]
      .sort((a, z) => z.at - a.at)
      .slice(0, Math.max(1, keep))
      .map((v) => v.id),
  )
}

const countOf = (d: RoomData) => (d.board.kind === 'wiki' ? (d.board.pages?.length ?? 0) : d.board.items.length)
const hashOf = (d: RoomData) => createHash('sha256').update(JSON.stringify(d.board)).digest('hex').slice(0, 32)

function writeAtomic(path: string, data: Buffer | string) {
  writeFileSync(`${path}.tmp`, data)
  renameSync(`${path}.tmp`, path)
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** File names in a folder, or none. */
function list(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** A file id from its stored name (abc.bin, abc.md, abc.type → abc). */
const fileIdOf = (name: string) => name.replace(/\.(bin|md|type)$/, '')

export class Backups {
  readonly dir: string
  private o: BackupOptions
  private every: number
  private keep: number
  private now: () => number
  private log: (...a: unknown[]) => void
  /** The first pass looks at every board; later ones only at boards whose room has been open. */
  private first = true
  private running = false
  lastPass: number | null = null
  lastError: string | null = null

  constructor(o: BackupOptions) {
    this.o = o
    this.dir = resolve(o.dir)
    this.every = o.every ?? BACKUP_EVERY
    this.keep = o.keep ?? BACKUP_KEEP
    this.now = o.now ?? Date.now
    this.log = o.log ?? (() => {})
    mkdirSync(join(this.dir, 'boards'), { recursive: true })
  }

  private boardDir(id: string) {
    return join(this.dir, 'boards', id)
  }

  /** A board's versions, newest first. */
  versions(id: string): Version[] {
    if (!BOARD_ID.test(id)) return []
    return readJson<Version[]>(join(this.boardDir(id), 'index.json'), [])
  }

  private saveIndex(id: string, versions: Version[]) {
    writeAtomic(join(this.boardDir(id), 'index.json'), JSON.stringify(versions))
  }

  /** A version as it was stored, or null. */
  read(id: string, version: string): RoomData | null {
    if (!BOARD_ID.test(id) || !isVersionId(version)) return null
    try {
      return JSON.parse(gunzipSync(readFileSync(join(this.boardDir(id), `${version}.json.gz`))).toString('utf8')) as RoomData
    } catch {
      return null
    }
  }

  /**
   * Saves a version of a board now. One that's the same as the latest isn't saved again (that one
   * comes back instead). Null when the board isn't there.
   */
  snapshot(id: string, reason: Reason, o: { by?: string; note?: string; data?: RoomData | null } = {}): Version | null {
    const data = o.data ?? this.o.host.data(id)
    if (!data || !BOARD_ID.test(id)) return null
    const by = o.by
    const note = o.note?.trim().slice(0, 120)
    const dir = this.boardDir(id)
    mkdirSync(dir, { recursive: true })
    const versions = this.versions(id)
    const files = this.copyFiles(id)
    const hash = hashOf(data)
    if (versions[0]?.hash === hash) {
      // Nothing changed: keep the latest, noting the board's time so it isn't looked at again (and
      // a name, when one is given for it now).
      versions[0] = { ...versions[0], updated: data.updated, files, ...(note && !versions[0].note ? { note, reason, ...(by ? { by } : {}) } : {}) }
      this.saveIndex(id, versions)
      return versions[0]
    }
    const at = this.now()
    const vid = `${stamp(at)}-${randomBytes(3).toString('hex').slice(0, 4)}`
    const bytes = gzipSync(JSON.stringify(data))
    writeAtomic(join(dir, `${vid}.json.gz`), bytes)
    const v: Version = {
      id: vid,
      at,
      reason,
      ...(by ? { by } : {}),
      ...(note ? { note } : {}),
      title: data.board.title,
      ...(data.board.kind === 'wiki' ? { kind: 'wiki' as const } : {}),
      objects: countOf(data),
      updated: data.updated,
      hash,
      bytes: bytes.length,
      files,
    }
    this.saveIndex(id, [v, ...versions])
    return v
  }

  /** Copies the board's files that aren't copied yet (or changed); returns the ids it has. */
  private copyFiles(id: string): string[] {
    const from = this.o.host.filesDir(id)
    const names = list(from).filter((n) => !n.endsWith('.tmp'))
    if (!names.length) return []
    const to = join(this.dir, 'files', id)
    mkdirSync(to, { recursive: true })
    for (const n of names) {
      try {
        const a = statSync(join(from, n))
        let same = false
        try {
          same = statSync(join(to, n)).size === a.size
        } catch {
          same = false
        }
        if (!same) copyFileSync(join(from, n), join(to, n))
      } catch (err) {
        this.log('couldn’t back up a file', id, n, err)
      }
    }
    return [...new Set(names.map(fileIdOf))]
  }

  /** Puts back the files a version had that the board no longer has. */
  restoreFiles(id: string, version: Version) {
    const from = join(this.dir, 'files', id)
    const to = this.o.host.filesDir(id)
    const backed = list(from)
    const have = new Set(list(to))
    for (const n of backed) {
      if (!version.files.includes(fileIdOf(n)) || have.has(n)) continue
      mkdirSync(to, { recursive: true })
      copyFileSync(join(from, n), join(to, n))
    }
  }

  /** Called just before a board is deleted: a last version, and a note so it can be put back. */
  deleting(id: string, by?: string) {
    const data = this.o.host.data(id)
    if (!data) return
    this.snapshot(id, 'before-delete', { by, data })
    const note: Deleted = {
      id,
      title: data.board.title,
      ...(data.board.kind === 'wiki' ? { kind: 'wiki' as const } : {}),
      at: this.now(),
      ...(by ? { by } : {}),
      ...(data.owner ? { owner: data.owner } : {}),
      ...(data.access ? { access: data.access } : {}),
    }
    writeAtomic(join(this.boardDir(id), 'deleted.json'), JSON.stringify(note))
  }

  /** Deleted boards that can still be put back, newest first. */
  deleted(): Deleted[] {
    const out: Deleted[] = []
    for (const id of list(join(this.dir, 'boards'))) {
      const note = readJson<Deleted | null>(join(this.boardDir(id), 'deleted.json'), null)
      if (note) out.push({ ...note, id })
    }
    return out.sort((a, z) => z.at - a.at)
  }

  isDeleted(id: string): boolean {
    return BOARD_ID.test(id) && existsSync(join(this.boardDir(id), 'deleted.json'))
  }

  /** A deleted board as it was last kept, and forgets that it was deleted; null if it can't be. */
  undelete(id: string): { data: RoomData; version: Version } | null {
    if (!this.isDeleted(id)) return null
    for (const v of this.versions(id)) {
      const data = this.read(id, v.id)
      if (!data) continue
      this.restoreFiles(id, v)
      rmSync(join(this.boardDir(id), 'deleted.json'), { force: true })
      return { data, version: v }
    }
    return null
  }

  /** Drops a board's versions past the newest few, and the copies of files none of the kept ones need. */
  private prune(id: string) {
    const versions = this.versions(id)
    const keep = retained(versions, this.keep)
    const kept = versions.filter((v) => keep.has(v.id))
    if (kept.length !== versions.length) {
      for (const v of versions) if (!keep.has(v.id)) rmSync(join(this.boardDir(id), `${v.id}.json.gz`), { force: true })
      this.saveIndex(id, kept)
    }
    const needed = new Set(kept.flatMap((v) => v.files))
    const filesDir = join(this.dir, 'files', id)
    for (const n of list(filesDir)) if (!needed.has(fileIdOf(n))) rmSync(join(filesDir, n), { force: true })
  }

  /**
   * One round: a version of every board that changed since its last one (once it's due), dropping
   * versions past the newest few, forgetting boards deleted long ago, and the daily copy of people and
   * settings. Returns how many versions were saved.
   */
  async pass(): Promise<number> {
    if (this.running) return 0
    this.running = true
    let saved = 0
    try {
      const host = this.o.host
      const now = this.now()
      const ids = host.ids()
      for (const id of this.first ? ids : ids.filter((x) => host.open(x))) {
        try {
          const last = this.versions(id)[0]
          if (last && now - last.at < this.every) continue
          const data = host.data(id)
          if (!data || (last && data.updated <= last.updated)) continue
          const before = last?.id
          if (this.snapshot(id, 'auto', { data })?.id !== before) saved++
        } catch (err) {
          this.log('couldn’t back up board', id, err)
          this.lastError = `${id}: ${(err as Error).message}`
        }
      }
      this.first = false
      const live = new Set(ids)
      for (const id of list(join(this.dir, 'boards'))) {
        try {
          const note = readJson<Deleted | null>(join(this.boardDir(id), 'deleted.json'), null)
          if (note && now - note.at > DELETED_KEEP) {
            rmSync(this.boardDir(id), { recursive: true, force: true })
            rmSync(join(this.dir, 'files', id), { recursive: true, force: true })
            continue
          }
          // A board gone without a note (removed by hand) keeps what it had; it just isn't pruned.
          if (live.has(id) || note) this.prune(id)
        } catch (err) {
          this.log('couldn’t tidy the backups of', id, err)
        }
      }
      await this.daily(now)
      this.lastPass = now
      if (saved) this.log(`backed up ${saved} board${saved === 1 ? '' : 's'}`)
    } catch (err) {
      this.lastError = (err as Error).message
      this.log('backup failed', err)
    } finally {
      this.running = false
    }
    return saved
  }

  /** People, groups, settings and usage: one copy a day, the last week of them kept. */
  private async daily(now: number) {
    const dir = join(this.dir, 'server')
    mkdirSync(dir, { recursive: true })
    const name = `${stamp(now).slice(0, 8)}.tar.gz`
    const path = join(dir, name)
    if (!existsSync(path)) {
      const entries = [...folderEntries(this.o.data, (p) => !(p === 'usage.json' || p === 'accounts' || p.startsWith('accounts/')) || p.endsWith('.tmp'))]
      if (entries.length) {
        await pipeline(tarGz(entries), createWriteStream(`${path}.tmp`))
        renameSync(`${path}.tmp`, path)
      }
    }
    const days = list(dir)
      .filter((n) => /^\d{8}\.tar\.gz$/.test(n))
      .sort()
    for (const n of days.slice(0, Math.max(0, days.length - SERVER_KEEP))) rmSync(join(dir, n), { force: true })
  }

  /** Whether the backups sit inside the data folder (so a lost disk loses both). */
  get insideData(): boolean {
    const r = relative(resolve(this.o.data), this.dir)
    return !r.startsWith('..') && !r.startsWith(sep) && !/^[a-zA-Z]:/.test(r)
  }

  /** How the backups stand, for admins. */
  status() {
    let versions = 0
    let bytes = 0
    let boards = 0
    for (const id of list(join(this.dir, 'boards'))) {
      const vs = this.versions(id)
      if (!vs.length) continue
      boards++
      versions += vs.length
      bytes += vs.reduce((n, v) => n + v.bytes, 0)
    }
    for (const id of list(join(this.dir, 'files')))
      for (const n of list(join(this.dir, 'files', id)))
        try {
          bytes += statSync(join(this.dir, 'files', id, n)).size
        } catch {
          // gone meanwhile
        }
    const days = list(join(this.dir, 'server')).filter((n) => n.endsWith('.tar.gz'))
    for (const n of days)
      try {
        bytes += statSync(join(this.dir, 'server', n)).size
      } catch {
        // gone meanwhile
      }
    return {
      dir: this.dir,
      insideData: this.insideData,
      every: this.every,
      keep: this.keep,
      lastPass: this.lastPass,
      lastError: this.lastError,
      boards,
      versions,
      deleted: this.deleted().length,
      bytes,
      serverCopies: days.length,
    }
  }

  /**
   * Everything the server keeps, as a .tar.gz read as it's sent: boards, their files, people,
   * groups and settings. Half-written files and the backups themselves stay out. (Sessions and API
   * tokens are kept only as hashes, so the archive can't be used to sign in.)
   */
  archive(skipped?: (name: string, why: string) => void) {
    const data = resolve(this.o.data)
    const backups = this.insideData ? relative(data, this.dir).split(sep).join('/') : null
    return tarGz(
      folderEntries(data, (p) => p.endsWith('.tmp') || (!!backups && (p === backups || p.startsWith(`${backups}/`)))),
      skipped,
    )
  }
}
