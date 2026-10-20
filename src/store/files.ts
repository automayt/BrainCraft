/**
 * Where a board's file bytes (and the words read out of them) are kept: on the server of the
 * board's live session, so everyone who can open the board can open its files; or, for a board that
 * isn't shared, in this browser.
 */

import type { KV } from './kv'
import type { LiveInfo } from './library'

export interface FileStore {
  /** Where files go: "server" (everyone with the board) or "browser" (this one only). */
  readonly where: 'server' | 'browser'
  put(id: string, data: Blob, type: string, text: string): Promise<void>
  /** The file, or null when it isn't here. */
  get(id: string): Promise<Blob | null>
  /** Its words as Markdown, or null. */
  text(id: string): Promise<string | null>
  remove(id: string): Promise<void>
}

/** A board's files kept in this browser. */
export function browserFiles(kv: KV, board: string): FileStore {
  const key = (id: string) => `file:${board}:${id}`
  return {
    where: 'browser',
    async put(id, data, type, text) {
      // Kept as bytes (a Blob doesn't survive every store), with its type and words.
      await kv.set(key(id), { type, bytes: new Uint8Array(await data.arrayBuffer()), text })
    },
    async get(id) {
      const v = await kv.get<{ type: string; bytes: Uint8Array }>(key(id))
      return v ? new Blob([v.bytes as BlobPart], { type: v.type }) : null
    },
    async text(id) {
      return (await kv.get<{ text: string }>(key(id)))?.text ?? null
    },
    remove: (id) => kv.delete(key(id)),
  }
}

/** A board's files on the server of its live session (by its key, or by signing in). */
export function serverFiles(live: LiveInfo): FileStore {
  const url = (id: string, part = '') => {
    const u = new URL(`api/boards/${encodeURIComponent(live.id)}/files/${encodeURIComponent(id)}${part}`, live.server.endsWith('/') ? live.server : `${live.server}/`)
    return u.href
  }
  const headers = (more: Record<string, string> = {}): Record<string, string> => ({
    'x-braincraft': '1',
    ...(live.account ? {} : { authorization: `Bearer ${live.key}` }),
    ...more,
  })
  const call = async (u: string, init: RequestInit = {}) => {
    const res = await fetch(u, { ...init, credentials: live.account ? 'include' : 'omit', headers: { ...headers(), ...(init.headers as Record<string, string>) } })
    // Reading something that isn't there is an answer (null); anything else that fails is an error.
    if (!res.ok && !(res.status === 404 && !init.method)) {
      const said = ((await res.json().catch(() => ({}))) as { error?: string }).error
      throw new Error(said ?? `The server said ${res.status}`)
    }
    return res
  }
  return {
    where: 'server',
    async put(id, data, type, text) {
      await call(url(id), { method: 'PUT', body: data, headers: { 'content-type': type || 'application/octet-stream' } })
      if (text) await call(url(id, '/text'), { method: 'PUT', body: text, headers: { 'content-type': 'text/markdown; charset=utf-8' } })
    },
    async get(id) {
      const res = await call(url(id))
      return res.ok ? await res.blob() : null
    },
    async text(id) {
      const res = await call(url(id, '/text'))
      return res.ok ? await res.text() : null
    },
    async remove(id) {
      await call(url(id), { method: 'DELETE' })
    },
  }
}
