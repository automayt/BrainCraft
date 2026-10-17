import type { Rect, Vec } from './geom'

export type Id = number

export type Kind =
  | 'sticky'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'frame'
  | 'pen'
  | 'mind'
  | 'flow'
  | 'comment'
  | 'image'
  | 'table'
  | 'kanban'
  | 'timeline'
  | 'data'

/** A timestamped work note attached to an object. */
export interface Note {
  id: string
  text: string
  /** Milliseconds since the epoch. */
  at: number
  author?: string
}

// ----- linked data: one dataset, many views ------------------------------------------

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'person' | 'checkbox'

export interface SelectOption {
  id: string
  name: string
  color: string
}

export interface Field {
  id: string
  name: string
  type: FieldType
  /** The choices of a `select` field, in order. */
  options?: SelectOption[]
}

/** A field value: text, a number, an ISO date, a select option's id, or a checkbox. */
export type FieldValue = string | number | boolean

export interface DataRecord {
  id: string
  values: Record<string, FieldValue>
}

/** Records shared by every view that shows them. */
export interface Dataset {
  id: string
  name: string
  fields: Field[]
  records: DataRecord[]
}

export type DataViewType = 'table' | 'board' | 'timeline'

/** How a `data` item shows its dataset. Sorting, filtering and hiding change the view, never the data. */
export interface DataView {
  dataset: string
  type: DataViewType
  sort?: { field: string; dir: 'asc' | 'desc' }
  /** Case-insensitive "contains" across every shown field. */
  query?: string
  /** Fields hidden in this view. */
  hidden?: string[]
  /** Board columns (and timeline lanes) come from this select or person field. */
  groupBy?: string
  /** Timeline bars run from `start` to `end` (date fields). */
  start?: string
  end?: string
}

/** One step of a flowchart run (runbook mode). */
export interface RunStep {
  node: Id
  /** The shape's text when the step was taken, so history reads right after edits. */
  text: string
  /** When the step was reached. */
  at: number
  /** The way taken out of this step (a decision's answer). */
  choice?: string
  note?: string
}

/** A finished (or stopped) walk through a flowchart. */
export interface RunRecord {
  id: string
  startedAt: number
  endedAt: number
  status: 'done' | 'stopped'
  steps: RunStep[]
  by?: string
}

export interface TableColumn {
  id: string
  name: string
  width: number
  hidden?: boolean
}

export interface TableRow {
  id: string
  cells: Record<string, string>
  hidden?: boolean
}

export interface TableData {
  columns: TableColumn[]
  rows: TableRow[]
  sort?: { column: string; dir: 'asc' | 'desc' }
  /** Case-insensitive "contains" filter per column. */
  filters?: Record<string, string>
  showFilters?: boolean
  /** Show hidden rows and columns (faded) so they can be restored. */
  showHidden?: boolean
}

export interface KanbanCard {
  id: string
  title: string
  color?: string
  /** ISO dates (YYYY-MM-DD). */
  start?: string
  due?: string
}

export interface KanbanColumn {
  id: string
  title: string
  cards: KanbanCard[]
}

export interface KanbanData {
  columns: KanbanColumn[]
}

export interface TimelineLane {
  id: string
  name: string
}

export interface TimelineEntry {
  id: string
  lane: string
  title: string
  /** ISO dates (YYYY-MM-DD); no `end` means a milestone. */
  start: string
  end?: string
  color: string
}

export interface TimelineData {
  lanes: TimelineLane[]
  entries: TimelineEntry[]
  /** Kanban boards whose dated cards appear on this timeline. */
  sources?: Id[]
  /** Days per screen pixel are derived from this range; omitted means fit the content. */
  range?: { start: string; end: string }
}

/** Standard flowchart symbols, drawn by `flow` items. */
export type FlowShape = 'process' | 'decision' | 'terminator' | 'data' | 'document' | 'database' | 'subroutine'

export const FLOW_SHAPES: { shape: FlowShape; label: string; hint: string; color: string; w: number; h: number }[] = [
  { shape: 'terminator', label: 'Start / End', hint: 'Where the flow begins or ends', color: '#cdeba5', w: 160, h: 64 },
  { shape: 'process', label: 'Process', hint: 'A step or action', color: '#aad2fa', w: 170, h: 84 },
  { shape: 'decision', label: 'Decision', hint: 'A yes/no question that branches', color: '#fff9b1', w: 180, h: 110 },
  { shape: 'data', label: 'Input / Output', hint: 'Data going in or out', color: '#cdbcff', w: 180, h: 80 },
  { shape: 'document', label: 'Document', hint: 'A document or report', color: '#ffffff', w: 170, h: 90 },
  { shape: 'database', label: 'Database', hint: 'Stored data', color: '#aaebe8', w: 140, h: 100 },
  { shape: 'subroutine', label: 'Subprocess', hint: 'A process defined elsewhere', color: '#aad2fa', w: 180, h: 84 },
]

export const flowShapeInfo = (s: FlowShape | undefined) => FLOW_SHAPES.find((f) => f.shape === s) ?? FLOW_SHAPES[1]

export type ConnectorStyle = 'straight' | 'elbow' | 'curved'
export type Arrowheads = 'end' | 'both' | 'none'

export type Side = 'left' | 'right'

export interface Item extends Rect {
  id: Id
  kind: Kind
  color: string
  text: string
  fontSize: number
  /** Stroke points of a `pen` item, in world coordinates. */
  points?: Vec[]
  strokeWidth?: number
  /** Mind-map node: its parent node, or undefined for the central (root) node. */
  parent?: Id
  /** Mind-map node directly under the root: which side of the root it grows on. */
  side?: Side
  /** Mind-map node moved by hand: how far it (and its branch) sits from where the layout would put it. */
  offset?: Vec
  /** Mind-map node: its children are hidden. */
  collapsed?: boolean
  /** Flowchart symbol of a `flow` item. */
  shape?: FlowShape
  /** Free-text description of the object, shown above its comments. */
  description?: string
  /** Work notes (comments) on this object, oldest first. */
  notes?: Note[]
  /** Image data URL of an `image` item. */
  src?: string
  /** When a comment block was written. */
  createdAt?: number
  /** Runs of the flowchart this shape starts (runbook mode), oldest first. */
  runs?: RunRecord[]
  table?: TableData
  /** A view of one of the board's datasets (`data` items). */
  view?: DataView
  kanban?: KanbanData
  timeline?: TimelineData
  /** Emoji reactions: who put each one on. */
  reactions?: Record<string, string[]>
  /** Dot votes, by vote card id (as text), then by person. */
  votes?: Record<string, Record<string, number>>
  /** On a vote card: what's being voted on and how. */
  poll?: Poll
  /** Can't be clicked, moved, edited or deleted until unlocked (right-click or Alt-click reaches it). */
  locked?: boolean
  /** Objects sharing a group id select and move together. */
  group?: string
}

/** A dot vote: each person spreads `each` votes over the options; totals hidden until revealed. */
export interface Poll {
  options: Id[]
  each: number
  revealed: boolean
  ended?: boolean
}

export interface Connector {
  id: Id
  from: Id
  to: Id
  color: string
  label?: string
  /** Defaults to `straight`. */
  style?: ConnectorStyle
  /** Defaults to `end`. */
  arrows?: Arrowheads
  dashed?: boolean
}

export interface Board {
  version: number
  title: string
  /** Items in paint order; later items are drawn on top. Mind-map siblings keep this order too. */
  items: Item[]
  connectors: Connector[]
  nextId: Id
  /** Records shown by `data` items; several items can show the same dataset. */
  datasets?: Dataset[]
}

export const FORMAT_VERSION = 1

export const FILLS: readonly [string, string][] = [
  ['Yellow', '#fff9b1'],
  ['Orange', '#ffcd82'],
  ['Red', '#ffaaa5'],
  ['Pink', '#f6b9e6'],
  ['Violet', '#cdbcff'],
  ['Blue', '#aad2fa'],
  ['Cyan', '#aaebe8'],
  ['Green', '#cdeba5'],
  ['Gray', '#e2e2e6'],
  ['White', '#ffffff'],
]

export const INKS: readonly [string, string][] = [
  ['Black', '#1e1e24'],
  ['Gray', '#787882'],
  ['Red', '#dc3232'],
  ['Orange', '#e87814'],
  ['Green', '#1e9646'],
  ['Blue', '#2864dc'],
  ['Purple', '#823cc8'],
]

/** Branch colours handed out to a mind map's main branches, in order. */
export const BRANCHES: readonly [string, string][] = [
  ['Blue', '#4262ff'],
  ['Orange', '#f2862e'],
  ['Green', '#25a35a'],
  ['Pink', '#e0457b'],
  ['Purple', '#8a4fe0'],
  ['Teal', '#14a3a3'],
  ['Red', '#d93f3f'],
  ['Gold', '#c9a20a'],
]

export const MIND_ROOT_COLOR = '#1e1e24'
export const TEXT_ON_FILL = '#1e1e24'

/** Whether the item's colour is an ink (text/line) colour rather than a fill. */
export const usesInk = (k: Kind) => k === 'text' || k === 'pen'
export const hasText = (k: Kind) => k !== 'pen' && k !== 'image'
export const isResizable = (k: Kind) => k !== 'mind' && k !== 'table'
/** Objects with their own interactive content (live once selected). */
export const isWidget = (k: Kind) => k === 'table' || k === 'kanban' || k === 'timeline' || k === 'data'
/** Height of the draggable title strip on widgets. */
export const WIDGET_TITLE_H = 40

export function defaultSize(k: Kind): { w: number; h: number } {
  switch (k) {
    case 'sticky':
      return { w: 200, h: 200 }
    case 'rect':
      return { w: 220, h: 140 }
    case 'ellipse':
      return { w: 180, h: 180 }
    case 'text':
      return { w: 260, h: 44 }
    case 'frame':
      return { w: 800, h: 600 }
    case 'mind':
      return { w: 160, h: 52 }
    case 'flow':
      return { w: 170, h: 84 }
    case 'comment':
      return { w: 260, h: 150 }
    case 'image':
      return { w: 320, h: 240 }
    case 'table':
      return { w: 520, h: 220 }
    case 'kanban':
      return { w: 860, h: 460 }
    case 'timeline':
      return { w: 1000, h: 320 }
    case 'data':
      return { w: 760, h: 360 }
    case 'pen':
      return { w: 1, h: 1 }
  }
}

export function defaultColor(k: Kind): string {
  switch (k) {
    case 'sticky':
      return FILLS[0][1]
    case 'rect':
    case 'ellipse':
      return FILLS[6][1]
    case 'frame':
      return '#ffffff'
    case 'mind':
      return MIND_ROOT_COLOR
    case 'flow':
      return FLOW_SHAPES[1].color
    case 'comment':
      return '#fff4d6'
    case 'kanban':
      return '#eef0f5'
    case 'image':
    case 'table':
    case 'timeline':
    case 'data':
      return '#ffffff'
    case 'text':
    case 'pen':
      return INKS[0][1]
  }
}

export function defaultFontSize(k: Kind): number {
  switch (k) {
    case 'text':
      return 28
    case 'frame':
      return 18
    case 'flow':
      return 17
    case 'comment':
      return 16
    case 'table':
    case 'kanban':
    case 'timeline':
    case 'data':
      return 18
    default:
      return 22
  }
}

export const KIND_LABELS: Record<Kind, string> = {
  sticky: 'Sticky note',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Text',
  frame: 'Frame',
  pen: 'Drawing',
  mind: 'Mind map node',
  flow: 'Flowchart shape',
  comment: 'Comment',
  image: 'Image',
  table: 'Table',
  kanban: 'Kanban board',
  timeline: 'Timeline',
  data: 'Database view',
}
