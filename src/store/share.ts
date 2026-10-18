/**
 * Read-only share links: the whole board, compressed, in the URL's #fragment.
 * The fragment never reaches a server, so sharing needs no backend and leaks nothing to one.
 */

import { embedKeys } from '../model/markdown'
import { fromJson } from '../model/serialize'
import type { Board, Item } from '../model/types'

export const SHARE_PARAM = 'view'

function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k)
  return out
}

/** The most a share link may unpack to: a tiny link can't be made to fill the memory. */
const MAX_BOARD_BYTES = 64 * 1024 * 1024

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BOARD_BYTES) {
      void reader.cancel()
      throw new Error('That board is too big to open from a link')
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

/** The board as a compact, URL-safe string. */
export async function encodeBoard(b: Board): Promise<string> {
  // Compact JSON: indentation would only cost bytes.
  const json = JSON.stringify(b)
  return toBase64Url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')))
}

export async function decodeBoard(text: string): Promise<Board> {
  const bytes = await pipe(fromBase64Url(text), new DecompressionStream('deflate-raw'))
  return fromJson(new TextDecoder().decode(bytes))
}

/** A link that opens the board read-only, based on the current page address. */
export async function shareUrl(b: Board, base: string): Promise<string> {
  const url = new URL(base)
  url.hash = `${SHARE_PARAM}=${await encodeBoard(b)}`
  return url.toString()
}

/** The encoded board in a URL hash like `#view=…`, if there is one. */
export function sharedFromHash(hash: string): string | null {
  const m = new RegExp(`^#?${SHARE_PARAM}=([A-Za-z0-9_-]+)$`).exec(hash)
  return m ? m[1] : null
}

/** The board without pictures, for links that would otherwise be huge (a wiki's embed copies too). */
export function withoutImages(b: Board): Board {
  const images = new Set(b.items.filter((i) => i.kind === 'image').map((i) => i.id))
  const pictured = b.snaps?.some((s) => s.items.some((i) => i.src))
  if (!images.size && !pictured) return b
  const plain = (i: Item) => {
    const light = { ...i }
    delete light.src
    return light
  }
  return {
    ...b,
    items: b.items.filter((i) => !images.has(i.id)),
    connectors: b.connectors.filter((c) => !images.has(c.from) && !images.has(c.to)),
    ...(pictured ? { snaps: b.snaps!.map((s) => ({ ...s, items: s.items.map(plain) })) } : {}),
  }
}

/** A wiki as a link carries it: no pages from the trash, and only the embed copies pages use. */
export function forSharing(b: Board): Board {
  if (b.kind !== 'wiki') return b
  const pages = (b.pages ?? []).filter((p) => !p.trashed)
  const kept = new Set(pages.map((p) => p.id))
  const bodies = (b.bodies ?? []).filter((x) => kept.has(x.id))
  const used = new Set(bodies.flatMap((x) => embedKeys(x.text)))
  const snaps = (b.snaps ?? []).filter((s) => used.has(s.key))
  return { ...b, pages, bodies, snaps: snaps.length ? snaps : undefined }
}
