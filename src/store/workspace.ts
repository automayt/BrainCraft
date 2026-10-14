/**
 * The boards in this browser and the one being edited: switching, autosave, files and share links.
 * The editor only knows about one board; this is everything around it.
 */

import type { Editor } from '../editor/Editor'
import { emptyBoard } from '../model/board'
import { fromJson, toJson, welcomeBoard } from '../model/serialize'
import type { Board } from '../model/types'
import { type KV, openKV } from './kv'
import { type BoardMeta, Library, type VersionMeta } from './library'
import { decodeBoard, sharedFromHash, shareUrl, withoutImages } from './share'

const CURRENT_KEY = 'braincraft:current'
/** Where boards lived before there was a library. */
const LEGACY_KEY = 'braincraft:board'
/** A copy of unsaved work written synchronously as the page closes, in case IndexedDB didn't finish. */
const RESCUE_KEY = 'braincraft:rescue'
const SAVE_DELAY = 500

export const FILE_EXT = '.braincraft'

// The File System Access API (Chromium browsers); elsewhere files are downloaded and uploaded.
interface FileHandle {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>
}
interface PickerOptions {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
  multiple?: boolean
}
type FsWindow = Window & {
  showSaveFilePicker?: (o: PickerOptions) => Promise<FileHandle>
  showOpenFilePicker?: (o: PickerOptions) => Promise<FileHandle[]>
}
const PICKER_TYPES = [{ description: 'BrainCraft board', accept: { 'application/json': [FILE_EXT, '.json'] } }]

const fsWindow = () => (typeof window === 'undefined' ? undefined : (window as FsWindow))

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function fileName(title: string) {
  const base = title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'board'
  return `${base}${FILE_EXT}`
}

const isAbort = (err: unknown) => (err as Error)?.name === 'AbortError'

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

export class Workspace {
  readonly editor: Editor
  readonly library: Library
  /** The board being edited, or null while viewing a shared link. */
  boardId: string | null = null
  /** Every board in this browser, newest first (refreshed after changes). */
  boards: BoardMeta[] = []
  saveState: SaveState = 'saved'
  /** The file the current board was opened from or saved to, when the browser can write files. */
  fileName: string | null = null

  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Board | null = null
  private listeners = new Set<() => void>()
  version = 0

  private constructor(editor: Editor, library: Library) {
    this.editor = editor
    this.library = library
    editor.onBoardChange = (b) => this.changed(b)
  }

  /** Opens the library and loads the right board: a shared link, the last board, or the welcome board. */
  static async start(editor: Editor, kv?: KV, hash = typeof location === 'undefined' ? '' : location.hash): Promise<Workspace> {
    const ws = new Workspace(editor, new Library(kv ?? (await openKV())))
    await ws.recover()
    const shared = sharedFromHash(hash)
    if (shared) {
      try {
        ws.view(await decodeBoard(shared))
        await ws.refresh()
        return ws
      } catch {
        editor.setStatus('That share link is damaged or incomplete — opening your boards instead')
      }
    }
    await ws.openLast()
    return ws
  }

  // ----- change notification (for React's useSyncExternalStore) -------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = () => this.version

  private emit() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  get readOnly() {
    return this.boardId === null
  }

  get persistent() {
    return this.library.kv.persistent
  }

  get canWriteFiles() {
    return !!fsWindow()?.showSaveFilePicker
  }

  // ----- loading -----------------------------------------------------------------

  private async openLast() {
    const storage = safeStorage()
    const last = storage?.getItem(CURRENT_KEY)
    if (last && (await this.library.meta(last))) return this.switchTo(last)
    const boards = await this.library.list()
    if (boards.length) return this.switchTo(boards[0].id)
    // First visit, or a browser that used the single-board version: bring that board over.
    let first = welcomeBoard()
    const legacy = storage?.getItem(LEGACY_KEY)
    if (legacy) {
      try {
        first = fromJson(legacy)
      } catch {
        // Unreadable: start with the welcome board.
      }
    }
    const id = await this.library.create(first)
    storage?.removeItem(LEGACY_KEY)
    await this.switchTo(id)
  }

  /** Writes back unsaved work rescued from the last page close. */
  private async recover() {
    const storage = safeStorage()
    const raw = storage?.getItem(RESCUE_KEY)
    if (!raw) return
    storage?.removeItem(RESCUE_KEY)
    try {
      const { id, json } = JSON.parse(raw) as { id: string; json: string }
      if (await this.library.meta(id)) await this.library.save(id, fromJson(json))
    } catch {
      // Nothing usable to recover.
    }
  }

  async refresh() {
    this.boards = await this.library.list()
    this.emit()
  }

  async switchTo(id: string) {
    await this.flush()
    const board = await this.library.load(id)
    if (!board) {
      this.editor.setStatus('That board could not be opened')
      return
    }
    this.boardId = id
    this.editor.readOnly = false
    safeStorage()?.setItem(CURRENT_KEY, id)
    this.fileName = (await this.handle(id))?.name ?? null
    this.loadQuietly(board)
    this.saveState = 'saved'
    this.clearShareHash()
    await this.refresh()
  }

  /** Loads into the editor without the load itself counting as a change to save. */
  private loadQuietly(board: Board, status = '') {
    const hook = this.editor.onBoardChange
    this.editor.onBoardChange = null
    this.editor.load(board, status)
    this.editor.onBoardChange = hook
  }

  /** Shows a board read-only, outside the library (a shared link). */
  view(board: Board) {
    this.boardId = null
    this.editor.readOnly = true
    this.loadQuietly(board, 'Viewing a shared board — read-only')
    this.emit()
  }

  async newBoard(board: Board = emptyBoard()) {
    await this.flush()
    const id = await this.library.create(board)
    await this.switchTo(id)
    return id
  }

  /** Saves a shared board into this browser's library and opens it for editing. */
  async keepCopy() {
    const b = this.editor.board
    await this.newBoard({ ...b, title: b.title || 'Shared board' })
    this.editor.setStatus('Saved a copy to your boards')
  }

  async duplicate(id: string) {
    await this.flush()
    const copy = await this.library.duplicate(id)
    await this.refresh()
    return copy
  }

  async remove(id: string) {
    await this.library.remove(id)
    if (id === this.boardId) {
      this.boardId = null
      const rest = await this.library.list()
      if (rest.length) await this.switchTo(rest[0].id)
      else await this.newBoard(welcomeBoard())
    } else await this.refresh()
  }

  async rename(id: string, title: string) {
    if (id === this.boardId) this.editor.setTitle(title)
    else {
      await this.library.rename(id, title)
      await this.refresh()
    }
  }

  // ----- autosave ----------------------------------------------------------------

  private changed(b: Board) {
    if (this.readOnly) return
    this.pending = b
    this.saveState = 'unsaved'
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY)
    this.emit()
  }

  /** Writes any unsaved change now. */
  async flush() {
    clearTimeout(this.timer)
    const b = this.pending
    const id = this.boardId
    if (!b || !id) return
    this.pending = null
    this.saveState = 'saving'
    try {
      await this.library.save(id, b)
      this.saveState = this.pending ? 'unsaved' : 'saved'
      this.boards = await this.library.list()
    } catch {
      this.saveState = 'error'
      this.editor.setStatus('Could not save in this browser — save to a file to keep your work')
    }
    this.emit()
  }

  /** Called as the page closes: IndexedDB may not finish, so leave a synchronous copy too. */
  rescue() {
    if (!this.pending || !this.boardId) return
    try {
      safeStorage()?.setItem(RESCUE_KEY, JSON.stringify({ id: this.boardId, json: toJson(this.pending) }))
    } catch {
      // Too big for localStorage; the IndexedDB write may still land.
    }
    void this.flush()
  }

  // ----- versions ----------------------------------------------------------------

  versions(): Promise<VersionMeta[]> {
    return this.boardId ? this.library.versions(this.boardId) : Promise.resolve([])
  }

  async saveVersion(name: string) {
    if (!this.boardId) return
    await this.flush()
    await this.library.addVersion(this.boardId, this.editor.board, name.trim() || undefined)
    this.editor.setStatus(`Saved version “${name.trim() || 'Untitled'}”`)
  }

  /** Puts an old version back as one undoable step. */
  async restoreVersion(v: VersionMeta) {
    if (!this.boardId) return
    const old = await this.library.loadVersion(this.boardId, v.at)
    if (!old) return
    await this.flush()
    // Keep what's being replaced, so restoring is never a one-way door.
    await this.library.addVersion(this.boardId, this.editor.board, `Before restoring ${new Date(v.at).toLocaleString()}`)
    this.editor.replaceBoard(old, `Restored the version from ${new Date(v.at).toLocaleString()} — Ctrl Z to undo`)
  }

  async deleteVersion(v: VersionMeta) {
    if (this.boardId) await this.library.deleteVersion(this.boardId, v.at)
  }

  previewVersion(v: VersionMeta) {
    return this.boardId ? this.library.loadVersion(this.boardId, v.at) : Promise.resolve(null)
  }

  // ----- files -------------------------------------------------------------------

  private async handle(id: string): Promise<FileHandle | null> {
    try {
      return (await this.library.kv.get<FileHandle>(`handle:${id}`)) ?? null
    } catch {
      return null
    }
  }

  private async rememberHandle(id: string, h: FileHandle) {
    try {
      await this.library.kv.set(`handle:${id}`, h)
    } catch {
      // Memory storage can't hold file handles; the file still saves this time.
    }
    if (id === this.boardId) this.fileName = h.name
  }

  /** Saves to the board's file, asking where the first time (or downloads a copy where browsers can't write files). */
  async saveFile(saveAs = false) {
    const b = this.editor.board
    const id = this.boardId
    const picker = fsWindow()?.showSaveFilePicker
    if (!picker) return this.download()
    try {
      let h = !saveAs && id ? await this.handle(id) : null
      if (h?.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await h.requestPermission?.({ mode: 'readwrite' })) !== 'granted') h = null
      }
      h ??= await picker({ suggestedName: fileName(b.title), types: PICKER_TYPES })
      const w = await h.createWritable()
      await w.write(toJson(b))
      await w.close()
      if (id) await this.rememberHandle(id, h)
      this.editor.setStatus(`Saved to ${h.name}`)
      this.emit()
    } catch (err) {
      if (!isAbort(err)) this.editor.setStatus(`Could not save the file: ${(err as Error).message}`)
    }
  }

  download() {
    const b = this.editor.board
    const name = fileName(b.title)
    const url = URL.createObjectURL(new Blob([toJson(b)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    this.editor.setStatus(`Downloaded ${name}`)
  }

  /** Asks for a board file with the system picker; false when the browser has none (use an <input>). */
  async pickFile(): Promise<boolean> {
    const picker = fsWindow()?.showOpenFilePicker
    if (!picker) return false
    try {
      const [h] = await picker({ types: PICKER_TYPES })
      await this.openFile(await h.getFile(), h)
    } catch (err) {
      if (!isAbort(err)) this.editor.setStatus(`Could not open the file: ${(err as Error).message}`)
    }
    return true
  }

  /** Opens a board file as a new board in the library. */
  async openFile(file: File, handle?: FileHandle) {
    try {
      const board = fromJson(await file.text())
      const id = await this.newBoard(board)
      if (handle) await this.rememberHandle(id, handle)
      this.editor.setStatus(`Opened ${file.name}`)
    } catch (err) {
      this.editor.setStatus(`Could not open ${file.name}: ${(err as Error).message}`)
    }
  }

  // ----- sharing -----------------------------------------------------------------

  /** A read-only link holding the whole board. */
  async shareLink(opts: { images: boolean }): Promise<string> {
    const b = opts.images ? this.editor.board : withoutImages(this.editor.board)
    const base = typeof location === 'undefined' ? 'https://braincraft.invalid/' : location.href
    return shareUrl(b, base)
  }

  private clearShareHash() {
    if (typeof location !== 'undefined' && sharedFromHash(location.hash)) {
      history.replaceState(null, '', location.pathname + location.search)
    }
  }
}
