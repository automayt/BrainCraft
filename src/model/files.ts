/**
 * Files kept with a board: PDFs, Word documents, slides, spreadsheets, text. The board keeps each
 * file's details (name, type, size, who added it, the page made from it); the bytes and the text
 * read out of them live in the file store beside the board (see `src/store/files.ts`), on the
 * server when the board is shared, else in this browser. A wiki's files are its knowledge base.
 */

import type { Board, BoardFile } from './types'

/** At most this many files on one board. */
export const MAX_FILES = 1000
/** The biggest file one can add (bytes); the server may set its own limit. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024

export const isFileId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(v)

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined)

/** A file's details from anywhere (a board file, a live peer), checked; null when it isn't one. */
export function cleanFile(v: unknown): BoardFile | null {
  if (!isObj(v) || !isFileId(v.id)) return null
  // Control characters (a newline in a name, say) are taken out.
  // eslint-disable-next-line no-control-regex
  const name = str(v.name, 200)?.replace(/[\u0000-\u001f]/g, '').trim()
  if (!name) return null
  const type = typeof v.type === 'string' && /^[\w.+-]{1,60}\/[\w.+-]{1,100}$/.test(v.type) ? v.type : 'application/octet-stream'
  const out: BoardFile = { id: v.id, name, type, size: count(v.size) ?? 0, at: count(v.at) ?? 0 }
  const by = str(v.by, 60)
  if (by) out.by = by
  const chars = count(v.chars)
  if (chars) out.chars = chars
  const pages = count(v.pages)
  if (pages) out.pages = pages
  if (typeof v.page === 'string' && /^[\w-]{1,64}$/.test(v.page)) out.page = v.page
  const excerpt = str(v.excerpt, 400)
  if (excerpt) out.excerpt = excerpt
  if (v.local === true) out.local = true
  const trashed = count(v.trashed)
  if (trashed) out.trashed = trashed
  return out
}

export const getFile = (b: Board, id: string) => b.files?.find((f) => f.id === id)

/** The board's files, newest first (trashed ones only when asked). */
export function filesOf(b: Board, trashed = false): BoardFile[] {
  return (b.files ?? []).filter((f) => !!f.trashed === trashed).sort((a, z) => z.at - a.at)
}

export function addFile(b: Board, f: BoardFile): Board {
  if (getFile(b, f.id) || (b.files?.length ?? 0) >= MAX_FILES) return b
  return { ...b, files: [...(b.files ?? []), f] }
}

export function updateFile(b: Board, id: string, change: (f: BoardFile) => BoardFile): Board {
  if (!getFile(b, id)) return b
  return { ...b, files: b.files!.map((f) => (f.id === id ? change(f) : f)) }
}

/** Moves a file to the trash (or back): its bytes stay until it's deleted for good. */
export const trashFile = (b: Board, id: string, on: boolean, now = Date.now()) =>
  updateFile(b, id, (f) => {
    const next = { ...f }
    if (on) next.trashed = now
    else delete next.trashed
    return next
  })

/** Forgets a file entirely (its bytes are the store's to delete). */
export function removeFile(b: Board, id: string): Board {
  if (!getFile(b, id)) return b
  const files = b.files!.filter((f) => f.id !== id)
  const next: Board = { ...b, files }
  if (!files.length) delete next.files
  return next
}

export type FileKind = 'pdf' | 'word' | 'slides' | 'sheet' | 'markdown' | 'text' | 'web' | 'data' | 'image' | 'other'

const EXT: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'word',
  doc: 'word',
  odt: 'word',
  rtf: 'word',
  pptx: 'slides',
  ppt: 'slides',
  odp: 'slides',
  xlsx: 'sheet',
  xls: 'sheet',
  ods: 'sheet',
  csv: 'sheet',
  tsv: 'sheet',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  html: 'web',
  htm: 'web',
  json: 'data',
  xml: 'data',
  yaml: 'data',
  yml: 'data',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
}

export const extOf = (name: string) => /\.([a-z0-9]{1,10})$/i.exec(name)?.[1].toLowerCase() ?? ''

/** What sort of file it is, from its name (then its type). */
export function kindOf(name: string, type = ''): FileKind {
  const k = EXT[extOf(name)]
  if (k) return k
  if (type === 'application/pdf') return 'pdf'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('text/')) return 'text'
  return 'other'
}

export const FILE_ICON: Record<FileKind, string> = {
  pdf: '📕',
  word: '📘',
  slides: '📙',
  sheet: '📗',
  markdown: '📝',
  text: '📄',
  web: '🌐',
  data: '🧾',
  image: '🖼️',
  other: '📎',
}

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  word: 'Document',
  slides: 'Slides',
  sheet: 'Spreadsheet',
  markdown: 'Markdown',
  text: 'Text',
  web: 'Web page',
  data: 'Data',
  image: 'Picture',
  other: 'File',
}

/** "1.4 MB", "820 KB", "12 bytes". */
export function formatSize(n: number): string {
  if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'bytes'}`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** A title for a file's page: its name without the extension, tidied. */
export function titleOfFile(name: string): string {
  const base = name.replace(/\.[a-z0-9]{1,10}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return base || name
}
