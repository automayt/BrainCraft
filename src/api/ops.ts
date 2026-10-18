/**
 * The BrainCraft operations API: a small JSON language for building boards,
 * meant for scripts and AI assistants. A batch of operations is applied all
 * at once (one undo step) or not at all; later operations can refer to
 * objects made earlier in the batch by the `ref` name given to them.
 *
 * See docs/API.md for the full reference.
 */

import * as B from '../model/board'
import { startPoll, toggleReaction } from '../model/reactions'
import { type Rect, type Vec, unionAll } from '../model/geom'
import * as D from '../model/dataset'
import { newKanban } from '../model/kanban'
import { insertMermaid, parseMermaid } from '../model/mermaid'
import { type Measure, type OutlineNode, createMapFromOutline, layoutAll, parseOutline } from '../model/mindmap'
import { linkItem, urlIn } from '../model/linkCard'
import { parseStatus, setStatus } from '../model/status'
import { newWheel } from '../model/wheel'
import { codeSize, langId } from '../model/code'
import { addNote } from '../model/notes'
import { tableSize } from '../model/table'
import { isIsoDay } from '../model/timeline'
import { uid } from '../model/uid'
import { cleanBody, cleanConnector, cleanItem, cleanPage } from '../model/sanitize'
import * as RV from '../model/revisions'
import * as W from '../model/wiki'
import {
  type Arrowheads,
  BRANCHES,
  type Board,
  type ConnectorStyle,
  type DataViewType,
  type FieldType,
  FILLS,
  type Id,
  type Item,
  type KanbanData,
  type TableData,
  type TimelineData,
} from '../model/types'

/** An object id, or the `ref` name of an object created earlier in the same batch. */
export type Ref = number | string

interface Placed {
  /** Name to refer to this object later in the batch. */
  ref?: string
  /** Top-left corner on the board. Omit to place it beside existing content. */
  at?: Vec
}

export type Op =
  | ({ op: 'createNote'; text: string; color?: string; w?: number; h?: number } & Placed)
  | ({ op: 'createText'; text: string; fontSize?: number; w?: number } & Placed)
  | ({ op: 'createShape'; shape?: 'rect' | 'ellipse'; text?: string; color?: string; w?: number; h?: number } & Placed)
  | ({ op: 'createComment'; text: string } & Placed)
  | ({ op: 'createFrame'; title: string; around?: Ref[]; w?: number; h?: number } & Placed)
  | ({ op: 'createMindMap'; outline?: string; tree?: OutlineNode } & Placed)
  | ({ op: 'createFlowchart'; mermaid: string } & Placed)
  | ({ op: 'createTable'; title?: string; columns: string[]; rows?: (string | number)[][] } & Placed)
  | ({
      op: 'createKanban'
      title?: string
      columns?: { title: string; cards?: (string | { title: string; start?: string; due?: string; color?: string })[] }[]
    } & Placed)
  | ({
      op: 'createTimeline'
      title?: string
      lanes?: { name: string; entries?: { title: string; start: string; end?: string; color?: string }[] }[]
      followKanban?: Ref[]
      w?: number
      h?: number
    } & Placed)
  | ({ op: 'createImage'; src: string; w?: number; h?: number } & Placed)
  | ({ op: 'createLink'; url: string; w?: number; h?: number } & Placed)
  | ({ op: 'createSpinner'; options: string[] } & Placed)
  | ({ op: 'createCode'; code: string; lang?: string; w?: number; h?: number } & Placed)
  | ({
      op: 'createDatabase'
      title?: string
      fields?: (string | { name: string; type?: FieldType; options?: string[] })[]
      records?: Record<string, unknown>[]
      views?: DataViewType[]
      groupBy?: string
    } & Placed)
  | { op: 'addRecords'; id: Ref; records: Record<string, unknown>[] }
  | { op: 'updateRecord'; id: Ref; record: string; values: Record<string, unknown> }
  | { op: 'deleteRecords'; id: Ref; records: string[] }
  | { op: 'react'; ids: Ref[]; emoji: string; by?: string }
  | { op: 'createVote'; options: Ref[]; question?: string; each?: number; ref?: string }
  | { op: 'connect'; from: Ref; to: Ref; label?: string; style?: ConnectorStyle; arrows?: Arrowheads; dashed?: boolean; ref?: string }
  | { op: 'update'; id: Ref; text?: string; description?: string; color?: string; x?: number; y?: number; w?: number; h?: number; locked?: boolean; status?: string | null }
  | { op: 'delete'; ids: Ref[] }
  | { op: 'addComment'; id: Ref; text: string; author?: string }
  /** Wiki pages (in a wiki only). `page`, `parent` and `before` take a page id, a `ref` or an exact title. */
  | { op: 'createPage'; title: string; parent?: string; before?: string; text?: string; icon?: string; ref?: string; note?: string }
  | { op: 'updatePage'; page: string; title?: string; text?: string; append?: string; icon?: string | null; note?: string }
  | { op: 'movePage'; page: string; parent?: string | null; before?: string }
  | { op: 'deletePage'; page: string }

export interface OpResult {
  op: Op['op']
  /** Id of the object or line created (if any). */
  id?: Id
  /** Ids of everything created, for multi-object operations like flowcharts and mind maps. */
  ids?: Id[]
  ref?: string
  /** The wiki page made or changed. */
  page?: string
}

export interface ApplyContext {
  measure: Measure
  /** Where to start placing objects on an empty board. */
  origin?: Vec
  now?: number
  /** Objects these operations may not change or delete (other people's hidden brainstorm notes). */
  protect?: ReadonlySet<Id>
}

/** Other people's hidden brainstorm notes on a board as someone sees it (blanked, so off limits). */
export const maskedIds = (view: Board): Set<Id> => new Set(view.items.filter((i) => i.masked).map((i) => i.id))

export class OpError extends Error {}

const GAP = 80

function fail(index: number, op: { op?: unknown }, message: string): never {
  throw new OpError(`Operation ${index + 1} (${String(op.op ?? '?')}): ${message}`)
}

/**
 * Applies `ops` to `board` and returns the new board. Throws an `OpError`
 * naming the failing operation, leaving the input untouched.
 */
export function applyOps(board: Board, ops: Op[], ctx: ApplyContext): { board: Board; results: OpResult[] } {
  if (!Array.isArray(ops)) throw new OpError('Expected a list of operations')
  let b = board
  const refs = new Map<string, Id>()
  const pageRefs = new Map<string, string>()
  const results: OpResult[] = []
  const existing = B.bounds(board)
  // New objects without a position go in a column to the right of the existing content.
  const column = { x: existing ? existing.x + existing.w + GAP * 1.5 : (ctx.origin?.x ?? 0), y: existing ? existing.y : (ctx.origin?.y ?? 0) }

  ops.forEach((op, index) => {
    if (!op || typeof op !== 'object' || typeof op.op !== 'string') fail(index, op ?? {}, 'each operation needs an "op" name')
    // A wiki has pages, not a canvas.
    if (W.isWiki(b) && !PAGE_OPS.has(op.op)) fail(index, op, `this is a wiki: use ${[...PAGE_OPS].join(', ')}`)
    try {
      run(op, index)
    } catch (err) {
      // A field of the wrong shape can trip deeper code; it's still this operation's mistake.
      if (err instanceof OpError) throw err
      fail(index, op, `couldn't be applied (${(err as Error)?.message ?? String(err)}); check each field's type`)
    }
  })

  // Everything made or changed is kept as a save and reload would keep it (the same on every
  // screen, since the server cleans changes the same way), or refused if it can't be kept.
  const old = new Map(board.items.map((i) => [i.id, i]))
  const items = b.items.map((i) => {
    if (old.get(i.id) === i) return i
    const clean = cleanItem(i)
    if (!clean) throw new OpError(`The operations made an object that isn't valid (${i.kind} ${i.id}); check field types`)
    return clean
  })
  if (ctx.protect?.size) {
    const now = new Map(b.items.map((i) => [i.id, i]))
    for (const id of ctx.protect)
      if (old.has(id) && now.get(id) !== old.get(id)) throw new OpError(`Object ${id} is someone's hidden brainstorm note; it can't be changed or deleted until the round is revealed`)
    // Nor can the round's card go while it hides them: that would show them all.
    for (const i of board.items)
      if (i.brainstorm && !i.brainstorm.revealed && !now.has(i.id)) throw new OpError(`Object ${i.id} is a private brainstorm still under way; reveal it before deleting it`)
  }
  const oldConns = new Set(board.connectors)
  const connectors = b.connectors.map((c) => {
    if (oldConns.has(c)) return c
    const clean = cleanConnector(c)
    if (!clean) throw new OpError("The operations made a connector that isn't valid; check its ends")
    return clean
  })
  // Pages are kept as a save would keep them too.
  const oldPages = new Set(board.pages ?? [])
  const oldBodies = new Set(board.bodies ?? [])
  const pages = b.pages?.map((p) => (oldPages.has(p) ? p : (cleanPage(p) ?? fail(0, { op: 'page' }, `page "${p.title}" isn't valid`))))
  const bodies = b.bodies?.map((x) => (oldBodies.has(x) ? x : (cleanBody(x) ?? fail(0, { op: 'page' }, 'a page’s text isn’t valid'))))
  return { board: layoutAll({ ...b, items, connectors, ...(pages ? { pages } : {}), ...(bodies ? { bodies } : {}) }, ctx.measure), results }

  function run(op: Op, index: number) {

    const resolve = (ref: Ref | undefined, field: string): Id => {
      if (typeof ref === 'number' && B.getItem(b, ref)) return ref
      if (typeof ref === 'string') {
        const id = refs.get(ref) ?? (/^\d+$/.test(ref) ? Number(ref) : undefined)
        if (id !== undefined && B.getItem(b, id)) return id
      }
      fail(index, op, `"${field}" refers to ${JSON.stringify(ref)}, which isn't an object on the board or an earlier "ref"`)
    }
    const text = (v: unknown, field: string, required = true): string => {
      if (v === undefined && !required) return ''
      if (typeof v !== 'string' && typeof v !== 'number') fail(index, op, `"${field}" should be text`)
      return String(v)
    }
    const date = (v: unknown, field: string): string | undefined => {
      if (v === undefined || v === '') return undefined
      if (typeof v !== 'string' || !isIsoDay(v)) fail(index, op, `"${field}" should be a date like 2026-10-14`)
      return v
    }

    /** Adds items, then moves the group to `at` (or the next free spot). */
    const place = (ids: Id[], at?: Vec) => {
      b = layoutAll(b, ctx.measure)
      const box = unionAll(ids.map((id) => B.itemBounds(B.getItem(b, id)!))) as Rect | null
      if (!box) return
      const target = at ?? { x: column.x, y: column.y }
      if (at && (typeof at.x !== 'number' || typeof at.y !== 'number')) fail(index, op, '"at" should be {"x": number, "y": number}')
      // Only what this operation made: a new frame "contains" whatever already sits where it was built.
      b = B.translate(b, new Set(ids), target.x - box.x, target.y - box.y)
      b = layoutAll(b, ctx.measure)
      if (!at) column.y += box.h + GAP
    }
    const add = (item: Omit<Item, 'id'>): Id => {
      let id: Id
      ;[b, id] = B.addItem(b, item)
      return id
    }
    const done = (result: Omit<OpResult, 'op'>) => {
      if ('ref' in op && op.ref) {
        if (result.id === undefined) fail(index, op, '"ref" needs an operation that creates something')
        refs.set(op.ref, result.id)
      }
      results.push({ op: op.op, ...result, ...('ref' in op && op.ref ? { ref: op.ref } : {}) })
    }
    const r0 = (w: number, h: number) => ({ x: 0, y: 0, w, h })
    /** A width or height given by the caller, if it's a sensible number. */
    const size = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 20000) : undefined)
    /** A position given by the caller: a finite number, or left out. */
    const coord = (v: unknown, field: string): number | undefined => {
      if (v === undefined) return undefined
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(index, op, `"${field}" should be a number`)
      return v
    }
    const color = (v: unknown, field = 'color'): { color?: string } => {
      if (v === undefined || v === null || v === '') return {}
      if (typeof v !== 'string') fail(index, op, `"${field}" should be a colour name or a hex code like #ffd84d`)
      return { color: colorByName(v)! }
    }
    /** A list field, or [] when left out. */
    const list = <T,>(v: T[] | undefined, field: string): T[] => {
      if (v === undefined || v === null) return []
      if (!Array.isArray(v)) fail(index, op, `"${field}" should be a list`)
      return v
    }
    const obj = <T,>(v: T, field: string): NonNullable<T> => {
      if (!v || typeof v !== 'object') fail(index, op, `"${field}" should be an object`)
      return v as NonNullable<T>
    }

    switch (op.op) {
      case 'createNote': {
        const id = add(B.newItem('sticky', r0(size(op.w) ?? 200, size(op.h) ?? 200), { text: text(op.text, 'text'), ...color(op.color) }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createText': {
        const fontSize = Math.min(size(op.fontSize) ?? 28, 400)
        const t = text(op.text, 'text')
        const id = add(B.newItem('text', r0(size(op.w) ?? Math.min(800, Math.max(120, t.length * fontSize * 0.55)), fontSize * 1.4 * t.split('\n').length + 8), { text: t, fontSize }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createShape': {
        const kind = op.shape === 'ellipse' ? 'ellipse' : 'rect'
        if (op.shape && op.shape !== 'rect' && op.shape !== 'ellipse') fail(index, op, '"shape" should be "rect" or "ellipse" (use createFlowchart for flowchart symbols)')
        const id = add(B.newItem(kind, r0(size(op.w) ?? 220, size(op.h) ?? 140), { text: text(op.text, 'text', false), ...color(op.color) }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createComment': {
        const id = add(B.newItem('comment', r0(260, 150), { text: text(op.text, 'text'), createdAt: ctx.now ?? Date.now() }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createFrame': {
        const title = text(op.title, 'title')
        const around = list(op.around, 'around')
        if (around.length) {
          const inner = around.map((r, k) => resolve(r, `around[${k}]`))
          const box = unionAll(inner.map((id) => B.itemBounds(B.getItem(b, id)!)))!
          const pad = 40
          const id = add(B.newItem('frame', { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad }, { text: title }))
          b = B.sendToBack(b, new Set([id]))
          done({ id })
        } else {
          const id = add(B.newItem('frame', r0(size(op.w) ?? 800, size(op.h) ?? 600), { text: title }))
          b = B.sendToBack(b, new Set([id]))
          place([id], op.at)
          done({ id })
        }
        break
      }
      case 'createMindMap': {
        const tree = op.tree ?? (op.outline !== undefined ? parseOutline(text(op.outline, 'outline')) : null)
        if (!tree || typeof tree.text !== 'string') fail(index, op, 'give "outline" (an indented list, 2+ lines) or "tree" ({"text": …, "children": […]})')
        const normalize = (n: OutlineNode): OutlineNode =>
          n && typeof n === 'object' ? { text: String(n.text ?? ''), children: Array.isArray(n.children) ? n.children.map(normalize) : [] } : { text: String(n ?? ''), children: [] }
        const before = new Set(b.items.map((i) => i.id))
        let root: Id
        ;[b, root] = createMapFromOutline(b, normalize(tree), { x: 0, y: 0 })
        const ids = b.items.filter((i) => !before.has(i.id)).map((i) => i.id)
        place(ids, op.at)
        done({ id: root, ids })
        break
      }
      case 'createFlowchart': {
        let ids: Id[]
        try {
          ;[b, ids] = insertMermaid(b, parseMermaid(text(op.mermaid, 'mermaid')), { x: 0, y: 0 })
        } catch (err) {
          if (err instanceof OpError) throw err
          fail(index, op, (err as Error).message)
        }
        place(ids, op.at)
        done({ id: ids[0], ids })
        break
      }
      case 'createTable': {
        if (!Array.isArray(op.columns) || !op.columns.length) fail(index, op, '"columns" should be a list of column names')
        const columns = op.columns.map((name, k) => ({ id: uid(), name: text(name, `columns[${k}]`), width: 150 }))
        const rows = list(op.rows, 'rows').map((row, k) => {
          if (!Array.isArray(row)) fail(index, op, `rows[${k}] should be a list of cell values`)
          return { id: uid(), cells: Object.fromEntries(columns.map((c, j) => [c.id, row[j] === undefined ? '' : String(row[j])])) }
        })
        const table: TableData = { columns, rows }
        const id = add(B.newItem('table', r0(tableSize(table).w, tableSize(table).h), { text: text(op.title, 'title', false) || 'Table', table }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createKanban': {
        const kanban: KanbanData = op.columns
          ? {
              columns: list(op.columns, 'columns').map((c, k) => ({
                id: uid(),
                title: text(obj(c, `columns[${k}]`).title, `columns[${k}].title`),
                cards: list(c.cards, `columns[${k}].cards`).map((card, j) => {
                  const f = `columns[${k}].cards[${j}]`
                  if (typeof card === 'string') return { id: uid(), title: card }
                  return {
                    id: uid(),
                    title: text(obj(card, f).title, `${f}.title`),
                    ...(date(card.start, `${f}.start`) ? { start: card.start } : {}),
                    ...(date(card.due, `${f}.due`) ? { due: card.due } : {}),
                    ...color(card.color, `${f}.color`),
                  }
                }),
              })),
            }
          : newKanban()
        const id = add(B.newItem('kanban', r0(Math.max(600, kanban.columns.length * 272 + 200), 460), { text: text(op.title, 'title', false) || 'Kanban board', kanban }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createTimeline': {
        const lanes: TimelineData['lanes'] = []
        const entries: TimelineData['entries'] = []
        list(op.lanes, 'lanes').forEach((lane, k) => {
          const id = uid()
          lanes.push({ id, name: text(obj(lane, `lanes[${k}]`).name, `lanes[${k}].name`) })
          list(lane.entries, `lanes[${k}].entries`).forEach((e, j) => {
            const f = `lanes[${k}].entries[${j}]`
            const start = date(obj(e, f).start, `${f}.start`)
            if (!start) fail(index, op, `"${f}.start" is required`)
            const end = date(e.end, `${f}.end`)
            if (end && end < start) fail(index, op, `"${f}.end" is before its start`)
            entries.push({ id: uid(), lane: id, title: text(e.title, `${f}.title`), start, ...(end ? { end } : {}), color: color(e.color, `${f}.color`).color ?? BRANCHES[entries.length % BRANCHES.length][1] })
          })
        })
        const sources = list(op.followKanban, 'followKanban').map((r, k) => {
          const id = resolve(r, `followKanban[${k}]`)
          if (B.getItem(b, id)?.kind !== 'kanban') fail(index, op, `followKanban[${k}] isn't a Kanban board`)
          return id
        })
        const timeline: TimelineData = { lanes, entries, ...(sources.length ? { sources } : {}) }
        const id = add(B.newItem('timeline', r0(size(op.w) ?? 1000, size(op.h) ?? Math.max(220, 120 + (lanes.length + sources.length) * 46)), { text: text(op.title, 'title', false) || 'Timeline', timeline }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createImage': {
        const src = text(op.src, 'src')
        if (!/^(data:image\/|https?:\/\/)/.test(src)) fail(index, op, '"src" should be a data:image/… URL or an http(s) URL')
        const id = add(B.newItem('image', r0(size(op.w) ?? 400, size(op.h) ?? 300), { src }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createCode': {
        const code = text(op.code, 'code', false)
        const lang = langId(op.lang)
        const fit = codeSize(code)
        const id = add(B.newItem('code', r0(size(op.w) ?? fit.w, size(op.h) ?? fit.h), { text: code, ...(lang ? { lang } : {}) }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createSpinner': {
        const options = Array.isArray(op.options) ? op.options.filter((o): o is string => typeof o === 'string' && !!o.trim()) : []
        if (options.length < 2) fail(index, op, '"options" should list two or more choices (text)')
        let id: Id
        ;[b, id] = newWheel(b, { x: 0, y: 0 }, options)
        place([id], op.at)
        done({ id })
        break
      }
      case 'createLink': {
        const url = urlIn(text(op.url, 'url'))
        if (!url) fail(index, op, '"url" should be one http(s) web address')
        const item = linkItem(url, { x: 0, y: 0 })
        const w = size(op.w)
        const h = size(op.h)
        const id = add({ ...item, x: 0, y: 0, ...(w ? { w } : {}), ...(h ? { h } : {}) })
        place([id], op.at)
        done({ id })
        break
      }
      case 'connect': {
        const from = resolve(op.from, 'from')
        const to = resolve(op.to, 'to')
        const a = B.getItem(b, from)
        const z = B.getItem(b, to)
        let id: Id | null
        ;[b, id] = B.connect(b, from, to, {
          style: op.style ?? B.defaultStyleBetween(a, z),
          ...(op.label ? { label: text(op.label, 'label') } : {}),
          ...(op.arrows ? { arrows: op.arrows } : {}),
          ...(op.dashed ? { dashed: true } : {}),
        })
        if (id === null) fail(index, op, 'those two are already connected (or are the same object)')
        done({ id })
        break
      }
      case 'update': {
        const id = resolve(op.id, 'id')
        b = B.updateItem(b, id, (i) => ({
          ...i,
          ...(op.text !== undefined ? { text: text(op.text, 'text') } : {}),
          ...(op.description !== undefined ? { description: text(op.description, 'description', false) } : {}),
          ...color(op.color),
          ...(coord(op.x, 'x') !== undefined ? { x: op.x } : {}),
          ...(coord(op.y, 'y') !== undefined ? { y: op.y } : {}),
          ...(size(op.w) ? { w: size(op.w) } : {}),
          ...(size(op.h) ? { h: size(op.h) } : {}),
          ...(op.locked === true ? { locked: true } : {}),
        }))
        if (op.locked === false)
          b = B.updateItem(b, id, (i) => {
            const next: Item = { ...i }
            delete next.locked
            return next
          })
        if (op.status !== undefined) {
          const status = op.status === null || op.status === '' || op.status === 'none' ? null : parseStatus(String(op.status))
          if (status === undefined) fail(index, op, '"status" should be todo, doing, waiting, undecided, done, dropped or none')
          b = setStatus(b, [id], status)
        }
        done({ id })
        break
      }
      case 'delete': {
        if (!Array.isArray(op.ids)) fail(index, op, '"ids" should be a list')
        const ids = new Set<Id>()
        op.ids.forEach((r, k) => {
          const id = resolve(r, `ids[${k}]`)
          for (const d of B.getItem(b, id)?.kind === 'mind' ? B.subtree(b, id) : [id]) ids.add(d)
        })
        b = B.remove(b, ids)
        done({ ids: [...ids] })
        break
      }
      case 'createDatabase': {
        const records = op.records ?? []
        if (!Array.isArray(records) || records.some((r) => !r || typeof r !== 'object')) fail(index, op, '"records" should be a list of objects keyed by field name')
        const specs = list(op.fields, 'fields').map((f, k) => (typeof f === 'string' ? { name: f } : f && typeof f === 'object' ? f : fail(index, op, `fields[${k}] should be a name or {"name", "type"}`)))
        let ds: ReturnType<typeof D.newDataset>
        const title = text(op.title, 'title', false)
        if (!specs.length && !records.length) ds = { ...D.newDataset(title || 'Projects'), name: title || 'Projects' }
        else {
          // Fields come from "fields", else from the records' keys; types are guessed from values unless given.
          const names = specs.length ? specs.map((f) => text(f.name, 'fields[].name')) : [...new Set(records.flatMap((r) => Object.keys(r)))]
          const columns = names.map((n) => records.map((r) => (r[n] === undefined || r[n] === null ? '' : String(r[n]))))
          ds = { id: uid(), name: title || 'Database', fields: [], records: [] }
          names.forEach((n, k) => {
            const spec = specs[k]
            const grouping = k > 0 && op.groupBy?.trim().toLowerCase() === n.trim().toLowerCase()
            const guessed = k === 0 ? 'text' : D.inferType(columns[k], n)
            // A board groups by choices or people, so the groupBy field is one of those.
            const type: FieldType = spec?.type ?? (grouping && guessed !== 'person' ? 'select' : guessed)
            if (!D.FIELD_TYPES.some((t) => t.type === type)) fail(index, op, `fields[${k}].type should be one of ${D.FIELD_TYPES.map((t) => t.type).join(', ')}`)
            let fid: string
            ;[ds, fid] = D.addField(ds, n, type)
            for (const o of list(spec?.options, `fields[${k}].options`)) ds = D.addOption(ds, fid, String(o))[0]
          })
          for (const r of records) {
            const { values, ds: withOpts } = D.valuesByName(ds, r)
            ds = D.addRecord(withOpts, values)[0]
          }
        }
        b = D.addDataset(b, ds)
        const views = list(op.views, 'views').length ? op.views! : ['table' as const]
        if (op.groupBy !== undefined && typeof op.groupBy !== 'string') fail(index, op, '"groupBy" should be a field name')
        const group = op.groupBy ? D.fieldByName(ds, op.groupBy) : undefined
        if (op.groupBy && !group) fail(index, op, `"groupBy" names no field. Fields: ${ds.fields.map((f) => f.name).join(', ')}`)
        const ids: Id[] = []
        let x = 0
        for (const type of views) {
          if (!D.VIEW_TYPES.some((t) => t.type === type)) fail(index, op, `"views" can hold ${D.VIEW_TYPES.map((t) => t.type).join(', ')}`)
          const view = { ...D.newView(ds.id, type), ...(group ? { groupBy: group.id } : {}) }
          const size = D.viewSize(ds, type)
          ids.push(add(B.newItem('data', { x, y: 0, w: size.w, h: size.h }, { text: ds.name, view })))
          x += size.w + 60
        }
        place(ids, op.at)
        done({ id: ids[0], ids })
        break
      }
      case 'addRecords':
      case 'updateRecord':
      case 'deleteRecords': {
        const id = resolve(op.id, 'id')
        const dsId = B.getItem(b, id)?.view?.dataset
        let ds = D.getDataset(b, dsId)
        if (!ds) fail(index, op, '"id" should be a database view')
        const findRecord = (q: string, field: string) => {
          const r = ds!.records.find((x) => x.id === q) ?? ds!.records.find((x) => D.recordTitle(ds!, x).toLowerCase() === String(q).toLowerCase())
          if (!r) fail(index, op, `"${field}" matches no record by id or ${D.titleField(ds!).name}`)
          return r
        }
        const valuesOf = (named: unknown, field: string) => {
          if (!named || typeof named !== 'object') fail(index, op, `"${field}" should be an object keyed by field name`)
          const out = D.valuesByName(ds!, named as Record<string, unknown>)
          if (out.unknown.length) fail(index, op, `unknown field ${out.unknown.map((u) => `"${u}"`).join(', ')}. Fields: ${ds!.fields.map((f) => f.name).join(', ')}`)
          ds = out.ds
          return out.values
        }
        if (op.op === 'addRecords') {
          if (!Array.isArray(op.records)) fail(index, op, '"records" should be a list')
          op.records.forEach((r, k) => {
            // Values first: they may add new choices to the dataset.
            const values = valuesOf(r, `records[${k}]`)
            ds = D.addRecord(ds!, values)[0]
          })
        } else if (op.op === 'updateRecord') {
          const r = findRecord(op.record, 'record')
          const values = valuesOf(op.values, 'values')
          for (const [f, v] of Object.entries(values)) ds = D.setValue(ds!, r.id, f, v)
          // Fields set to null or "" are cleared.
          for (const [name, v] of Object.entries(op.values)) {
            const f = D.fieldByName(ds!, name)
            if (f && (v === null || v === '')) ds = D.setValue(ds!, r.id, f.id, null)
          }
        } else {
          if (!Array.isArray(op.records)) fail(index, op, '"records" should be a list of record ids or titles')
          op.records.forEach((q, k) => (ds = D.deleteRecord(ds!, findRecord(String(q), `records[${k}]`).id)))
        }
        const final = ds!
        b = D.updateDataset(b, final.id, () => final)
        done({ id })
        break
      }
      case 'react': {
        if (!Array.isArray(op.ids) || !op.ids.length) fail(index, op, '"ids" should be a list of objects')
        const emoji = text(op.emoji, 'emoji', false)
        if (!emoji.trim() || [...emoji].length > 4) fail(index, op, '"emoji" should be one emoji, like 👍')
        const who = op.by?.trim() || 'AI'
        const ids = new Set(op.ids.map((r, k) => resolve(r, `ids[${k}]`)))
        b = B.updateItems(b, ids, (i) => (i.reactions?.[emoji]?.includes(who) ? i : toggleReaction(i, emoji, who)))
        done({ ids: [...ids] })
        break
      }
      case 'createVote': {
        if (!Array.isArray(op.options) || op.options.length < 2) fail(index, op, '"options" should list two or more objects to vote on')
        const options = op.options.map((r, k) => resolve(r, `options[${k}]`))
        let id: Id
        ;[b, id] = startPoll(b, options, { question: op.question, each: op.each })
        done({ id })
        break
      }
      case 'addComment': {
        const id = resolve(op.id, 'id')
        b = addNote(b, id, text(op.text, 'text'), op.author, ctx.now)
        done({ id })
        break
      }
      case 'createPage':
      case 'updatePage':
      case 'movePage':
      case 'deletePage': {
        if (!W.isWiki(b)) fail(index, op, 'pages belong to wikis; open a wiki, or make one with create_board and template "wiki"')
        const findPage = (v: unknown, field: string): string => {
          if (typeof v !== 'string' || !v.trim()) fail(index, op, `"${field}" should be a page id, a "ref" or a page's title`)
          const own = W.getPage(b, v)
          const id = pageRefs.get(v) ?? (own && !own.trashed ? v : W.pageByTitle(b, v)?.id)
          if (!id) fail(index, op, `"${field}" refers to ${JSON.stringify(v)}, which isn't a page in this wiki`)
          return id
        }
        const now = ctx.now ?? Date.now()
        if (op.op === 'createPage') {
          const parent = op.parent === undefined || op.parent === null ? undefined : findPage(op.parent, 'parent')
          const before = op.before === undefined ? undefined : findPage(op.before, 'before')
          let id: string
          ;[b, id] = W.addPage(b, { title: text(op.title, 'title'), parent, before, text: text(op.text, 'text', false), icon: typeof op.icon === 'string' ? op.icon : undefined }, now, 'AI')
          if (!id) fail(index, op, `the wiki is full (${W.MAX_PAGES} pages)`)
          b = RV.savePageVersion(b, id, { note: typeof op.note === 'string' ? op.note : 'Written by an AI assistant' })
          if (op.ref) pageRefs.set(op.ref, id)
          results.push({ op: op.op, page: id, ...(op.ref ? { ref: op.ref } : {}) })
        } else if (op.op === 'updatePage') {
          const id = findPage(op.page, 'page')
          // The page as it was, then as changed: both in its history.
          b = RV.savePageVersion(b, id)
          if (op.title !== undefined || op.icon !== undefined) b = W.setPageMeta(b, id, { ...(op.title !== undefined ? { title: text(op.title, 'title') } : {}), ...(op.icon !== undefined ? { icon: op.icon === null ? null : text(op.icon, 'icon') } : {}) })
          if (op.text !== undefined || op.append !== undefined) {
            const base = op.text !== undefined ? text(op.text, 'text') : W.pageText(b, id)
            const extra = op.append !== undefined ? text(op.append, 'append') : ''
            const joined = extra ? `${base}${base && !base.endsWith('\n') ? '\n' : ''}${extra}` : base
            b = W.setPageBody(b, id, joined, now, 'AI')
          }
          b = RV.savePageVersion(b, id, { at: now, by: 'AI', note: typeof op.note === 'string' ? op.note : 'Changed by an AI assistant' })
          results.push({ op: op.op, page: id })
        } else if (op.op === 'movePage') {
          const id = findPage(op.page, 'page')
          const parent = op.parent === undefined || op.parent === null ? undefined : findPage(op.parent, 'parent')
          if (parent !== undefined && W.withDescendants(b, id).has(parent)) fail(index, op, 'a page can’t go inside one of its own sub-pages')
          b = W.movePage(b, id, parent, op.before === undefined ? undefined : findPage(op.before, 'before'))
          results.push({ op: op.op, page: id })
        } else {
          const id = findPage(op.page, 'page')
          b = W.trashPage(b, id, now)
          results.push({ op: op.op, page: id })
        }
        break
      }
      default:
        fail(index, op, `unknown operation. Known: ${OPS.join(', ')}`)
    }
  }
}

const PAGE_OPS = new Set<string>(['createPage', 'updatePage', 'movePage', 'deletePage'])

export const OPS: Op['op'][] = [
  'createNote',
  'createText',
  'createShape',
  'createComment',
  'createFrame',
  'createMindMap',
  'createFlowchart',
  'createTable',
  'createKanban',
  'createTimeline',
  'createImage',
  'createLink',
  'createSpinner',
  'createCode',
  'connect',
  'update',
  'delete',
  'addComment',
  'createDatabase',
  'addRecords',
  'updateRecord',
  'deleteRecords',
  'react',
  'createVote',
  'createPage',
  'updatePage',
  'movePage',
  'deletePage',
]

/** Pulls a list of operations out of pasted JSON: `{"ops": […]}`, a bare list, or one operation. */
export function opsFromText(text: string): Op[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const list = Array.isArray(raw) ? raw : (raw as { ops?: unknown })?.ops
  if (Array.isArray(list) && list.length && list.every((o) => o && typeof o === 'object' && typeof (o as Op).op === 'string')) return list as Op[]
  if (raw && typeof raw === 'object' && typeof (raw as Op).op === 'string') return [raw as Op]
  return null
}

// Colours by name, so scripts can say "yellow" instead of a hex code.
const NAMED = new Map(FILLS.map(([name, hex]) => [name.toLowerCase(), hex]))
export function colorByName(c: string | undefined): string | undefined {
  return c ? (NAMED.get(c.toLowerCase()) ?? c) : undefined
}
