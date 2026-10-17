/**
 * The browser end of the MCP connection. The BrainCraft MCP server runs on the user's machine;
 * this tab listens to it (Server-Sent Events), runs each tool on the live board and posts the answer back.
 * A pairing token from the server is required, so other pages can't drive or read the board.
 */

import { BrainCraftAPI } from './api'
import { boardFromTemplate, TEMPLATES } from '../model/templates'
import type { Workspace } from '../store/workspace'
import { type ToolHost, ToolError, pickBoard, runTool } from './tools'

const STORAGE_KEY = 'braincraft:ai'
export const DEFAULT_PORT = 4319

export interface Pairing {
  port: number
  token: string
}

export type BridgeState = 'off' | 'connecting' | 'connected' | 'lost'

/** Reads `#ai=PORT.TOKEN`, the link the MCP server hands out for pairing. */
export function pairingFromHash(hash: string): Pairing | null {
  const m = /(?:^#|&)ai=(\d{2,5})\.([A-Za-z0-9_-]{16,})/.exec(hash)
  return m ? { port: Number(m[1]), token: m[2] } : null
}

/** Accepts what a person might paste: the whole link, `PORT.TOKEN`, or just the token. */
export function parsePairing(text: string): Pairing | null {
  const t = text.trim()
  const fromLink = pairingFromHash(t.includes('#') ? t.slice(t.indexOf('#')) : `#ai=${t}`)
  if (fromLink) return fromLink
  return /^[A-Za-z0-9_-]{16,}$/.test(t) ? { port: DEFAULT_PORT, token: t } : null
}

function liveHost(ws: Workspace): ToolHost {
  const editor = ws.editor
  const api = new BrainCraftAPI(editor)
  const info = (id: string) => {
    const m = ws.boards.find((b) => b.id === id)
    return { id, title: m?.title ?? editor.board.title, objects: m?.items, current: id === ws.boardId }
  }
  return {
    where: () => (ws.readOnly ? `a read-only shared board "${editor.board.title}"` : `the board "${editor.board.title}" open in the browser`),
    // What this person can see: others' hidden brainstorm notes stay hidden from their browser's AI too.
    board: () => editor.viewBoard,
    apply: (ops) => {
      if (ws.readOnly) throw new ToolError('The browser is showing a read-only shared board. Ask the person to save a copy first, or open another board.')
      const results = api.apply(ops)
      editor.setStatus(`AI assistant: ${ops.length} change${ops.length === 1 ? '' : 's'} — Ctrl Z to undo`)
      return results
    },
    listBoards: async () =>
      ws.boards.map((b) => ({ id: b.id, title: b.title, updated: new Date(b.updated).toISOString(), objects: b.items, current: b.id === ws.boardId })),
    openBoard: async (q) => {
      const b = pickBoard(ws.boards, q)
      await ws.switchTo(b.id)
      return info(b.id)
    },
    createBoard: async (title, template) => {
      const t = TEMPLATES.find((x) => x.id === (template ?? 'blank')) ?? TEMPLATES[0]
      const id = await ws.newBoard({ ...boardFromTemplate(t, editor.measure), title })
      return info(id)
    },
  }
}

export class Bridge {
  state: BridgeState = 'off'
  pairing: Pairing | null = null
  /** Tool calls run so far this session. */
  calls = 0
  onChange: (() => void) | null = null

  private ws: Workspace
  private source: EventSource | null = null

  constructor(ws: Workspace) {
    this.ws = ws
  }

  static stored(): Pairing | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as Pairing) : null
    } catch {
      return null
    }
  }

  private set(state: BridgeState) {
    this.state = state
    this.onChange?.()
  }

  private url(path: string) {
    const p = this.pairing!
    return `http://127.0.0.1:${p.port}${path}?token=${encodeURIComponent(p.token)}`
  }

  connect(pairing: Pairing) {
    this.disconnect(false)
    this.pairing = pairing
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing))
    } catch {
      // Pairing just won't survive a reload.
    }
    this.set('connecting')
    const source = new EventSource(this.url('/events'))
    this.source = source
    source.onopen = () => this.set('connected')
    // EventSource retries by itself; show that the link is down meanwhile.
    source.onerror = () => this.source === source && this.set('lost')
    source.addEventListener('call', (e) => void this.handle((e as MessageEvent<string>).data))
  }

  /** Stops listening; `forget` also drops the saved pairing. */
  disconnect(forget = true) {
    this.source?.close()
    this.source = null
    if (forget) {
      this.pairing = null
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // Nothing saved.
      }
    }
    if (this.state !== 'off') this.set('off')
  }

  private async handle(data: string) {
    let id = ''
    let reply: { id: string; ok: boolean; result?: unknown; error?: string }
    try {
      const call = JSON.parse(data) as { id: string; tool: string; args?: Record<string, unknown> }
      id = call.id
      const result = await runTool(liveHost(this.ws), call.tool, call.args)
      reply = { id, ok: true, result }
    } catch (err) {
      reply = { id, ok: false, error: (err as Error).message }
    }
    this.calls++
    this.onChange?.()
    await fetch(this.url('/result'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reply) }).catch(() => {})
  }
}
