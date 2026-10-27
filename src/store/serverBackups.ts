/**
 * The server's backups of a board (see server/backups.ts): its saved versions, putting one back for
 * everyone, deleted boards to put back, and, for admins, how the backups stand.
 */

import { fromJson } from '../model/serialize'
import type { Board } from '../model/types'
import { call } from './account'
import type { LiveInfo } from './library'

export interface ServerVersion {
  id: string
  at: number
  reason: 'auto' | 'manual' | 'before-restore' | 'before-delete'
  by?: string
  note?: string
  title: string
  kind?: 'wiki'
  /** Objects on a board, or pages in a wiki. */
  objects: number
  bytes: number
  /** How many files it had. */
  files: number
}

export interface DeletedBoard {
  id: string
  title: string
  kind?: 'wiki'
  deleted: number
  by?: string
  owner: { id: string; name: string } | null
}

export interface BackupStatus {
  dir: string
  insideData: boolean
  /** Versions kept of each board. */
  keep: number
  every: number
  lastPass: number | null
  lastError: string | null
  boards: number
  versions: number
  deleted: number
  bytes: number
  serverCopies: number
}

/** A call about a live board: by signing in, or with its key. */
async function boardCall<T>(live: LiveInfo, path: string, method = 'GET', body?: unknown): Promise<T> {
  const where = `api/boards/${encodeURIComponent(live.id)}/${path}`
  if (live.account) return call<T>(live.server, where, method, body)
  let res: Response
  try {
    res = await fetch(new URL(where, live.server.endsWith('/') ? live.server : `${live.server}/`), {
      method,
      credentials: 'omit',
      headers: { authorization: `Bearer ${live.key}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch (err) {
    throw new Error(`Couldn’t reach the server (${(err as Error).message})`)
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `The server said ${res.status}`)
  return data
}

export const serverVersions = async (live: LiveInfo) => (await boardCall<{ versions: ServerVersion[] }>(live, 'versions')).versions

/** A version's board, checked like any board coming in. */
export async function readServerVersion(live: LiveInfo, id: string): Promise<Board> {
  const r = await boardCall<{ board: unknown }>(live, `versions/${encodeURIComponent(id)}`)
  return fromJson(JSON.stringify(r.board))
}

export const saveServerVersion = async (live: LiveInfo, note: string) =>
  (await boardCall<{ version: ServerVersion }>(live, 'versions', 'POST', note.trim() ? { note: note.trim() } : {})).version

export const restoreServerVersion = (live: LiveInfo, id: string) =>
  boardCall<{ restored: ServerVersion; before?: ServerVersion }>(live, `versions/${encodeURIComponent(id)}/restore`, 'POST', {})

export const deletedBoards = async (server: string) => (await call<{ boards: DeletedBoard[] }>(server, 'api/backups/deleted')).boards

export const restoreDeleted = (server: string, id: string) =>
  call<{ id: string; title: string; kind?: 'wiki'; level: 'view' | 'edit' | 'manage' }>(server, `api/backups/deleted/${encodeURIComponent(id)}/restore`, 'POST', {})

export const backupStatus = (server: string) => call<BackupStatus>(server, 'api/admin/backups')
export const backupNow = (server: string) => call<BackupStatus & { saved: number }>(server, 'api/admin/backups', 'POST', {})

/** Why a version was saved, in words. */
export function versionLabel(v: ServerVersion): string {
  if (v.note) return v.note
  switch (v.reason) {
    case 'manual':
      return v.by ? `Saved by ${v.by}` : 'Saved by hand'
    case 'before-restore':
      return v.by ? `Before ${v.by} put back an earlier version` : 'Before an earlier version was put back'
    case 'before-delete':
      return v.by ? `Before ${v.by} deleted it` : 'Before it was deleted'
    default:
      return 'Automatic backup'
  }
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
