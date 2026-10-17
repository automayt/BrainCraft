/**
 * The editor: board, camera, selection, tools and every gesture, independent of
 * React. The UI forwards pointer and keyboard input in canvas (screen) pixels and
 * re-renders whenever the editor emits.
 */

import * as B from '../model/board'
import { type Camera, between, centerOn, defaultCamera, fit, rectToWorld, toScreen, toWorld, zoomAt } from '../model/camera'
import { type Rect, type Vec, center, dist, intersects, rectFromCenter, rectFromPoints, unionAll } from '../model/geom'
import { History } from '../model/history'
import { type OpResult, applyOps, opsFromText } from '../api/ops'
import * as F from '../model/flowchart'
import * as M from '../model/mindmap'
import * as N from '../model/notes'
import * as K from '../model/kanban'
import { kanbanWidth, newKanban } from '../model/kanban'
import { looksTabular, newTable, tableFromText, tableSize } from '../model/table'
import * as TL from '../model/timeline'
import { insertMermaid, looksLikeMermaid, parseMermaid, toMermaid } from '../model/mermaid'
import { clipFromText, clipToText } from '../model/serialize'
import * as S from '../model/slides'
import * as R from '../model/runbook'
import * as D from '../model/dataset'
import * as RX from '../model/reactions'
import * as CU from '../model/catchup'
import { uid } from '../model/uid'
import { linkItem, urlIn, withPreview } from '../model/linkCard'
import * as ST from '../model/status'
import * as BS from '../model/brainstorm'
import * as WH from '../model/wheel'
import * as FL from '../model/flip'
import { listLines, stickyGrid } from '../model/stickyGrid'
import { type Patch, applyPatches, diff } from '../collab/patch'
import type { PeerInfo, Signal } from '../collab/protocol'
import {
  type Arrowheads,
  type Board,
  type ConnectorStyle,
  type FlowShape,
  type Id,
  type Item,
  type KanbanData,
  type Kind,
  type LinkCard,
  type Status,
  type TableData,
  type TimelineData,
  type Side,
  type Dataset,
  type DataView,
  type DataViewType,
  KIND_LABELS,
  INKS,
  defaultSize,
  flowShapeInfo,
  WIDGET_TITLE_H,
  hasText,
  isResizable,
  isWidget,
} from '../model/types'

export type Tool =
  | 'select'
  | 'hand'
  | 'sticky'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'connector'
  | 'pen'
  | 'frame'
  | 'mind'
  | 'flow'
  | 'comment'
  | 'table'
  | 'kanban'
  | 'timeline'
  | 'data'

export const TOOLS: { tool: Tool; key: string; label: string }[] = [
  { tool: 'select', key: 'v', label: 'Select' },
  { tool: 'hand', key: 'h', label: 'Hand' },
  { tool: 'sticky', key: 'n', label: 'Sticky note' },
  { tool: 'text', key: 't', label: 'Text' },
  { tool: 'rect', key: 'r', label: 'Rectangle' },
  { tool: 'ellipse', key: 'o', label: 'Ellipse' },
  { tool: 'mind', key: 'm', label: 'Mind map' },
  { tool: 'flow', key: 'd', label: 'Flowchart' },
  { tool: 'comment', key: 'c', label: 'Comment' },
  { tool: 'table', key: 'g', label: 'Table' },
  { tool: 'kanban', key: 'k', label: 'Kanban board' },
  { tool: 'timeline', key: 'i', label: 'Timeline' },
  { tool: 'data', key: 'b', label: 'Database' },
  { tool: 'connector', key: 'l', label: 'Connector' },
  { tool: 'pen', key: 'p', label: 'Pen' },
  { tool: 'frame', key: 'f', label: 'Frame' },
]

const CREATES: Partial<Record<Tool, Kind>> = {
  sticky: 'sticky',
  text: 'text',
  rect: 'rect',
  ellipse: 'ellipse',
  frame: 'frame',
  comment: 'comment',
  table: 'table',
  kanban: 'kanban',
  timeline: 'timeline',
  data: 'data',
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

export function cornerOf(r: Rect, c: Corner): Vec {
  return { x: c[1] === 'w' ? r.x : r.x + r.w, y: c[0] === 'n' ? r.y : r.y + r.h }
}

const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }

/** UI handles the canvas can report under the pointer. */
export type Handle =
  | { kind: 'resize'; corner: Corner }
  | { kind: 'connect' }
  | { kind: 'mindAdd'; id: Id; side?: Side }
  | { kind: 'collapse'; id: Id }
  | { kind: 'flowAdd'; dir: F.FlowDir }
  | { kind: 'notes'; id: Id }
  | { kind: 'react'; id: Id; emoji: string }
  | { kind: 'flip'; id: Id }
  | { kind: 'vote'; id: Id; poll: Id; delta: 1 | -1 }

export type Drag =
  | { type: 'none' }
  | { type: 'pan'; last: Vec }
  | {
      type: 'move'
      ids: Set<Id>
      start: Vec
      applied: Vec
      bounds: Rect | null
      snap: Snap
      guides: Guides
      before: Board
      magnet?: F.Magnet | null
      /** Mind-map ideas that move by their offset rather than their position. */
      heads: Set<Id>
    }
  | { type: 'branch'; id: Id; start: Vec; offset: Vec; target: Id | null; before: Board }
  | { type: 'resize'; id: Id; anchor: Vec; before: Board }
  | { type: 'marquee'; start: Vec; current: Vec; base: Set<Id> }
  | { type: 'create'; kind: Kind; start: Vec; current: Vec }
  | { type: 'draw'; points: Vec[] }
  | { type: 'connect'; from: Id; current: Vec; origin: Vec; quick?: F.FlowDir }

/** Alignment lines a moving selection can snap to, in world units. */
interface Snap {
  xs: number[]
  ys: number[]
}

/** The alignment lines currently snapped to, for drawing. */
export interface Guides {
  x?: number
  y?: number
}

export interface Editing {
  /** The item being edited, or the connector when `connector` is set. */
  id: Id
  connector?: boolean
  /** The board before this edit (and before the item was created, for new items). */
  before: Board
  created: boolean
}

export interface Modifiers {
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
}

/** What happened to a key press, so the UI knows whether to `preventDefault`. */
export type KeyResult = boolean | 'save'

export interface Presenting {
  slides: S.Slide[]
  index: number
  /** Showing the whole board instead of a slide. */
  overview: boolean
  laser: boolean
  notes: boolean
  /** Whether the board was read-only before presenting, to put back afterwards. */
  wasReadOnly: boolean
  /** Where the view was, to go back to afterwards. */
  camera: Camera
}

export interface Running {
  /** The flowchart's start shape, where the finished run is recorded. */
  start: Id
  startedAt: number
  /** Steps reached so far; the last is the current one. */
  steps: R.RunStep[]
  wasReadOnly: boolean
}

/** A run that just ended, shown as a summary until dismissed. */
export interface FinishedRun {
  start: Id
  record: R.RunRecord
}

/** An AI change that was applied: kept so it can be undone (or redone) on its own, later. */
/** Keeps new ids clear of any objects or connectors the patches brought in (patches leave nextId alone). */
function withIdsAfter(b: Board, patches: Patch[]): Board {
  let next = b.nextId
  for (const p of patches) if ((p.k === 'item' || p.k === 'conn') && p.v && p.id >= next) next = p.id + 1
  return next === b.nextId ? b : { ...b, nextId: next }
}

export interface AiChange {
  id: string
  at: number
  summary: string
  /** What it changed, and how to take it back. */
  forward: Patch[]
  inverse: Patch[]
  undone: boolean
}

/** Slides can zoom in this far, so small frames fill the screen. */
const SLIDE_MAX_ZOOM = 4
const EMOTE_MS = 2200
const CHAT_MS = 6000
const FLIGHT_MS = 520

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const prefersReducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export class Editor {
  board: Board
  camera: Camera = defaultCamera()
  tool: Tool = 'select'
  selection = new Set<Id>()
  selectedConnector: Id | null = null
  editing: Editing | null = null
  drag: Drag = { type: 'none' }
  viewport = { w: 1200, h: 800 }
  /** Pixels on the right covered by a side panel (comments, assistant); framing keeps clear of them. */
  rightInset = 0
  penColor = INKS[0][1]
  penWidth = 4
  /** The symbol the flowchart tool places. */
  flowShape: FlowShape = 'process'
  /** The flowchart shape panel stays open while building a flowchart, until closed or another tool is picked. */
  flowPalette = false
  /** A shape being dragged out of the panel: where it would land, and what it would snap to. */
  paletteDrag: { shape: FlowShape; at: Vec; magnet: F.Magnet | null } | null = null
  /** The comments (work notes) panel is showing. */
  notesOpen = false
  /** Only objects with this status show at full strength (the status key's filter). */
  statusFilter: Status | null = null
  /** The search / object lookup palette is showing. */
  searchOpen = false
  /** Name stamped on new comments. */
  author = ''
  /** A flowchart line dropped on empty space, waiting for the user to pick the next shape. */
  shapePicker: { from: Id; at: Vec; options: FlowShape[] } | null = null
  spaceDown = false
  /** Last pointer position in world space, for pasting. */
  pointer: Vec | null = null
  status = ''

  readonly history = new History()
  private listeners = new Set<() => void>()
  private hiddenCache: [Board, Set<Id>] | null = null
  version = 0
  /** Called after every change to the board (for autosave). */
  onBoardChange: ((b: Board) => void) | null = null
  /** Shared links and presentations: the board can be looked at, not changed. */
  readOnly = false
  /** Presentation mode: frames shown one at a time, full screen. */
  presenting: Presenting | null = null
  /** An AI proposal shown as a ghost on the board before it's applied. */
  aiPreview: { id: string; patches: Patch[] } | null = null
  /** AI changes applied to this board, newest last. */
  aiHistory: AiChange[] = []
  /** Called when the AI history changes (for saving it). */
  onAiHistory: ((h: AiChange[]) => void) | null = null
  /** Other people in a live session, by connection id. */
  peers = new Map<string, PeerInfo>()

  // ----- live moments: emotes, cursor chat and the shared timer (not part of the board) ----------

  /** Emotes floating up from where they were sent. */
  emotes: { key: number; emoji: string; at: Vec; color: string; t: number }[] = []
  /** The latest line of cursor chat from each person ("me" for mine), shown for a few seconds. */
  chats = new Map<string, { text: string; t: number }>()
  timer: { endsAt: number; totalMs: number; by: string } | null = null
  /** Set by a live session: sends a moment to everyone; false when not connected. */
  sendSignal: ((s: Signal) => boolean) | null = null
  /** Where the emote picker is open (screen position), if it is. */
  emotePicker: Vec | null = null
  /** Typing a line of cursor chat. */
  chatting = false
  myColor = '#7048e8'
  private emoteKey = 0

  /** Sends an emote from the pointer (or the middle of the view). */
  emote(emoji: string, at: Vec = this.pointer ?? center(this.visibleWorld)) {
    this.emotePicker = null
    this.showEmote(emoji, at, this.myColor)
    this.sendSignal?.({ kind: 'emote', emoji, at })
  }

  showEmote(emoji: string, at: Vec, color: string) {
    const e = { key: ++this.emoteKey, emoji, at, color, t: Date.now() }
    this.emotes = [...this.emotes.slice(-30), e]
    setTimeout(() => {
      this.emotes = this.emotes.filter((x) => x !== e)
      this.emit()
    }, EMOTE_MS)
    this.emit()
  }

  openEmotePicker(at: Vec | null = this.pointer ? toScreen(this.camera, this.pointer) : null) {
    this.emotePicker = at ?? { x: this.viewport.w / 2, y: this.viewport.h / 2 }
    this.emit()
  }

  closeEmotePicker() {
    this.emotePicker = null
    this.emit()
  }

  setChatting(on: boolean) {
    this.chatting = on
    this.emit()
  }

  /** Says something next to my cursor, for everyone in the session. */
  say(text: string) {
    this.chatting = false
    const line = text.trim().slice(0, 140)
    if (line) {
      this.showChat('me', line)
      this.sendSignal?.({ kind: 'chat', text: line })
    }
    this.emit()
  }

  showChat(who: string, text: string) {
    const entry = { text, t: Date.now() }
    this.chats = new Map(this.chats).set(who, entry)
    setTimeout(() => {
      if (this.chats.get(who) !== entry) return
      const next = new Map(this.chats)
      next.delete(who)
      this.chats = next
      this.emit()
    }, CHAT_MS)
    this.emit()
  }

  /** Starts (or with null, stops) the timer; in a live session everyone sees the same one. */
  startTimer(seconds: number | null) {
    if (this.sendSignal?.({ kind: 'timer', seconds })) return
    this.setTimer(seconds ? { endsAt: Date.now() + seconds * 1000, totalMs: seconds * 1000, by: this.me } : null)
  }

  setTimer(t: { endsAt: number; totalMs: number; by: string } | null) {
    this.timer = t
    this.emit()
  }

  /** A moment someone else sent. */
  receiveSignal(from: string, s: Signal) {
    if (s.kind === 'emote') this.showEmote(s.emoji, s.at, this.peers.get(from)?.color ?? '#7048e8')
    else if (s.kind === 'chat') this.showChat(from, s.text)
  }
  /** Pointer moves (for showing your cursor to others); null when it leaves the board. */
  onPointer: ((world: Vec | null) => void) | null = null
  /** The person moved the camera themselves (stops following someone). */
  onUserCamera: (() => void) | null = null
  /** Runbook mode: walking a flowchart step by step. */
  running: Running | null = null
  finishedRun: FinishedRun | null = null
  private flight = 0

  readonly measure: M.Measure

  constructor(board: Board, measure: M.Measure) {
    this.measure = measure
    this.board = M.layoutAll(board, measure)
  }

  // ----- plumbing ----------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = () => this.version

  emit() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  get hidden(): Set<Id> {
    if (this.hiddenCache?.[0] !== this.board) this.hiddenCache = [this.board, B.hiddenIds(this.board)]
    return this.hiddenCache[1]
  }

  /** Replaces the board, re-running the mind-map layout. Does not record history. */
  private apply(b: Board) {
    if (this.readOnly) return
    // During a private brainstorm, notes written here are marked as this person's.
    const next = M.layoutAll(BS.stampNew(this.board, b, this.me), this.measure)
    if (next === this.board) return
    this.board = next
    this.onBoardChange?.(next)
  }

  private commit(before: Board) {
    this.history.commit(before, this.board)
  }

  /** Runs `f` as one undoable step. */
  edit(f: (b: Board) => Board) {
    this.finishEditing()
    const before = this.board
    this.apply(f(this.board))
    this.commit(before)
    this.emit()
  }

  /** Swaps in a whole new board (e.g. an old version) as one undoable step. */
  replaceBoard(board: Board, status = '') {
    this.selection.clear()
    this.selectedConnector = null
    this.edit(() => board)
    this.setStatus(status)
  }

  load(board: Board, status = '') {
    this.board = M.layoutAll(board, this.measure)
    this.selection.clear()
    this.selectedConnector = null
    this.editing = null
    this.drag = { type: 'none' }
    this.history.clear()
    // AI changes and catch-up news belong to the board they were made on.
    this.aiPreview = null
    this.aiHistory = []
    this.catchUp = null
    this.showingCatchUp = false
    this.status = status
    this.zoomToFit()
    this.onBoardChange?.(this.board)
    this.emit()
  }

  /** Measures text again (e.g. once web fonts load) and re-lays out mind maps. */
  relayout() {
    this.measureCache?.()
    const next = M.layoutAll({ ...this.board, items: this.board.items.map((i) => (i.kind === 'mind' ? { ...i, w: 0 } : i)) }, this.measure)
    this.board = next
    this.emit()
  }

  /** Clears the text measurement cache, if the measure function has one. */
  measureCache: (() => void) | null = null

  setStatus(status: string) {
    this.status = status
    this.emit()
  }

  setViewport(w: number, h: number) {
    this.viewport = { w, h }
    if (this.presenting) this.showSlide(false)
    else this.emit()
  }

  setTool(tool: Tool) {
    if (this.readOnly && tool !== 'select' && tool !== 'hand') return
    this.finishEditing()
    if (tool === 'flow') this.flowPalette = true
    else if (tool !== 'select' && tool !== 'hand') this.flowPalette = false
    this.tool = tool
    this.emit()
  }

  setTitle(title: string) {
    this.edit((b) => (b.title === title ? b : { ...b, title }))
  }

  /** Sets the board's emoji (null takes it off). */
  setBoardIcon(icon: string | null) {
    this.edit((b) => {
      if ((b.icon ?? null) === icon) return b
      const next: Board = { ...b }
      if (icon) next.icon = icon
      else delete next.icon
      return next
    })
  }

  select(ids: Iterable<Id>) {
    this.selection = new Set(ids)
    this.selectedConnector = null
    this.emit()
  }

  get selectedItems(): Item[] {
    return this.board.items.filter((i) => this.selection.has(i.id))
  }

  /** The one selected item, if exactly one is selected. */
  get single(): Item | undefined {
    if (this.selection.size !== 1) return undefined
    return B.getItem(this.board, [...this.selection][0])
  }

  // ----- history -----------------------------------------------------------------

  undo() {
    this.finishEditing()
    const step = this.history.undo()
    if (step) this.afterJump(this.board === step.after ? step.before : this.rebase(step.after, step.before))
  }

  redo() {
    this.finishEditing()
    const step = this.history.redo()
    if (step) this.afterJump(this.board === step.before ? step.after : this.rebase(step.before, step.after))
  }

  pointerLeave() {
    this.onPointer?.(null)
  }

  // ----- live sessions ---------------------------------------------------------------

  /** Applies changes that came from someone else: not undoable here, and allowed even when read-only. */
  applyRemote(patches: Patch[], opts: { sharedIds?: boolean } = {}) {
    if (!patches.length) return
    // Tabs of one browser share the id sequence (live sessions hand each person their own range).
    const patched = applyPatches(this.board, patches)
    const next = M.layoutAll(opts.sharedIds ? withIdsAfter(patched, patches) : patched, this.measure)
    this.board = next
    this.selection = new Set([...this.selection].filter((id) => B.getItem(next, id)))
    if (this.selectedConnector !== null && !B.getConnector(next, this.selectedConnector)) this.selectedConnector = null
    if (this.editing && !(this.editing.connector ? B.getConnector(next, this.editing.id) : B.getItem(next, this.editing.id))) this.editing = null
    this.onBoardChange?.(next)
    this.emit()
  }

  /**
   * Takes the server's board on joining (or rejoining) a live session. New ids come from this
   * connection's own block; the camera stays put unless this is the first look at the board.
   */
  resetFromRemote(board: Board, opts: { readOnly: boolean; idBase: number }) {
    const first = !this.board.items.length
    const next = M.layoutAll(board, this.measure)
    this.board = opts.idBase > 0 ? { ...next, nextId: opts.idBase } : next
    this.readOnly = opts.readOnly
    this.selection = new Set([...this.selection].filter((id) => B.getItem(this.board, id)))
    this.editing = null
    this.onBoardChange?.(this.board)
    if (first) this.zoomToFit()
    else this.emit()
  }

  /** Shows the same part of the board as someone being followed. */
  follow(view: Rect) {
    this.flight++
    this.camera = fit(view, this.viewport, 0, 8)
    this.emit()
  }

  // ----- AI changes ------------------------------------------------------------------

  /** The part of the canvas not under a side panel. */
  get openView() {
    return { w: Math.max(200, this.viewport.w - this.rightInset), h: this.viewport.h }
  }

  /** Shows a proposal as a preview, bringing it into view when it's off screen; `null` clears it. */
  previewAi(p: { id: string; patches: Patch[] } | null) {
    if (this.aiPreview?.id === p?.id) return
    this.aiPreview = p
    if (p) {
      const ghost = applyPatches(this.board, p.patches)
      const box = unionAll(p.patches.flatMap((x) => (x.k === 'item' ? [B.getItem(ghost, x.id) ?? B.getItem(this.board, x.id)].filter((i) => !!i).map(B.itemBounds) : [])))
      const seen = rectToWorld(this.camera, { x: 0, y: 0, ...this.openView })
      if (box && !(box.x >= seen.x && box.y >= seen.y && box.x + box.w <= seen.x + seen.w && box.y + box.h <= seen.y + seen.h)) {
        const all = unionAll([box, ...p.patches.flatMap((x) => (x.k === 'item' && B.getItem(this.board, x.id) ? [B.itemBounds(B.getItem(this.board, x.id)!)] : []))])!
        this.flyTo(fit(all, this.openView, 100, this.camera.zoom))
      }
    }
    this.emit()
  }

  /**
   * Applies an AI proposal as one undoable step and records it in the AI history.
   * The patches were made against the board when proposed; edits since then are kept.
   */
  applyAi(id: string, summary: string, patches: Patch[]): boolean {
    if (this.readOnly) return false
    const before = this.board
    this.finishEditing()
    this.aiPreview = null
    this.edit((b) => withIdsAfter(applyPatches(b, patches), patches))
    if (this.board === before) return false
    const change: AiChange = { id, at: Date.now(), summary, forward: diff(before, this.board), inverse: diff(this.board, before), undone: false }
    this.aiHistory = [...this.aiHistory, change]
    this.onAiHistory?.(this.aiHistory)
    // Show what arrived.
    const added = change.forward.flatMap((p) => (p.k === 'item' && p.v ? [p.id] : []))
    if (added.length) {
      this.selection = new Set(added.filter((x) => B.getItem(this.board, x)))
      const box = B.bounds(this.board, this.selection)
      if (box) this.flyTo(fit(box, this.openView, 120))
    }
    this.emit()
    return true
  }

  /** Takes back (or puts back) one AI change, whatever happened since; itself undoable. */
  toggleAiChange(id: string) {
    const c = this.aiHistory.find((x) => x.id === id)
    if (!c || this.readOnly) return
    const patches = c.undone ? c.forward : c.inverse
    this.edit((b) => withIdsAfter(applyPatches(b, patches), patches))
    this.aiHistory = this.aiHistory.map((x) => (x.id === id ? { ...x, undone: !x.undone } : x))
    this.onAiHistory?.(this.aiHistory)
    this.setStatus(c.undone ? `Redid: ${c.summary}` : `Undid: ${c.summary}`)
  }

  /** Applies just the change from `from` to `to` onto the current board (others' edits since stay). */
  private rebase(from: Board, to: Board): Board {
    return M.layoutAll(applyPatches(this.board, diff(from, to)), this.measure)
  }

  private afterJump(b: Board) {
    if (this.readOnly) return
    this.board = b
    this.onBoardChange?.(b)
    this.selection = new Set([...this.selection].filter((id) => B.getItem(b, id)))
    if (this.selectedConnector !== null && !B.getConnector(b, this.selectedConnector)) this.selectedConnector = null
    this.emit()
  }

  // ----- camera ------------------------------------------------------------------

  zoomBy(factor: number, anchor: Vec = { x: this.viewport.w / 2, y: this.viewport.h / 2 }) {
    this.flight++
    this.onUserCamera?.()
    this.camera = zoomAt(this.camera, anchor, factor)
    this.emit()
  }

  setZoom(zoom: number) {
    this.zoomBy(zoom / this.camera.zoom)
  }

  pan(dx: number, dy: number) {
    this.flight++
    this.onUserCamera?.()
    this.camera = { ...this.camera, x: this.camera.x + dx, y: this.camera.y + dy }
    this.emit()
  }

  centerOn(world: Vec) {
    this.camera = centerOn(this.camera, world, this.viewport)
    this.emit()
  }

  /** Moves the camera smoothly to `target` (instantly when motion is reduced or there's no animation frame). */
  flyTo(target: Camera, ms = FLIGHT_MS) {
    const id = ++this.flight
    const raf = globalThis.requestAnimationFrame
    if (!raf || prefersReducedMotion() || ms <= 0) {
      this.camera = target
      this.emit()
      return
    }
    const from = this.camera
    const start = performance.now()
    const step = (now: number) => {
      if (id !== this.flight) return
      const t = Math.min(1, (now - start) / ms)
      this.camera = t === 1 ? target : between(from, target, easeInOut(t), this.viewport)
      this.emit()
      if (t < 1) raf(step)
    }
    raf(step)
  }

  // ----- runbook mode -------------------------------------------------------------

  /** Starts walking the flowchart containing `id` (default: the selection) from its start, or from `id` itself. */
  startRun(id: Id | undefined = this.single?.id, fromHere = false): boolean {
    const item = id !== undefined ? B.getItem(this.board, id) : undefined
    if (item?.kind !== 'flow') {
      this.setStatus('Select a flowchart shape to run its flowchart')
      return false
    }
    const start = R.runStart(this.board, item.id)
    if (start === null) return false
    const first = fromHere ? item.id : start
    this.finishEditing()
    this.notesOpen = false
    this.searchOpen = false
    this.shapePicker = null
    this.finishedRun = null
    const now = Date.now()
    this.running = { start, startedAt: now, steps: [{ node: first, text: this.stepText(first), at: now }], wasReadOnly: this.readOnly }
    // Shapes can't change under a run in progress.
    this.readOnly = true
    this.selection = new Set()
    this.selectedConnector = null
    this.followRun()
    return true
  }

  private stepText(id: Id): string {
    const i = B.getItem(this.board, id)
    return i?.text.trim() || flowShapeInfo(i?.shape).label
  }

  get runStep(): Id | null {
    return this.running?.steps.at(-1)?.node ?? null
  }

  get runOptions(): R.RunOption[] {
    const at = this.runStep
    return at === null ? [] : R.options(this.board, at)
  }

  /** Keeps the current step in view, left of the run panel. */
  private followRun() {
    const at = this.runStep
    const item = at !== null ? B.getItem(this.board, at) : undefined
    if (!item) return this.emit()
    const zoom = Math.max(0.75, Math.min(1.25, this.camera.zoom))
    const panel = this.viewport.w > 900 ? 200 : 0
    const c = center(item)
    this.flyTo({ zoom, x: (this.viewport.w - panel) / 2 - c.x * zoom, y: this.viewport.h / 2 - c.y * zoom })
  }

  /** Takes option `n` (0-based) out of the current step; with one way out, `n` can be left out. */
  runChoose(n?: number) {
    const r = this.running
    const opts = this.runOptions
    const pick = n ?? (opts.length === 1 ? 0 : -1)
    const opt = opts[pick]
    if (!r || !opt) return
    const steps = r.steps.slice()
    steps[steps.length - 1] = { ...steps[steps.length - 1], choice: opt.labelled ? opt.label : undefined }
    steps.push({ node: opt.to.id, text: this.stepText(opt.to.id), at: Date.now() })
    this.running = { ...r, steps }
    this.followRun()
  }

  /** Goes back a step (its time and note are dropped). */
  runBack() {
    const r = this.running
    if (!r || r.steps.length < 2) return
    const steps = r.steps.slice(0, -1)
    const last = { ...steps[steps.length - 1] }
    delete last.choice
    steps[steps.length - 1] = last
    this.running = { ...r, steps }
    this.followRun()
  }

  setRunNote(note: string) {
    const r = this.running
    if (!r) return
    const steps = r.steps.slice()
    const last = steps[steps.length - 1]
    const next: R.RunStep = { ...last, note }
    if (!note.trim()) delete next.note
    steps[steps.length - 1] = next
    this.running = { ...r, steps }
    this.emit()
  }

  /**
   * Ends the run. Finished runs, and stopped runs that got past the first step, are recorded
   * on the flowchart (one undoable change) and summarised until `dismissRun`.
   */
  endRun(status: R.RunRecord['status']) {
    const r = this.running
    if (!r) return
    this.running = null
    this.readOnly = r.wasReadOnly
    const steps = r.steps.map((s) => (s.note ? { ...s, note: s.note.trim() } : s))
    if (status === 'stopped' && steps.length < 2) return this.emit()
    const record = R.newRun(steps, status, r.startedAt, Date.now(), this.author || undefined)
    if (!this.readOnly) this.edit((b) => R.recordRun(b, r.start, record))
    this.finishedRun = { start: r.start, record }
    this.emit()
  }

  dismissRun() {
    this.finishedRun = null
    this.emit()
  }

  deleteRun(start: Id, runId: string) {
    this.edit((b) => R.deleteRun(b, start, runId))
  }

  /** Keys while running; true when handled. */
  runKey(key: string): boolean {
    if (!this.running) return false
    const n = Number(key)
    if (key === 'Enter' || key === 'ArrowRight' || key === ' ') {
      if (this.runOptions.length === 0) this.endRun('done')
      else this.runChoose()
      return true
    }
    if (n >= 1 && n <= 9) {
      this.runChoose(n - 1)
      return true
    }
    if (key === 'Backspace' || key === 'ArrowLeft') {
      this.runBack()
      return true
    }
    if (key === 'Escape') {
      this.endRun('stopped')
      return true
    }
    return false
  }

  // ----- presenting --------------------------------------------------------------

  /** Starts presenting from the selected frame (or the first); false when there's nothing to show. */
  startPresenting(): boolean {
    const slides = S.slides(this.board)
    if (!slides.length) {
      this.setStatus('Nothing to present yet — add a frame (F) around each slide')
      return false
    }
    const index = S.startSlide(this.board, slides, this.selection)
    this.finishEditing()
    this.shapePicker = null
    this.searchOpen = false
    this.selection = new Set()
    this.selectedConnector = null
    this.tool = 'select'
    this.presenting = { slides, index, overview: false, laser: false, notes: false, wasReadOnly: this.readOnly, camera: this.camera }
    this.readOnly = true
    this.showSlide(false)
    return true
  }

  stopPresenting() {
    const p = this.presenting
    if (!p) return
    this.presenting = null
    this.readOnly = p.wasReadOnly
    // Back to where the board was before presenting.
    this.flyTo(p.camera)
  }

  private slideCamera(): Camera | null {
    const p = this.presenting
    if (!p) return null
    const r = p.overview ? B.bounds(this.board) : p.slides[p.index]?.rect
    return r ? fit(r, this.viewport, p.overview ? 60 : Math.min(72, this.viewport.w * 0.05), SLIDE_MAX_ZOOM) : null
  }

  /** Frames the current slide; called again when the window changes size. */
  showSlide(animate = true) {
    const cam = this.slideCamera()
    if (!cam) return
    if (animate) this.flyTo(cam)
    else {
      this.flight++
      this.camera = cam
      this.emit()
    }
  }

  goToSlide(index: number) {
    const p = this.presenting
    if (!p) return
    const next = Math.max(0, Math.min(p.slides.length - 1, index))
    if (next === p.index && !p.overview) return
    this.presenting = { ...p, index: next, overview: false }
    this.showSlide()
  }

  /** Toggles a presentation option: the whole-board overview, the laser pointer or speaker notes. */
  togglePresenting(what: 'overview' | 'laser' | 'notes') {
    const p = this.presenting
    if (!p) return
    this.presenting = { ...p, [what]: !p[what] }
    if (what === 'overview') this.showSlide()
    else this.emit()
  }

  /** Keys while presenting; true when handled. */
  presentKey(key: string): boolean {
    const p = this.presenting
    if (!p) return false
    switch (key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
      case 'Enter':
        this.goToSlide(p.overview ? p.index : p.index + 1)
        return true
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
      case 'Backspace':
        this.goToSlide(p.index - 1)
        return true
      case 'Home':
        this.goToSlide(0)
        return true
      case 'End':
        this.goToSlide(p.slides.length - 1)
        return true
      case 'Escape':
        this.stopPresenting()
        return true
      case 'o':
      case 'O':
        this.togglePresenting('overview')
        return true
      case 'l':
      case 'L':
        this.togglePresenting('laser')
        return true
      case 'n':
      case 'N':
        this.togglePresenting('notes')
        return true
    }
    // Number keys jump to that slide.
    const n = Number(key)
    if (n >= 1 && n <= 9 && n <= p.slides.length) {
      this.goToSlide(n - 1)
      return true
    }
    return false
  }

  zoomToFit() {
    const phone = this.viewport.w <= 720
    let target = B.bounds(this.board, this.selection.size ? this.selection : undefined)
    // On a phone a whole board is often unreadably small: start at its first frame instead.
    if (phone && target && !this.selection.size && fit(target, this.viewport, 24).zoom < 0.3) {
      const frames = this.board.items.filter((i) => i.kind === 'frame').sort((a, z) => a.y - z.y || a.x - z.x)
      if (frames.length) target = B.itemBounds(frames[0])
    }
    this.camera = target ? fit(target, this.viewport, phone ? 24 : 96) : defaultCamera()
    this.emit()
  }

  get visibleWorld(): Rect {
    return rectToWorld(this.camera, { x: 0, y: 0, w: this.viewport.w, h: this.viewport.h })
  }

  // ----- text editing ------------------------------------------------------------

  startEditing(id: Id, opts: { before?: Board; created?: boolean } = {}) {
    if (this.readOnly) return
    if (this.editing?.id !== id) this.finishEditing()
    const item = B.getItem(this.board, id)
    if (!item || !hasText(item.kind)) return
    if (item.locked) return this.setStatus('Locked — unlock it to edit')
    if (BS.isMasked(item, this.me, !!BS.openRound(this.board))) return this.setStatus(`That's ${item.hiddenBy}'s note — hidden until the brainstorm is revealed`)
    this.selection = new Set([id])
    this.selectedConnector = null
    this.editing = { id, before: opts.before ?? this.board, created: opts.created ?? false }
    // On a phone, bring what's being typed up to a readable size.
    if (this.viewport.w <= 720 && this.camera.zoom < 0.75 && !this.presenting) {
      this.flyTo(centerOn({ ...this.camera, zoom: 0.75 }, center(item), this.viewport))
    }
    this.emit()
  }

  /** Starts editing the label of connector `id`. */
  startEditingLabel(id: Id) {
    this.finishEditing()
    if (this.readOnly || !B.getConnector(this.board, id)) return
    this.selection = new Set()
    this.selectedConnector = id
    this.editing = { id, connector: true, before: this.board, created: false }
    this.emit()
  }

  /** The text being edited. */
  get editingText(): string {
    const e = this.editing
    if (!e) return ''
    return (e.connector ? B.getConnector(this.board, e.id)?.label : B.getItem(this.board, e.id)?.text) ?? ''
  }

  setEditingText(text: string) {
    const e = this.editing
    if (!e) return
    if (e.connector) this.apply(B.updateConnector(this.board, e.id, (c) => ({ ...c, label: text })))
    else this.apply(B.updateItem(this.board, e.id, (i) => (i.text === text ? i : { ...i, text })))
    this.emit()
  }

  /** Ends text editing, recording the creation and typing as one undo step. */
  finishEditing() {
    const e = this.editing
    if (!e) return
    this.editing = null
    if (e.connector) {
      const c = B.getConnector(this.board, e.id)
      if (c && !c.label?.trim()) {
        this.apply(B.updateConnector(this.board, e.id, (x) => ({ ...x, label: undefined })))
      }
      this.commit(e.before)
      this.emit()
      return
    }
    const item = B.getItem(this.board, e.id)
    // A new mind-map branch left empty is discarded, as if never added.
    if (e.created && item?.kind === 'mind' && item.parent !== undefined && !item.text.trim()) {
      this.apply(e.before)
      this.selection = new Set([...this.selection].filter((id) => B.getItem(this.board, id)))
      if (!this.selection.size && item.parent !== undefined) this.selection = new Set([item.parent])
    } else {
      this.commit(e.before)
    }
    this.emit()
  }

  /** Keys pressed inside the text box. Returns true when handled. */
  editingKey(key: string, mods: Modifiers): boolean {
    const e = this.editing
    if (!e) return false
    const item = B.getItem(this.board, e.id)
    if (key === 'Escape') {
      this.finishEditing()
      return true
    }
    if (item?.kind === 'flow' && key === 'Tab') {
      this.finishEditing()
      if (B.getItem(this.board, item.id)) this.addFlowStep(item.id)
      return true
    }
    if (item?.kind !== 'mind') return false
    if (key === 'Enter' && !mods.shift) {
      const hadText = !!item.text.trim()
      this.finishEditing()
      // Enter on a filled node keeps the brainstorm going with a sibling.
      if (hadText && B.getItem(this.board, item.id)) this.addMindNode(item.id, 'sibling')
      return true
    }
    if (key === 'Tab') {
      this.finishEditing()
      if (B.getItem(this.board, item.id)) this.addMindNode(item.id, mods.shift ? 'sibling' : 'child')
      return true
    }
    return false
  }

  // ----- comments, search ----------------------------------------------------------

  toggleNotes(open = !this.notesOpen) {
    this.notesOpen = open
    this.emit()
  }

  setAuthor(name: string) {
    this.author = name
    this.emit()
  }

  /** What changed since this person last looked (shown until dismissed). */
  catchUp: (CU.CatchUp & { before: Board }) | null = null
  /** Highlighting the changes on the board. */
  showingCatchUp = false
  onCatchUpDone: (() => void) | null = null
  /** A question for the AI assistant from elsewhere in the app (it opens and asks), with any pictures. */
  pendingAiPrompt: { text: string; images?: { mediaType: 'image/png' | 'image/jpeg'; data: string }[]; label?: string } | null = null

  askAi(text: string, images?: { mediaType: 'image/png' | 'image/jpeg'; data: string }[], label?: string) {
    this.pendingAiPrompt = { text, images, label }
    this.emit()
  }

  setCatchUp(c: (CU.CatchUp & { before: Board }) | null) {
    this.catchUp = c
    this.showingCatchUp = false
    this.emit()
  }

  showCatchUp(on = !this.showingCatchUp) {
    this.showingCatchUp = on && !!this.catchUp
    const c = this.catchUp
    if (this.showingCatchUp && c) {
      const box = B.bounds(this.board, new Set([...c.added, ...c.changed, ...c.comments.map((x) => x.id)]))
      const removed = unionAll(c.removed.map(B.itemBounds))
      const all = box && removed ? unionAll([box, removed]) : (box ?? removed)
      if (all) this.flyTo(fit(all, this.openView, 120))
    }
    this.emit()
  }

  dismissCatchUp() {
    this.catchUp = null
    this.showingCatchUp = false
    this.emit()
    this.onCatchUpDone?.()
  }

  /** A stand-in name for reactions and votes until the person gives theirs (set per browser). */
  guestName = 'Guest'

  /** Who "I" am on reactions and votes. */
  get me(): string {
    return this.author.trim() || this.guestName
  }

  // ----- reactions and votes ---------------------------------------------------------

  /** Puts my `emoji` on each of `ids` (the selection by default), or takes it off. */
  toggleReaction(emoji: string, ids: Id[] = [...this.selection]) {
    if (this.readOnly || !ids.length) return
    const who = this.me
    // On several objects at once: add everywhere unless all already have it.
    const all = ids.every((id) => B.getItem(this.board, id)?.reactions?.[emoji]?.includes(who))
    this.edit((b) => B.updateItems(b, new Set(ids), (i) => (!!i.reactions?.[emoji]?.includes(who) === !all ? i : RX.toggleReaction(i, emoji, who))))
  }

  /** Starts a dot vote on the selection; the vote card appears just above it. */
  // ----- private brainstorm ----------------------------------------------------------

  private masked: { board: Board; me: string; view: Board } | null = null

  /** The board as this person may see it: other people's notes in an open brainstorm are blank. */
  get viewBoard(): Board {
    const me = this.me
    if (this.masked?.board !== this.board || this.masked.me !== me) this.masked = { board: this.board, me, view: BS.maskFor(this.board, me) }
    return this.masked.view
  }

  /** Turns flip cards over (the selected ones by default). */
  flipCards(ids: Id[] = [...this.selection]) {
    if (this.readOnly) return
    const cards = ids.filter((id) => {
      const i = B.getItem(this.board, id)
      return i && FL.isFlipCard(i)
    })
    if (!cards.length) return
    this.edit((b) => FL.flip(b, cards))
  }

  /** Gives the selected sticky notes a back (or takes it off). */
  setFlipCards(on: boolean) {
    if (this.readOnly) return
    const ids = this.selectedItems.filter((i) => i.kind === 'sticky').map((i) => i.id)
    if (!ids.length) return
    this.edit((b) => FL.setFlipCard(b, ids, on))
    this.setStatus(on ? 'Flip card: click ↻ to turn it over and write on the back' : 'Back removed')
  }

  /** Adds a spinner wheel; selected objects' text become its options. */
  addWheel() {
    if (this.readOnly) return
    const options = this.selectedItems.map((i) => N.objectLabel(i)).filter((t) => t && !/^(Sticky note|Text|Rectangle|Ellipse) d+$/.test(t))
    let id: Id = -1
    this.edit((b) => {
      const [next, card] = WH.newWheel(b, this.pointer ?? center(this.visibleWorld), options)
      id = card
      return next
    })
    this.select([id])
    this.keepInView(id)
    this.setStatus(options.length >= 2 ? `A wheel with ${options.length} options — click Spin` : 'Double-click the wheel to put your options on it, one per line')
  }

  spinWheel(id: Id) {
    if (this.readOnly) return
    this.edit((b) => WH.spinWheel(b, id))
  }

  /** Opens a private brainstorm round (or shows the one already open). */
  startBrainstorm(prompt = '') {
    if (this.readOnly) return
    const open = BS.openRound(this.board)
    if (open) {
      this.focusObject(open.id)
      return this.setStatus('A private brainstorm is already open — reveal it to start another')
    }
    let id: Id = -1
    this.edit((b) => {
      const [next, card] = BS.startBrainstorm(b, center(this.visibleWorld), this.me, prompt)
      id = card
      return next
    })
    this.select([id])
    this.setStatus('Private brainstorm open: sticky notes stay hidden from others until someone reveals them')
  }

  revealBrainstorm(card: Id) {
    if (this.readOnly) return
    const { notes } = BS.roundStats(this.board)
    this.edit((b) => BS.reveal(b, card))
    this.setStatus(notes ? `Revealed ${notes} note${notes === 1 ? '' : 's'}` : 'Brainstorm closed')
  }

  startVote(question?: string, each?: number) {
    const options = [...this.selection].filter((id) => {
      const i = B.getItem(this.board, id)
      return i && !i.poll && i.kind !== 'frame'
    })
    if (this.readOnly) return
    if (options.length < 2) return this.setStatus('Select two or more things to vote on, then start the vote')
    let id: Id = -1
    this.edit((b) => {
      const [next, card] = RX.startPoll(b, options, { question, each })
      id = card
      return next
    })
    this.select([id])
    this.keepInView(id)
    const allowance = RX.pollOf(this.board, id)!.poll.each
    this.setStatus(`Vote started: everyone gets ${allowance === 1 ? 'one vote' : `${allowance} votes`} — click the dots on the options`)
  }

  vote(poll: Id, option: Id, delta: 1 | -1) {
    if (this.readOnly) return
    const p = RX.pollOf(this.board, poll)
    if (!p || p.poll.ended) return
    if (delta > 0 && RX.usedVotes(this.board, poll, this.me) >= p.poll.each) {
      return this.setStatus(`${p.poll.each === 1 ? 'You’ve used your vote' : `You’ve used all ${p.poll.each} votes`} — click − on an option to move one`)
    }
    this.edit((b) => RX.castVote(b, poll, option, this.me, delta))
  }

  revealVote(poll: Id, revealed = true) {
    if (!this.readOnly) this.edit((b) => RX.setRevealed(b, poll, revealed))
  }

  endVote(poll: Id) {
    if (!this.readOnly) this.edit((b) => RX.endPoll(b, poll))
  }

  sortByVotes(poll: Id) {
    if (!this.readOnly) this.edit((b) => RX.sortByVotes(b, poll))
  }

  /** Adds a work note to `id` (one undo step). */
  /** Sets an object's description (one undo step); empty removes it. */
  setDescription(id: Id, text: string) {
    const value = text.replace(/\s+$/, '')
    this.edit((b) =>
      B.updateItem(b, id, (i) => {
        if ((i.description ?? '') === value) return i
        const next: Item = { ...i, description: value }
        if (!value) delete next.description
        return next
      }),
    )
  }

  addNote(id: Id, text: string) {
    this.edit((b) => N.addNote(b, id, text, this.author.trim() || undefined))
  }

  deleteNote(id: Id, noteId: string) {
    this.edit((b) => N.deleteNote(b, id, noteId))
  }

  setSearchOpen(open: boolean) {
    this.searchOpen = open
    if (open) this.finishEditing()
    this.emit()
  }

  /** Selects `id` and brings it into view, zooming in if it would be too small to read. */
  focusObject(id: Id) {
    const item = B.getItem(this.board, id)
    if (!item) return
    this.finishEditing()
    // Reveal nodes inside collapsed mind-map branches.
    let b = this.board
    for (let p = item.parent; p !== undefined; p = B.getItem(b, p)?.parent) {
      if (B.getItem(b, p)?.collapsed) b = M.toggleCollapsed(b, p)
    }
    if (b !== this.board) this.apply(b)
    this.selection = new Set([id])
    this.selectedConnector = null
    const fitted = fit(B.itemBounds(item), this.openView, 120)
    this.emit()
    this.flyTo(this.camera.zoom < 0.5 || this.camera.zoom > fitted.zoom * 1.5 ? fitted : centerOn(this.camera, center(item), this.openView))
  }

  // ----- flowcharts ---------------------------------------------------------------

  closeFlowPalette() {
    this.flowPalette = false
    if (this.tool === 'flow') this.tool = 'select'
    this.emit()
  }

  /** How close (in world units) a shape must come to a free side to snap to it. */
  private get magnetReach() {
    return 70 / this.camera.zoom
  }

  /** A shape from the panel is being dragged over the board (screen point, or null when off it). */
  paletteDragMove(shape: FlowShape, screen: Vec | null) {
    if (!screen) {
      this.paletteDrag = null
      return this.emit()
    }
    const at = toWorld(this.camera, screen)
    const info = flowShapeInfo(shape)
    this.paletteDrag = { shape, at, magnet: F.findMagnet(this.board, at, info, new Set(), this.magnetReach) }
    this.emit()
  }

  /** Drops a shape from the panel; near another shape it snaps beside it and connects. */
  paletteDrop(shape: FlowShape, screen: Vec) {
    this.paletteDragMove(shape, screen)
    const d = this.paletteDrag
    this.paletteDrag = null
    if (!d || this.readOnly) return this.emit()
    const before = this.board
    this.finishEditing()
    let id: Id = -1
    this.apply(((b) => {
      let next: Board
      ;[next, id] = F.dropShape(b, shape, d.at, d.magnet)
      return next
    })(this.board))
    this.flowShape = shape
    this.tool = 'select'
    this.startEditing(id, { before, created: true })
  }

  setFlowShape(shape: FlowShape) {
    this.flowShape = shape
    this.setTool('flow')
  }

  /** Adds a connected next step after flowchart shape `id` and starts editing it. */
  addFlowStep(id: Id, dir: F.FlowDir = F.flowDirection(this.board, id)) {
    this.finishEditing()
    const before = this.board
    const [b, newId] = F.addStep(this.board, id, dir)
    if (newId === null) return
    this.apply(b)
    this.startEditing(newId, { before, created: true })
    this.keepInView(newId)
  }

  /** Creates the shape chosen in the shape picker, linked from where the line started. */
  pickShape(shape: FlowShape) {
    const p = this.shapePicker
    if (!p) return
    this.shapePicker = null
    const before = this.board
    const [b, id] = F.addStepAt(this.board, p.from, shape, p.at)
    this.apply(b)
    this.startEditing(id, { before, created: true })
  }

  cancelShapePicker() {
    this.shapePicker = null
    this.emit()
  }

  // ----- images, imports -----------------------------------------------------------

  /** Places an image (natural size `w`×`h`) at the pointer, scaled down to a sensible size. */
  addImage(src: string, w: number, h: number, at: Vec = this.pointer ?? center(this.visibleWorld)) {
    const scale = Math.min(1, 480 / Math.max(w, h))
    const size = { w: Math.max(8, w * scale), h: Math.max(8, h * scale) }
    let id = -1
    this.edit((b) => {
      const [next, newId] = B.addItem(b, B.newItem('image', rectFromCenter(at, size.w, size.h), { src }))
      id = newId
      return next
    })
    this.tool = 'select'
    this.select([id])
  }

  /** Adds a card for web address `url` at the pointer; its preview fills in once the server reads the page. */
  addLink(url: string, at: Vec = this.pointer ?? center(this.visibleWorld)) {
    let id = -1
    this.edit((b) => {
      const [next, newId] = B.addItem(b, linkItem(url, at))
      id = newId
      return next
    })
    this.tool = 'select'
    this.select([id])
    return id
  }

  /**
   * Fills in a link card's preview. It isn't an undo step of its own: undoing
   * the paste takes the card away, preview and all.
   */
  fillLink(id: Id, preview: Partial<LinkCard>) {
    const item = B.getItem(this.board, id)
    if (!item?.link || this.readOnly) return
    this.apply(B.updateItem(this.board, id, (i) => withPreview(i, preview)))
    this.emit()
  }

  /** Inserts a Mermaid flowchart at the pointer (or view centre). Throws if it can't be read. */
  importMermaid(text: string, at: Vec = this.pointer ?? center(this.visibleWorld)) {
    const graph = parseMermaid(text)
    let ids: Id[] = []
    this.edit((b) => {
      const [next, newIds] = insertMermaid(b, graph, at)
      ids = newIds
      return next
    })
    this.select(ids)
    this.zoomToFit()
    this.status = `Added a flowchart with ${ids.length} shapes`
    this.emit()
  }

  /** Mermaid for the selection, or for every flowchart shape when nothing is selected. */
  exportMermaid(): string {
    return toMermaid(this.board, this.selection.size ? this.selection : undefined)
  }

  // ----- tables, Kanban boards, timelines -------------------------------------------

  /** Updates an object as one undo step. */
  updateItem(id: Id, f: (i: Item) => Item) {
    this.edit((b) => B.updateItem(b, id, f))
  }

  /** Updates a table, resizing the object to fit it. */
  updateTable(id: Id, f: (t: TableData) => TableData) {
    this.updateItem(id, (i) => {
      if (!i.table) return i
      const table = f(i.table)
      if (table === i.table) return i
      return { ...i, table, ...tableSize(table) }
    })
  }

  // ----- linked data ----------------------------------------------------------------

  /** Changes a dataset (one undo step); every view of it updates. */
  updateDataset(datasetId: string, f: (d: Dataset) => Dataset) {
    this.edit((b) => D.updateDataset(b, datasetId, f))
  }

  /** Changes how one view shows its dataset. */
  updateView(id: Id, f: (v: DataView) => DataView) {
    this.updateItem(id, (i) => {
      if (!i.view) return i
      const view = f(i.view)
      return view === i.view ? i : { ...i, view }
    })
  }

  /** Adds another view of the same dataset beside `id` (to the right, or below if that's taken). */
  addDataView(id: Id, type: DataViewType) {
    const src = B.getItem(this.board, id)
    if (!src?.view) return
    const ds = D.getDataset(this.board, src.view.dataset)
    if (!ds) return
    const size = D.viewSize(ds, type)
    let at = { x: src.x + src.w + 60, y: src.y }
    const free = (p: Vec) => !this.board.items.some((i) => i.kind !== 'frame' && intersects(B.itemBounds(i), { ...p, ...size }))
    if (!free(at)) at = { x: src.x, y: src.y + src.h + 60 }
    for (let k = 0; k < 20 && !free(at); k++) at = { x: at.x, y: at.y + 120 }
    let newId: Id = -1
    this.edit((b) => {
      let next: Board
      ;[next, newId] = B.addItem(b, B.newItem('data', { ...at, ...size }, { text: src.text, view: { ...D.newView(src.view!.dataset, type), groupBy: src.view!.groupBy } }))
      return next
    })
    this.select([newId])
    this.keepInView(newId)
  }

  /** Turns a table, Kanban board or timeline into a dataset with a view of the same kind. */
  convertToData(id: Id) {
    const i = B.getItem(this.board, id)
    if (!i || !(i.table || i.kanban || i.timeline)) return
    const name = i.text || KIND_LABELS[i.kind]
    const ds = i.table ? D.datasetFromTable(name, i.table) : i.kanban ? D.datasetFromKanban(name, i.kanban) : D.datasetFromTimeline(name, i.timeline!)
    const type: DataViewType = i.table ? 'table' : i.kanban ? 'board' : 'timeline'
    this.edit((b) =>
      B.updateItem(D.addDataset(b, ds), id, (x) => {
        const next: Item = { ...x, kind: 'data', view: D.newView(ds.id, type), w: Math.max(x.w, type === 'table' ? 700 : x.w), h: Math.max(x.h, 320) }
        delete next.table
        delete next.kanban
        delete next.timeline
        return next
      }),
    )
    this.setStatus(`Converted to linked data — add a Board or Timeline view from its title bar`)
  }

  updateKanban(id: Id, f: (k: KanbanData) => KanbanData) {
    this.updateItem(id, (i) => (i.kanban ? { ...i, kanban: f(i.kanban) } : i))
  }

  updateTimeline(id: Id, f: (t: TimelineData) => TimelineData) {
    this.updateItem(id, (i) => (i.timeline ? { ...i, timeline: f(i.timeline) } : i))
  }

  /**
   * Reschedules a timeline entry by `days` (or one of its ends). Entries that
   * come from Kanban cards update the card itself.
   */
  shiftTimelineEntry(timeline: Id, entry: TL.ShownEntry, days: number, edge?: 'start' | 'end') {
    if (!days) return
    const next = TL.shiftDates(entry, days, edge)
    const src = entry.source
    if (!src) {
      this.updateTimeline(timeline, (t) => TL.updateEntry(t, entry.id, { start: next.start, end: next.end }))
      return
    }
    this.updateKanban(src.kanban, (k) => {
      const card = K.findCard(k, src.card)?.card
      if (!card) return k
      if (TL.isIsoDay(card.start) && TL.isIsoDay(card.due)) return K.updateCard(k, card.id, { start: next.start, due: next.end ?? next.start })
      if (TL.isIsoDay(card.due)) return K.updateCard(k, card.id, { due: next.start })
      return K.updateCard(k, card.id, { start: next.start })
    })
  }

  /** Changes the symbol of the selected flowchart shapes. */
  setShape(shape: FlowShape) {
    this.edit((b) =>
      B.updateItems(b, this.selection, (i) => {
        if (i.kind !== 'flow' || i.shape === shape) return i
        // Shapes still in their default colour take the new symbol's colour.
        const color = i.color === flowShapeInfo(i.shape).color ? flowShapeInfo(shape).color : i.color
        return { ...i, shape, color }
      }),
    )
  }

  setConnectorStyle(style: ConnectorStyle) {
    const id = this.selectedConnector
    if (id !== null) this.edit((b) => B.updateConnector(b, id, (c) => ({ ...c, style })))
  }

  setDashed(dashed: boolean) {
    const id = this.selectedConnector
    if (id !== null) this.edit((b) => B.updateConnector(b, id, (c) => ({ ...c, dashed })))
  }

  setArrowheads(arrows: Arrowheads) {
    const id = this.selectedConnector
    if (id !== null) this.edit((b) => B.updateConnector(b, id, (c) => ({ ...c, arrows })))
  }

  /** Pans just enough to bring item `id` into view. */
  /** Pans (or zooms out) so item `id` is fully visible, clear of the toolbars and side panels. */
  keepInView(id: Id) {
    const i = B.getItem(this.board, id)
    if (!i) return
    const r = this.screenRect(i)
    // Room taken by the chrome: top bars, the tool rail (bottom on phones), the zoom bar, side panels.
    const phone = this.viewport.w <= 720
    const pad = { left: phone ? 16 : 76, top: phone ? 116 : 72, right: 16 + this.rightInset, bottom: phone ? 132 : 64 }
    const w = this.viewport.w - pad.left - pad.right
    const h = this.viewport.h - pad.top - pad.bottom
    if (r.w > w || r.h > h) {
      // Too big to show at this zoom: zoom out to fit it in the clear area.
      const cam = fit(B.itemBounds(i), { w, h }, 0)
      this.camera = { ...cam, x: cam.x + pad.left, y: cam.y + pad.top }
      this.emit()
      return
    }
    let dx = 0
    let dy = 0
    if (r.x < pad.left) dx = pad.left - r.x
    else if (r.x + r.w > this.viewport.w - pad.right) dx = this.viewport.w - pad.right - (r.x + r.w)
    if (r.y < pad.top) dy = pad.top - r.y
    else if (r.y + r.h > this.viewport.h - pad.bottom) dy = this.viewport.h - pad.bottom - (r.y + r.h)
    if (dx || dy) this.pan(dx, dy)
  }

  /** Creates whatever the armed tool makes in the middle of the view: keyboard and command-palette creation. */
  placeHere(): boolean {
    const kind = CREATES[this.tool] ?? (this.tool === 'mind' ? 'mind' : this.tool === 'flow' ? 'flow' : undefined)
    if (!kind || this.readOnly) return false
    const view = this.openView
    // A little off-centre each time, so repeated placements don't stack exactly.
    const n = this.board.items.length % 5
    const at = { x: view.w / 2 + n * 24, y: view.h / 2 + n * 24 }
    this.pointerDown(at, 0, {})
    this.pointerUp(at)
    return true
  }

  // ----- mind maps ---------------------------------------------------------------

  /** Adds a child or sibling to node `id` and starts editing it. */
  addMindNode(id: Id, how: 'child' | 'sibling', side?: Side) {
    this.finishEditing()
    const before = this.board
    const [b, newId] = how === 'child' ? M.addChild(this.board, id, side) : M.addSibling(this.board, id)
    if (newId < 0) return
    this.apply(b)
    this.startEditing(newId, { before, created: true })
  }

  /** Lines up the selected objects. */
  align(how: B.AlignHow) {
    this.edit((b) => B.align(b, this.selection, how))
  }

  /** Spaces the selected objects evenly. */
  distribute(axis: 'x' | 'y') {
    this.edit((b) => B.distribute(b, this.selection, axis))
  }

  /** Puts the selected sibling ideas under a new idea, ready to name. */
  groupIdeas() {
    const before = this.board
    const [b, id] = M.groupUnder(this.board, [...this.selection], 'Group')
    if (id < 0) return this.setStatus('Select ideas that share a parent to group them')
    this.finishEditing()
    this.apply(b)
    // Named "Group" rather than left empty, so clicking away keeps it (and its ideas).
    this.startEditing(id, { before })
  }

  /** Puts a hand-arranged mind map back into its automatic layout. */
  tidyMindMap(id: Id) {
    this.edit((b) => M.tidy(b, id))
  }

  toggleCollapsed(id: Id) {
    this.edit((b) => M.toggleCollapsed(b, id))
  }

  /** The selected mind map as a Markdown outline. */
  outlineOfSelection(): string | null {
    const node = this.single
    return node?.kind === 'mind' ? M.toOutline(this.board, node.id) : null
  }

  // ----- selection commands ------------------------------------------------------

  deleteSelection() {
    const items = new Set<Id>()
    if (this.selectedItems.some((i) => i.locked)) this.setStatus('Locked objects stay — unlock them to delete')
    for (const id of [...this.selection].filter((x) => !B.getItem(this.board, x)?.locked)) {
      if (B.getItem(this.board, id)?.kind === 'mind') for (const d of B.subtree(this.board, id)) items.add(d)
      else items.add(id)
    }
    const connectors = new Set(this.selectedConnector !== null ? [this.selectedConnector] : [])
    if (!items.size && !connectors.size) return
    const next = M.selectionAfterDelete(this.board, this.selection)
    const first = this.selection.size === 1 ? B.getItem(this.board, [...this.selection][0]) : undefined
    this.edit((b) => B.remove(b, items, connectors))
    // Say what went, so a slip with Delete is noticed (and undone) straight away.
    const what = first
      ? `“${N.objectLabel(first)}”${items.size > 1 ? ` and ${items.size - 1} ${first.kind === 'mind' ? 'sub-idea' : 'object'}${items.size > 2 ? 's' : ''}` : ''}`
      : items.size
        ? `${items.size} object${items.size === 1 ? '' : 's'}`
        : 'the line'
    this.setStatus(`Deleted ${what}  ·  Ctrl+Z to undo`)
    this.selection = new Set(next !== undefined && B.getItem(this.board, next) ? [next] : [])
    this.selectedConnector = null
    this.emit()
  }

  /** Marks the selection with a status (null clears it). */
  markStatus(status: Status | null) {
    const ids = this.selectedItems.filter((i) => ST.canHaveStatus(i.kind)).map((i) => i.id)
    if (!ids.length) return
    this.edit((b) => ST.setStatus(b, ids, status))
    const info = ST.statusInfo(status)
    this.setStatus(info ? `Marked ${ids.length === 1 ? 'as' : `${ids.length} objects as`} ${info.label.toLowerCase()}` : 'Status cleared')
  }

  /** Dims everything without this status; the same status again (or null) shows everything. */
  setStatusFilter(status: Status | null) {
    this.statusFilter = status === this.statusFilter ? null : status
    this.emit()
  }

  setColor(color: string) {
    if (this.selectedConnector !== null) {
      const id = this.selectedConnector
      this.edit((b) => B.updateConnector(b, id, (c) => ({ ...c, color })))
      return
    }
    this.edit((b) => {
      for (const i of this.selectedItems) {
        b = i.kind === 'mind' ? M.setBranchColor(b, i.id, color) : B.updateItem(b, i.id, (x) => ({ ...x, color }))
      }
      return b
    })
  }

  scaleFont(factor: number) {
    this.edit((b) =>
      B.updateItems(b, this.selection, (i) =>
        i.kind === 'mind' ? i : { ...i, fontSize: Math.min(400, Math.max(6, Math.round(i.fontSize * factor))) },
      ),
    )
  }

  bringToFront() {
    this.edit((b) => B.bringToFront(b, this.selection))
  }

  sendToBack() {
    this.edit((b) => B.sendToBack(b, this.selection))
  }

  duplicate() {
    if (!this.selection.size) return
    const clip = B.copy(this.board, this.selection)
    let ids = new Set<Id>()
    this.edit((b) => {
      const [next, newIds] = B.paste(b, clip, 30, 30)
      ids = newIds
      return next
    })
    this.select([...ids].filter((id) => B.getItem(this.board, id)?.parent === undefined || !ids.has(B.getItem(this.board, id)!.parent!)))
  }

  selectAll() {
    this.finishEditing()
    this.tool = 'select'
    this.select(this.board.items.filter((i) => !this.hidden.has(i.id) && !i.locked).map((i) => i.id))
  }

  // ----- lock and groups --------------------------------------------------------------

  /** Locks (or unlocks) the selection: locked objects can't be clicked, moved or changed by accident. */
  setLocked(locked: boolean) {
    if (this.readOnly || !this.selection.size) return
    const ids = new Set(this.selection)
    this.edit((b) => B.updateItems(b, ids, (i) => {
      if (!!i.locked === locked) return i
      const next: Item = { ...i, locked }
      if (!locked) delete next.locked
      return next
    }))
    this.setStatus(locked ? 'Locked — right-click or Alt-click it to unlock' : 'Unlocked')
  }

  /** Groups the selection so it selects and moves as one (mind-map ideas get a new parent idea instead). */
  group() {
    const items = this.selectedItems
    if (this.readOnly || items.length < 2) return
    if (items.every((i) => i.kind === 'mind')) return this.groupIdeas()
    const id = uid()
    const ids = new Set(items.map((i) => i.id))
    this.edit((b) => B.updateItems(b, ids, (i) => ({ ...i, group: id })))
    this.setStatus(`Grouped ${ids.size} objects — Ctrl+Shift+G to ungroup`)
  }

  ungroup() {
    if (this.readOnly) return
    const ids = new Set(this.selectedItems.filter((i) => i.group).map((i) => i.id))
    if (!ids.size) return
    this.edit((b) => B.updateItems(b, ids, (i) => {
      const next = { ...i }
      delete next.group
      return next
    }))
    this.setStatus('Ungrouped')
  }

  /** The selection, serialised for the system clipboard. */
  copyText(): string | null {
    if (!this.selection.size) return null
    return clipToText(B.copy(this.board, this.selection))
  }

  /**
   * Pastes clipboard text at the pointer: BrainCraft items, an indented outline
   * (which becomes a mind map) or plain text (which becomes a sticky note).
   */
  pasteText(text: string) {
    const at = this.pointer ?? center(this.visibleWorld)
    const ops = opsFromText(text)
    if (ops) {
      try {
        let results: OpResult[] = []
        this.edit((b) => {
          const out = applyOps(b, ops, { measure: this.measure, origin: at })
          results = out.results
          return out.board
        })
        const created = results.flatMap((r) => r.ids ?? (r.id !== undefined && r.op.startsWith('create') ? [r.id] : []))
        this.select(created.filter((id) => B.getItem(this.board, id)))
        if (created.length) this.zoomToFit()
        this.setStatus(`Applied ${ops.length} operation${ops.length === 1 ? '' : 's'}`)
      } catch (err) {
        this.setStatus((err as Error).message)
      }
      return
    }
    const clip = clipFromText(text)
    if (clip) {
      const box = B.bounds({ ...this.board, items: clip.items })
      if (!box) return
      const c = center(box)
      let ids = new Set<Id>()
      this.edit((b) => {
        const [next, newIds] = B.paste(b, clip, at.x - c.x, at.y - c.y)
        ids = newIds
        return next
      })
      this.select([...ids].filter((id) => {
        const p = B.getItem(this.board, id)?.parent
        return p === undefined || !ids.has(p)
      }))
      return
    }
    const url = urlIn(text)
    if (url) {
      this.addLink(url, at)
      return
    }
    if (looksTabular(text)) {
      const table = tableFromText(text)
      const size = tableSize(table)
      let id = -1
      this.edit((b) => {
        const [next, newId] = B.addItem(b, B.newItem('table', rectFromCenter(at, size.w, size.h), { text: 'Table', table }))
        id = newId
        return next
      })
      this.select([id])
      this.status = `Pasted a table with ${table.rows.length} rows`
      this.emit()
      return
    }
    if (looksLikeMermaid(text)) {
      try {
        this.importMermaid(text, at)
      } catch (err) {
        this.setStatus(`Couldn't read that Mermaid: ${(err as Error).message}`)
      }
      return
    }
    const lines = listLines(text)
    if (lines) {
      let ids: Id[] = []
      this.edit((b) => {
        const [next, made] = stickyGrid(b, lines, at)
        ids = made
        return next
      })
      this.select(ids)
      this.setStatus(`Pasted ${ids.length} sticky notes, one per line (indent a list to get a mind map)`)
      return
    }
    const outline = M.parseOutline(text)
    if (outline) {
      let root = -1
      this.edit((b) => {
        const [next, id] = M.createMapFromOutline(b, outline, at)
        root = id
        return next
      })
      this.select([root])
      this.status = 'Pasted outline as a mind map'
      this.emit()
      return
    }
    if (text.trim()) {
      let id = -1
      this.edit((b) => {
        const [next, newId] = B.addItem(b, B.newItem('sticky', rectFromCenter(at, 200, 200), { text: text.trim() }))
        id = newId
        return next
      })
      this.select([id])
    }
  }

  // ----- pointer input -----------------------------------------------------------

  private tol() {
    return 4 / this.camera.zoom
  }

  hitAt(screen: Vec, withLocked = false): B.Hit | null {
    return B.hitTest(this.board, toWorld(this.camera, screen), this.tol(), this.hidden, withLocked)
  }

  pointerDown(screen: Vec, button: number, mods: Modifiers, handle?: Handle) {
    const world = toWorld(this.camera, screen)
    this.shapePicker = null
    this.pointer = world
    if (button === 1 || this.spaceDown || (button === 0 && this.tool === 'hand')) {
      this.drag = { type: 'pan', last: screen }
      this.emit()
      return
    }
    if (button === 2) {
      this.finishEditing()
      // Right-click reaches locked objects too, so they can be unlocked.
      const hit = this.hitAt(screen, true)
      if (hit?.type === 'item' && !this.selection.has(hit.id)) this.select([hit.id])
      else if (hit?.type === 'connector') {
        this.selection = new Set()
        this.selectedConnector = hit.id
        this.emit()
      } else if (!hit) this.select([])
      return
    }
    if (button !== 0) return
    this.finishEditing()

    if (handle) {
      switch (handle.kind) {
        case 'mindAdd': {
          const node = B.getItem(this.board, handle.id)
          if (node) this.addMindNode(node.id, 'child', handle.side)
          return
        }
        case 'collapse':
          this.toggleCollapsed(handle.id)
          return
        case 'notes':
          this.select([handle.id])
          this.toggleNotes(true)
          return
        case 'react':
          this.toggleReaction(handle.emoji, [handle.id])
          return
        case 'flip':
          this.flipCards([handle.id])
          return
        case 'vote':
          this.vote(handle.poll, handle.id, mods.alt ? -1 : handle.delta)
          return
        case 'resize': {
          const item = this.single
          if (item) {
            this.drag = { type: 'resize', id: item.id, anchor: cornerOf(item, OPPOSITE[handle.corner]), before: this.board }
          }
          this.emit()
          return
        }
        case 'connect':
        case 'flowAdd': {
          const item = this.single
          if (item) {
            const quick = handle.kind === 'flowAdd' ? handle.dir : undefined
            this.drag = { type: 'connect', from: item.id, current: world, origin: screen, quick }
          }
          this.emit()
          return
        }
      }
    }

    const kind = CREATES[this.tool] ?? (this.tool === 'mind' ? 'mind' : this.tool === 'flow' ? 'flow' : undefined)
    if (kind) {
      this.drag = { type: 'create', kind, start: world, current: world }
    } else if (this.tool === 'pen') {
      this.drag = { type: 'draw', points: [world] }
    } else if (this.tool === 'connector') {
      const hit = this.hitAt(screen)
      if (hit?.type === 'item') this.drag = { type: 'connect', from: hit.id, current: world, origin: screen }
    } else if (this.tool === 'select') {
      // Alt-click reaches locked objects (to select and unlock them).
      const hit = this.hitAt(screen, mods.alt)
      if (hit?.type === 'item') {
        if (mods.shift && this.selection.has(hit.id)) {
          for (const id of B.withGroups(this.board, [hit.id])) this.selection.delete(id)
          this.selection = new Set(this.selection)
        } else {
          // A click on a grouped object takes the whole group.
          if (!this.selection.has(hit.id)) this.selection = B.withGroups(this.board, mods.shift ? [...this.selection, hit.id] : [hit.id])
          this.selectedConnector = null
          const node = this.single
          if (node?.kind === 'mind' && node.parent !== undefined) {
            this.drag = { type: 'branch', id: node.id, start: world, offset: { x: 0, y: 0 }, target: null, before: this.board }
          } else {
            this.startMove(world)
          }
        }
      } else if (hit?.type === 'connector') {
        this.selection = new Set()
        this.selectedConnector = hit.id
      } else {
        if (!mods.shift) this.selection = new Set()
        this.selectedConnector = null
        this.drag = { type: 'marquee', start: world, current: world, base: new Set(this.selection) }
      }
    }
    this.emit()
  }

  /** Begins dragging the selection, collecting the alignment lines it can snap to. */
  private startMove(world: Vec) {
    const ids = B.movingSet(this.board, this.selection)
    const view = this.visibleWorld
    const snap: Snap = { xs: [], ys: [] }
    for (const i of this.board.items) {
      if (ids.has(i.id) || this.hidden.has(i.id) || i.kind === 'pen' || !intersects(i, view)) continue
      snap.xs.push(i.x, i.x + i.w / 2, i.x + i.w)
      snap.ys.push(i.y, i.y + i.h / 2, i.y + i.h)
    }
    this.drag = {
      type: 'move',
      ids,
      start: world,
      applied: { x: 0, y: 0 },
      bounds: B.bounds(this.board, this.selection),
      snap,
      guides: {},
      before: this.board,
      heads: B.offsetHeads(this.board, ids),
    }
  }

  /** Nudges `delta` so an edge or centre of `bounds` lands on a nearby line. */
  private snapDelta(bounds: Rect, delta: Vec, snap: Snap): { delta: Vec; guides: Guides } {
    const reach = 6 / this.camera.zoom
    const best = (values: number[], lines: number[]) => {
      let found: { adjust: number; line: number } | undefined
      for (const v of values)
        for (const line of lines) {
          const adjust = line - v
          if (Math.abs(adjust) <= reach && (!found || Math.abs(adjust) < Math.abs(found.adjust))) found = { adjust, line }
        }
      return found
    }
    const x = bounds.x + delta.x
    const y = bounds.y + delta.y
    const sx = best([x, x + bounds.w / 2, x + bounds.w], snap.xs)
    const sy = best([y, y + bounds.h / 2, y + bounds.h], snap.ys)
    return {
      delta: { x: delta.x + (sx?.adjust ?? 0), y: delta.y + (sy?.adjust ?? 0) },
      guides: { x: sx?.line, y: sy?.line },
    }
  }

  pointerMove(screen: Vec, mods: Modifiers = {}) {
    const world = toWorld(this.camera, screen)
    this.pointer = world
    this.onPointer?.(world)
    const d = this.drag
    switch (d.type) {
      case 'none':
        return
      case 'pan':
        this.camera = { ...this.camera, x: this.camera.x + screen.x - d.last.x, y: this.camera.y + screen.y - d.last.y }
        d.last = screen
        break
      case 'move': {
        let delta = { x: world.x - d.start.x, y: world.y - d.start.y }
        d.guides = {}
        d.magnet = null
        // A lone shape or sticky note snaps beside a nearby one (shapes also connect on release).
        const lone = d.ids.size === 1 ? B.getItem(d.before, [...d.ids][0]) : undefined
        const rule = lone && F.MAGNET_RULES[lone.kind]
        if (lone && rule && !mods.alt) {
          const c = { x: lone.x + lone.w / 2 + delta.x, y: lone.y + lone.h / 2 + delta.y }
          d.magnet = F.findMagnet(this.board, c, lone, d.ids, this.magnetReach, rule)
          if (d.magnet) delta = { x: d.magnet.at.x - lone.x - lone.w / 2, y: d.magnet.at.y - lone.y - lone.h / 2 }
        }
        // Alt moves freely; otherwise line up with nearby items.
        if (d.bounds && !mods.alt && !d.magnet) ({ delta, guides: d.guides } = this.snapDelta(d.bounds, delta, d.snap))
        const step = { x: delta.x - d.applied.x, y: delta.y - d.applied.y }
        let moved = B.translate(this.board, d.ids, step.x, step.y)
        // Ideas inside a mind map keep their place through the layout by their offset.
        if (d.heads.size) moved = B.updateItems(moved, d.heads, (i) => B.nudgeItem(i, step.x, step.y))
        this.apply(moved)
        d.applied = delta
        break
      }
      case 'branch': {
        d.offset = { x: world.x - d.start.x, y: world.y - d.start.y }
        d.target = this.branchDropTarget(d.id, world)
        // The idea itself follows the pointer, its branch and lines with it.
        const base = B.getItem(d.before, d.id)?.offset ?? { x: 0, y: 0 }
        this.apply(B.updateItem(d.before, d.id, (i) => ({ ...i, offset: { x: base.x + d.offset.x, y: base.y + d.offset.y } })))
        break
      }
      case 'resize': {
        const r = rectFromPoints(d.anchor, world)
        r.w = Math.max(r.w, 12)
        r.h = Math.max(r.h, 12)
        const item = B.getItem(this.board, d.id)
        // Images keep their proportions; shift-drag to stretch.
        if (item?.kind === 'image' && !mods.shift) {
          const ratio = item.w / item.h
          if (r.w / r.h > ratio) r.w = r.h * ratio
          else r.h = r.w / ratio
          if (world.x < d.anchor.x) r.x = d.anchor.x - r.w
          if (world.y < d.anchor.y) r.y = d.anchor.y - r.h
        }
        this.apply(B.updateItem(this.board, d.id, (i) => B.setRect(i, r)))
        break
      }
      case 'marquee':
      case 'create':
      case 'connect':
        d.current = world
        break
      case 'draw': {
        const last = d.points[d.points.length - 1]
        if (dist(last, world) * this.camera.zoom > 1.5) d.points = [...d.points, world]
        break
      }
    }
    this.emit()
  }

  /** The mind node a dragged branch would be attached to if dropped at `world`. */
  private branchDropTarget(id: Id, world: Vec): Id | null {
    const own = B.subtree(this.board, id)
    const hidden = this.hidden
    for (let k = this.board.items.length - 1; k >= 0; k--) {
      const i = this.board.items[k]
      if (i.kind === 'mind' && !own.has(i.id) && !hidden.has(i.id) && B.hitItem(i, world, this.tol() + 6)) return i.id
    }
    return null
  }

  pointerUp(screen: Vec) {
    const world = toWorld(this.camera, screen)
    const d = this.drag
    this.drag = { type: 'none' }
    switch (d.type) {
      case 'move': {
        const m = d.magnet
        const id = [...d.ids][0]
        const rule = F.MAGNET_RULES[B.getItem(this.board, id)?.kind ?? 'text']
        if (m && rule?.connect && !F.linked(this.board, m.target, id)) this.apply(B.connect(this.board, m.target, id, { style: 'elbow' })[0])
        this.commit(d.before)
        break
      }
      case 'resize':
        this.commit(d.before)
        break
      case 'branch':
        this.dropBranch(d, world)
        break
      case 'marquee': {
        const hits = [...B.itemsWithin(this.board, rectFromPoints(d.start, d.current), this.hidden)].filter((id) => !B.getItem(this.board, id)?.locked)
        this.selection = B.withGroups(this.board, [...d.base, ...hits])
        break
      }
      case 'create':
        this.finishCreate(d.kind, d.start, world)
        break
      case 'draw': {
        const before = this.board
        this.apply(B.addItem(this.board, B.penItem(d.points, this.penColor, this.penWidth))[0])
        this.commit(before)
        break
      }
      case 'connect':
        // A click (not a drag) on a flowchart arrow adds the next step that way.
        if (d.quick && dist(d.origin, screen) < 5) this.addFlowStep(d.from, d.quick)
        else this.finishConnect(d.from, world)
        break
    }
    this.emit()
  }

  /** Abandons the current gesture (e.g. when a second finger starts a pinch). */
  cancelDrag() {
    const d = this.drag
    if ('before' in d) this.apply(d.before)
    this.drag = { type: 'none' }
    this.emit()
  }

  private dropBranch(d: Extract<Drag, { type: 'branch' }>, world: Vec) {
    // A click, not a drag: put back any tiny move.
    if (dist(d.start, world) * this.camera.zoom < 4) return this.apply(d.before)
    const node = B.getItem(this.board, d.id)
    if (!node) return
    const clearOffset = (i: Item): Item => {
      const next = { ...i }
      delete next.offset
      return next
    }
    if (d.target !== null) {
      // Dropped on another idea: it becomes a child there, laid out normally.
      const target = B.getItem(this.board, d.target)!
      const side: Side = world.x < target.x + target.w / 2 ? 'left' : 'right'
      this.apply(B.updateItem(M.reparent(this.board, d.id, d.target, side), d.id, clearOffset))
    } else {
      const parent = node.parent !== undefined ? B.getItem(this.board, node.parent) : undefined
      const side: Side | undefined = parent && parent.parent === undefined ? (world.x < parent.x + parent.w / 2 ? 'left' : 'right') : undefined
      if (side && side !== (node.side ?? 'right')) {
        // A main branch dropped across its root switches sides.
        this.apply(B.updateItem(this.board, d.id, (i) => ({ ...clearOffset(i), side })))
        this.apply(B.bringToFront(this.board, B.subtree(this.board, d.id)))
      }
      // Otherwise it was dropped on empty space and already sits where it was put.
    }
    this.commit(d.before)
  }

  private finishCreate(kind: Kind, start: Vec, end: Vec) {
    const before = this.board
    let id: Id
    if (kind === 'mind') {
      let b: Board
      ;[b, id] = M.createMap(before, start)
      this.apply(b)
    } else if (kind === 'flow') {
      const r = rectFromPoints(start, end)
      const sized = r.w * this.camera.zoom >= 8 && r.h * this.camera.zoom >= 8
      let b: Board
      if (sized) [b, id] = B.addItem(this.board, F.flowItem(this.flowShape, center(r), { w: r.w, h: r.h }))
      else {
        // A click near a shape snaps beside it and connects, like dropping from the panel.
        const magnet = F.findMagnet(this.board, start, flowShapeInfo(this.flowShape), new Set(), this.magnetReach)
        ;[b, id] = F.dropShape(this.board, this.flowShape, start, magnet)
      }
      this.apply(b)
    } else {
      let r = rectFromPoints(start, end)
      if (r.w * this.camera.zoom < 8 || r.h * this.camera.zoom < 8) {
        const s = defaultSize(kind)
        r = rectFromCenter(start, s.w, s.h)
      }
      if (kind === 'table') r = rectFromCenter(start, tableSize(newTable()).w, tableSize(newTable()).h)
      if (kind === 'kanban' && r.w < 500) r = rectFromCenter(start, kanbanWidth(newKanban()), r.h)
      if (kind === 'data' && r.w < 600) r = rectFromCenter(start, defaultSize('data').w, defaultSize('data').h)
      let ds: Dataset | undefined
      if (kind === 'data') {
        ds = D.newDataset(`Database ${(this.board.datasets?.length ?? 0) + 1}`)
        r = rectFromCenter(center(r), Math.max(r.w, D.viewSize(ds, 'table').w), Math.max(r.h, D.viewSize(ds, 'table').h))
      }
      const extra: Partial<Item> =
        ds
          ? { text: ds.name, view: D.newView(ds.id, 'table') }
          : kind === 'table'
          ? { text: 'Table', table: newTable() }
          : kind === 'kanban'
            ? { text: 'Kanban board', kanban: newKanban() }
            : kind === 'timeline'
              ? { text: 'Timeline', timeline: TL.newTimeline() }
              : kind === 'frame'
          ? { text: `Frame ${this.board.items.filter((i) => i.kind === 'frame').length + 1}` }
          : kind === 'comment'
            ? { createdAt: Date.now() }
            : {}
      let b: Board
      ;[b, id] = B.addItem(ds ? D.addDataset(this.board, ds) : this.board, B.newItem(kind, r, extra))
      // A frame goes beneath whatever it was drawn around.
      if (kind === 'frame') b = B.sendToBack(b, new Set([id]))
      this.apply(b)
    }
    this.tool = 'select'
    if (kind === 'frame' || isWidget(kind)) {
      this.commit(before)
      this.select([id])
      if (isWidget(kind)) this.keepInView(id)
    } else {
      this.startEditing(id, { before, created: true })
    }
  }

  private finishConnect(from: Id, world: Vec) {
    const source = B.getItem(this.board, from)
    if (!source) return
    const hit = B.hitTest(this.board, world, this.tol(), this.hidden)
    const target = hit?.type === 'item' ? B.getItem(this.board, hit.id) : undefined
    const before = this.board
    if (target && target.id !== from && target.kind !== 'frame') {
      this.apply(B.connect(this.board, from, target.id, { style: B.defaultStyleBetween(source, target) })[0])
      this.commit(before)
      return
    }
    if (hit && (hit.type === 'connector' || target?.id === from)) return
    // Dropped on empty canvas (or a frame): grow the idea with a new linked item.
    if (source.kind === 'mind') {
      this.addMindNode(from, 'child', world.x < source.x + source.w / 2 ? 'left' : 'right')
      return
    }
    if (source.kind === 'pen' || source.kind === 'frame') return
    if (source.kind === 'flow') {
      this.shapePicker = { from, at: world, options: F.recommendShapes(this.board, source.shape) }
      return
    }
    const item = B.newItem(source.kind, rectFromCenter(world, source.w, source.h), { color: source.color, fontSize: source.fontSize })
    const [b, id] = B.addItem(this.board, item)
    this.apply(B.connect(b, from, id)[0])
    this.startEditing(id, { before, created: true })
  }

  doubleClick(screen: Vec) {
    const hit = this.hitAt(screen)
    const target = hit?.type === 'item' ? B.getItem(this.board, hit.id) : undefined
    if (target && isWidget(target.kind)) {
      // Widgets handle clicks in their body; their title strip renames them.
      if (toWorld(this.camera, screen).y - target.y <= WIDGET_TITLE_H) this.startEditing(target.id)
      else this.select([target.id])
    } else if (hit?.type === 'item') {
      this.startEditing(hit.id)
    } else if (hit?.type === 'connector') {
      this.startEditingLabel(hit.id)
    } else if (!hit && this.tool === 'select') {
      const before = this.board
      const [b, id] = B.addItem(this.board, B.newItem('sticky', rectFromCenter(toWorld(this.camera, screen), 200, 200)))
      this.apply(b)
      this.startEditing(id, { before, created: true })
    }
  }

  wheel(screen: Vec, dx: number, dy: number, zoomGesture: boolean) {
    this.flight++
    this.onUserCamera?.()
    if (zoomGesture) this.camera = zoomAt(this.camera, screen, Math.exp(-dy * 0.01))
    else this.camera = { ...this.camera, x: this.camera.x - dx, y: this.camera.y - dy }
    this.emit()
  }

  // ----- keyboard ----------------------------------------------------------------

  /** Keyboard shortcuts on the canvas (not while typing). */
  keyDown(key: string, mods: Modifiers): KeyResult {
    const k = key.length === 1 ? key.toLowerCase() : key
    if (this.emotePicker) {
      const n = Number(k)
      if (n >= 1 && n <= RX.REACTIONS.length) this.emote(RX.REACTIONS[n - 1])
      else if (k === 'Escape' || k === 'e') this.closeEmotePicker()
      else return false
      return true
    }
    if (this.shapePicker) {
      const n = Number(k)
      if (n >= 1 && n <= this.shapePicker.options.length) this.pickShape(this.shapePicker.options[n - 1])
      else if (k === 'Escape') this.cancelShapePicker()
      else return false
      return true
    }
    if (mods.ctrl) {
      if (k === 'z' && mods.shift) this.redo()
      else if (k === 'z') this.undo()
      else if (k === 'y') this.redo()
      else if (k === 'a') this.selectAll()
      else if (k === 'd') this.duplicate()
      else if (k === 's') return 'save'
      else if (k === 'g' && mods.shift) this.ungroup()
      else if (k === 'g' && this.selection.size > 1) this.group()
      else if (k === 'l' && mods.shift && this.selection.size) this.setLocked(!this.selectedItems.every((i) => i.locked))
      else if (ARROWS[k] && this.selection.size) {
        // Ctrl + arrow nudges anything, mind-map ideas included (Shift for bigger steps).
        const step = mods.shift ? 50 : 10
        const dir = ARROWS[k]!
        const dx = dir === 'left' ? -step : dir === 'right' ? step : 0
        const dy = dir === 'up' ? -step : dir === 'down' ? step : 0
        this.edit((b) => {
          // The same as dragging: frames carry their contents, ideas move with their branches.
          const ids = B.movingSet(b, this.selection)
          return B.updateItems(B.translate(b, ids, dx, dy), B.offsetHeads(b, ids), (i) => B.nudgeItem(i, dx, dy))
        })
      }
      else if (k === 'k' || k === 'f') this.setSearchOpen(true)
      else return false
      return true
    }
    if (mods.shift && k === 'c') {
      this.toggleNotes()
      return true
    }
    if (mods.shift && k === 'r' && this.single?.kind === 'flow') {
      this.startRun()
      return true
    }
    const node = this.single
    const mind = node?.kind === 'mind' ? node : undefined

    if (mods.shift && k === '!') {
      this.zoomToFit()
      return true
    }
    if (k === 'Delete' || k === 'Backspace') {
      this.deleteSelection()
      return true
    }
    if (k === 'Escape') {
      // First Esc deselects; another closes the flowchart shape panel.
      if (!this.selection.size && this.selectedConnector === null && this.tool === 'select' && this.flowPalette) this.flowPalette = false
      this.drag = { type: 'none' }
      this.tool = 'select'
      this.select([])
      return true
    }
    if (node?.kind === 'flow') {
      // Tab continues the flow; Alt + arrow branches off in that direction.
      if (k === 'Tab') {
        this.addFlowStep(node.id)
        return true
      }
      const dir = ARROWS[k]
      if (dir && mods.alt) {
        this.addFlowStep(node.id, dir)
        return true
      }
    }
    if (mind) {
      if (k === 'Tab') {
        this.addMindNode(mind.id, mods.shift ? 'sibling' : 'child')
        return true
      }
      if (k === 'Enter') {
        this.addMindNode(mind.id, 'sibling')
        return true
      }
      if (k === 'F2' || k === ' ') {
        this.startEditing(mind.id)
        return true
      }
      if (k === '/') {
        this.toggleCollapsed(mind.id)
        return true
      }
      const dir = ARROWS[k]
      if (dir) {
        if (mods.alt && (dir === 'up' || dir === 'down')) {
          this.edit((b) => M.moveAmongSiblings(b, mind.id, dir === 'up' ? -1 : 1))
        } else {
          const next = M.navigate(this.board, mind.id, dir)
          if (next !== undefined) this.select([next])
        }
        return true
      }
    } else {
      if ((k === 'Enter' || k === 'F2') && node) {
        this.startEditing(node.id)
        return true
      }
      const dir = ARROWS[k]
      if (dir && this.selection.size) {
        const step = mods.shift ? 10 : 1
        const [dx, dy] = { left: [-step, 0], right: [step, 0], up: [0, -step], down: [0, step] }[dir]
        this.edit((b) => B.translate(b, B.movingSet(b, this.selection), dx, dy))
        return true
      }
    }
    if (k === 'Enter' && !node && this.placeHere()) return true
    // With nothing selected: E for an emote, / to say something by your cursor.
    if (!this.selection.size && !mods.alt && !mods.ctrl) {
      if (k === 'e') {
        this.openEmotePicker()
        return true
      }
      if (k === '/') {
        this.setChatting(true)
        return true
      }
    }
    // Typing on a selected object renames it, as in other whiteboards: the first key replaces the text.
    if (node && !mods.alt && key.length === 1 && key !== ' ' && hasText(node.kind) && !isWidget(node.kind) && !this.readOnly) {
      this.startEditing(node.id)
      this.setEditingText(key)
      return true
    }
    if (!mods.alt) {
      const tool = TOOLS.find((t) => t.key === k)
      if (tool) {
        this.setTool(tool.tool)
        return true
      }
    }
    return false
  }

  /** A one-line reminder of what the keyboard can do right now. */
  get hint(): string | null {
    const e = this.editing
    if (e) {
      if (e.connector) return 'Type a label  ·  Esc done'
      const kind = B.getItem(this.board, e.id)?.kind
      if (kind === 'mind') return 'Enter next idea  ·  Tab sub-idea  ·  Shift+Enter new line  ·  Esc done'
      if (kind === 'flow') return 'Tab add the next step  ·  Esc done'
      return 'Esc done'
    }
    if (this.tool === 'mind') return 'Click to place the central idea'
    if (this.tool === 'flow') return `Click to place a ${flowShapeInfo(this.flowShape).label.toLowerCase()} (near a shape it snaps on and connects), or drag one from the panel`
    if (this.tool === 'connector') return 'Drag from one item to another'
    if (this.tool === 'pen') return 'Draw on the board  ·  Esc done'
    const armed = TOOLS.find((t) => t.tool === this.tool)
    if (armed && CREATES[this.tool]) return `Click to place a ${armed.label.toLowerCase()} (or drag to size it)  ·  Enter puts one in the middle  ·  Esc cancel`
    if (this.selectedConnector !== null) return 'Double-click the line to label it'
    const node = this.single
    if (node?.kind === 'mind')
      return 'Tab add sub-idea  ·  Enter add idea below  ·  Arrows move  ·  Space edit  ·  / collapse  ·  Shift+C comments'
    if (node?.kind === 'flow')
      return 'Tab next step  ·  Alt+Arrow add a step that way  ·  Enter edit  ·  Drag a blue arrow for shape ideas'
    return null
  }

  // ----- render helpers ----------------------------------------------------------

  screenRect(r: Rect): Rect {
    const p = toScreen(this.camera, r)
    return { x: p.x, y: p.y, w: r.w * this.camera.zoom, h: r.h * this.camera.zoom }
  }

  /** Whether the single selection can be resized with corner handles. */
  get resizable(): Item | undefined {
    const i = this.single
    return i && !this.editing && !i.locked && isResizable(i.kind) ? i : undefined
  }
}

const ARROWS: Record<string, M.Direction | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}
