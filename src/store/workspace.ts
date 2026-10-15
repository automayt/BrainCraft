/**
 * The boards in this browser and the one being edited: switching, autosave, files and share links.
 * The editor only knows about one board; this is everything around it.
 */

import type { Editor } from '../editor/Editor'
import { emptyBoard } from '../model/board'
import { fromJson, toJson, welcomeBoard } from '../model/serialize'
import type { Board } from '../model/types'
import { type KV, openKV } from './kv'
import { LiveSession } from '../collab/live'
import { type Patch, diff } from '../collab/patch'
import { colorFor, type LiveLink, liveFromHash, liveHash } from '../collab/protocol'
import { type BoardMeta, Library, type LiveInfo, type VersionMeta } from './library'
import { decodeBoard, sharedFromHash, shareUrl, withoutImages } from './share'

const CURRENT_KEY = 'braincraft:current'
/** Where boards lived before there was a library. */
const LEGACY_KEY = 'braincraft:board'
/** A copy of unsaved work written synchronously as the page closes, in case IndexedDB didn't finish. */
const RESCUE_KEY = 'braincraft:rescue'
const SAVE_DELAY = 500
const SERVER_KEY = 'braincraft:server'
/** Tabs of this app in the same browser talk on this channel. */
const TAB_CHANNEL = 'braincraft:tabs'
const TAB_DELAY = 30

/** Between tabs: changes to a board, a request for (and answer with) a board's latest state, or "the board list changed". */
type TabMessage =
  | { t: 'patch'; board: string; patches: Patch[]; from: string }
  | { t: 'want'; board: string; from: string }
  | { t: 'state'; board: string; data: Board; from: string; to: string }
  | { t: 'library'; from: string }
const NAME_KEY = 'braincraft:name'
const COLOR_KEY = 'braincraft:color'

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

  /** The live session of the open board, when it's shared through a server. */
  live: LiveSession | null = null
  /** A BrainCraft server this app can use for live sessions (found at start), or null. */
  server: string | null = null

  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Board | null = null
  private listeners = new Set<() => void>()
  version = 0

  // Other tabs with the same board open stay in step through a BroadcastChannel.
  private channel: BroadcastChannel | null = null
  private tabId = Math.random().toString(36).slice(2)
  /** The board as this tab last told the other tabs (or heard from them). */
  private tabSynced: Board | null = null
  private tabTimer: ReturnType<typeof setTimeout> | undefined
  private savedTitle = ''

  private constructor(editor: Editor, library: Library) {
    this.editor = editor
    this.library = library
    editor.onBoardChange = (b) => this.changed(b)
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(TAB_CHANNEL)
      this.channel.onmessage = (e: MessageEvent<TabMessage>) => this.fromTab(e.data)
    }
  }

  // ----- other tabs ----------------------------------------------------------------

  /** Stops listening to other tabs (tests; the app lives as long as its tab). */
  dispose() {
    clearTimeout(this.tabTimer)
    this.channel?.close()
    this.channel = null
  }

  private post(m: TabMessage) {
    this.channel?.postMessage(m)
  }

  /** Tells other tabs the list of boards changed (new, deleted, renamed…). */
  private libraryChanged() {
    this.post({ t: 'library', from: this.tabId })
  }

  /** Sends this tab's changes to the open board to other tabs, soon. Live sessions sync through the server instead. */
  private tabChanged() {
    if (!this.boardId || this.live || this.tabTimer !== undefined) return
    this.tabTimer = setTimeout(() => this.sendToTabs(), TAB_DELAY)
  }

  private sendToTabs() {
    clearTimeout(this.tabTimer)
    this.tabTimer = undefined
    if (!this.boardId || this.live || !this.tabSynced) return
    const patches = diff(this.tabSynced, this.editor.board)
    this.tabSynced = this.editor.board
    if (patches.length) this.post({ t: 'patch', board: this.boardId, patches, from: this.tabId })
  }

  private fromTab(m: TabMessage) {
    if (!m || m.from === this.tabId) return
    if (m.t === 'library') {
      void this.refresh().then(() => {
        // The board open here was deleted in another tab.
        if (this.boardId && !this.boards.some((b) => b.id === this.boardId) && this.boards.length) void this.switchTo(this.boards[0].id)
      })
      return
    }
    if (m.board !== this.boardId || this.live) return
    if (m.t === 'want') {
      this.sendToTabs()
      this.post({ t: 'state', board: m.board, data: this.editor.board, from: this.tabId, to: m.from })
      return
    }
    if (m.t === 'state' && m.to !== this.tabId) return
    // Ours go out first, then theirs are applied on top.
    this.sendToTabs()
    const patches = m.t === 'patch' ? m.patches : diff(this.editor.board, m.data)
    if (!patches.length) return
    this.editor.applyRemote(patches)
    this.tabSynced = this.editor.board
  }

  /** Opens the library and loads the right board: a shared link, the last board, or the welcome board. */
  static async start(editor: Editor, kv?: KV, hash = typeof location === 'undefined' ? '' : location.hash): Promise<Workspace> {
    const ws = new Workspace(editor, new Library(kv ?? (await openKV())))
    await ws.recover()
    ws.server = await findServer()
    const live = liveFromHash(hash)
    if (live) {
      const server = live.server ?? ws.server
      if (server) {
        await ws.joinLive(live, server)
        return ws
      }
      editor.setStatus('That live link needs its BrainCraft server, which isn’t reachable from here')
    }
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
    this.closeLive()
    this.boardId = id
    this.editor.readOnly = false
    safeStorage()?.setItem(CURRENT_KEY, id)
    this.fileName = (await this.handle(id))?.name ?? null
    this.loadQuietly(board)
    this.tabSynced = this.editor.board
    this.savedTitle = board.title
    // Another tab may have this board open with changes not saved yet.
    this.post({ t: 'want', board: id, from: this.tabId })
    this.saveState = 'saved'
    this.clearShareHash()
    const meta = await this.library.meta(id)
    if (meta?.live) this.connectLive(meta.live)
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
    this.closeLive()
    this.tabSynced = null
    this.boardId = null
    this.editor.readOnly = true
    this.loadQuietly(board, 'Viewing a shared board — read-only')
    this.emit()
  }

  async newBoard(board: Board = emptyBoard()) {
    await this.flush()
    const id = await this.library.create(board)
    this.libraryChanged()
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
    this.libraryChanged()
    await this.refresh()
    return copy
  }

  async remove(id: string) {
    await this.library.remove(id)
    this.libraryChanged()
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
    this.live?.localChanged()
    this.tabChanged()
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
      // A renamed board shows its new name in other tabs' board lists.
      if (b.title !== this.savedTitle) {
        this.savedTitle = b.title
        this.libraryChanged()
      }
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

  // ----- live sessions ----------------------------------------------------------

  get liveInfo(): LiveInfo | undefined {
    return this.boards.find((b) => b.id === this.boardId)?.live
  }

  /** Your name and colour as others see them. */
  get me() {
    const storage = safeStorage()
    const name = this.editor.author || storage?.getItem(NAME_KEY) || 'Guest'
    let color = storage?.getItem(COLOR_KEY)
    if (!color) {
      color = colorFor(`${name}${Math.random()}`)
      storage?.setItem(COLOR_KEY, color)
    }
    return { name, color }
  }

  setName(name: string) {
    const n = name.trim().slice(0, 40)
    safeStorage()?.setItem(NAME_KEY, n)
    this.editor.setAuthor(n)
    this.live?.setMe(this.me)
    this.emit()
  }

  private connectLive(info: LiveInfo) {
    // Reassigned below as the server tells us our role.
    // eslint-disable-next-line no-param-reassign
    const session = new LiveSession(this.editor, info.server, { id: info.id, key: info.key }, this.me)
    session.onChange = () => {
      // The server decides the role; remember it so the right links are offered.
      const id = this.boardId
      if (id && session.state === 'live' && info.role !== session.role) {
        info = { ...info, role: session.role }
        void this.library.setLive(id, info).then(() => this.refresh())
      }
      this.emit()
    }
    this.editor.onPointer = (p) => session.pointer(p)
    this.editor.onUserCamera = () => session.following && session.follow(null)
    // Selection and view changes go out with presence.
    const unsubscribe = this.editor.subscribe(() => session.sendPresence())
    const close = session.close.bind(session)
    session.close = () => {
      unsubscribe()
      this.editor.onPointer = null
      this.editor.onUserCamera = null
      close()
    }
    this.live = session
    this.emit()
  }

  private closeLive() {
    if (!this.live) return
    this.live.flush()
    this.live.close()
    this.live = null
    this.editor.readOnly = false
  }

  /** Shares the open board through the server: anyone with the edit or view link joins live. */
  async startLive(server = this.server): Promise<LiveInfo | null> {
    if (!server || !this.boardId) return null
    if (this.liveInfo) return this.liveInfo
    await this.flush()
    const res = await fetch(new URL('api/boards', server.endsWith('/') ? server : `${server}/`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board: this.editor.board }),
    })
    if (!res.ok) throw new Error(`The server said ${res.status}`)
    const { id, editKey, viewKey } = (await res.json()) as { id: string; editKey: string; viewKey: string }
    const info: LiveInfo = { server, id, key: editKey, role: 'edit', viewKey }
    await this.library.setLive(this.boardId, info)
    this.libraryChanged()
    await this.refresh()
    this.connectLive(info)
    return info
  }

  /** Stops sharing from this browser: the board here becomes a normal board again. */
  async leaveLive() {
    if (!this.boardId) return
    this.closeLive()
    await this.library.setLive(this.boardId, undefined)
    await this.refresh()
  }

  /** Opens a live link: the board joins your library (or reopens if you've been here before). */
  async joinLive(link: LiveLink, server: string) {
    const known = await this.library.findLive(server, link.id)
    let id = known?.id
    if (!id) {
      id = await this.library.create(emptyBoard('Shared board'))
      await this.library.setLive(id, { server, id: link.id, key: link.key, role: 'edit' })
    } else if (known?.live?.key !== link.key) {
      await this.library.setLive(id, { ...known!.live!, key: link.key })
    }
    await this.switchTo(id)
  }

  /** A link that joins this board's live session, with edit or view rights. */
  liveLink(role: 'edit' | 'view'): string | null {
    const info = this.liveInfo
    if (!info) return null
    const key = role === 'edit' ? (info.role === 'edit' ? info.key : null) : (info.viewKey ?? (info.role === 'view' ? info.key : null))
    if (!key) return null
    const url = new URL(typeof location === 'undefined' ? 'https://braincraft.invalid/' : location.href)
    const sameOrigin = typeof location !== 'undefined' && info.server.startsWith(location.origin)
    url.hash = liveHash({ id: info.id, key, ...(sameOrigin ? {} : { server: info.server }) })
    return url.toString()
  }

  /** Remembers a server address to use for live sessions (for apps hosted elsewhere). */
  async useServer(address: string): Promise<boolean> {
    const s = address.trim().replace(/\/+$/, '') + '/'
    if (!(await isServer(s))) return false
    safeStorage()?.setItem(SERVER_KEY, s)
    this.server = s
    this.emit()
    return true
  }

  // ----- sharing -----------------------------------------------------------------

  /** A read-only link holding the whole board. */
  async shareLink(opts: { images: boolean }): Promise<string> {
    const b = opts.images ? this.editor.board : withoutImages(this.editor.board)
    const base = typeof location === 'undefined' ? 'https://braincraft.invalid/' : location.href
    return shareUrl(b, base)
  }

  private clearShareHash() {
    if (typeof location !== 'undefined' && (sharedFromHash(location.hash) || liveFromHash(location.hash))) {
      history.replaceState(null, '', location.pathname + location.search)
    }
  }
}

async function isServer(base: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(new URL('api/health', base), { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok && ((await res.json()) as { name?: string }).name === 'braincraft'
  } catch {
    return false
  }
}

/** The server this app came from (when served by the BrainCraft server), or one set by hand. */
async function findServer(): Promise<string | null> {
  if (typeof location === 'undefined' || typeof fetch === 'undefined') return null
  const here = new URL('./', location.href).href
  if (location.protocol.startsWith('http') && (await isServer(here))) return here
  const saved = safeStorage()?.getItem(SERVER_KEY)
  return saved && (await isServer(saved)) ? saved : null
}
