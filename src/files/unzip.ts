/**
 * Reads a .zip file (Word, PowerPoint and Excel files are zips of XML). Compressed entries are
 * inflated by the browser's own DecompressionStream, so BrainCraft needs no zip library.
 */

export interface Unzipped {
  /** Every entry's path, in the order they appear. */
  names: string[]
  /** An entry's bytes, or null when there's no such entry. */
  read(name: string): Promise<Uint8Array | null>
  /** An entry as text (UTF-8), or null. */
  text(name: string): Promise<string | null>
}

/** At most this much unpacked from one entry: a "zip bomb" stops here. */
const MAX_ENTRY = 200 * 1024 * 1024

async function inflate(data: Uint8Array, size: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > Math.max(size, 1) * 2 + 1024 || total > MAX_ENTRY) {
      await reader.cancel()
      throw new Error('An entry in the file unpacks to far more than it says')
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export function unzip(bytes: Uint8Array): Unzipped {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-directory record is in the last 64 KB (after an optional comment).
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('Not a zip file')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries = new Map<string, { method: number; size: number; packed: number; local: number }>()
  const decoder = new TextDecoder()
  for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break
    const method = view.getUint16(at + 10, true)
    const packed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen))
    entries.set(name, { method, size, packed, local })
    at += 46 + nameLen + extraLen + commentLen
  }
  const read = async (name: string) => {
    const e = entries.get(name)
    if (!e || e.local + 30 > bytes.length || view.getUint32(e.local, true) !== 0x04034b50) return null
    const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true)
    const data = bytes.subarray(start, start + e.packed)
    if (e.method === 0) return data
    if (e.method === 8) return inflate(data, e.size)
    throw new Error(`Compression method ${e.method} isn't supported`)
  }
  return {
    names: [...entries.keys()],
    read,
    text: async (name) => {
      const b = await read(name)
      return b ? decoder.decode(b) : null
    },
  }
}
