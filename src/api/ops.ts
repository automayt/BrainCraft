/**
 * The BrainCraft operations API: a small JSON language for building boards,
 * meant for scripts and AI assistants. A batch of operations is applied all
 * at once (one undo step) or not at all; later operations can refer to
 * objects made earlier in the batch by the `ref` name given to them.
 *
 * See docs/API.md for the full reference.
 */

import { cleanItemLink, setItemLink } from '../model/itemLink'
import * as B from '../model/board'
import { startPoll, toggleReaction } from '../model/reactions'
import { type Rect, type Vec, unionAll } from '../model/geom'
import * as D from '../model/dataset'
import { newKanban } from '../model/kanban'
import { insertMermaid, parseMermaid, stepSize } from '../model/mermaid'
import { type Measure, type OutlineNode, addChild, createMapFromOutline, layoutAll, parseOutline, reparent } from '../model/mindmap'
import * as F from '../model/flowchart'
import { applyOutline } from '../model/outlineSync'
import { runAutomations } from '../model/automations'
import { linkItem, urlIn } from '../model/linkCard'
import { parseStatus, setStatus } from '../model/status'
import { newWheel } from '../model/wheel'
import { setSketch } from '../model/sketch'
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
  type Automation,
  type Dataset,
  type Field,
  type FieldValue,
  type FieldType,
  FILLS,
  type FlowShape,
  type RollupFn,
  type Id,
  type Item,
  type KanbanData,
  type TableData,
  type TimelineData,
} from '../model/types'

/** An object id, or the `ref` name of an object created earlier in the same batch. */
export type Ref = number | string

type IdeaIn = string | { text: string; children?: IdeaIn[] }
/** A database field: a name and type, plus a formula, what a relation links to, or how a rollup sums up. */
type FieldSpec = {
  name: string
  type?: FieldType
  options?: string[]
  /** A formula's expression, fields in braces: "{Price} * {Qty}". */
  formula?: string
  /** A relation: the database it links to, by name (or a view's id). */
  to?: string | number
  /** A rollup: the relation field (by name) whose linked records it sums up… */
  relation?: string
  /** …which of their fields (by name; left out for just how many)… */
  field?: string
  /** …and how. */
  fn?: RollupFn
}
type KanbanColumnIn = { title: string; cards?: (string | { title: string; start?: string; due?: string; color?: string })[] }
type TimelineLaneIn = { name: string; entries?: { title: string; start: string; end?: string; color?: string }[] }

/** Words for flowchart shapes, as the Mermaid shapes are often called. */
const FLOW_SHAPE_WORDS: Record<string, FlowShape> = {
  process: 'process',
  step: 'process',
  decision: 'decision',
  terminator: 'terminator',
  start: 'terminator',
  end: 'terminator',
  data: 'data',
  io: 'data',
  input: 'data',
  output: 'data',
  document: 'document',
  database: 'database',
  subroutine: 'subroutine',
  subprocess: 'subroutine',
}
const DIRECTIONS: F.FlowDir[] = ['down', 'right', 'up', 'left']
const same = (a: string, z: string) => a.trim().toLowerCase() === z.trim().toLowerCase()

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
  /** Grows a mind map: ideas under `parent` (an outline indents deeper ones). */
  | { op: 'addIdeas'; parent: Ref; ideas: string | IdeaIn[]; ref?: string }
  | { op: 'moveIdea'; id: Ref; parent: Ref }
  /** Replaces a whole mind map (the one `id` is in), where it is. */
  | { op: 'setMindMap'; id: Ref; outline?: string; tree?: OutlineNode; branch?: boolean }
  | ({ op: 'createFlowchart'; mermaid: string } & Placed)
  /** Grows a flowchart: a chain of steps after `after`. */
  | { op: 'addSteps'; after: Ref; steps: (string | { text: string; shape?: string; label?: string })[]; direction?: F.FlowDir; ref?: string }
  /** Replaces a whole flowchart (the one `id` is in), where it is. */
  | { op: 'setFlowchart'; id: Ref; mermaid: string }
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
  /** Replace a widget's content (same shape as creating it); unchanged cards, rows and entries keep their details. */
  | { op: 'setKanban'; id: Ref; title?: string; columns: KanbanColumnIn[] }
  | { op: 'setTable'; id: Ref; title?: string; columns: string[]; rows?: (string | number)[][] }
  | { op: 'setTimeline'; id: Ref; title?: string; lanes: TimelineLaneIn[] }
  | ({ op: 'createImage'; src: string; w?: number; h?: number } & Placed)
  | ({ op: 'createLink'; url: string; w?: number; h?: number } & Placed)
  | ({ op: 'createSpinner'; options: string[] } & Placed)
  | ({ op: 'createCode'; code: string; lang?: string; w?: number; h?: number } & Placed)
  | ({
      op: 'createDatabase'
      title?: string
      fields?: (string | FieldSpec)[]
      records?: Record<string, unknown>[]
      views?: DataViewType[]
      groupBy?: string
    } & Placed)
  | { op: 'addRecords'; id: Ref; records: Record<string, unknown>[] }
  /** Adds a field to an existing database (any of its views). */
  | { op: 'addField'; id: Ref; field: FieldSpec }
  /** "When this happens, set that" on a database: fields by name, values as people write them. */
  | { op: 'addAutomation'; id: Ref; when: { added: true } | { field: string; to?: unknown }; then: { field: string; value: unknown }[] }
  | { op: 'updateRecord'; id: Ref; record: string; values?: Record<string, unknown>; body?: string }
  | { op: 'deleteRecords'; id: Ref; records: string[] }
  | { op: 'react'; ids: Ref[]; emoji: string; by?: string }
  | { op: 'createVote'; options: Ref[]; question?: string; each?: number; ref?: string }
  | { op: 'connect'; from: Ref; to: Ref; label?: string; style?: ConnectorStyle; arrows?: Arrowheads; dashed?: boolean; ref?: string; freeform?: boolean }
  | { op: 'update'; id: Ref; text?: string; description?: string; color?: string; x?: number; y?: number; w?: number; h?: number; locked?: boolean; status?: string | null; sketch?: boolean; linkTo?: string | Record<string, unknown> | null }
  | { op: 'delete'; ids: Ref[] }
  | { op: 'addComment'; id: Ref; text: string; author?: string }
  /** Wiki pages (in a wiki only). `page`, `parent` and `before` take a page id, a `ref` or an exact title. */
  | { op: 'createPage'; title: string; parent?: string; before?: string; text?: string; icon?: string; ref?: string; note?: string }
  | { op: 'updatePage'; page: string; title?: string; text?: string; append?: string; icon?: string | null; note?: string; protected?: boolean }
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

    /** A mind map from "outline" (one line is just its central idea) or "tree". */
    const treeOf = (o: { outline?: unknown; tree?: unknown }): OutlineNode => {
      const normalize = (n: OutlineNode): OutlineNode =>
        n && typeof n === 'object' ? { text: String(n.text ?? ''), children: Array.isArray(n.children) ? n.children.map(normalize) : [] } : { text: String(n ?? ''), children: [] }
      if (o.tree !== undefined) {
        const t = normalize(o.tree as OutlineNode)
        if (!t.text) fail(index, op, '"tree" needs {"text": …, "children": […]}')
        return t
      }
      const t = o.outline === undefined ? '' : text(o.outline, 'outline')
      const parsed = parseOutline(t) ?? (t.trim() && !t.trim().includes('\n') ? { text: t.trim(), children: [] } : null)
      if (!parsed) fail(index, op, 'give "outline" (an indented list: the central idea, then its ideas indented under it) or "tree" ({"text": …, "children": […]})')
      return parsed
    }
    /** Ideas to add: an indented outline (one idea per line) or a list of texts or {text, children}. */
    const ideasOf = (v: unknown, field: string): OutlineNode[] => {
      const node = (n: unknown, f: string): OutlineNode => {
        if (typeof n === 'string' || typeof n === 'number') return { text: String(n).trim(), children: [] }
        const o = obj(n, f) as { text?: unknown; children?: unknown[] }
        return { text: text(o.text, `${f}.text`).trim(), children: list(o.children, `${f}.children`).map((c, k) => node(c, `${f}.children[${k}]`)) }
      }
      const out =
        typeof v === 'string'
          ? // Under a stand-in top line, every line becomes an idea (deeper ones by indentation).
            (parseOutline(`root\n${v.split(/\r?\n/).map((l) => `  ${l}`).join('\n')}`)?.children ?? [])
          : list(v as unknown[] | undefined, field).map((n, k) => node(n, `${field}[${k}]`))
      const check = (n: OutlineNode) => {
        if (!n.text) fail(index, op, `every idea in "${field}" needs words`)
        if (n.text.includes('\n')) fail(index, op, `one idea per line in "${field}": "${n.text.split('\n')[0]}…" has several`)
        n.children.forEach(check)
      }
      out.forEach(check)
      return out
    }
    /** Kanban columns as given, keeping the details of columns and cards that are already there. */
    const kanbanOf = (columns: KanbanColumnIn[] | undefined, prev?: KanbanData): KanbanData => {
      const oldCards = prev?.columns.flatMap((c) => c.cards) ?? []
      return {
        columns: list(columns, 'columns').map((c, k) => {
          const title = text(obj(c, `columns[${k}]`).title, `columns[${k}].title`)
          return {
            id: prev?.columns.find((x) => same(x.title, title))?.id ?? uid(),
            title,
            cards: list(c.cards, `columns[${k}].cards`).map((card, j) => {
              const f = `columns[${k}].cards[${j}]`
              const t = typeof card === 'string' ? card : text(obj(card, f).title, `${f}.title`)
              const old = oldCards.find((x) => same(x.title, t))
              if (typeof card === 'string') return old ? { ...old, title: t } : { id: uid(), title: t }
              return {
                ...(old ?? { id: uid() }),
                title: t,
                ...(date(card.start, `${f}.start`) ? { start: card.start } : {}),
                ...(date(card.due, `${f}.due`) ? { due: card.due } : {}),
                ...color(card.color, `${f}.color`),
              }
            }),
          }
        }),
      }
    }
    /** A table as given, keeping the details of columns and rows already there (rows match by their first cell). */
    const tableOf = (columnsIn: unknown, rowsIn: unknown, prev?: TableData): TableData => {
      if (!Array.isArray(columnsIn) || !columnsIn.length) fail(index, op, '"columns" should be a list of column names')
      const columns = columnsIn.map((name, k) => {
        const n = text(name, `columns[${k}]`)
        const old = prev?.columns.find((c) => same(c.name, n))
        return old ? { ...old, name: n } : { id: uid(), name: n, width: 150 }
      })
      const firstOld = prev?.columns[0]?.id
      const rows = list(rowsIn as unknown[] | undefined, 'rows').map((row, k) => {
        if (!Array.isArray(row)) fail(index, op, `rows[${k}] should be a list of cell values`)
        const old = firstOld !== undefined && row[0] !== undefined ? prev?.rows.find((r) => same(r.cells[firstOld] ?? '', String(row[0]))) : undefined
        return { ...old, id: old?.id ?? uid(), cells: Object.fromEntries(columns.map((c, j) => [c.id, row[j] === undefined ? '' : String(row[j])])) }
      })
      const ids = new Set(columns.map((c) => c.id))
      return {
        columns,
        rows,
        ...(prev?.sort && ids.has(prev.sort.column) ? { sort: prev.sort } : {}),
        ...(prev?.filters ? { filters: Object.fromEntries(Object.entries(prev.filters).filter(([c]) => ids.has(c))) } : {}),
      }
    }
    /** Timeline lanes as given, keeping the details of lanes and entries already there. */
    const timelineOf = (lanesIn: TimelineLaneIn[] | undefined, prev?: TimelineData): Pick<TimelineData, 'lanes' | 'entries'> => {
      const lanes: TimelineData['lanes'] = []
      const entries: TimelineData['entries'] = []
      list(lanesIn, 'lanes').forEach((lane, k) => {
        const name = text(obj(lane, `lanes[${k}]`).name, `lanes[${k}].name`)
        const id = prev?.lanes.find((l) => same(l.name, name))?.id ?? uid()
        lanes.push({ id, name })
        list(lane.entries, `lanes[${k}].entries`).forEach((e, j) => {
          const f = `lanes[${k}].entries[${j}]`
          const start = date(obj(e, f).start, `${f}.start`)
          if (!start) fail(index, op, `"${f}.start" is required`)
          const end = date(e.end, `${f}.end`)
          if (end && end < start) fail(index, op, `"${f}.end" is before its start`)
          const title = text(e.title, `${f}.title`)
          const old = prev?.entries.find((x) => same(x.title, title))
          const entry = { ...old, id: old?.id ?? uid(), lane: id, title, start, color: color(e.color, `${f}.color`).color ?? old?.color ?? BRANCHES[entries.length % BRANCHES.length][1] }
          if (end) entries.push({ ...entry, end })
          else {
            const { end: _gone, ...milestone } = entry as typeof entry & { end?: string }
            void _gone
            entries.push(milestone)
          }
        })
      })
      // Waiting on an entry that's gone means nothing now.
      const kept = new Set(entries.map((e) => e.id))
      return { lanes, entries: entries.map((e) => (e.after ? { ...e, after: e.after.filter((a) => kept.has(a)) } : e)) }
    }
    /** A database to link to: by name (on this board) or one of its views. */
    const datasetNamed = (to: unknown, self: Dataset, field: string): Dataset => {
      if (typeof to === 'number' || (typeof to === 'string' && refs.has(to))) {
        const ds = D.getDataset(b, B.getItem(b, resolve(to as Ref, field))?.view?.dataset)
        if (ds) return ds
      }
      const name = String(to ?? '').trim().toLowerCase()
      if (name === self.name.toLowerCase() || name === 'self') return self
      const ds = (b.datasets ?? []).find((d) => d.name.toLowerCase() === name)
      if (!ds) fail(index, op, `"${field}" should name a database on this board (${(b.datasets ?? []).map((d) => d.name).join(', ') || 'none yet'})`)
      return ds
    }
    /** A new field's settings, from its spec. */
    const configure = (ds: Dataset, fid: string, spec: FieldSpec, at: string): Dataset => {
      const f = D.fieldById(ds, fid)!
      if (f.type === 'formula') return D.setFieldConfig(ds, fid, { formula: text(spec.formula ?? '', `${at}.formula`, false) })
      if (f.type === 'relation') return D.setFieldConfig(ds, fid, { relation: { dataset: datasetNamed(spec.to, ds, `${at}.to`).id } })
      if (f.type === 'rollup') {
        const rel = spec.relation ? D.fieldByName(ds, spec.relation) : undefined
        if (rel?.type !== 'relation') fail(index, op, `"${at}.relation" should name a relation field of this database, made before it`)
        const target = rel.relation?.dataset === ds.id ? ds : D.getDataset(b, rel.relation?.dataset)
        const tf = spec.field ? target && D.fieldByName(target, spec.field) : undefined
        if (spec.field && !tf) fail(index, op, `"${at}.field" names no field of the linked database (${target?.fields.map((x) => x.name).join(', ')})`)
        const fn = spec.fn ?? (tf ? 'sum' : 'count')
        if (!D.ROLLUP_FNS.some((x) => x.fn === fn)) fail(index, op, `"${at}.fn" should be one of ${D.ROLLUP_FNS.map((x) => x.fn).join(', ')}`)
        return D.setFieldConfig(ds, fid, { rollup: { relation: rel.id, fn, ...(tf ? { field: tf.id } : {}) } })
      }
      return ds
    }
    /** A relation's value from the titles (or ids) of the records it links to. */
    const linkFor =
      (ds: Dataset, lenient = false) =>
      (f: Field, raw: unknown): string | undefined => {
        const target = f.relation?.dataset === ds.id ? ds : D.getDataset(b, f.relation?.dataset)
        if (!target) return undefined
        const wanted = (Array.isArray(raw) ? raw : String(raw).split(',')).map((x) => String(x).trim()).filter(Boolean)
        const ids = wanted.map((w) => target.records.find((r) => r.id === w || D.recordTitle(target, r).toLowerCase() === w.toLowerCase())?.id)
        // Lenient only for links within the database being made (found once its records are all in).
        if (!(lenient && target === ds) && ids.some((x) => !x)) fail(index, op, `"${f.name}" links to records of "${target.name}" by title; no record is called ${wanted.filter((_w, k) => !ids[k]).map((w) => `"${w}"`).join(', ')}`)
        return D.relValue(ids.filter((x): x is string => !!x)) || undefined
      }

    /** An existing widget of `kind`, by "id". */
    const widget = (r: Ref, kind: 'kanban' | 'table' | 'timeline'): Item => {
      const it = B.getItem(b, resolve(r, 'id'))!
      if (it.kind !== kind) fail(index, op, `"id" should be a ${kind === 'kanban' ? 'Kanban board' : kind} (that one is a ${it.kind})`)
      return it
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
        const tree = treeOf(op)
        const before = new Set(b.items.map((i) => i.id))
        let root: Id
        ;[b, root] = createMapFromOutline(b, tree, { x: 0, y: 0 })
        const ids = b.items.filter((i) => !before.has(i.id)).map((i) => i.id)
        place(ids, op.at)
        done({ id: root, ids })
        break
      }
      case 'addIdeas': {
        const parent = resolve(op.parent, 'parent')
        if (B.getItem(b, parent)?.kind !== 'mind') fail(index, op, '"parent" should be an idea in a mind map (kind mind). To start one, use createMindMap {"outline": "Central idea"}')
        const ideas = ideasOf(op.ideas, 'ideas')
        if (!ideas.length) fail(index, op, '"ideas" should list at least one idea')
        const ids: Id[] = []
        const grow = (under: Id, nodes: OutlineNode[]) => {
          for (const n of nodes) {
            let id: Id
            ;[b, id] = addChild(b, under, undefined, n.text)
            ids.push(id)
            grow(id, n.children)
          }
        }
        grow(parent, ideas)
        b = layoutAll(b, ctx.measure)
        done({ id: ids[0], ids })
        break
      }
      case 'moveIdea': {
        const id = resolve(op.id, 'id')
        const parent = resolve(op.parent, 'parent')
        if (B.getItem(b, id)?.kind !== 'mind' || B.getItem(b, parent)?.kind !== 'mind') fail(index, op, '"id" and "parent" should both be ideas in a mind map')
        const next = reparent(b, id, parent)
        if (next === b) fail(index, op, 'it can’t go there: a central idea doesn’t move, and an idea can’t go under its own branch')
        b = layoutAll(next, ctx.measure)
        done({ id })
        break
      }
      case 'setMindMap': {
        const it = B.getItem(b, resolve(op.id, 'id'))!
        if (it.kind !== 'mind') fail(index, op, '"id" should be an idea in the mind map to replace')
        let root = it
        while (root.parent !== undefined) root = B.getItem(b, root.parent) ?? root
        // Changed in place: ideas whose words stay keep their identity, colour and comments.
        const tree = treeOf(op)
        const lines: string[] = []
        const walk = (n: OutlineNode, depth: number) => {
          lines.push(`${'  '.repeat(depth)}${n.text.replace(/\s*\n\s*/g, ' ')}`)
          n.children.forEach((c) => walk(c, depth + 1))
        }
        walk(tree, 0)
        const before = new Set(b.items.map((i) => i.id))
        // With "branch", just that idea's branch; otherwise the whole map.
        b = op.branch === true ? applyOutline(b, it.id, lines.join('\n'), ctx.measure, true) : applyOutline(b, root.id, lines.join('\n'), ctx.measure)
        done({ id: root.id, ids: b.items.filter((i) => !before.has(i.id)).map((i) => i.id) })
        break
      }
      case 'addSteps': {
        const start = resolve(op.after, 'after')
        if (B.getItem(b, start)?.kind !== 'flow') fail(index, op, '"after" should be a step in a flowchart (kind flow). To start one, use createFlowchart')
        const steps = list(op.steps, 'steps')
        if (!steps.length) fail(index, op, '"steps" should list at least one step')
        if (op.direction !== undefined && !DIRECTIONS.includes(op.direction)) fail(index, op, '"direction" should be down, right, up or left')
        let prev = start
        const ids: Id[] = []
        steps.forEach((s, k) => {
          const f = `steps[${k}]`
          const step = typeof s === 'string' ? { text: s } : (obj(s, f) as { text?: unknown; shape?: unknown; label?: unknown })
          const words = text(step.text, `${f}.text`)
          let shape: FlowShape | undefined
          if (step.shape !== undefined) {
            shape = FLOW_SHAPE_WORDS[String(step.shape).toLowerCase()]
            if (!shape) fail(index, op, `"${f}.shape" should be one of ${Object.keys(FLOW_SHAPE_WORDS).join(', ')}`)
          }
          const s2 = shape ?? F.nextShape(B.getItem(b, prev)?.shape)
          let id: Id | null
          ;[b, id] = F.addStep(b, prev, op.direction ?? F.flowDirection(b, prev), s2, stepSize(s2, words))
          if (id === null) fail(index, op, `couldn't add ${f}`)
          const made = id
          b = B.updateItem(b, made, (i) => ({ ...i, text: words }))
          if (step.label !== undefined) {
            const label = text(step.label, `${f}.label`)
            const from = prev
            b = { ...b, connectors: b.connectors.map((c) => (c.from === from && c.to === made ? { ...c, label } : c)) }
          }
          ids.push(made)
          prev = made
        })
        done({ id: ids[ids.length - 1], ids })
        break
      }
      case 'setFlowchart': {
        const first = resolve(op.id, 'id')
        if (B.getItem(b, first)?.kind !== 'flow') fail(index, op, '"id" should be a step in the flowchart to replace')
        // The whole chart: every step joined to this one by lines.
        const chart = new Set<Id>([first])
        for (let grew = true; grew; ) {
          grew = false
          for (const c of b.connectors) {
            const [x, z] = [B.getItem(b, c.from), B.getItem(b, c.to)]
            if (x?.kind !== 'flow' || z?.kind !== 'flow') continue
            if (chart.has(x.id) !== chart.has(z.id)) {
              chart.add(x.id)
              chart.add(z.id)
              grew = true
            }
          }
        }
        const box = unionAll([...chart].map((id) => B.itemBounds(B.getItem(b, id)!)))!
        let ids: Id[] = []
        try {
          const graph = parseMermaid(text(op.mermaid, 'mermaid'))
          b = B.remove(b, chart)
          ;[b, ids] = insertMermaid(b, graph, { x: 0, y: 0 })
        } catch (err) {
          if (err instanceof OpError) throw err
          fail(index, op, (err as Error).message)
        }
        place(ids, { x: box.x, y: box.y })
        done({ id: ids[0], ids })
        break
      }
      case 'setKanban': {
        const it = widget(op.id, 'kanban')
        const kanban = kanbanOf(op.columns, it.kanban)
        b = B.updateItem(b, it.id, (i) => ({ ...i, kanban, w: Math.max(i.w, kanban.columns.length * 272 + 200), ...(op.title !== undefined ? { text: text(op.title, 'title') } : {}) }))
        done({ id: it.id })
        break
      }
      case 'setTable': {
        const it = widget(op.id, 'table')
        const table = tableOf(op.columns, op.rows, it.table)
        const sz = tableSize(table)
        b = B.updateItem(b, it.id, (i) => ({ ...i, table, w: sz.w, h: sz.h, ...(op.title !== undefined ? { text: text(op.title, 'title') } : {}) }))
        done({ id: it.id })
        break
      }
      case 'setTimeline': {
        const it = widget(op.id, 'timeline')
        const prev = it.timeline
        const t = timelineOf(op.lanes, prev)
        const timeline: TimelineData = { ...t, ...(prev?.sources?.length ? { sources: prev.sources } : {}) }
        b = B.updateItem(b, it.id, (i) => ({ ...i, timeline, h: Math.max(i.h, 120 + (t.lanes.length + (prev?.sources?.length ?? 0)) * 46), ...(op.title !== undefined ? { text: text(op.title, 'title') } : {}) }))
        done({ id: it.id })
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
        const table: TableData = tableOf(op.columns, op.rows)
        const id = add(B.newItem('table', r0(tableSize(table).w, tableSize(table).h), { text: text(op.title, 'title', false) || 'Table', table }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createKanban': {
        const kanban: KanbanData = op.columns ? kanbanOf(op.columns) : newKanban()
        const id = add(B.newItem('kanban', r0(Math.max(600, kanban.columns.length * 272 + 200), 460), { text: text(op.title, 'title', false) || 'Kanban board', kanban }))
        place([id], op.at)
        done({ id })
        break
      }
      case 'createTimeline': {
        const { lanes, entries } = timelineOf(op.lanes)
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
        if (op.sketch !== undefined) {
          if (typeof op.sketch !== 'boolean') fail(index, op, '"sketch" should be true or false')
          b = setSketch(b, [id], op.sketch)
        }
        if (op.linkTo !== undefined) {
          // A web address as text, a place in BrainCraft as {board?, page?, heading?, item?}, or null to remove it.
          const raw = typeof op.linkTo === 'string' ? { url: op.linkTo } : op.linkTo
          const link = raw === null ? null : cleanItemLink(raw)
          if (raw !== null && !link) fail(index, op, '"linkTo" should be a web address, {"board": KEY, "page": ID, "heading"?: slug} or {"item": ID}, or null')
          b = setItemLink(b, [id], link)
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
            if (spec) ds = configure(ds, fid, spec, `fields[${k}]`)
          })
          for (const r of records) {
            const { values, ds: withOpts } = D.valuesByName(ds, r, linkFor(ds, true))
            ds = D.addRecord(withOpts, values)[0]
          }
          // Links within this same database can only be found once its records are all in.
          if (ds.fields.some((f) => f.type === 'relation' && f.relation?.dataset === ds.id)) {
            const all = ds
            ds = { ...ds, records: ds.records.map((rec, j) => ({ ...rec, values: { ...rec.values, ...D.valuesByName(all, records[j], linkFor(all)).values } })) }
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
      case 'addField': {
        const id = resolve(op.id, 'id')
        let ds = D.getDataset(b, B.getItem(b, id)?.view?.dataset)
        if (!ds) fail(index, op, '"id" should be a database view')
        const spec = obj(op.field, 'field') as FieldSpec
        const type = spec.type ?? 'text'
        if (!D.FIELD_TYPES.some((t) => t.type === type)) fail(index, op, `"field.type" should be one of ${D.FIELD_TYPES.map((t) => t.type).join(', ')}`)
        let fid: string
        ;[ds, fid] = D.addField(ds!, text(spec.name, 'field.name'), type)
        for (const o of list(spec.options, 'field.options')) ds = D.addOption(ds, fid, String(o))[0]
        const final = configure(ds, fid, spec, 'field')
        b = D.updateDataset(b, final.id, () => final)
        done({ id })
        break
      }
      case 'addAutomation': {
        const id = resolve(op.id, 'id')
        const ds = D.getDataset(b, B.getItem(b, id)?.view?.dataset)
        if (!ds) fail(index, op, '"id" should be a database view')
        const field = (name: unknown, at: string) => {
          const f = typeof name === 'string' ? D.fieldByName(ds!, name) : undefined
          if (!f) fail(index, op, `"${at}" should name a field (${ds!.fields.map((x) => x.name).join(', ')})`)
          if (D.isComputed(f)) fail(index, op, `"${at}" is worked out (a formula or rollup), so it can't be set or watched`)
          return f
        }
        const w = obj(op.when, 'when') as { added?: unknown; field?: unknown; to?: unknown }
        let when: Automation['when']
        if (w.added === true) when = { added: true }
        else {
          const f = field(w.field, 'when.field')
          const to = w.to === undefined ? undefined : D.coerce(f, w.to as FieldValue)
          if (w.to !== undefined && to === undefined) fail(index, op, `"when.to" isn't a value "${f.name}" can have`)
          when = { field: f.id, ...(to !== undefined ? { to } : {}) }
        }
        const steps = list(op.then, 'then')
        if (!steps.length) fail(index, op, '"then" should list at least one {"field", "value"} to set')
        const then = steps.map((s, k) => {
          const f = field(obj(s, `then[${k}]`).field, `then[${k}].field`)
          const raw = (s as { value?: unknown }).value
          if (raw === 'today' || raw === null || raw === '') return { field: f.id, value: raw === 'today' ? ('today' as const) : null }
          const v = D.coerce(f, raw as FieldValue)
          if (v === undefined) fail(index, op, `"then[${k}].value" isn't a value "${f.name}" can have`)
          return { field: f.id, value: v }
        })
        const rule: Automation = { id: uid(), when, then }
        b = D.updateDataset(b, ds!.id, (d) => ({ ...d, automations: [...(d.automations ?? []), rule] }))
        done({ id })
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
          const out = D.valuesByName(ds!, named as Record<string, unknown>, linkFor(ds!))
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
          if (op.values === undefined && op.body === undefined) fail(index, op, 'give "values" (fields to set) or "body" (the record’s page)')
          if (op.values !== undefined) {
            const values = valuesOf(op.values, 'values')
            for (const [f, v] of Object.entries(values)) ds = D.setValue(ds!, r.id, f, v)
            // Fields set to null or "" are cleared.
            for (const [name, v] of Object.entries(op.values)) {
              const f = D.fieldByName(ds!, name)
              if (f && (v === null || v === '')) ds = D.setValue(ds!, r.id, f.id, null)
            }
          }
          if (op.body !== undefined) ds = D.setBody(ds!, r.id, text(op.body, 'body', false))
        } else {
          if (!Array.isArray(op.records)) fail(index, op, '"records" should be a list of record ids or titles')
          op.records.forEach((q, k) => (ds = D.deleteRecord(ds!, findRecord(String(q), `records[${k}]`).id)))
        }
        // The database's automations follow, as when someone changes it by hand.
        const final = runAutomations(D.getDataset(b, ds!.id), ds!)
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
          if (op.protected !== undefined) {
            if (typeof op.protected !== 'boolean') fail(index, op, '"protected" should be true or false')
            b = W.setPageMeta(b, id, { protected: op.protected })
          }
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
  'addIdeas',
  'moveIdea',
  'setMindMap',
  'createFlowchart',
  'addSteps',
  'setFlowchart',
  'setKanban',
  'setTable',
  'setTimeline',
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
  'addField',
  'addAutomation',
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
