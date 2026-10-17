/**
 * A live session in the browser: keeps the open board in step with the server and everyone on it.
 *
 * Local edits are sent as patches against the last board both sides agreed on. While a patch is
 * on its way, incoming changes to the same objects are ignored: the server applies them in order,
 * so ours (sent later) wins there too and everyone ends up the same. Presence (cursors,
 * selections, what's on screen) is sent a few times a second.
 */

import type { Editor } from '../editor/Editor'
import type { Rect, Vec } from '../model/geom'
import type { Board, Id } from '../model/types'
import { type Patch, applyPatches, diff, keyOf, sameValue, valuesOf } from './patch'
import { cleanConnector, cleanItem } from '../model/sanitize'
import { type ClientMessage, type LiveLink, type PeerInfo, type Presence, type Role, type ServerMessage } from './protocol'

export type LiveState = 'connecting' | 'live' | 'offline' | 'denied'

const SEND_DELAY = 40
/** Patches per message, under the server's limit (a select-all move on a huge board goes in parts). */
const BATCH = 2000
/** And at most this much JSON per message (the server takes 25 MB; pictures make patches big). */
const BATCH_BYTES = 4_000_000
/** A picture longer than this can't be shared live: the server would cut it short (as a file would). */
const MAX_SRC = 16 * 1024 * 1024

/** About how much a patch weighs when sent: pictures by their data, the rest as JSON. */
const weigh = (p: Patch) => (p.k === 'item' && typeof p.v?.src === 'string' && p.v.src.length > 100_000 ? p.v.src.length + 4096 : JSON.stringify(p).length)
const tooBig = (p: Patch) => p.k === 'item' && typeof p.v?.src === 'string' && p.v.src.length > MAX_SRC
const PRESENCE_EVERY = 80
const RETRY = [500, 1000, 2000, 4000, 8000, 15000]

/** The server's WebSocket address for a board. */
export function liveUrl(server: string, link: LiveLink): string {
  const u = new URL(`api/boards/${encodeURIComponent(link.id)}/live`, server.endsWith('/') ? server : `${server}/`)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.searchParams.set('key', link.key)
  return u.toString()
}

export interface Me {
  name: string
  color: string
}

export class LiveSession {
  state: LiveState = 'connecting'
  role: Role = 'view'
  /** Everyone else here, by connection id. */
  peers = new Map<string, PeerInfo>()
  /** Someone whose view this screen follows. */
  following: string | null = null
  onChange: (() => void) | null = null

  readonly link: LiveLink
  readonly server: string
  private editor: Editor
  private me: Me
  private ws: WebSocket | null = null
  /** The board as last agreed with the server (our sent patches included). */
  private synced: Board | null = null
  /** Keys of objects with patches the server hasn't confirmed yet, by message. */
  private pending = new Map<number, Set<string>>()
  /**
   * Those patches themselves, with the board they were made against, kept to send again if the
   * connection drops before the server confirms.
   */
  private inflight = new Map<number, { patches: Patch[]; base: Board }>()
  /** Objects too big to share, kept on this screen only (and put back after a reconnect). */
  private keptHere = new Map<string, Patch>()
  private seq = 0
  private sendTimer: ReturnType<typeof setTimeout> | undefined
  private presenceTimer: ReturnType<typeof setTimeout> | undefined
  private lastPresence = 0
  private retries = 0
  private closed = false
  private cursor: Vec | null = null

  /** Called each time the session has (re)loaded the server's board. */
  onSynced: (() => void) | null = null

  constructor(editor: Editor, server: string, link: LiveLink, me: Me) {
    this.editor = editor
    this.server = server
    this.link = link
    this.me = me
    this.connect()
  }

  private set(state: LiveState) {
    this.state = state
    this.onChange?.()
  }

  private connect() {
    if (this.closed) return
    this.set('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(liveUrl(this.server, this.link))
    } catch {
      return this.retry()
    }
    this.ws = ws
    let opened = false
    ws.onopen = () => {
      opened = true
      this.retries = 0
    }
    ws.onmessage = (e) => {
      try {
        this.receive(JSON.parse(String(e.data)) as ServerMessage)
      } catch {
        // Ignore a garbled message; the next full sync puts things right.
      }
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      if (e?.code === 1009) {
        // A message was too big for the server: sending it again would only loop. Drop what
        // wasn't confirmed; the board reloads as everyone has it.
        this.inflight.clear()
        this.editor.setStatus('Live session: that change was too big to share, so it was undone here')
      }
      this.pending.clear()
      this.peers.clear()
      // Closed before opening: the key was refused (or the server is down; retry either way, slowly).
      if (!opened && this.retries >= 2) this.set('denied')
      else this.set('offline')
      this.retry()
    }
  }

  private retry() {
    if (this.closed) return
    const wait = RETRY[Math.min(this.retries++, RETRY.length - 1)]
    setTimeout(() => this.connect(), wait)
  }

  close() {
    this.closed = true
    clearTimeout(this.sendTimer)
    clearTimeout(this.presenceTimer)
    this.ws?.close()
    this.ws = null
    this.editor.peers = new Map()
    this.editor.sendSignal = null
    this.editor.emit()
  }

  private sendRaw(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }

  // ----- board changes -------------------------------------------------------------------

  private receive(m: ServerMessage) {
    switch (m.t) {
      case 'hello': {
        this.role = m.you.role
        // Work the server may not have (sent but not confirmed, or done while disconnected) is
        // replayed on top of its board; what it already has makes no difference there.
        const sent = [...this.inflight.values()]
        const offline = [...(this.synced ? diff(this.synced, this.editor.board) : []), ...this.keptHere.values()]
        this.inflight.clear()
        this.editor.resetFromRemote(m.board, { readOnly: m.you.role === 'view', idBase: m.you.idBase })
        // A sent change goes again only where the server still has what it was made against (or
        // an earlier change of ours to the same thing): if someone has changed it since, theirs is newer.
        const now = valuesOf(this.editor.board)
        // Objects as the server keeps them (cleaned), so a value nobody changed compares equal.
        const kept = (p: Patch, v: unknown) => (v && p.k === 'item' ? cleanItem(v) : v && p.k === 'conn' ? cleanConnector(v) : v)
        const same = (p: Patch, a: unknown, z: unknown) => sameValue(kept(p, a), kept(p, z))
        const ours = new Map<string, unknown[]>()
        const replay: Patch[] = []
        for (const { patches, base } of sent) {
          const then = valuesOf(base)
          for (const p of patches) {
            const values = ours.get(keyOf(p)) ?? [then(p)]
            if (values.some((v) => same(p, now(p), v))) replay.push(p)
            values.push(p.v)
            ours.set(keyOf(p), values)
          }
        }
        const unsent = [...replay, ...offline]
        this.synced = this.editor.board
        if (unsent.length && this.role === 'edit') {
          this.editor.applyRemote(unsent)
          this.flush()
        }
        this.peers = new Map(m.peers.map((p) => [p.id, p]))
        this.pushPeers()
        // Times come as "time left", so clocks needn't agree.
        this.editor.setTimer(m.timer ? { endsAt: Date.now() + m.timer.remainingMs, totalMs: m.timer.totalMs, by: m.timer.by } : null)
        this.editor.sendSignal = (signal) => {
          if (this.state !== 'live' || this.ws?.readyState !== WebSocket.OPEN) return false
          this.sendRaw({ t: 'signal', signal })
          return true
        }
        this.set('live')
        this.onSynced?.()
        this.sendPresence(true)
        break
      }
      case 'patch': {
        // Ours go first, so anything we've changed is protected below.
        this.flush()
        const busy = new Set<string>()
        for (const keys of this.pending.values()) for (const k of keys) busy.add(k)
        const take = m.patches.filter((p) => !busy.has(keyOf(p)))
        if (take.length) {
          this.editor.applyRemote(take)
          this.synced = applyPatches(this.synced ?? this.editor.board, take)
          // Re-sync to the laid-out board, so layout differences between screens never echo back.
          this.synced = this.editor.board
        }
        break
      }
      case 'ack':
        this.pending.delete(m.seq)
        this.inflight.delete(m.seq)
        break
      case 'presence':
        this.peers.set(m.peer.id, m.peer)
        this.pushPeers()
        if (this.following === m.peer.id && m.peer.view) this.editor.follow(m.peer.view)
        break
      case 'leave':
        this.peers.delete(m.id)
        if (this.following === m.id) this.following = null
        this.pushPeers()
        break
      case 'signal':
        this.editor.receiveSignal(m.from, m.signal)
        break
      case 'timer':
        this.editor.setTimer(m.timer ? { endsAt: Date.now() + m.timer.remainingMs, totalMs: m.timer.totalMs, by: m.timer.by } : null)
        break
      case 'error':
        this.editor.setStatus(`Live session: ${m.message}`)
        if (m.seq !== undefined && this.pending.has(m.seq)) {
          // That change was refused: forget it and reload the board everyone has, so this screen
          // doesn't hold on to it (or ignore others' edits to those objects) from now on.
          this.pending.delete(m.seq)
          this.inflight.delete(m.seq)
          this.ws?.close()
        }
        break
    }
  }

  private pushPeers() {
    this.editor.peers = new Map(this.peers)
    this.editor.emit()
    this.onChange?.()
  }

  /** The board changed here; send the change soon (changes during a drag go out as they happen). */
  localChanged() {
    if (this.role !== 'edit' || this.state !== 'live') return
    if (this.sendTimer === undefined) this.sendTimer = setTimeout(() => this.flush(), SEND_DELAY)
  }

  /** Sends whatever changed here since the last agreed board. */
  flush() {
    clearTimeout(this.sendTimer)
    this.sendTimer = undefined
    if (!this.synced || this.role !== 'edit' || this.ws?.readyState !== WebSocket.OPEN) return
    const patches: Patch[] = diff(this.synced, this.editor.board)
    if (!patches.length) return
    const base = this.synced
    this.synced = this.editor.board
    let part: Patch[] = []
    let bytes = 0
    const send = () => {
      if (!part.length) return
      const seq = ++this.seq
      this.pending.set(seq, new Set(part.map(keyOf)))
      this.inflight.set(seq, { patches: part, base })
      this.sendRaw({ t: 'patch', seq, patches: part })
      part = []
      bytes = 0
    }
    // Big changes go in parts the server accepts, by count and by size.
    for (const p of patches) {
      if (tooBig(p)) {
        if (!this.keptHere.has(keyOf(p))) this.editor.setStatus('Live session: a picture is too big to share live; it stays on this screen only')
        this.keptHere.set(keyOf(p), p)
        continue
      }
      this.keptHere.delete(keyOf(p))
      const size = weigh(p)
      if (part.length >= BATCH || (part.length && bytes + size > BATCH_BYTES)) send()
      part.push(p)
      bytes += size
    }
    send()
  }

  // ----- presence --------------------------------------------------------------------------

  setMe(me: Me) {
    this.me = me
    this.sendPresence(true)
  }

  pointer(world: Vec | null) {
    this.cursor = world
    this.sendPresence()
  }

  /** Sends where we are and what we've selected, at most every PRESENCE_EVERY ms. */
  sendPresence(now = false) {
    if (this.state !== 'live') return
    const wait = PRESENCE_EVERY - (Date.now() - this.lastPresence)
    if (!now && wait > 0) {
      if (this.presenceTimer === undefined)
        this.presenceTimer = setTimeout(() => {
          this.presenceTimer = undefined
          this.sendPresence(true)
        }, wait)
      return
    }
    this.lastPresence = Date.now()
    const view: Rect = this.editor.visibleWorld
    const presence: Presence = { name: this.me.name, color: this.me.color, cursor: this.cursor, selection: [...this.editor.selection] as Id[], view }
    this.sendRaw({ t: 'presence', presence })
  }

  follow(id: string | null) {
    this.following = id
    const view = id ? this.peers.get(id)?.view : null
    if (view) this.editor.follow(view)
    this.onChange?.()
  }
}
