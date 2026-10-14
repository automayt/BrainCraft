/**
 * Read-only share links: the whole board, compressed, in the URL's #fragment.
 * The fragment never reaches a server, so sharing needs no backend and leaks nothing to one.
 */

import { fromJson } from '../model/serialize'
import type { Board } from '../model/types'

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

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
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

/** The board without pictures, for links that would otherwise be huge. */
export function withoutImages(b: Board): Board {
  const images = new Set(b.items.filter((i) => i.kind === 'image').map((i) => i.id))
  if (!images.size) return b
  return {
    ...b,
    items: b.items.filter((i) => !images.has(i.id)),
    connectors: b.connectors.filter((c) => !images.has(c.from) && !images.has(c.to)),
  }
}
