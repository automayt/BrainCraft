/**
 * The boards in this browser and the one being edited: switching, autosave, files and share links.
 * The editor only knows about one board; this is everything around it.
 */

import type { AiChange, Editor } from '../editor/Editor'
import { emptyBoard, getItem } from '../model/board'
import { getBody, getPage, pageText } from '../model/wiki'
import { wikiFromTemplate } from '../model/wikiTemplates'
import { GUIDE_TITLE, guideWiki, tourBoard } from './guide'
import { headings, parseMarkdown } from '../model/markdown'
import { type Place, openFromHash, openHash, placeFromParams, placeParams } from './deepLink'
import { fromJson, toJson, welcomeBoard } from '../model/serialize'
import type { Board } from '../model/types'
import { type KV, openKV } from './kv'
import { LiveSession } from '../collab/live'
import { type Patch, diff } from '../collab/patch'
import { colorFor, type LiveLink, liveFromHash, liveHash } from '../collab/protocol'
import { catchUp } from '../model/catchup'
import { type BoardRef, type LinkTarget, objectLabel } from '../model/notes'
import { type BoardMeta, Library, type LiveInfo, type VersionMeta } from './library'
import { type AccountInfo, call, can, fetchAccount, type ServerBoard } from './account'
import { boardRefs, type CrossLink, excerpt, LinkIndex } from './links'
import { decodeBoard, forSharing, sharedFromHash, shareUrl, withoutImages } from './share'

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
const GUEST_KEY = 'braincraft:guest'
const SEEN_DELAY = 1500
const seenKey = (id: string) => `seen:${id}`
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

/** Where a board's AI change history is kept. */
export const aiKey = (id: string) => `ai:${id}`

/** A wiki page as one saved version had it. */
export interface PageVersion {
  v: VersionMeta
  title: string
  text: string
  /** When those words were written, and by whom. */
  at: number
  by?: string
}

export class Workspace {
  readonly editor: Editor
  readonly library: Library
  /** The board being edited, or null while viewing a shared link. */
  boardId: string | null = null
  /** Every board in this browser, newest first (refreshed after changes). */
  boards: BoardMeta[] = []
  /** On a server with accounts: who's signed in (null: no accounts, or no server). */
  account: AccountInfo | null = null
  /** The boards the signed-in person can reach on that server. */
  serverBoards: ServerBoard[] = []
  saveState: SaveState = 'saved'
  /** The file the current board was opened from or saved to, when the browser can write files. */
  fileName: string | null = null

  /** The live session of the open board, when it's shared through a server. */
  live: LiveSession | null = null
  /** A BrainCraft server this app can use for live sessions (found at start), or null. */
  server: string | null = null

  private timer: ReturnType<typeof setTimeout> | undefined
  /** Unsaved work, and which board it belongs to (the open board can change before it's saved). */
  private pending: { id: string; board: Board } | null = null
  /** The save under way, if any. */
  private saving: Promise<void> | undefined
  /** Boards deleted in this tab: nothing saves them back. */
  private removed = new Set<string>()
  private listeners = new Set<() => void>()
  version = 0

  // Other tabs with the same board open stay in step through a BroadcastChannel.
  private channel: BroadcastChannel | null = null
  private tabId = Math.random().toString(36).slice(2)
  /** The board as this tab last told the other tabs (or heard from them). */
  private tabSynced: Board | null = null
  private tabTimer: ReturnType<typeof setTimeout> | undefined
  private savedTitle = ''
  private readonly linkIndex: LinkIndex

  private constructor(editor: Editor, library: Library) {
    this.editor = editor
    this.library = library
    this.linkIndex = new LinkIndex(library)
    editor.onBoardChange = (b) => this.changed(b)
    // Reactions and votes need a name before the person gives one: a stable guest name per browser.
    const storage = safeStorage()
    let guest = storage?.getItem(GUEST_KEY)
    if (!guest) {
      guest = `Guest ${Math.floor(1000 + Math.random() * 9000)}`
      storage?.setItem(GUEST_KEY, guest)
    }
    editor.guestName = guest
    if (!editor.author) editor.author = storage?.getItem(NAME_KEY) ?? storage?.getItem('braincraft:author') ?? ''
    editor.myColor = this.me.color
    // Once the news is read (or dismissed), the board counts as seen.
    editor.onCatchUpDone = () => this.markSeen(true)
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.checkCatchUp()
        else this.markSeen(true)
      })
    editor.onAiHistory = (h) => {
      // The latest 50 AI changes per board, so each can still be undone after a reload.
      if (this.boardId) void this.library.kv.set(aiKey(this.boardId), h.slice(-50))
    }
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
    this.editor.applyRemote(patches, { sharedIds: true })
    this.tabSynced = this.editor.board
  }

  /** Opens the library and loads the right board: a shared link, the last board, or the welcome board. */
  static async start(editor: Editor, kv?: KV, hash = typeof location === 'undefined' ? '' : location.hash): Promise<Workspace> {
    const ws = new Workspace(editor, new Library(kv ?? (await openKV())))
    await ws.recover()
    ws.server = await findServer()
    ws.account = await fetchAccount(ws.server)
    if (ws.account?.user) await ws.signedIn(ws.account)
    if (await ws.openHash(hash)) return ws
    await ws.openLast()
    return ws
  }

  /**
   * Opens what a link's hash points at: a live session (and maybe a page or object in it), a
   * snapshot, or a place on a board in this browser. Returns whether it opened anything.
   */
  async openHash(hash: string): Promise<boolean> {
    const live = liveFromHash(hash)
    if (live) {
      const server = live.server ?? this.server
      if (server) {
        await this.joinLive(live, server)
        // The page shows as soon as the session brings it (until then, the wiki's first page).
        const place = placeFromParams(new URLSearchParams(hash.replace(/^#/, '')))
        if (place.page !== undefined) this.editor.openPage(place.page, place.heading ?? null)
        return true
      }
      this.editor.setStatus('That live link needs its BrainCraft server, which isn’t reachable from here')
    }
    const shared = sharedFromHash(hash)
    if (shared) {
      try {
        this.view(await decodeBoard(shared))
        await this.refresh()
        return true
      } catch {
        this.editor.setStatus('That share link is damaged or incomplete — opening your boards instead')
      }
    }
    const open = openFromHash(hash)
    if (open) {
      if (!this.boards.length) await this.refresh()
      if (!this.findBoard(open.board!)) {
        this.editor.setStatus('That link is to a board that isn’t in this browser. Ask a friend for the live link.')
        return false
      }
      await this.openLink(open)
      this.clearShareHash()
      return true
    }
    return false
  }

  /** A web link to the open board, or a place on it, for anyone who has it in their browser. */
  webLink(place: Place = {}): string | null {
    const key = this.linkKey
    if (!key || typeof location === 'undefined') return null
    const url = new URL(location.href)
    url.hash = openHash(key, place)
    return url.toString()
  }

  /** A web link to a page or object on any board in this browser, for anyone who has that board. */
  linkTo(to: LinkTarget): string | null {
    if (!to.board || typeof location === 'undefined') return null
    const url = new URL(location.href)
    url.hash = openHash(to.board, { page: to.page, heading: to.heading, item: to.item })
    return url.toString()
  }

  /** The live session's view or edit link, opening at a place (a page, a heading, an object). */
  inviteLink(role: 'edit' | 'view', place: Place = {}): string | null {
    const link = this.liveLink(role)
    const rest = placeParams(place)
    return link && rest ? `${link}&${rest}` : link
  }

  /** What a page card shows for a page: where it is, its title and its opening words. */
  async pagePreview(to: { board: string; page: string }): Promise<{ site: string; title: string; description: string } | null> {
    const b = await this.readBoard(to.board)
    const page = b && getPage(b, to.page)
    if (!b || !page) return null
    return { site: `📘 ${b.title || 'Wiki'}`, title: `${page.icon ? `${page.icon} ` : ''}${page.title || 'Untitled'}`, description: excerpt(b, page.id, 160) }
  }

  /** Drops a card for a wiki page on the board, from a pasted page link. */
  async addPageCard(to: LinkTarget, url: string) {
    if (!to.board || to.page === undefined) return
    const page = { board: to.board, page: to.page }
    const preview = await this.pagePreview(page)
    this.editor.addPageCard(page, url, preview ?? { site: '📘 Wiki page', title: 'A page that isn’t in this browser' })
  }

  /** Brings page cards on the open board up to date with their pages (titles and opening words). */
  async refreshPageCards() {
    // In a live session every friend would rewrite the cards from their own copy of the wiki.
    if (this.live) return
    const board = this.boardId
    for (const item of this.editor.board.items) {
      if (!item.page || !item.link) continue
      const preview = await this.pagePreview(item.page)
      // Stop if another board opened meanwhile: ids are only unique within one board.
      if (this.boardId !== board || this.live) return
      const now = getItem(this.editor.board, item.id)
      if (!now?.page || !now.link || now.page !== item.page) continue
      if (preview && (preview.title !== now.link.title || preview.description !== now.link.description || preview.site !== now.link.site)) this.editor.fillLink(item.id, preview)
    }
  }

  /** What to call a link to `to` when it's pasted: the page's or object's name. */
  async labelFor(to: LinkTarget): Promise<string> {
    const b = to.board && !this.selfKeys.includes(to.board) ? await this.readBoard(to.board) : this.editor.board
    const meta = to.board ? this.findBoard(to.board) : undefined
    if (b && to.page !== undefined) {
      const page = getPage(b, to.page)
      const heading = to.heading ? headings(parseMarkdown(pageText(b, to.page))).find((h) => h.slug === to.heading)?.text : undefined
      return `${page?.title || 'Untitled'}${heading ? ` › ${heading}` : ''}`
    }
    if (b && to.item !== undefined) {
      const item = getItem(b, to.item)
      return item ? objectLabel(item) : 'Object'
    }
    return meta?.title ?? b?.title ?? 'Board'
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

  /** Nothing here can be changed: a snapshot link, or a live session joined with the view link. */
  get viewOnly() {
    return this.readOnly || this.liveInfo?.role === 'view'
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
    // A first visit also gets the guide, waiting in Your boards (made first, so the welcome board is the newest).
    if (!legacy) await this.makeGuide().catch(() => undefined)
    const id = await this.library.create(first)
    storage?.removeItem(LEGACY_KEY)
    await this.switchTo(id)
  }

  /** Makes the guide wiki and the tour board it shows pictures of; the guide's id. */
  private async makeGuide(): Promise<string> {
    const tour = tourBoard(this.editor.measure)
    const tourId = await this.library.create(tour.board)
    return this.library.create(guideWiki(tourId, tour, Date.now(), this.editor.me))
  }

  /** Opens the built-in guide, making it (and its tour board) if this browser hasn't got it. */
  async openGuide() {
    await this.flush()
    const have = (await this.library.list()).find((b) => b.kind === 'wiki' && b.title === GUIDE_TITLE)
    const id = have?.id ?? (await this.makeGuide())
    if (!have) this.libraryChanged()
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
    // What you just did on the board you're leaving isn't news when you come back.
    this.markSeen(true)
    const board = await this.library.load(id)
    if (!board) {
      this.editor.setStatus('That board could not be opened')
      return
    }
    const file = await this.handle(id)
    // From here to the load nothing waits: a change in between would be saved to the new board
    // with the old board's content.
    this.closeLive()
    this.boardId = id
    this.editor.readOnly = false
    safeStorage()?.setItem(CURRENT_KEY, id)
    this.fileName = file?.name ?? null
    this.loadQuietly(board)
    // Before the next wait, so an edit made during it still goes to other tabs.
    this.tabSynced = this.editor.board
    this.editor.aiHistory = (await this.library.kv.get<AiChange[]>(aiKey(id))) ?? []
    this.savedTitle = board.title
    // Another tab may have this board open with changes not saved yet.
    this.post({ t: 'want', board: id, from: this.tabId })
    this.saveState = 'saved'
    this.clearShareHash()
    const meta = await this.library.meta(id)
    if (meta?.live) this.connectLive(meta.live)
    else void this.checkCatchUp()
    await this.refresh()
    // Page cards catch up with pages edited since this board was last open.
    if (!this.editor.readOnly) void this.refreshPageCards()
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
    // Signed in to a server with accounts: new boards live there, yours.
    if (this.boardsOnServer) {
      await this.startLive().catch((err: unknown) => this.editor.setStatus(`Couldn’t put the board on the server: ${(err as Error).message}`))
      await this.loadServerBoards()
    }
    return id
  }

  /** Starts a new wiki (pages in a tree) and opens it. */
  newWiki(title?: string, template = 'wiki') {
    return this.newBoard(wikiFromTemplate(template, title))
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
    // Unsaved work on a deleted board goes with it (and never lands on another board).
    this.removed.add(id)
    if (this.pending?.id === id) {
      clearTimeout(this.timer)
      this.pending = null
    }
    // A save already under way finishes first, so it can't write the board back afterwards.
    await this.saving
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
    this.markSeen()
    if (this.readOnly || !this.boardId || this.removed.has(this.boardId)) return
    this.pending = { id: this.boardId, board: b }
    this.saveState = 'unsaved'
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY)
    this.emit()
  }

  /** Writes any unsaved change now. */
  async flush() {
    clearTimeout(this.timer)
    if (!this.pending) return
    const { id, board: b } = this.pending
    this.pending = null
    if (this.removed.has(id)) return
    this.saveState = 'saving'
    try {
      const saving = this.library.save(id, b)
      this.saving = saving.catch(() => {})
      await saving
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
    if (!this.pending) return
    try {
      safeStorage()?.setItem(RESCUE_KEY, JSON.stringify({ id: this.pending.id, json: toJson(this.pending.board) }))
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
    // Saved by hand, so never listed as an autosave.
    await this.library.addVersion(this.boardId, this.editor.board, name.trim() || 'Saved version')
    this.editor.setStatus(name.trim() ? `Saved version “${name.trim()}”` : 'Saved a version')
  }

  /** Puts an old version back as one undoable step. */
  async restoreVersion(v: VersionMeta) {
    if (!this.boardId) return
    const old = await this.library.loadVersion(this.boardId, v.at)
    if (!old) return
    await this.flush()
    // Keep what's being replaced, so restoring is never a one-way door.
    await this.library.addVersion(this.boardId, this.editor.board, `Before restoring ${new Date(v.at).toLocaleString()}`)
    // The page history carries on through a restore (versions don't keep it); a version left
    // without its page is dropped when the wiki is next read.
    const now = this.editor.board.revs
    this.editor.replaceBoard(now ? { ...old, revs: now } : old, `Restored the version from ${new Date(v.at).toLocaleString()} — Ctrl Z to undo`)
    this.editor.savePagesAfterRestore(`The wiki went back to ${new Date(v.at).toLocaleString()}`)
  }

  /**
   * One wiki page through the saved versions, newest first: each time its title or words changed,
   * when and by whom (versions where the page stayed the same are folded into the change before).
   */
  async pageHistory(pageId: string, before = Infinity): Promise<PageVersion[]> {
    if (!this.boardId) return []
    const out: PageVersion[] = []
    for (const v of await this.library.versions(this.boardId)) {
      // Only the ones older than `before` (the page's first saved version), without reading the rest.
      if (v.at >= before) continue
      const b = await this.library.loadVersion(this.boardId, v.at)
      const page = b && getPage(b, pageId)
      if (!b || !page) continue
      const body = getBody(b, pageId)
      const entry: PageVersion = { v, title: page.title, text: body?.text ?? '', at: body?.at ?? v.at, ...(body?.by ? { by: body.by } : {}) }
      const newer = out.at(-1)
      // The same words in an older version: the change happened then, so that's the one to show.
      if (newer && newer.text === entry.text && newer.title === entry.title) out[out.length - 1] = { ...entry, v: newer.v.name ? newer.v : v }
      else out.push(entry)
    }
    return out
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

  // ----- wiki-links ---------------------------------------------------------------

  /** The keys links to the open board may use: its id here and its live-session id. */
  get selfKeys(): string[] {
    const live = this.liveInfo?.id
    return [...(this.boardId ? [this.boardId] : []), ...(live ? [live] : [])]
  }

  /** The other boards in this browser, as [[ links name them. */
  get otherBoards(): BoardRef[] {
    return boardRefs(this.boards.filter((m) => m.id !== this.boardId))
  }

  /** The board in this browser a link key points at. */
  findBoard(key: string): BoardMeta | undefined {
    return this.boards.find((m) => m.id === key || m.live?.id === key)
  }

  /** Follows a link: opens its board when it's another one, then shows its object. */
  async openLink(to: LinkTarget) {
    if (to.board && !this.selfKeys.includes(to.board)) {
      const meta = this.findBoard(to.board)
      if (!meta) {
        this.editor.setStatus('That board isn’t in this browser. Ask a friend for its link.')
        return
      }
      await this.switchTo(meta.id)
    }
    if (to.page !== undefined) {
      const page = getPage(this.editor.board, to.page)
      if (page && !page.trashed) this.editor.openPage(to.page, to.heading ?? null)
      else this.editor.setStatus(page ? 'That page is in the trash' : 'That page was deleted')
      return
    }
    if (to.item === undefined) return
    if (getItem(this.editor.board, to.item)) this.editor.focusObject(to.item)
    else this.editor.setStatus('That object was deleted')
  }

  private readBoards = new Map<string, { updated: number; board: Board }>()

  /**
   * Another board (or wiki) in this browser, by its link key: read once and kept until it changes.
   * For page previews and page cards; the open board is the editor's own.
   */
  async readBoard(key: string): Promise<Board | null> {
    const meta = this.findBoard(key)
    if (!meta) return null
    if (meta.id === this.boardId) return this.editor.board
    const hit = this.readBoards.get(meta.id)
    if (hit && hit.updated === meta.updated) return hit.board
    const board = await this.library.load(meta.id)
    if (board) {
      // A few recent boards, not every one read this session (pictures and all).
      this.readBoards.delete(meta.id)
      this.readBoards.set(meta.id, { updated: meta.updated, board })
      while (this.readBoards.size > 12) this.readBoards.delete(this.readBoards.keys().next().value!)
    }
    return board
  }

  /** The key other boards and links use for the open one (its live id when shared). */
  get linkKey(): string | null {
    return this.liveInfo?.id ?? this.boardId
  }

  /** Comments and descriptions on other boards in this browser that link here. */
  linksHere(): Promise<CrossLink[]> {
    return this.linkIndex.to(this.selfKeys, this.boards, this.boardId)
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
    // Coming back to a live board: what did the others do meanwhile?
    session.onSynced = () => void this.checkCatchUp()
    this.live = session
    this.emit()
  }

  // ----- since you were here ---------------------------------------------------------

  private seenTimer: ReturnType<typeof setTimeout> | undefined

  /** Remembers the board as seen now (soon, or right away). */
  markSeen(now = false) {
    clearTimeout(this.seenTimer)
    const id = this.boardId
    // While there's unread news, keep the old snapshot; nothing counts as seen while hidden.
    if (!id || this.editor.catchUp || (typeof document !== 'undefined' && document.visibilityState === 'hidden' && !now)) return
    const save = () => {
      if (this.boardId === id && !this.editor.catchUp) void this.library.kv.set(seenKey(id), { board: { ...this.editor.board, revs: undefined }, at: Date.now() })
    }
    if (now) save()
    else this.seenTimer = setTimeout(save, SEEN_DELAY)
  }

  /** Compares the board with how this person last saw it, and offers the news. */
  async checkCatchUp() {
    const id = this.boardId
    if (!id || this.editor.catchUp) return
    const seen = await this.library.kv.get<{ board: Board; at: number }>(seenKey(id))
    if (this.boardId !== id) return
    const news = seen ? catchUp(seen.board, this.editor.board, seen.at) : null
    if (news) this.editor.setCatchUp({ ...news, before: seen!.board })
    else this.markSeen(true)
  }

  private closeLive() {
    if (!this.live) return
    this.live.flush()
    this.live.close()
    this.live = null
    this.editor.readOnly = false
  }

  // ----- accounts --------------------------------------------------------------------

  /** Someone signed in (or was already): their name on everything, and the server's boards listed. */
  async signedIn(info: AccountInfo) {
    this.account = info
    if (info.user) {
      this.editor.setAuthor(info.user.name)
      this.live?.setMe(this.me)
    }
    await this.loadServerBoards()
    this.emit()
  }

  async signOut() {
    if (this.server) await call(this.server, 'api/auth/logout', 'POST').catch(() => {})
    this.closeLive()
    this.account = this.account ? { ...this.account, user: null, permissions: [] } : null
    this.serverBoards = []
    this.emit()
  }

  /** The boards the signed-in person can reach on the server. */
  async loadServerBoards() {
    if (!this.server || !this.account?.user) return
    try {
      this.serverBoards = (await call<{ boards: ServerBoard[] }>(this.server, 'api/boards')).boards
    } catch {
      this.serverBoards = []
    }
    this.emit()
  }

  /** Opens a board from the server: this browser keeps a copy and joins it live. */
  async openServerBoard(remote: ServerBoard) {
    if (!this.server) return
    const known = await this.library.findLive(this.server, remote.id)
    let id = known?.id
    if (!id) {
      id = await this.library.create(emptyBoard(remote.title))
      await this.library.setLive(id, { server: this.server, id: remote.id, key: '', role: remote.level === 'view' ? 'view' : 'edit', account: true })
      this.libraryChanged()
    }
    await this.switchTo(id)
  }

  /** Whether new boards go to the server (a server with accounts, and permission to make them). */
  get boardsOnServer() {
    return !!this.account?.user && can(this.account, 'boards.create')
  }

  /** Shares the open board through the server: anyone with the edit or view link joins live. */
  async startLive(server = this.server): Promise<LiveInfo | null> {
    if (!server || !this.boardId) return null
    if (this.liveInfo) return this.liveInfo
    await this.flush()
    // On a server with accounts the board becomes yours there (no keys); otherwise it gets two links.
    const { id, editKey, viewKey } = await call<{ id: string; editKey?: string; viewKey?: string }>(server, 'api/boards', 'POST', { board: this.editor.board }, !!this.account)
    const info: LiveInfo = { server, id, key: editKey ?? '', role: 'edit', ...(viewKey ? { viewKey } : {}), ...(this.account ? { account: true } : {}) }
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
    } else if (known?.live && known.live.key !== link.key && known.live.viewKey !== link.key) {
      const live = known.live
      // Someone who can edit keeps their edit key when they open a view link (it becomes the
      // view link this browser offers); a view-only visitor tries the new key, keeping the old one.
      await this.library.setLive(id, live.role === 'edit' ? { ...live, viewKey: link.key } : { ...live, key: link.key, role: 'edit', viewKey: live.key })
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

  /** A read-only link holding the whole board (as this person sees it: others' hidden brainstorm notes stay blank). */
  async shareLink(opts: { images: boolean }): Promise<string> {
    const view = forSharing(this.editor.viewBoard)
    const b = opts.images ? view : withoutImages(view)
    const base = typeof location === 'undefined' ? 'https://braincraft.invalid/' : location.href
    return shareUrl(b, base)
  }

  private clearShareHash() {
    if (typeof location !== 'undefined' && (sharedFromHash(location.hash) || liveFromHash(location.hash) || openFromHash(location.hash))) {
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
