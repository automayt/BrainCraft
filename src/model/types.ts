import type { Rect, Vec } from './geom'

export type Id = number

export type Kind = 'sticky' | 'rect' | 'ellipse' | 'text' | 'frame' | 'pen' | 'mind' | 'flow'

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
  /** Mind-map node: its children are hidden. */
  collapsed?: boolean
  /** Flowchart symbol of a `flow` item. */
  shape?: FlowShape
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
}

export interface Board {
  version: number
  title: string
  /** Items in paint order; later items are drawn on top. Mind-map siblings keep this order too. */
  items: Item[]
  connectors: Connector[]
  nextId: Id
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
export const hasText = (k: Kind) => k !== 'pen'
export const isResizable = (k: Kind) => k !== 'mind'

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
}
