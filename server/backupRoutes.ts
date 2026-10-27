/**
 * A board's versions over HTTP (see backups.ts):
 *
 *   GET  /api/boards/:id/versions                 its versions, newest first (view)
 *   GET  /api/boards/:id/versions/:version        one of them, with the board as it was (view)
 *   POST /api/boards/:id/versions {note?}         save a version now, named if you like (edit)
 *   POST /api/boards/:id/versions/:version/restore   put the board back to it, for everyone (edit)
 *
 * Putting a board back first saves a version of it as it is, so that can be undone the same way.
 * The caller has already checked that the asker may open the board.
 */

import type { ServerResponse } from 'node:http'
import { OpError } from '../src/api/ops'
import type { Room } from '../src/collab/room'
import { fromJson } from '../src/model/serialize'
import { type Backups, isVersionId, type Version } from './backups'

export interface VersionAsker {
  canEdit: boolean
  /** False keeps a wiki's protected pages as they are (servers with accounts). */
  manages?: boolean
  /** Their name, noted on versions they make. */
  name?: string
  /** Called after a restore, to note it (servers with accounts). */
  restored?: (v: Version, before: Version | null) => void
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** What the app is shown of a version (not its hash or file list). */
export const describeVersion = ({ hash: _hash, files, ...v }: Version) => ({ ...v, files: files.length })

/** Handles /api/boards/:id/versions…; false when it isn't a version route. */
export async function versionRoute(backups: Backups, room: Room, method: string, rest: string[], who: VersionAsker, body: () => Promise<string>, res: ServerResponse): Promise<boolean> {
  if (rest[0] !== 'versions' || rest.length > 3) return false
  const id = room.data.id
  const [, vid, action] = rest

  if (rest.length === 1) {
    if (method === 'GET') return json(res, 200, { versions: backups.versions(id).map(describeVersion) }), true
    if (method !== 'POST') return json(res, 405, { error: 'Method not allowed' }), true
    if (!who.canEdit) return json(res, 403, { error: 'You can only view this board' }), true
    let note: string | undefined
    try {
      const b = JSON.parse((await body()) || '{}') as { note?: unknown }
      note = typeof b.note === 'string' ? b.note : undefined
    } catch {
      return json(res, 400, { error: 'Send {"note": "…"} or nothing' }), true
    }
    const v = backups.snapshot(id, 'manual', { by: who.name, note })
    return json(res, v ? 201 : 404, v ? { version: describeVersion(v) } : { error: 'No such board' }), true
  }

  const version = isVersionId(vid) ? backups.versions(id).find((v) => v.id === vid) : undefined
  if (!version) return json(res, 404, { error: 'No such version (it may have been thinned out)' }), true
  const stored = backups.read(id, version.id)
  if (!stored) return json(res, 404, { error: 'That version can’t be read' }), true
  let board
  try {
    // Checked like any board coming in, in case the backup was touched by hand.
    board = fromJson(JSON.stringify(stored.board))
  } catch (err) {
    return json(res, 422, { error: `That version can’t be read: ${(err as Error).message}` }), true
  }

  if (rest.length === 2) {
    if (method !== 'GET') return json(res, 405, { error: 'Method not allowed' }), true
    return json(res, 200, { version: describeVersion(version), board }), true
  }

  if (action !== 'restore') return json(res, 404, { error: 'Not found' }), true
  if (method !== 'POST') return json(res, 405, { error: 'Method not allowed' }), true
  if (!who.canEdit) return json(res, 403, { error: 'You can only view this board' }), true
  if ((board.kind === 'wiki') !== (room.data.board.kind === 'wiki')) return json(res, 409, { error: 'That version is a different kind of board' }), true
  const before = backups.snapshot(id, 'before-restore', { by: who.name })
  try {
    backups.restoreFiles(id, version)
    room.restore(board, { manages: who.manages })
  } catch (err) {
    return json(res, err instanceof OpError ? 403 : 500, { error: (err as Error).message }), true
  }
  who.restored?.(version, before)
  return json(res, 200, { restored: describeVersion(version), ...(before ? { before: describeVersion(before) } : {}), version: room.data.version }), true
}
