/**
 * The editor: board, camera, selection, tools and every gesture, independent of
 * React. The UI forwards pointer and keyboard input in canvas (screen) pixels and
 * re-renders whenever the editor emits.
 */

import * as B from '../model/board'
import { isDrawing, sceneText } from '../model/excalidraw'
import { canSketch, flowComponent, setBoardSketch, setSketch, sketchNew } from '../model/sketch'
import { type ItemLink, setItemLink } from '../model/itemLink'
import type { BoardFile, ExcalidrawScene, TimeEntry, TimeTarget } from '../model/types'
import { type Camera, between, centerOn, defaultCamera, fit, rectToWorld, toScreen, toWorld, zoomAt } from '../model/camera'
import { type Rect, type Vec, center, dist, intersects, rectFromCenter, rectFromPoints, unionAll } from '../model/geom'
import { History } from '../model/history'
import { canFitToContent, canMatchSize, fitToContent, growsText, itemFontSize, sameSize } from '../model/fitText'
import { type OpResult, applyOps, opsFromText } from '../api/ops'
import * as F from '../model/flowchart'
import * as M from '../model/mindmap'
import { applyOutline, rootOf as mapRoot } from '../model/outlineSync'
import { type Problem, fixAll, fixProblem } from '../model/boardCheck'
import { runAutomations } from '../model/automations'
import { type ButtonPlan, newTitle, stamp } from '../model/pageButtons'
import { withSynced } from '../model/synced'
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
import * as TT from '../model/timeTracking'
import * as BS from '../model/brainstorm'
import { merge3 } from '../model/merge'
import * as RV from '../model/revisions'
import * as W from '../model/wiki'
import * as FS from '../model/files'
import type { PagePlan } from '../files/toWiki'
import { getSnap, setSnap, unusedSnaps } from '../model/embed'
import { embedKeys, toggleTask } from '../model/markdown'
import * as WH from '../model/wheel'
import * as FL from '../model/flip'
import { listLines, stickyGrid } from '../model/stickyGrid'
import { codeSize, fencedCode, langId } from '../model/code'
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
  type Page,
  type Snap as EmbedSnap,
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
  FLOW_SHAPES,
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
  { tool: 'comment', key: 'c', label: 'Comment block' },
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
  /** `tap`: what a finger came down on, selected if it lifts without moving the board. */
  | { type: 'pan'; last: Vec; tap?: { id: Id; at: Vec }; right?: { at: Vec; moved: boolean } }
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
      /** The board as this drag last left it. */
      at?: Board
    }
  | { type: 'branch'; id: Id; start: Vec; offset: Vec; target: Id | null; before: Board; at?: Board }
  | { type: 'resize'; id: Id; anchor: Vec; before: Board; at?: Board }
  | { type: 'marquee'; start: Vec; current: Vec; base: Set<Id> }
  | { type: 'create'; kind: Kind; start: Vec; current: Vec }
  | { type: 'draw'; points: Vec[] }
  | { type: 'connect'; from: Id; current: Vec; origin: Vec; quick?: F.FlowDir; choose?: boolean }

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
  /** Started by typing over the selected object's text. */
  replaced?: boolean
}

export interface Modifiers {
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  /** A finger, not a mouse or pen. */
  touch?: boolean
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
/** How far a right press may move and still be a right-click (screen pixels); further, it pans. */
const RIGHT_CLICK_SLOP = 5
const FLIGHT_MS = 520

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const prefersReducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
/** How to reach a locked object: phones have neither right-click nor Alt. */
const UNLOCK_HINT = () =>
  globalThis.matchMedia?.('(pointer: coarse)').matches ? 'Locked — press and hold it to unlock' : 'Locked — right-click or Alt-click it to unlock'

/** Plain things the next-shape picker offers besides flowchart symbols. */
export const PLAIN_NEXT = ['rect', 'ellipse', 'sticky', 'text'] as const
export type PlainNext = (typeof PLAIN_NEXT)[number]
/** What the next-shape picker offers: a flowchart symbol, or a plain shape, note or text. */
export type NextShape = FlowShape | PlainNext
export const isPlainNext = (k: string | undefined): k is PlainNext => (PLAIN_NEXT as readonly string[]).includes(k ?? '')

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

  /** Room taken on the right by the comments panel or assistant; floating bars keep clear of it. */
  setRightInset(px: number) {
    if (px === this.rightInset) return
    this.rightInset = px
    this.emit()
  }

  /**
   * Flowstate: the board alone on screen, built by talking to the assistant. What it changes is
   * brought into view, clear of its words at the top and yours at the bottom.
   */
  flow = false

  setFlow(on: boolean) {
    if (on === this.flow) return
    this.flow = on
    if (on) {
      this.finishEditing()
      this.selection = new Set()
      this.setTool('select')
    }
    this.emit()
  }

  /**
   * Flowstate's camera after a change: the whole board while it's readable at that size (so a
   * mind map is seen growing), otherwise what changed.
   */
  private frameFlow(changed: Rect | null) {
    const top = this.viewport.h > 560 ? 140 : 96
    const bottom = 72
    const view = { w: this.viewport.w, h: Math.max(200, this.viewport.h - top - bottom) }
    const all = B.bounds(this.board)
    const target = all && fit(all, view, 72).zoom >= 0.55 ? all : (changed ?? all)
    if (!target) return
    const cam = fit(target, view, 72)
    this.flyTo({ ...cam, y: cam.y + top })
  }
  penColor = INKS[0][1]
  penWidth = 4
  /** The symbol the flowchart tool places. */
  flowShape: FlowShape = 'process'
  /** The flowchart shape panel stays open while building a flowchart, until closed or another tool is picked. */
  flowPalette = false
  /** "Select several" on a touch screen: taps add to the selection and a drag draws a box, as Shift does. */
  tapToAdd = false
  /** A shape being dragged out of the panel: where it would land, and what it would snap to. */
  paletteDrag: { shape: FlowShape; at: Vec; magnet: F.Magnet | null } | null = null
  /** The comments (work notes) panel is showing. */
  notesOpen = false
  /** Only objects with this status show at full strength (the status key's filter). */
  statusFilter: Status | null = null
  /** Only objects assigned to this person show at full strength. */
  personFilter: string | null = null
  /** The timesheet is open, showing time on this (or everything). */
  timesheet: { on?: TimeTarget; log?: boolean } | null = null
  /** The search / object lookup palette is showing. */
  searchOpen = false
  /** Name stamped on new comments. */
  author = ''
  /** The signed-in account's id ('' without one), so mentions of it are known to be of me. */
  userId = ''
  /** A flowchart line dropped on empty space, waiting for the user to pick the next shape. */
  shapePicker: { from: Id; at: Vec; options: NextShape[] } | null = null
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
  /**
   * The Excalidraw drawing open for editing: an existing one (`id`), or a new one to put at `at`
   * (or a scene brought in from a file or the clipboard, `scene`).
   */
  drawing: { id: Id | null; at: Vec; scene?: ExcalidrawScene } | null = null
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
    // On a hand-drawn board, what's new comes out drawn by hand.
    const next = M.layoutAll(sketchNew(this.board, BS.stampNew(this.board, b, this.me)), this.measure)
    if (next === this.board) return
    this.board = next
    this.onBoardChange?.(next)
  }

  private commit(before: Board) {
    // Each undo step signs what it really changed with this person's name, for
    // "Since you were here" (a drag counts once, at its end, however far it went).
    const signed = CU.stampAuthors(before, this.board, this.me)
    if (signed !== this.board && !this.readOnly) {
      this.board = signed
      this.onBoardChange?.(signed)
    }
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
    this.blankSlate = false
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
    // A wiki opens on its first page (the screen picks the remembered one, if any).
    this.page = null
    this.pageHeading = null
    this.lastTyping = null
    this.peek = null
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

  /** The empty board's ways to start were put away (Blank canvas), until another board opens. */
  blankSlate = false

  /** Puts away the empty board's ways to start, for a blank canvas. */
  startBlank() {
    this.blankSlate = true
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

  /** Turns "Select several" (for touch screens) on or off. */
  setTapToAdd(on: boolean) {
    this.tapToAdd = on
    this.tool = 'select'
    this.setStatus(on ? 'Selecting several: tap objects to add or remove them, or drag a box — press and hold for Done' : '')
    this.emit()
  }

  setTool(tool: Tool) {
    if (this.readOnly && tool !== 'select' && tool !== 'hand') return
    this.finishEditing()
    this.tapToAdd = false
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
    if (step) this.afterJump(this.keepLog(this.board === step.after ? step.before : this.rebase(step.after, step.before)))
  }

  redo() {
    this.finishEditing()
    const step = this.history.redo()
    if (step) this.afterJump(this.keepLog(this.board === step.before ? step.after : this.rebase(step.before, step.after)))
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
    // Only mind maps are laid out here, so a change that leaves them alone needs no layout pass
    // (this runs for every message from every busy peer).
    const mind = patches.some((p) => (p.k === 'item' && (p.v === null || p.v.kind === 'mind')) || p.k === 'order')
    const layout = (b: Board) => (mind ? M.layoutAll(b, this.measure) : b)
    const next = layout(opts.sharedIds ? withIdsAfter(patched, patches) : patched)
    this.board = next
    // A gesture or edit under way keeps the board it started from, to restore or record
    // against: the change that just arrived goes into that too, so neither erases it.
    const held = (b: Board) => layout(applyPatches(b, patches))
    const d = this.drag
    if ('before' in d) {
      d.before = held(d.before)
      if (d.at) d.at = held(d.at)
    }
    if (this.editing) this.editing = { ...this.editing, before: held(this.editing.before) }
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
    this.board = Number.isSafeInteger(opts.idBase) && opts.idBase > 0 ? { ...next, nextId: opts.idBase } : next
    this.readOnly = opts.readOnly
    this.selection = new Set([...this.selection].filter((id) => B.getItem(this.board, id)))
    this.editing = null
    // A gesture held across a reconnect would take everything others did meanwhile as its own
    // (one undo step, credited to you); it ends here, and its work is replayed with the rest.
    this.drag = { type: 'none' }
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
  applyAi(id: string, summary: string, patches: Patch[], bases?: Record<string, string>): boolean {
    if (this.readOnly) return false
    const before = this.board
    // A page someone typed on since the proposal keeps both their words and the proposal's.
    const merged = new Set<string>()
    patches = patches.map((p) => {
      const base = p.k === 'body' && p.v ? bases?.[p.id] : undefined
      if (base === undefined || p.k !== 'body' || !p.v) return p
      const text = merge3(base, W.pageText(before, p.id), p.v.text)
      if (text !== p.v.text) merged.add(p.id)
      return { ...p, v: { ...p.v, text } }
    })
    // Such a page's versions are saved afresh around the change, so history shows what it really says.
    if (merged.size) {
      patches = patches.filter((p) => p.k !== 'rev' || !p.v || !merged.has(p.v.page))
      this.saveVersions(merged)
    }
    this.finishEditing()
    this.aiPreview = null
    const start = this.board
    this.edit((b) => withIdsAfter(applyPatches(b, patches), patches))
    if (merged.size) this.saveVersions(merged, { at: Date.now(), by: 'AI', note: summary })
    if (this.board === start) return false
    const change: AiChange = { id, at: Date.now(), summary, forward: diff(before, this.board), inverse: diff(this.board, before), undone: false }
    this.aiHistory = [...this.aiHistory, change]
    this.onAiHistory?.(this.aiHistory)
    // Show what arrived.
    const added = change.forward.flatMap((p) => (p.k === 'item' && p.v ? [p.id] : []))
    if (added.length) this.selection = new Set(added.filter((x) => B.getItem(this.board, x)))
    const box = added.length ? B.bounds(this.board, this.selection) : null
    if (this.flow) this.frameFlow(box)
    else if (box) this.flyTo(fit(box, this.openView, 120))
    this.emit()
    return true
  }

  /** Takes back (or puts back) one AI change, whatever happened since; itself undoable. */
  toggleAiChange(id: string) {
    const c = this.aiHistory.find((x) => x.id === id)
    if (!c || this.readOnly) return
    // Versions stay whichever way the change goes.
    const patches = (c.undone ? c.forward : c.inverse).filter((p) => p.k !== 'rev')
    this.edit((b) => this.keepLog(withIdsAfter(applyPatches(b, patches), patches)))
    this.aiHistory = this.aiHistory.map((x) => (x.id === id ? { ...x, undone: !x.undone } : x))
    this.onAiHistory?.(this.aiHistory)
    this.setStatus(c.undone ? `Redid: ${c.summary}` : `Undid: ${c.summary}`)
  }

  /** Applies just the change from `from` to `to` onto the current board (others' edits since stay). */
  private rebase(from: Board, to: Board): Board {
    return M.layoutAll(applyPatches(this.board, diff(from, to).filter((p) => p.k !== 'rev')), this.measure)
  }

  /** Undo and redo never take saved page versions away: the history of a page is a log, not an edit. */
  private keepLog(b: Board): Board {
    const log = this.board.revs
    if (b.revs === log) return b
    // Every version now, for pages that are there; and a page undo brings back brings its history back.
    const kept = new Map((log ?? []).filter((r) => W.getPage(b, r.page)).map((r) => [r.id, r]))
    for (const r of b.revs ?? []) if (!kept.has(r.id) && !W.getPage(this.board, r.page) && W.getPage(b, r.page)) kept.set(r.id, r)
    const next: Board = { ...b, revs: [...kept.values()] }
    if (!next.revs!.length) delete next.revs
    return next
  }

  /** Saves versions of pages (outside undo: see {@link keepLog}). */
  /** When this person last saved (or found saved) a version of each page, for the every-few-minutes rule. */
  private versionSaved = new Map<string, number>()

  private saveVersions(pages: Iterable<string>, opts: RV.SaveOptions = {}) {
    if (this.readOnly || !W.isWiki(this.board)) return
    let b = this.board
    const now = Date.now()
    for (const id of pages) {
      b = RV.savePageVersion(b, id, opts)
      this.versionSaved.set(id, now)
    }
    if (b === this.board) return
    this.apply(b)
    this.emit()
  }

  /** Starting to write on a page: what it says now is kept first, so the change can be seen later. */
  beginPageEdit(id: string) {
    this.saveVersions([id])
  }

  /** Done writing on a page: what it says now becomes a version, with an optional note. */
  endPageEdit(id: string, note?: string) {
    const changed = RV.unsavedChanges(this.board, id)
    const before = RV.latestRev(this.board, id)?.note
    this.saveVersions([id], { note, me: this.author.trim() || undefined })
    // A note with nothing changed only joins your own latest version; say so when it couldn't.
    if (note?.trim() && !changed && RV.latestRev(this.board, id)?.note === before) this.setStatus('Nothing changed, so the note wasn’t kept')
  }

  /** After the whole wiki went back to an earlier version: each page that changed gets a version saying so. */
  savePagesAfterRestore(note: string) {
    if (!W.isWiki(this.board)) return
    this.saveVersions(
      (this.board.pages ?? []).filter((p) => RV.unsavedChanges(this.board, p.id)).map((p) => p.id),
      { at: Date.now(), by: this.author.trim() || undefined, note },
    )
  }

  /** Changes a synced section's words in the page that holds it (every page showing it follows). */
  setSyncedSection(name: string, words: string): boolean {
    if (this.readOnly) return false
    const next = withSynced(this.board, name, words)
    if (!next) return false
    if (next.text === W.pageText(this.board, next.page)) return true
    this.saveVersions([next.page])
    this.setPageText(next.page, next.text)
    this.saveVersions([next.page], { at: Date.now(), by: this.author.trim() || undefined, quick: true, note: `Changed the synced section “${name}”` })
    return true
  }

  /** Replaces one line of a page while reading (switching an embed between picture and text), as a small version. */
  setPageLine(id: string, line: number, text: string, note: string) {
    if (this.readOnly) return
    const lines = W.pageText(this.board, id).replace(/\r\n?/g, '\n').split('\n')
    if (line < 0 || line >= lines.length || lines[line] === text) return
    this.saveVersions([id])
    lines[line] = text
    this.setPageText(id, lines.join('\n'))
    this.saveVersions([id], { at: Date.now(), by: this.author.trim() || undefined, quick: true, note })
  }

  /** Ticks or unticks a checklist item while reading: saved as a small version, credited to whoever ticked. */
  tickTask(id: string, line: number) {
    if (this.readOnly) return
    const before = W.pageText(this.board, id)
    const after = toggleTask(before, line)
    if (after === before) return
    // What it said first, so the tick is credited for the tick alone.
    this.saveVersions([id])
    this.setPageText(id, after)
    const raw = after.replace(/\r\n?/g, '\n').split('\n')[line] ?? ''
    const done = /\[[xX]\]/.test(raw)
    const words = raw.replace(/^[\s>]*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]\s*/, '').trim()
    const short = words.length > 40 ? `${words.slice(0, 39)}…` : words
    const me = this.author.trim() || undefined
    this.saveVersions([id], { at: Date.now(), by: me, quick: true, note: `${done ? 'Ticked' : 'Unticked'} “${short}”` })
  }

  /** A wiki panel to open (from Ctrl+K): the open page's history, recent changes, or adding Markdown files. */
  wikiPanel: 'history' | 'recent' | 'import' | null = null
  /** The wiki's Files are open (on `select`, a file to show first). */
  filesPanel: { select?: string } | null = null

  openFiles(select?: string) {
    this.filesPanel = select ? { select } : {}
    this.emit()
  }

  closeFiles() {
    this.filesPanel = null
    this.emit()
  }
  /** The page whose changes since the last visit are showing (it outlives the page view it opens). */
  changesOf: string | null = null
  /** Pages of "Since you were here" already looked at: their dots and banner rows go. */
  catchUpSeen = new Set<string>()

  showChanges(id: string | null) {
    this.changesOf = id
    if (id) {
      this.page = id
      this.catchUpSeen.add(id)
    }
    this.emit()
  }

  openWikiPanel(panel: 'history' | 'recent' | 'import') {
    this.wikiPanel = panel
    this.emit()
  }

  /** Marks a saved version to keep for good, or gives it a note. */
  markPageVersion(revId: string, mark: { note?: string; keep?: boolean }) {
    if (this.readOnly) return
    const next = RV.markRev(this.board, revId, mark)
    if (next === this.board) return
    this.apply(next)
    this.emit()
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
    // One at a time (a second would take the first's read-only state as the board's own).
    if (this.running) {
      this.setStatus('A run is under way — finish or stop it first')
      return false
    }
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
    if (BS.isMasked(item, this.me, BS.openRound(this.board))) return this.setStatus(`That's ${item.hiddenBy}'s note — hidden until the brainstorm is revealed`)
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
      // A stray key can replace a whole note: say how to get it back.
      const was = B.getItem(e.before, e.id)?.text
      if (e.replaced && was?.trim() && item && item.text !== was) this.setStatus('Replaced the text — Ctrl Z brings it back')
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
    if (open) {
      this.peek = null
      this.outlineOf = null
    }
    this.emit()
  }

  /** The mind map (by its central idea) shown as an outline beside the board, or null. */
  outlineOf: Id | null = null

  /** Shows the map `id` belongs to as an outline beside the board (null closes it). */
  openOutline(id: Id | null) {
    const root = id === null ? undefined : mapRoot(this.board, id)
    this.outlineOf = root?.id ?? null
    // One panel on the right at a time.
    if (root) {
      this.notesOpen = false
      this.peek = null
    }
    this.emit()
  }

  /** Fixes one problem Check board found (one undo step). */
  fixProblem(p: Problem) {
    if (this.readOnly) return
    const next = fixProblem(this.board, p, this.measure)
    if (next !== this.board) this.edit(() => next)
  }

  /** Fixes everything Check board found that has a fix (one undo step). */
  fixAllProblems() {
    if (this.readOnly) return
    const next = fixAll(this.board, this.measure)
    if (next !== this.board) this.edit(() => next)
  }

  /** Changes the map `id` belongs to so it matches an outline (one undo step). */
  setOutline(id: Id, text: string): boolean {
    if (this.readOnly) return false
    const next = applyOutline(this.board, id, text, this.measure)
    if (next === this.board) return false
    this.edit(() => next)
    return true
  }

  setAuthor(name: string, userId = this.userId) {
    this.author = name
    this.userId = userId
    this.emit()
  }

  /** Who I am, for finding mentions of me. */
  get mentionMe(): N.Me {
    return { ...(this.userId ? { id: this.userId } : {}), name: this.author.trim() }
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
    this.catchUpSeen = new Set()
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

  /** Adds a code block at the pointer, sized to its code. */
  addCode(code = '', lang?: string, at: Vec = this.pointer ?? center(this.visibleWorld)) {
    if (this.readOnly) return
    const { w, h } = codeSize(code)
    let id: Id = -1
    this.edit((b) => {
      const [next, newId] = B.addItem(b, B.newItem('code', rectFromCenter(at, w, h), { text: code, ...(langId(lang) ? { lang: langId(lang) } : {}) }))
      id = newId
      return next
    })
    this.tool = 'select'
    this.select([id])
    if (!code) this.startEditing(id, { before: this.board, created: true })
    return id
  }

  /** Sets a code block's language (for its colouring and label). */
  setCodeLang(id: Id, lang: string) {
    const l = langId(lang)
    if (!l || this.readOnly) return
    this.edit((b) => B.updateItem(b, id, (i) => (i.lang === l ? i : { ...i, lang: l })))
  }

  /** Turns flip cards over (the selected ones by default). */
  flipCards(ids: Id[] = [...this.selection]) {
    if (this.readOnly) return
    const cards = ids.filter((id) => {
      const i = B.getItem(this.viewBoard, id)
      return i && FL.isFlipCard(i) && !i.masked
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
    // Each selected object's own words (not other people's hidden notes); empty ones are skipped.
    const options = this.selectedItems
      .map((i) => B.getItem(this.viewBoard, i.id))
      .filter((i): i is Item => !!i && !i.masked)
      .map((i) => i.text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
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
      const [next, card] = BS.startBrainstorm(b, this.pointer ?? center(this.visibleWorld), this.me, prompt)
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
    this.setStatus(notes ? `Revealed ${notes} note${notes === 1 ? '' : 's'} — Ctrl Z hides them again` : 'Brainstorm closed')
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
    const before = this.board
    this.edit((b) => N.deleteNote(b, id, noteId))
    // One click deletes anyone's comment: make the way back obvious.
    if (this.board !== before) this.setStatus('Comment deleted — Ctrl Z brings it back')
  }

  // ----- wiki pages ------------------------------------------------------------------------

  /** The page a wiki is showing (null: its first page). */
  page: string | null = null
  /** A heading to scroll to on that page, once it's shown. */
  pageHeading: string | null = null
  /** A page was just made: its title takes the keyboard. */
  focusTitle = false
  /** The last typing on a page, so a burst of it undoes as one step. */
  private lastTyping: { page: string; at: number; board: Board } | null = null

  /** A wiki page shown beside the canvas (from a link on it), without leaving the board. */
  peek: { board: string; page: string; heading?: string } | null = null

  peekPage(to: { board: string; page: string; heading?: string } | null) {
    this.peek = to
    // One panel on the right at a time.
    if (to) {
      this.notesOpen = false
      this.outlineOf = null
    }
    this.emit()
  }

  /** The page being shown: the one picked, or else the wiki's first. */
  get currentPage(): Page | undefined {
    if (!W.isWiki(this.board)) return undefined
    const picked = W.getPage(this.board, this.page ?? undefined)
    return picked && !picked.trashed ? picked : W.pageOrder(this.board)[0]
  }

  openPage(id: string, heading: string | null = null) {
    this.page = id
    if (this.catchUp?.pages) this.catchUpSeen.add(id)
    this.pageHeading = heading
    this.emit()
  }

  /** Adds a page (under `parent`, before `before` or last) and opens it. */
  /**
   * A template button pressed on page `from` (its macro on line `line`): a new page from the
   * template, or the template's words added below the button. Says so when it can't.
   */
  pressTemplateButton(from: string, line: number, plan: ButtonPlan) {
    if (this.readOnly) return
    const tpl = plan.template ? W.pageByTitle(this.board, plan.template) : undefined
    if (!tpl) return this.setStatus(plan.template ? `There's no page called “${plan.template}” to use as the template` : 'This button names no template page: add template="Page title"')
    const now = new Date()
    const me = this.author.trim()
    const words = stamp(W.pageText(this.board, tpl.id), now, me)
    if (plan.here) {
      const lines = W.pageText(this.board, from).replace(/\r\n?/g, '\n').split('\n')
      lines.splice(line + 1, 0, '', ...words.replace(/^#\s+.*\n+/, '').split('\n'))
      this.saveVersions([from])
      this.setPageText(from, lines.join('\n'))
      this.saveVersions([from], { at: Date.now(), by: me || undefined, quick: true, note: `Added “${tpl.title}”` })
      return
    }
    const parent = plan.under ? W.pageByTitle(this.board, plan.under)?.id : from
    const title = newTitle(plan, tpl.title, now, me)
    // A template that starts with its own title as a heading gets the new one.
    const body = words.replace(/^#\s+.*(\n|$)/, `# ${title}$1`)
    this.addWikiPage({ title, parent, text: body })
  }

  addWikiPage(opts: { title?: string; parent?: string; before?: string; text?: string } = {}): string {
    let id = ''
    this.edit((b) => {
      const [next, made] = W.addPage(b, { title: opts.title ?? '', parent: opts.parent, before: opts.before, text: opts.text }, Date.now(), this.author.trim() || undefined)
      id = made
      return next
    })
    // A page without a name yet: its title is the first thing to type.
    if (id && opts.title === undefined) this.focusTitle = true
    if (id) this.openPage(id)
    else if (!this.readOnly) this.setStatus(`This wiki is full (${W.MAX_PAGES.toLocaleString('en')} pages)`)
    return id
  }

  // ----- files -----------------------------------------------------------------------

  /** Keeps a file's details on the board (its bytes are already in the file store). */
  addFile(f: BoardFile) {
    this.edit((b) => FS.addFile(b, f))
  }

  updateFile(id: string, change: (f: BoardFile) => BoardFile) {
    this.edit((b) => FS.updateFile(b, id, change))
  }

  /** To the trash (or back out of it). */
  trashFile(id: string, on = true) {
    this.edit((b) => FS.trashFile(b, id, on))
  }

  /** Forgets a file entirely; its bytes are the store's to delete. */
  removeFile(id: string) {
    this.edit((b) => FS.removeFile(b, id))
  }

  /**
   * Makes the pages a file became (see toWiki.ts), under `parent` or at the top, as one step; the
   * file remembers its page. Returns the main page's id ('' when the wiki is full).
   */
  addPagesFromPlan(plan: PagePlan, file?: string, parent?: string): string {
    if (this.readOnly) return ''
    const by = this.author.trim() || undefined
    let root = ''
    this.edit((b) => {
      const add = (board: Board, p: PagePlan, under?: string): Board => {
        const [next, id] = W.addPage(board, { title: p.title, parent: under, text: p.text, ...(p.icon ? { icon: p.icon } : {}) }, Date.now(), by)
        if (!id) return board
        if (!root) root = id
        return p.children.reduce((acc, c) => add(acc, c, id), next)
      }
      const next = add(b, plan, parent)
      return file && root ? FS.updateFile(next, file, (f) => ({ ...f, page: root })) : next
    })
    if (root) this.openPage(root)
    else this.setStatus(`This wiki is full (${W.MAX_PAGES.toLocaleString('en')} pages)`)
    return root
  }

  setPageTitle(id: string, title: string) {
    if (W.getPage(this.board, id)?.title === title) return
    this.saveVersions([id])
    this.edit((b) => W.setPageMeta(b, id, { title }))
    this.saveVersions([id], { at: Date.now(), by: this.author.trim() || undefined })
  }

  setPageIcon(id: string, icon: string | null) {
    this.edit((b) => W.setPageMeta(b, id, { icon }))
  }

  /** Replaces a page's words; typing in quick succession on one page is one undo step. */
  setPageText(id: string, text: string) {
    if (this.readOnly) return
    // A long stretch of writing still leaves versions behind, every few minutes.
    // (Counted from when a version was last saved here, not when its words were written.)
    const saved = this.versionSaved.get(id)
    if (saved !== undefined && Date.now() - saved > RV.REV_EVERY && RV.unsavedChanges(this.board, id)) this.saveVersions([id])
    const before = this.board
    this.apply(W.setPageBody(this.board, id, text, Date.now(), this.author.trim() || undefined))
    if (this.board === before) return
    const t = this.lastTyping
    const now = Date.now()
    if (t && t.page === id && now - t.at < 1500 && t.board === before) this.history.amend(before, this.board)
    else this.history.commit(before, this.board)
    this.lastTyping = { page: id, at: now, board: this.board }
    this.emit()
  }

  /** Adds pages (from Markdown files) under `parent`, in order, as one undo step; returns their ids. */
  importPages(pages: { title: string; text: string }[], parent?: string): string[] {
    if (this.readOnly || !W.isWiki(this.board) || !pages.length) return []
    const ids: string[] = []
    const by = this.author.trim() || undefined
    this.lastTyping = null
    this.edit((b) => {
      for (const p of pages) {
        let id: string
        ;[b, id] = W.addPage(b, { title: p.title, text: p.text, parent }, Date.now(), by)
        if (id) ids.push(id)
      }
      return b
    })
    this.saveVersions(ids, { note: 'Added from a Markdown file' })
    const skipped = pages.length - ids.length
    this.setStatus(`Added ${ids.length} page${ids.length === 1 ? '' : 's'} from Markdown${skipped ? ` (${skipped} didn’t fit: the wiki is full)` : ''}`)
    return ids
  }

  /** Puts a page's title and words back as they were in an old version, as one undo step. */
  restorePageVersion(id: string, title: string, text: string, when: string) {
    if (this.readOnly || !W.getPage(this.board, id)) return
    this.lastTyping = null
    this.saveVersions([id])
    this.edit((b) => W.setPageMeta(W.setPageBody(b, id, text, Date.now(), this.author.trim() || undefined), id, { title }))
    this.saveVersions([id], { note: `Put back ${when}` })
    this.setStatus(`Put back ${when} — undo takes it back`)
  }

  /** Moves a page (and its sub-pages) under `parent` (undefined: the top), before `before` or last. */
  movePageTo(id: string, parent: string | undefined, before?: string) {
    const was = this.board
    this.edit((b) => W.movePage(b, id, parent, before))
    if (this.board === was && parent !== undefined && W.withDescendants(was, id).has(parent)) this.setStatus('A page can’t go inside one of its own sub-pages')
  }

  /** Protects a page (and the pages under it), or lifts its protection. */
  setPageProtected(id: string, on: boolean) {
    const page = W.getPage(this.board, id)
    if (!page || this.readOnly) return
    this.edit((b) => W.setPageMeta(b, id, { protected: on }))
    this.setStatus(on ? `“${page.title || 'Untitled'}” is protected` : `“${page.title || 'Untitled'}” is no longer protected`)
  }

  trashPage(id: string) {
    const page = W.getPage(this.board, id)
    if (!page) return
    const count = W.withDescendants(this.board, id).size
    this.edit((b) => W.trashPage(b, id))
    if (this.page === id) this.page = null
    this.setStatus(`Moved “${page.title || 'Untitled'}”${count > 1 ? ` and ${count - 1} sub-page${count > 2 ? 's' : ''}` : ''} to the trash — restore it from the Trash in the page list`)
  }

  restorePage(id: string) {
    this.edit((b) => W.restorePage(b, id))
    this.openPage(id)
  }

  /**
   * Keeps a wiki's copy of an embedded object up to date (for friends without that board). Not an
   * undo step: it follows the board it copies. Copies no page embeds any more go at the same time.
   */
  keepSnap(snap: EmbedSnap) {
    if (this.readOnly || !W.isWiki(this.board)) return
    const used = new Set((this.board.bodies ?? []).flatMap((x) => embedKeys(x.text)))
    const old = getSnap(this.board, snap.key)
    const same = !used.has(snap.key) || (old && old.at === snap.at && old.by === snap.by)
    const stale = unusedSnaps(this.board, used)
    // Nothing new to keep and nothing to drop: no change, no save, no break in the undo step.
    if (same && !stale.length) return
    let next = same ? this.board : setSnap(this.board, snap)
    if (stale.length) next = { ...next, snaps: (next.snaps ?? []).filter((s) => !stale.includes(s.key)) }
    if (!next.snaps?.length) delete next.snaps
    this.apply(next)
    this.emit()
  }

  deletePageForever(id: string) {
    this.edit((b) => W.deletePage(b, id))
    if (this.page === id) this.page = null
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
  pickShape(shape: NextShape) {
    const p = this.shapePicker
    if (!p) return
    this.shapePicker = null
    const before = this.board
    if (!isPlainNext(shape)) {
      const [b, id] = F.addStepAt(this.board, p.from, shape, p.at)
      this.apply(b)
      this.startEditing(id, { before, created: true })
      return
    }
    // Another of the same keeps its size and colour; a different kind starts as that kind does.
    const source = B.getItem(this.board, p.from)
    const same = source?.kind === shape
    const size = same ? { w: source!.w, h: source!.h } : defaultSize(shape)
    const shapes = (k?: Kind) => k === 'rect' || k === 'ellipse'
    const color = same || (shapes(source?.kind) && shapes(shape)) ? { color: source!.color } : {}
    const item = B.newItem(shape, rectFromCenter(p.at, size.w, size.h), { ...color, ...(same ? { fontSize: source!.fontSize, ...(source!.fontFixed ? { fontFixed: true as const } : {}) } : {}), ...(source?.sketch ? { sketch: true as const } : {}) })
    const [b, id] = B.addItem(this.board, item)
    this.apply(B.connect(b, p.from, id)[0])
    this.startEditing(id, { before, created: true })
  }

  /** The next-shape picker where a step would go from `id` towards `dir` (Shift on a blue arrow). */
  chooseFlowStep(id: Id, dir: F.FlowDir) {
    const from = B.getItem(this.board, id)
    if (!from || this.readOnly) return
    const options = F.recommendShapes(this.board, from.shape)
    const info = flowShapeInfo(options[0])
    const r = F.placeNext(this.board, from, dir, info.w, info.h)
    this.shapePicker = { from: id, at: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, options }
    this.emit()
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

  /** Opens a drawing in Excalidraw: the one with `id`, or a new one (in the middle of the view). */
  openDrawing(id?: Id, scene?: ExcalidrawScene, at: Vec = this.pointer ?? center(this.visibleWorld)) {
    const item = id === undefined ? undefined : B.getItem(this.board, id)
    if (id !== undefined && !isDrawing(item)) return
    if (id === undefined && this.readOnly) return
    this.drawing = { id: id ?? null, at: item ? { x: item.x + item.w / 2, y: item.y + item.h / 2 } : at, ...(scene ? { scene } : {}) }
    this.emit()
  }

  closeDrawing() {
    this.drawing = null
    this.emit()
  }

  /**
   * Keeps a drawing: its scene and its picture (`src`, `w`×`h`, as drawn). An existing drawing keeps
   * its width on the board and its middle; a new one is placed where it was opened. One undo step.
   */
  saveDrawing(id: Id | null, scene: ExcalidrawScene, picture: { src: string; w: number; h: number }, at?: Vec): Id | null {
    if (this.readOnly) return null
    const text = sceneText(scene)
    const old = id === null ? undefined : B.getItem(this.board, id)
    if (id !== null && !isDrawing(old)) return null
    const ratio = picture.h / Math.max(1, picture.w)
    let made: Id | null = id
    this.edit((b) => {
      if (old) {
        const w = old.w
        const h = Math.max(8, w * ratio)
        return B.updateItem(b, old.id, (i) => ({ ...i, src: picture.src, excalidraw: scene, text, y: i.y + (i.h - h) / 2, h }))
      }
      const scale = Math.min(1, 640 / Math.max(picture.w, picture.h))
      const w = Math.max(40, picture.w * scale)
      const [next, newId] = B.addItem(b, B.newItem('image', rectFromCenter(at ?? this.drawing?.at ?? center(this.visibleWorld), w, w * ratio), { src: picture.src, text }))
      made = newId
      return B.updateItem(next, newId, (i) => ({ ...i, excalidraw: scene }))
    })
    this.tool = 'select'
    if (made !== null) this.select([made])
    return made
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

  /** A card for a wiki page (from a pasted page link): its title and opening words, opened beside the board. */
  addPageCard(page: { board: string; page: string }, url: string, preview: Partial<LinkCard>, at: Vec = this.pointer ?? center(this.visibleWorld)) {
    let id = -1
    this.edit((b) => {
      const [next, newId] = B.addItem(b, { ...withPreview({ ...linkItem(url, at), id: 0 } as Item, { ...preview, checked: true }), page })
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
    return toMermaid(this.viewBoard, this.selection.size ? this.selection : undefined)
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
    // The database's automations follow the change, in the same undo step.
    this.edit((b) => D.updateDataset(b, datasetId, (d) => runAutomations(d, f(d))))
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
    this.updateItem(id, (i) => {
      if (!i.kanban) return i
      const kanban = f(i.kanban)
      // More columns than it had: the board widens to show them, if it was showing them all before.
      const grew = kanban.columns.length > i.kanban.columns.length && i.w >= kanbanWidth(i.kanban) - 2
      return { ...i, kanban, ...(grew ? { w: Math.max(i.w, kanbanWidth(kanban)) } : {}) }
    })
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
    // Room taken by the chrome: top bars, the tool rail (bottom on phones), the zoom bar and status key, side panels.
    const phone = this.viewport.w <= 720
    const pad = { left: phone ? 16 : 76, top: phone ? 116 : 72, right: 16 + this.rightInset, bottom: phone ? 132 : 104 }
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
    if (!phone) {
      // The minimap holds the bottom-right corner (200 × 136, 12px in): clear it, upwards if there's room.
      const corner = { x: this.viewport.w - this.rightInset - 220, y: this.viewport.h - 156 }
      const right = r.x + dx + r.w
      const bottom = r.y + dy + r.h
      if (right > corner.x && bottom > corner.y) {
        if (corner.y - r.h >= pad.top) dy += corner.y - bottom
        else dx += corner.x - right
      }
    }
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
    // Never type blind: a new idea past the edge of the screen comes into view.
    this.keepInView(newId)
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
    this.setStatus(`Deleted ${what}  ·  Ctrl Z to undo`)
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

  /** Ticks the selection off (or, when it's all done already, unticks it): Ctrl Enter. */
  toggleDone() {
    const marked = this.selectedItems.filter((i) => ST.canHaveStatus(i.kind))
    if (!marked.length) return
    if (marked.every((i) => i.status === 'done')) {
      this.edit((b) => ST.setStatus(b, marked.map((i) => i.id), null))
      this.setStatus(marked.length === 1 ? 'Not done any more' : `${marked.length} objects not done any more`)
    } else this.markStatus('done')
  }

  // ----- time tracking, assignees and estimates -------------------------------------------

  /** Me, for timers and time: my name, and my account when signed in. */
  get person(): TT.Person {
    return { name: this.me, ...(this.userId ? { user: this.userId } : {}) }
  }

  /** My timer running on this board, if any. */
  get myTimer(): TimeEntry | undefined {
    return TT.runningFor(this.board, this.person)
  }

  /** What "this" is for a timer: the one selected object, else the wiki page open, else the board. */
  get timeTarget(): TimeTarget | undefined {
    const one = this.single
    if (one && ST.canHaveStatus(one.kind)) return { item: one.id }
    if (W.isWiki(this.board) && this.page) return { page: this.page }
    return undefined
  }

  /** Starts my timer on `on` (what's selected, by default); one already running stops first. */
  startTracking(on: TimeTarget | undefined = this.timeTarget, note?: string) {
    if (this.readOnly) return
    let started: { id: string; stopped?: TimeEntry } | null = null
    this.edit((b) => {
      const r = TT.startTimer(b, { ...this.person, on, note, now: Date.now() })
      started = r
      return r.board
    })
    const what = TT.describeTarget(this.board, on).label
    const stopped = started!.stopped
    this.setStatus(stopped ? `Timing ${what} (stopped ${TT.formatDuration(TT.durationOf(stopped, Date.now()))} on ${TT.describeTarget(this.board, stopped.on, stopped.label).label})` : `Timing ${what}`)
  }

  /** Stops my timer (at `end`, when it ran on after I stopped working). */
  stopTracking(end?: number) {
    if (this.readOnly || !this.myTimer) return
    let stopped: TimeEntry | undefined
    this.edit((b) => {
      const r = TT.stopTimer(b, this.person, Date.now(), end)
      stopped = r.stopped
      return r.board
    })
    if (stopped) this.setStatus(`${TT.formatDuration(TT.durationOf(stopped, Date.now()))} on ${TT.describeTarget(this.board, stopped.on, stopped.label).label}`)
  }

  /** Alt T: stops my timer when it's on what's selected, else starts one there. */
  toggleTracking() {
    const mine = this.myTimer
    if (mine && TT.sameTarget(mine.on, this.timeTarget)) this.stopTracking()
    else this.startTracking()
  }

  /** Time logged by hand; the error's words when it can't be right. */
  logTime(o: { who?: TT.Person; on?: TimeTarget; start: number; end: number; note?: string }): string | null {
    if (this.readOnly) return 'This board is view-only'
    try {
      const who = o.who ?? this.person
      const next = TT.logTime(this.board, { ...who, on: o.on, start: o.start, end: o.end, note: o.note, by: this.me }).board
      this.edit(() => next)
      this.setStatus(`Logged ${TT.formatDuration(o.end - o.start)}${who.name === this.me ? '' : ` for ${who.name}`}`)
      return null
    } catch (err) {
      return (err as Error).message
    }
  }

  /** Changes one time entry; the error's words when it can't be right. */
  updateTime(id: string, c: TT.EntryChange): string | null {
    if (this.readOnly) return 'This board is view-only'
    try {
      const next = TT.updateEntry(this.board, id, c)
      this.edit(() => next)
      return null
    } catch (err) {
      return (err as Error).message
    }
  }

  deleteTime(id: string) {
    if (this.readOnly) return
    this.edit((b) => TT.deleteEntry(b, id))
    this.setStatus('Time entry deleted (Ctrl Z brings it back)')
  }

  /** Assigns people to the selection (or `ids`): set, add or take away. */
  assign(names: string[], how: 'set' | 'add' | 'remove' = 'set', ids: Id[] = [...this.selection]) {
    if (this.readOnly || !ids.length) return
    this.edit((b) => TT.assign(b, ids, names, how))
  }

  /** How long the selection (or `ids`) should take, in minutes; null clears it. */
  setEstimate(minutes: number | null, ids: Id[] = [...this.selection]) {
    if (this.readOnly || !ids.length) return
    this.edit((b) => TT.setEstimate(b, ids, minutes))
  }

  /** Dims everything not assigned to this person; the same person again (or null) shows everything. */
  setPersonFilter(name: string | null) {
    this.personFilter = name && name.toLowerCase() !== this.personFilter?.toLowerCase() ? name : null
    this.emit()
  }

  /** Opens the timesheet, on time spent on `on` (or everything), or with time to log. */
  openTimesheet(o: { on?: TimeTarget; log?: boolean } | null = {}) {
    this.timesheet = o
    this.emit()
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

  /** Text a size larger or smaller. Text sized to its shape keeps the new size from then on, starting from the size it's shown at. */
  scaleFont(factor: number) {
    this.edit((b) =>
      B.updateItems(b, this.selection, (i) => {
        if (i.kind === 'mind') return i
        const from = growsText(i) && !i.fontFixed ? itemFontSize(i, this.measure) : i.fontSize
        return { ...i, fontSize: Math.min(400, Math.max(6, Math.round(from * factor))), ...(growsText(i) ? { fontFixed: true as const } : {}) }
      }),
    )
  }

  /**
   * Each selected object sized to what's in it: shapes and sticky notes to their text (an empty one
   * back to its usual size), text boxes, code and tables to theirs, and frames to what's inside.
   */
  fitToContent() {
    // Frames last, so they wrap what's in them as it ends up.
    const ids = this.selectedItems
      .filter((i) => !i.locked && canFitToContent(i))
      .sort((a, z) => Number(a.kind === 'frame') - Number(z.kind === 'frame'))
      .map((i) => i.id)
    if (!ids.length) return this.setStatus('Fit to content works on shapes, sticky notes, text, code, tables and frames')
    let changed = 0
    let emptyFrames = 0
    this.edit((b) => {
      for (const id of ids) {
        const i = B.getItem(b, id)
        if (!i) continue
        const r = fitToContent(b, i, this.measure)
        if (!r) {
          if (i.kind === 'frame') emptyFrames++
          continue
        }
        if (r.x === i.x && r.y === i.y && r.w === i.w && r.h === i.h) continue
        b = B.updateItem(b, id, (x) => B.setRect(x, r))
        changed++
      }
      return b
    })
    this.setStatus(changed ? `Fitted ${changed === 1 ? 'it' : `${changed} objects`} to ${changed === 1 ? 'its' : 'their'} content` : emptyFrames ? 'There’s nothing in the frame to fit it to' : 'Already fits its content')
  }

  /** Whether Same size has two or more objects to work on. */
  get canMatchSize(): boolean {
    return this.selectedItems.filter((i) => !i.locked && canMatchSize(i)).length > 1
  }

  /** The selected shapes, notes and comments made one size: the largest of them, each about its centre. */
  matchSize() {
    const items = this.selectedItems.filter((i) => !i.locked && canMatchSize(i))
    if (items.length < 2) return this.setStatus('Select two or more shapes or notes to make them the same size')
    const rects = sameSize(items)
    this.edit((b) => B.updateItems(b, new Set(rects.keys()), (i) => B.setRect(i, rects.get(i.id)!)))
    this.setStatus(`Made ${items.length} the same size`)
  }

  /** Text sized to its shape again, after being given a size. */
  fitText() {
    this.edit((b) =>
      B.updateItems(b, this.selection, (i) => {
        if (!i.fontFixed) return i
        const { fontFixed: _, ...rest } = i
        return { ...rest, fontSize: B.newItem(i.kind, i).fontSize }
      }),
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
    // Someone else's hidden brainstorm note copies as the blank you see.
    const clip = B.copy(this.viewBoard, this.selection)
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
  /**
   * Draws objects by hand, or not: the selection (or `ids`), a flowchart shape bringing its whole
   * flowchart. Lines follow the objects they join. One undo step.
   */
  setSketch(on: boolean, ids: Iterable<Id> = this.selection) {
    if (this.readOnly) return
    const all = new Set<Id>()
    for (const id of ids) {
      all.add(id)
      for (const f of flowComponent(this.board, id)) all.add(f)
    }
    const before = this.board
    this.edit((b) => setSketch(b, all, on))
    if (this.board !== before) this.setStatus(on ? 'Hand-drawn' : 'Drawn with clean lines again')
  }

  /**
   * A hand-drawn board (or not): everything on it drawn by hand now, and everything made on it from
   * now on too, for everyone in the session. One undo step.
   */
  setBoardSketch(on: boolean) {
    if (this.readOnly) return
    const before = this.board
    this.edit((b) => setBoardSketch(b, on))
    if (this.board !== before) this.setStatus(on ? 'Hand-drawn board: everything here, and everything you add, is drawn by hand' : 'Clean lines again')
  }

  /** Makes the selection (or `ids`) lead somewhere when clicked, or not (null). One undo step. */
  setLink(link: ItemLink | null, ids: Iterable<Id> = this.selection) {
    if (this.readOnly) return
    const before = this.board
    this.edit((b) => setItemLink(b, ids, link))
    if (this.board !== before) this.setStatus(link ? 'Linked: click the badge on its corner to follow it' : 'Link removed')
  }

  /** Whether everything selected that can be drawn by hand is. */
  get selectionSketched(): boolean {
    const items = this.selectedItems.filter((i) => canSketch(i.kind))
    return items.length > 0 && items.every((i) => i.sketch)
  }

  setLocked(locked: boolean) {
    if (this.readOnly || !this.selection.size) return
    const ids = new Set(this.selection)
    this.edit((b) => B.updateItems(b, ids, (i) => {
      if (!!i.locked === locked) return i
      const next: Item = { ...i, locked }
      if (!locked) delete next.locked
      return next
    }))
    this.setStatus(locked ? UNLOCK_HINT() : 'Unlocked')
  }

  /** Groups the selection so it selects and moves as one (mind-map ideas get a new parent idea instead). */
  group() {
    const items = this.selectedItems
    if (this.readOnly || items.length < 2) return
    if (items.every((i) => i.kind === 'mind')) return this.groupIdeas()
    const id = uid()
    const ids = new Set(items.map((i) => i.id))
    this.edit((b) => B.updateItems(b, ids, (i) => ({ ...i, group: id })))
    this.setStatus(`Grouped ${ids.size} objects — Ctrl Shift G to ungroup`)
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
    // Other people's hidden brainstorm notes copy as blank cards.
    return clipToText(B.copy(this.viewBoard, this.selection))
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
    const fenced = fencedCode(text)
    if (fenced) {
      this.addCode(fenced.code, fenced.lang, at)
      this.setStatus('Pasted as a code block')
      return
    }
    const url = urlIn(text)
    if (url) {
      this.addLink(url, at)
      this.setStatus('Pasted as a link card')
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

  /** The right mouse button pressed: dragging pans the board, and letting go without moving is a right-click. */
  rightDown(screen: Vec) {
    this.shapePicker = null
    this.drag = { type: 'pan', last: screen, right: { at: screen, moved: false } }
    this.emit()
  }

  /**
   * The right mouse button let go. True when it was a right-click rather than a pan: what's under it
   * is selected (as a right-click does) and the menu should open.
   */
  rightUp(screen: Vec): boolean {
    const d = this.drag
    if (d.type !== 'pan' || !d.right) return false
    this.drag = { type: 'none' }
    if (d.right.moved) {
      this.emit()
      return false
    }
    this.pointerDown(screen, 2, {})
    return true
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
      // Selecting several (touch), press-and-hold opens the menu for what's already picked.
      if (this.tapToAdd) return
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
            // Shift on a blue arrow: choose the next shape, rather than the usual one.
            this.drag = { type: 'connect', from: item.id, current: world, origin: screen, quick, ...(quick && mods.shift ? { choose: true } : {}) }
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
      if (this.tapToAdd) mods = { ...mods, shift: true }
      // Alt-click reaches locked objects (to select and unlock them).
      const hit = this.hitAt(screen, mods.alt)
      // A finger on empty space (or anywhere, on a board that can't be changed) moves the board,
      // as on any map; a tap there still clears the selection.
      if (mods.touch && !mods.shift && (!hit || this.readOnly)) {
        if (!hit) {
          this.selection = new Set()
          this.selectedConnector = null
        }
        this.drag = { type: 'pan', last: screen, ...(hit?.type === 'item' ? { tap: { id: hit.id, at: screen } } : {}) }
        this.emit()
        return
      }
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
        // A locked object ignores clicks; say why (locked frames are backgrounds, so they stay quiet).
        const under = this.hitAt(screen, true)
        const locked = under?.type === 'item' ? B.getItem(this.board, under.id) : undefined
        if (locked?.locked && locked.kind !== 'frame') this.setStatus(UNLOCK_HINT())
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
        // A right press only pans once it moves: held still, it's a right-click (the menu).
        if (d.right && !d.right.moved) {
          if (dist(d.right.at, screen) < RIGHT_CLICK_SLOP) break
          d.right.moved = true
        }
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
        d.at = this.board
        d.applied = delta
        break
      }
      case 'branch': {
        d.offset = { x: world.x - d.start.x, y: world.y - d.start.y }
        d.target = this.branchDropTarget(d.id, world)
        // The idea itself follows the pointer, its branch and lines with it.
        const base = B.getItem(d.before, d.id)?.offset ?? { x: 0, y: 0 }
        this.apply(B.updateItem(d.before, d.id, (i) => ({ ...i, offset: { x: base.x + d.offset.x, y: base.y + d.offset.y } })))
        d.at = this.board
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
        d.at = this.board
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
      case 'pan':
        // A still tap on a board that can't change selects (to read comments, copy, follow a run).
        if (d.tap && dist(d.tap.at, screen) < 8) this.select(B.withGroups(this.board, [d.tap.id]))
        break
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
        // A click (not a drag) on a flowchart arrow adds the next step that way (with Shift, asks which).
        if (d.quick && dist(d.origin, screen) < 5) {
          if (d.choose) this.chooseFlowStep(d.from, d.quick)
          else this.addFlowStep(d.from, d.quick)
        } else this.finishConnect(d.from, world)
        break
    }
    this.emit()
  }

  /** Abandons the current gesture (e.g. when a second finger starts a pinch). */
  cancelDrag() {
    const d = this.drag
    // Takes back only what the drag itself changed, whatever else has happened since.
    if ('before' in d && d.at) this.apply(this.rebase(d.at, d.before))
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
    // A shape, note or text: which one next (another like it first, so 1 or Enter keeps it the same).
    if (isPlainNext(source.kind)) {
      this.shapePicker = { from, at: world, options: [source.kind, ...PLAIN_NEXT.filter((k) => k !== source.kind), 'decision', 'terminator'] }
      this.emit()
      return
    }
    const item = B.newItem(source.kind, rectFromCenter(world, source.w, source.h), { color: source.color, fontSize: source.fontSize, ...(source.fontFixed ? { fontFixed: true as const } : {}) })
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
    } else if (hit?.type === 'item' && isDrawing(target)) {
      this.openDrawing(hit.id)
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

  /**
   * The mouse wheel: `zoom` zooms at the pointer (about 16% a notch), `pinch` follows a trackpad
   * pinch (small, frequent steps), `pan` moves the board.
   */
  wheel(screen: Vec, dx: number, dy: number, how: 'zoom' | 'pinch' | 'pan') {
    this.flight++
    this.onUserCamera?.()
    if (how === 'pinch') this.camera = zoomAt(this.camera, screen, Math.exp(-dy * 0.01))
    else if (how === 'zoom') this.camera = zoomAt(this.camera, screen, Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0015))
    else this.camera = { ...this.camera, x: this.camera.x - dx, y: this.camera.y - dy }
    this.emit()
  }

  // ----- keyboard ----------------------------------------------------------------

  /** Whether `key` would start typing into the one selected object (replacing its text). */
  typesInto(key: string, mods: Modifiers = {}): boolean {
    const node = this.single
    return !!node && !mods.alt && !mods.ctrl && key.length === 1 && key !== ' ' && hasText(node.kind) && !isWidget(node.kind) && !this.readOnly
  }

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
      // Flowchart symbols: the same numbers as the shape panel, whatever order the suggestions come
      // in. With plain shapes in the list too, the numbers are the list's.
      const opts = this.shapePicker.options
      const n = /^[1-9]$/.test(k) ? Number(k) : 0
      const shape = !n ? undefined : opts.some(isPlainNext) ? opts[n - 1] : FLOW_SHAPES[n - 1]?.shape
      if (k === 'Enter') this.pickShape(opts[0])
      else if (shape) this.pickShape(shape)
      else if (k === 'Escape') this.cancelShapePicker()
      else return false
      return true
    }
    if ('before' in this.drag) {
      // Mid-drag, Esc puts things back as they were; undo or delete would tangle with the drag.
      if (k === 'Escape') this.cancelDrag()
      else if (!(mods.ctrl || k === 'Delete' || k === 'Backspace')) return false
      return true
    }
    // With the shape panel open and nothing selected, its numbers pick a shape to place.
    const panelShape = this.flowPalette && !this.selection.size && !mods.ctrl && !mods.alt && /^[1-9]$/.test(k) ? FLOW_SHAPES[Number(k) - 1]?.shape : undefined
    if (panelShape) {
      this.setFlowShape(panelShape)
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
      else if (k === 'Enter' && this.selection.size) this.toggleDone()
      else return false
      return true
    }
    // Letters with Alt act on the selection; plain or shifted ones type into it (below).
    if (mods.alt && k === 'c') {
      this.toggleNotes()
      return true
    }
    if (mods.alt && k === 't' && !this.readOnly) {
      this.toggleTracking()
      return true
    }
    if (mods.alt && k === 'r' && this.single?.kind === 'flow') {
      this.startRun()
      return true
    }
    const node = this.single
    const mind = node?.kind === 'mind' ? node : undefined

    if (mods.shift && k === '!' && !this.typesInto(key, mods)) {
      this.zoomToFit()
      return true
    }
    if (k === 'Delete' || k === 'Backspace') {
      this.deleteSelection()
      return true
    }
    if (k === 'Escape') {
      // First Esc deselects; another (or the first, with nothing selected) closes the flowchart shape panel.
      if (!this.selection.size && this.selectedConnector === null && (this.tool === 'select' || this.tool === 'flow') && this.flowPalette) this.flowPalette = false
      this.tapToAdd = false
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
          if (next !== undefined) {
            this.select([next])
            this.keepInView(next)
          }
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
    if (node && this.typesInto(key, mods)) {
      this.startEditing(node.id)
      if (this.editing) this.editing.replaced = true
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
      if (kind === 'mind') return 'Enter next idea  ·  Tab sub-idea  ·  Shift Enter new line  ·  Esc done'
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
      return 'Tab add sub-idea  ·  Enter add idea below  ·  Arrows move  ·  Space edit  ·  / collapse  ·  Alt C comments'
    if (node?.kind === 'flow')
      return 'Tab next step  ·  Alt Arrow add a step that way  ·  Enter edit  ·  Drag a blue arrow for shape ideas'
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
