/**
 * A .tar.gz written as it goes, for downloading a whole server's data without holding it in
 * memory. Plain ustar: names up to 255 bytes (split into prefix and name), files up to 8 GB.
 * Anything that tar on Windows, macOS or Linux opens.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Readable } from 'node:stream'
import { createGzip } from 'node:zlib'

export interface TarEntry {
  /** The path inside the archive, with / between folders. */
  name: string
  /** The bytes, or a function that reads them when it's their turn. */
  data: Buffer | (() => Buffer)
  mtime?: number
}

const enc = new TextEncoder()

/** Where a name goes in the header: [prefix, name], or null when it can't fit. */
export function splitName(name: string): [string, string] | null {
  const bytes = enc.encode(name).length
  if (bytes <= 100) return ['', name]
  if (bytes > 255) return null
  // Split at a slash so the prefix is at most 155 bytes and the rest at most 100.
  for (let k = name.indexOf('/'); k > 0; k = name.indexOf('/', k + 1)) {
    const prefix = name.slice(0, k)
    const rest = name.slice(k + 1)
    if (enc.encode(prefix).length <= 155 && enc.encode(rest).length <= 100) return [prefix, rest]
  }
  return null
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0'
}

export function header(name: string, size: number, mtime: number): Buffer {
  const split = splitName(name)
  if (!split) throw new Error(`The name is too long for the archive: ${name}`)
  const h = Buffer.alloc(512)
  h.write(split[1], 0, 100, 'utf8')
  h.write(octal(0o644, 8), 100, 'ascii')
  h.write(octal(0, 8), 108, 'ascii')
  h.write(octal(0, 8), 116, 'ascii')
  h.write(octal(size, 12), 124, 'ascii')
  h.write(octal(Math.floor(mtime / 1000), 12), 136, 'ascii')
  // The checksum counts its own field as spaces.
  h.write('        ', 148, 'ascii')
  h.write('0', 156, 'ascii')
  h.write('ustar\0', 257, 'ascii')
  h.write('00', 263, 'ascii')
  h.write(split[0], 345, 155, 'utf8')
  let sum = 0
  for (const b of h) sum += b
  h.write(octal(sum, 7) + ' ', 148, 'ascii')
  return h
}

function* blocks(entries: Iterable<TarEntry>, skipped: (name: string, why: string) => void): Generator<Buffer> {
  for (const e of entries) {
    let data: Buffer
    try {
      data = typeof e.data === 'function' ? e.data() : e.data
    } catch (err) {
      // A file that went away between listing and reading is left out, not the whole archive.
      skipped(e.name, (err as Error).message)
      continue
    }
    if (!splitName(e.name)) {
      skipped(e.name, 'its name is too long')
      continue
    }
    yield header(e.name, data.length, e.mtime ?? Date.now())
    yield data
    const pad = (512 - (data.length % 512)) % 512
    if (pad) yield Buffer.alloc(pad)
  }
  // Two empty blocks end the archive.
  yield Buffer.alloc(1024)
}

/** The entries as a gzipped tar, read as it's sent. */
export function tarGz(entries: Iterable<TarEntry>, skipped: (name: string, why: string) => void = () => {}): Readable {
  return Readable.from(blocks(entries, skipped)).pipe(createGzip())
}

/**
 * Every file under `root`, as entries named by their path inside it (with /). `skip` leaves out a
 * file or a whole folder (given its path inside root, with /).
 */
export function* folderEntries(root: string, skip: (path: string) => boolean = () => false): Generator<TarEntry> {
  const walk = function* (dir: string): Generator<TarEntry> {
    let names: string[]
    try {
      names = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const n of names) {
      const full = join(dir, n)
      const path = relative(root, full).split(sep).join('/')
      if (skip(path)) continue
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) yield* walk(full)
      else if (st.isFile()) yield { name: path, data: () => readFileSync(full), mtime: st.mtimeMs }
    }
  }
  yield* walk(root)
}
