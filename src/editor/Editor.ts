/**
 * The editor: board, camera, selection, tools and every gesture, independent of
 * React. The UI forwards pointer and keyboard input in canvas (screen) pixels and
 * re-renders whenever the editor emits.
 */

import * as B from '../model/board'
import { type Camera, centerOn, defaultCamera, fit, rectToWorld, toScreen, toWorld, zoomAt } from '../model/camera'
import { type Rect, type Vec, center, dist, rectFromCenter, rectFromPoints } from '../model/geom'
import { History } from '../model/history'
import * as M from '../model/mindmap'
import { clipFromText, clipToText } from '../model/serialize'
import { type Board, type Id, type Item, type Kind, type Side, INKS, defaultSize, hasText, isResizable } from '../model/types'

export type Tool = 'select' | 'hand' | 'sticky' | 'text' | 'rect' | 'ellipse' | 'connector' | 'pen' | 'frame' | 'mind'

export const TOOLS: { tool: Tool; key: string; label: string }[] = [
  { tool: 'select', key: 'v', label: 'Select' },
  { tool: 'hand', key: 'h', label: 'Hand' },
  { tool: 'sticky', key: 'n', label: 'Sticky note' },
  { tool: 'text', key: 't', label: 'Text' },
  { tool: 'rect', key: 'r', label: 'Rectangle' },
  { tool: 'ellipse', key: 'o', label: 'Ellipse' },
  { tool: 'mind', key: 'm', label: 'Mind map' },
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

export type Drag =
  | { type: 'none' }
  | { type: 'pan'; last: Vec }
  | { type: 'move'; ids: Set<Id>; last: Vec; before: Board }
  | { type: 'branch'; id: Id; start: Vec; offset: Vec; target: Id | null; before: Board }
  | { type: 'resize'; id: Id; anchor: Vec; before: Board }
  | { type: 'marquee'; start: Vec; current: Vec; base: Set<Id> }
  | { type: 'create'; kind: Kind; start: Vec; current: Vec }
  | { type: 'draw'; points: Vec[] }
  | { type: 'connect'; from: Id; current: Vec }

export interface Editing {
  id: Id
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

export class Editor {
  board: Board
  camera: Camera = defaultCamera()
  tool: Tool = 'select'
  selection = new Set<Id>()
  selectedConnector: Id | null = null
  editing: Editing | null = null
  drag: Drag = { type: 'none' }
  viewport = { w: 1200, h: 800 }
  penColor = INKS[0][1]
  penWidth = 4
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
    const next = M.layoutAll(b, this.measure)
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

  load(board: Board, status = '') {
    this.board = M.layoutAll(board, this.measure)
    this.selection.clear()
    this.selectedConnector = null
    this.editing = null
    this.drag = { type: 'none' }
    this.history.clear()
    this.status = status
    this.zoomToFit()
    this.onBoardChange?.(this.board)
    this.emit()
  }

  setStatus(status: string) {
    this.status = status
    this.emit()
  }

  setViewport(w: number, h: number) {
    this.viewport = { w, h }
    this.emit()
  }

  setTool(tool: Tool) {
    this.finishEditing()
    this.tool = tool
    this.emit()
  }

  setTitle(title: string) {
    this.edit((b) => (b.title === title ? b : { ...b, title }))
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
    const prev = this.history.undo(this.board)
    if (prev) this.afterJump(prev)
  }

  redo() {
    this.finishEditing()
    const next = this.history.redo(this.board)
    if (next) this.afterJump(next)
  }

  private afterJump(b: Board) {
    this.board = b
    this.onBoardChange?.(b)
    this.selection = new Set([...this.selection].filter((id) => B.getItem(b, id)))
    if (this.selectedConnector !== null && !B.getConnector(b, this.selectedConnector)) this.selectedConnector = null
    this.emit()
  }

  // ----- camera ------------------------------------------------------------------

  zoomBy(factor: number, anchor: Vec = { x: this.viewport.w / 2, y: this.viewport.h / 2 }) {
    this.camera = zoomAt(this.camera, anchor, factor)
    this.emit()
  }

  setZoom(zoom: number) {
    this.zoomBy(zoom / this.camera.zoom)
  }

  pan(dx: number, dy: number) {
    this.camera = { ...this.camera, x: this.camera.x + dx, y: this.camera.y + dy }
    this.emit()
  }

  centerOn(world: Vec) {
    this.camera = centerOn(this.camera, world, this.viewport)
    this.emit()
  }

  zoomToFit() {
    const target = B.bounds(this.board, this.selection.size ? this.selection : undefined)
    this.camera = target ? fit(target, this.viewport) : defaultCamera()
    this.emit()
  }

  get visibleWorld(): Rect {
    return rectToWorld(this.camera, { x: 0, y: 0, w: this.viewport.w, h: this.viewport.h })
  }

  // ----- text editing ------------------------------------------------------------

  startEditing(id: Id, opts: { before?: Board; created?: boolean } = {}) {
    if (this.editing?.id !== id) this.finishEditing()
    const item = B.getItem(this.board, id)
    if (!item || !hasText(item.kind)) return
    this.selection = new Set([id])
    this.selectedConnector = null
    this.editing = { id, before: opts.before ?? this.board, created: opts.created ?? false }
    this.emit()
  }

  setEditingText(text: string) {
    if (!this.editing) return
    const id = this.editing.id
    this.apply(B.updateItem(this.board, id, (i) => (i.text === text ? i : { ...i, text })))
    this.emit()
  }

  /** Ends text editing, recording the creation and typing as one undo step. */
  finishEditing() {
    const e = this.editing
    if (!e) return
    this.editing = null
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
    for (const id of this.selection) {
      if (B.getItem(this.board, id)?.kind === 'mind') for (const d of B.subtree(this.board, id)) items.add(d)
      else items.add(id)
    }
    const connectors = new Set(this.selectedConnector !== null ? [this.selectedConnector] : [])
    if (!items.size && !connectors.size) return
    const next = M.selectionAfterDelete(this.board, this.selection)
    this.edit((b) => B.remove(b, items, connectors))
    this.selection = new Set(next !== undefined && B.getItem(this.board, next) ? [next] : [])
    this.selectedConnector = null
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
    this.select(this.board.items.filter((i) => !this.hidden.has(i.id)).map((i) => i.id))
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

  hitAt(screen: Vec): B.Hit | null {
    return B.hitTest(this.board, toWorld(this.camera, screen), this.tol(), this.hidden)
  }

  pointerDown(screen: Vec, button: number, mods: Modifiers, handle?: Handle) {
    const world = toWorld(this.camera, screen)
    this.pointer = world
    if (button === 1 || this.spaceDown || (button === 0 && this.tool === 'hand')) {
      this.drag = { type: 'pan', last: screen }
      this.emit()
      return
    }
    if (button === 2) {
      const hit = this.hitAt(screen)
      if (hit?.type === 'item' && !this.selection.has(hit.id)) this.select([hit.id])
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
        case 'resize': {
          const item = this.single
          if (item) {
            this.drag = { type: 'resize', id: item.id, anchor: cornerOf(item, OPPOSITE[handle.corner]), before: this.board }
          }
          this.emit()
          return
        }
        case 'connect': {
          const item = this.single
          if (item) this.drag = { type: 'connect', from: item.id, current: world }
          this.emit()
          return
        }
      }
    }

    const kind = CREATES[this.tool]
    if (kind || this.tool === 'mind') {
      this.drag = { type: 'create', kind: kind ?? 'mind', start: world, current: world }
    } else if (this.tool === 'pen') {
      this.drag = { type: 'draw', points: [world] }
    } else if (this.tool === 'connector') {
      const hit = this.hitAt(screen)
      if (hit?.type === 'item') this.drag = { type: 'connect', from: hit.id, current: world }
    } else if (this.tool === 'select') {
      const hit = this.hitAt(screen)
      if (hit?.type === 'item') {
        if (mods.shift && this.selection.has(hit.id)) {
          this.selection.delete(hit.id)
          this.selection = new Set(this.selection)
        } else {
          if (!this.selection.has(hit.id)) this.selection = new Set(mods.shift ? [...this.selection, hit.id] : [hit.id])
          this.selectedConnector = null
          const node = this.single
          if (node?.kind === 'mind' && node.parent !== undefined) {
            this.drag = { type: 'branch', id: node.id, start: world, offset: { x: 0, y: 0 }, target: null, before: this.board }
          } else {
            this.drag = { type: 'move', ids: B.movingSet(this.board, this.selection), last: world, before: this.board }
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

  pointerMove(screen: Vec) {
    const world = toWorld(this.camera, screen)
    this.pointer = world
    const d = this.drag
    switch (d.type) {
      case 'none':
        return
      case 'pan':
        this.camera = { ...this.camera, x: this.camera.x + screen.x - d.last.x, y: this.camera.y + screen.y - d.last.y }
        d.last = screen
        break
      case 'move':
        this.apply(B.translate(this.board, d.ids, world.x - d.last.x, world.y - d.last.y))
        d.last = world
        break
      case 'branch': {
        d.offset = { x: world.x - d.start.x, y: world.y - d.start.y }
        d.target = this.branchDropTarget(d.id, world)
        break
      }
      case 'resize': {
        const r = rectFromPoints(d.anchor, world)
        r.w = Math.max(r.w, 12)
        r.h = Math.max(r.h, 12)
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
      case 'move':
      case 'resize':
        this.commit(d.before)
        break
      case 'branch':
        this.dropBranch(d, world)
        break
      case 'marquee': {
        const hits = B.itemsWithin(this.board, rectFromPoints(d.start, d.current), this.hidden)
        this.selection = new Set([...d.base, ...hits])
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
        this.finishConnect(d.from, world)
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
    if (dist(d.start, world) * this.camera.zoom < 4) return
    const node = B.getItem(this.board, d.id)
    if (!node) return
    if (d.target !== null) {
      const target = B.getItem(this.board, d.target)!
      const side: Side = world.x < target.x + target.w / 2 ? 'left' : 'right'
      this.apply(M.reparent(this.board, d.id, d.target, side))
    } else {
      // A main branch dropped across its root switches sides.
      const parent = node.parent !== undefined ? B.getItem(this.board, node.parent) : undefined
      if (parent && parent.parent === undefined) {
        const side: Side = world.x < parent.x + parent.w / 2 ? 'left' : 'right'
        if (side !== (node.side ?? 'right')) {
          this.apply(B.updateItem(this.board, d.id, (i) => ({ ...i, side })))
          this.apply(B.bringToFront(this.board, B.subtree(this.board, d.id)))
        }
      }
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
    } else {
      let r = rectFromPoints(start, end)
      if (r.w * this.camera.zoom < 8 || r.h * this.camera.zoom < 8) {
        const s = defaultSize(kind)
        r = rectFromCenter(start, s.w, s.h)
      }
      const extra: Partial<Item> =
        kind === 'frame' ? { text: `Frame ${this.board.items.filter((i) => i.kind === 'frame').length + 1}` } : {}
      let b: Board
      ;[b, id] = B.addItem(this.board, B.newItem(kind, r, extra))
      // A frame goes beneath whatever it was drawn around.
      if (kind === 'frame') b = B.sendToBack(b, new Set([id]))
      this.apply(b)
    }
    this.tool = 'select'
    if (kind === 'frame') {
      this.commit(before)
      this.select([id])
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
      this.apply(B.connect(this.board, from, target.id)[0])
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
    const [b, id] = B.addItem(
      this.board,
      B.newItem(source.kind, rectFromCenter(world, source.w, source.h), { color: source.color, fontSize: source.fontSize }),
    )
    this.apply(B.connect(b, from, id)[0])
    this.startEditing(id, { before, created: true })
  }

  doubleClick(screen: Vec) {
    const hit = this.hitAt(screen)
    if (hit?.type === 'item') {
      this.startEditing(hit.id)
    } else if (!hit && this.tool === 'select') {
      const before = this.board
      const [b, id] = B.addItem(this.board, B.newItem('sticky', rectFromCenter(toWorld(this.camera, screen), 200, 200)))
      this.apply(b)
      this.startEditing(id, { before, created: true })
    }
  }

  wheel(screen: Vec, dx: number, dy: number, zoomGesture: boolean) {
    if (zoomGesture) this.camera = zoomAt(this.camera, screen, Math.exp(-dy * 0.01))
    else this.camera = { ...this.camera, x: this.camera.x - dx, y: this.camera.y - dy }
    this.emit()
  }

  // ----- keyboard ----------------------------------------------------------------

  /** Keyboard shortcuts on the canvas (not while typing). */
  keyDown(key: string, mods: Modifiers): KeyResult {
    const k = key.length === 1 ? key.toLowerCase() : key
    if (mods.ctrl) {
      if (k === 'z' && mods.shift) this.redo()
      else if (k === 'z') this.undo()
      else if (k === 'y') this.redo()
      else if (k === 'a') this.selectAll()
      else if (k === 'd') this.duplicate()
      else if (k === 's') return 'save'
      else return false
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
      this.drag = { type: 'none' }
      this.tool = 'select'
      this.select([])
      return true
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
      if (k === 'c' && !mods.alt) {
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
    if (!mods.alt) {
      const tool = TOOLS.find((t) => t.key === k)
      if (tool) {
        this.setTool(tool.tool)
        return true
      }
    }
    return false
  }

  // ----- render helpers ----------------------------------------------------------

  screenRect(r: Rect): Rect {
    const p = toScreen(this.camera, r)
    return { x: p.x, y: p.y, w: r.w * this.camera.zoom, h: r.h * this.camera.zoom }
  }

  /** Whether the single selection can be resized with corner handles. */
  get resizable(): Item | undefined {
    const i = this.single
    return i && !this.editing && isResizable(i.kind) ? i : undefined
  }
}

const ARROWS: Record<string, M.Direction | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}
