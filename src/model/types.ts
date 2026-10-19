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
  | 'link'
  | 'code'

/** A web address shown as a card. The preview fields come from the page, when a server could read it. */
export interface LinkCard {
  url: string
  title?: string
  description?: string
  /** Address of the page's picture. */
  image?: string
  site?: string
  /** Set once a preview was looked for (found or not), so it isn't asked for again. */
  checked?: boolean
}

/** Where an object stands. */
export type Status = 'todo' | 'doing' | 'waiting' | 'undecided' | 'done' | 'dropped'

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

/**
 * A wiki page's place in its wiki: title and position. Its words are a separate `PageBody`, so
 * renaming or moving a page and typing on it never overwrite each other.
 */
export interface Page {
  id: string
  /** The page it sits under; missing (or a page that's gone) means the top level. */
  parent?: string
  /** Order among its siblings, smallest first (ties go by id). */
  rank: number
  title: string
  icon?: string
  created: number
  /** When it went to the trash (with its sub-pages); restorable until deleted for good. */
  trashed?: number
}

/** A copy of what a page's embed shows, kept in the wiki. `key` is `board` or `board#item`. */
export interface Snap {
  key: string
  at: number
  /** Who saved it; only they refresh it as they read, so viewing a page never shares a board. */
  by?: string
  items: Item[]
  connectors: Connector[]
  datasets?: Dataset[]
}

/** A wiki page's words, in Markdown, and who last changed them. */
export interface PageBody {
  id: string
  text: string
  at: number
  by?: string
}

/**
 * One saved version of a wiki page: its title and words at a moment, who wrote them, and a note
 * about what changed. Versions are only ever added (or pruned when there are too many), never
 * edited, so friends adding them at the same time never clash.
 */
export interface PageRev {
  id: string
  page: string
  at: number
  by?: string
  title: string
  text: string
  /** What changed, in the writer's words. */
  note?: string
  /** Kept for good, however many versions come after it. */
  keep?: boolean
  /** Its number on the page, fixed when saved (older versions going doesn't renumber the rest). */
  n?: number
  /** A small change (ticking checklist items) that the same person's next small change joins. */
  quick?: boolean
}

export type DataViewType = 'table' | 'board' | 'timeline' | 'calendar' | 'gallery'

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
  /** The month a calendar view shows (YYYY-MM); this month when missing. */
  month?: string
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
  /** Entries (of this timeline) that must finish before this one starts. */
  after?: string[]
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

/** An Excalidraw drawing's scene: its elements, and the pictures they show. */
export interface ExcalidrawScene {
  elements: unknown[]
  files?: Record<string, ExcalidrawFile>
}

export interface ExcalidrawFile {
  id: string
  mimeType: string
  dataURL: string
  created: number
}

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
  /** An `image` item drawn in Excalidraw: the scene, so it opens again for editing (`src` is its picture). */
  excalidraw?: ExcalidrawScene
  /** When a comment block was written. */
  createdAt?: number
  /** Runs of the flowchart this shape starts (runbook mode), oldest first. */
  runs?: RunRecord[]
  table?: TableData
  /** A view of one of the board's datasets (`data` items). */
  view?: DataView
  kanban?: KanbanData
  timeline?: TimelineData
  /** The web address and preview of a `link` card. */
  link?: LinkCard
  /** A link card for a wiki page (its title and opening words), opened beside the board. */
  page?: { board: string; page: string }
  /** A code block's language (an id from model/code; guessed when missing). */
  lang?: string
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
  /** Where this object stands: to do, in progress, done… */
  status?: Status
  /** Who last changed it (their name), for "Since you were here". */
  by?: string
  /** On a comment card: a private brainstorm round, and whether it was revealed. */
  brainstorm?: { by: string; revealed?: boolean }
  /** A sticky note written during an open brainstorm: only its writer sees it until the reveal. */
  hiddenBy?: string
  /** The brainstorm card (round) a hidden note was written in. */
  hiddenRound?: Id
  /** A flip card's other side (a sticky note with this is a flip card). Flipping swaps it with `text`. */
  back?: string
  /** A flip card showing its back. */
  flipped?: boolean
  /** On a comment card: a spinner wheel whose options are the card's lines, and its latest spin. */
  wheel?: { spin?: { at: number; from: number; to: number; result: number; label?: string } }
  /** Set only on the copy drawn for someone a hidden note is hidden from; never saved. */
  masked?: boolean
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
  /** An emoji that marks the board in lists, the tab title and links. */
  icon?: string
  /** Items in paint order; later items are drawn on top. Mind-map siblings keep this order too. */
  items: Item[]
  connectors: Connector[]
  nextId: Id
  /** Records shown by `data` items; several items can show the same dataset. */
  datasets?: Dataset[]
  /** A wiki: pages in a tree instead of a canvas. Set when it's made, never changed. */
  kind?: 'wiki'
  pages?: Page[]
  /** The pages' words, one per page (same id). */
  bodies?: PageBody[]
  /** Copies of what the pages embed, for friends who don't have those boards. */
  snaps?: Snap[]
  /** Saved versions of the pages, oldest first (see `revisions.ts`). */
  revs?: PageRev[]
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
export const hasText = (k: Kind) => k !== 'pen' && k !== 'image' && k !== 'link'
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
    case 'link':
      return { w: 360, h: 120 }
    case 'code':
      return { w: 460, h: 240 }
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
    case 'link':
      return '#ffffff'
    case 'code':
      return '#16181d'
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
    case 'code':
      return 14
    case 'table':
    case 'kanban':
    case 'timeline':
    case 'data':
      return 18
    default:
      return 22
  }
}

/** What an object is called in lists: comment cards that became a vote, brainstorm or wheel, and flip cards, get their own names. */
export function itemKindLabel(i: Pick<Item, 'kind' | 'poll' | 'brainstorm' | 'wheel' | 'back' | 'excalidraw'>): string {
  if (i.kind === 'comment') {
    if (i.poll) return 'Vote'
    if (i.brainstorm) return 'Private brainstorm'
    if (i.wheel) return 'Spinner wheel'
  }
  if (i.kind === 'sticky' && typeof i.back === 'string') return 'Flip card'
  if (i.kind === 'image' && i.excalidraw) return 'Excalidraw drawing'
  return KIND_LABELS[i.kind]
}

export const KIND_LABELS: Record<Kind, string> = {
  sticky: 'Sticky note',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Text',
  frame: 'Frame',
  pen: 'Drawing',
  mind: 'Mind map idea',
  flow: 'Flowchart shape',
  comment: 'Comment block',
  image: 'Image',
  table: 'Table',
  kanban: 'Kanban board',
  timeline: 'Timeline',
  data: 'Database view',
  link: 'Link card',
  code: 'Code block',
}
