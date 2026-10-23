/**
 * Mermaid flowcharts in and out. Supports the `flowchart`/`graph` syntax:
 * directions, the common node shapes (classic and `@{ shape: … }` forms),
 * chained and `&`-grouped links, link labels, dotted and arrowless links.
 * Subgraphs, classes and styles are skipped on import.
 */

import { addItem, connect, getItem } from './board'
import { flowItem } from './flowchart'
import type { Vec } from './geom'
import { type Arrowheads, type Board, type FlowShape, type Id, type Item, flowShapeInfo } from './types'

export type MermaidDir = 'TD' | 'BT' | 'LR' | 'RL'

export interface MermaidNode {
  key: string
  label: string
  shape: FlowShape
}

export interface MermaidEdge {
  from: string
  to: string
  label?: string
  arrows: Arrowheads
  dashed: boolean
}

export interface MermaidGraph {
  dir: MermaidDir
  nodes: MermaidNode[]
  edges: MermaidEdge[]
}

const HEADER = /^\s*(?:flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?\s*;?\s*$/i

export function looksLikeMermaid(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('%%'))
  return !!first && HEADER.test(first)
}

/** Shape tokens after a node id, most specific first. */
const SHAPES: [RegExp, FlowShape][] = [
  [/\(\[(.*?)\]\)/y, 'terminator'],
  [/\[\[(.*?)\]\]/y, 'subroutine'],
  [/\[\((.*?)\)\]/y, 'database'],
  [/\(\(\((.*?)\)\)\)/y, 'terminator'],
  [/\(\((.*?)\)\)/y, 'terminator'],
  [/\{\{(.*?)\}\}/y, 'process'],
  [/\{(.*?)\}/y, 'decision'],
  [/\[[/\\](.*?)[/\\]\]/y, 'data'],
  [/\[(.*?)\]/y, 'process'],
  [/\((.*?)\)/y, 'process'],
  [/>(.*?)\]/y, 'document'],
]

const NEW_SHAPES: Record<string, FlowShape> = {
  rect: 'process',
  rectangle: 'process',
  process: 'process',
  proc: 'process',
  rounded: 'process',
  event: 'process',
  hex: 'process',
  hexagon: 'process',
  diamond: 'decision',
  diam: 'decision',
  decision: 'decision',
  question: 'decision',
  stadium: 'terminator',
  pill: 'terminator',
  terminal: 'terminator',
  circle: 'terminator',
  circ: 'terminator',
  'sm-circ': 'terminator',
  start: 'terminator',
  stop: 'terminator',
  'lean-r': 'data',
  'lean-l': 'data',
  'in-out': 'data',
  'out-in': 'data',
  doc: 'document',
  document: 'document',
  docs: 'document',
  'tag-doc': 'document',
  cyl: 'database',
  cylinder: 'database',
  db: 'database',
  database: 'database',
  das: 'database',
  subproc: 'subroutine',
  subroutine: 'subroutine',
  'fr-rect': 'subroutine',
  'framed-rectangle': 'subroutine',
}

const SKIP = /^\s*(?:subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|%%)/

function cleanLabel(raw: string): string {
  let s = raw.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1)
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#quot;/g, '"')
    .replace(/#amp;/g, '&')
    .replace(/#lt;/g, '<')
    .replace(/#gt;/g, '>')
    .trim()
}

const ID = /[\p{L}\p{N}_]+/uy
const SPACE = /\s*/y
const AMP = /\s*&\s*/y
// "-- text -->", "== text ==>", "-. text .->" (and their arrowless forms).
const LABELLED_LINK = /(<)?(--|==|-\.)\s+(.+?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+)/y
// "-->", "---", "-.->", "==>", "<-->", optionally followed by |label|.
const PLAIN_LINK = /(<)?(-\.+-|-{2,}|={2,})(>|o|x)?(?:\s*\|([^|]*)\|)?/y

class Scanner {
  pos = 0
  readonly text: string
  constructor(text: string) {
    this.text = text
  }
  match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.pos
    const m = re.exec(this.text)
    if (m) this.pos = re.lastIndex
    return m
  }
  done() {
    this.match(SPACE)
    return this.pos >= this.text.length
  }
}

/** Splits a line at `;` separators that aren't inside a label. */
function splitStatements(line: string): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let k = 0; k < line.length; k++) {
    const ch = line[k]
    if (ch === '"') quoted = !quoted
    else if (quoted) continue
    else if ('[({'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
    else if (ch === '|') depth = depth ? depth - 1 : depth + 1
    else if (ch === ';' && depth === 0) {
      out.push(line.slice(start, k))
      start = k + 1
    }
  }
  out.push(line.slice(start))
  return out
}

/** Parses a Mermaid flowchart. Throws with a readable message on anything it can't follow. */
export function parseMermaid(text: string): MermaidGraph {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() && !l.trim().startsWith('%%'))
  const header = start >= 0 ? HEADER.exec(lines[start]) : null
  if (!header) throw new Error('Mermaid flowcharts start with "flowchart TD" (or graph LR, …)')
  const dirRaw = (header[1] ?? 'TD').toUpperCase()
  const dir: MermaidDir = dirRaw === 'TB' ? 'TD' : (dirRaw as MermaidDir)

  const nodes = new Map<string, MermaidNode>()
  const edges: MermaidEdge[] = []

  const node = (s: Scanner): string | null => {
    s.match(SPACE)
    const id = s.match(ID)
    if (!id) return null
    const key = id[0]
    let label: string | undefined
    let shape: FlowShape | undefined
    const modern = s.match(/@\{([^}]*)\}/y)
    if (modern) {
      const props = Object.fromEntries(
        [...modern[1].matchAll(/([\w-]+)\s*:\s*("(?:[^"\\]|\\.)*"|[^,]+)/g)].map((m) => [m[1], m[2].trim()]),
      )
      if (props.shape) shape = NEW_SHAPES[props.shape.replace(/"/g, '').toLowerCase()] ?? 'process'
      if (props.label) label = cleanLabel(props.label)
    } else {
      for (const [re, sh] of SHAPES) {
        const m = s.match(re)
        if (m) {
          label = cleanLabel(m[1])
          shape = sh
          break
        }
      }
    }
    const existing = nodes.get(key)
    if (!existing) nodes.set(key, { key, label: label ?? key, shape: shape ?? 'process' })
    else if (shape) nodes.set(key, { key, label: label ?? existing.label, shape })
    return key
  }

  const group = (s: Scanner): string[] | null => {
    const first = node(s)
    if (!first) return null
    const out = [first]
    while (s.match(AMP)) {
      const next = node(s)
      if (!next) throw new Error(`Expected a node after "&" near "${s.text.slice(s.pos, s.pos + 20)}"`)
      out.push(next)
    }
    return out
  }

  const link = (s: Scanner): Omit<MermaidEdge, 'from' | 'to'> | null => {
    s.match(SPACE)
    const labelled = s.match(LABELLED_LINK)
    if (labelled) {
      const head = labelled[4].endsWith('>')
      return {
        label: cleanLabel(labelled[3]),
        arrows: head ? (labelled[1] ? 'both' : 'end') : 'none',
        dashed: labelled[2] === '-.',
      }
    }
    const plain = s.match(PLAIN_LINK)
    if (!plain) return null
    const head = plain[3] === '>'
    return {
      ...(plain[4] !== undefined && plain[4].trim() ? { label: cleanLabel(plain[4]) } : {}),
      arrows: head ? (plain[1] ? 'both' : 'end') : 'none',
      dashed: plain[2].includes('.'),
    }
  }

  for (let n = start + 1; n < lines.length; n++) {
    for (const statement of splitStatements(lines[n])) {
      if (!statement.trim() || SKIP.test(statement)) continue
      const s = new Scanner(statement)
      let left = group(s)
      if (!left) throw new Error(`Line ${n + 1}: expected a node id, got "${statement.trim()}"`)
      while (!s.done()) {
        const l = link(s)
        if (!l) throw new Error(`Line ${n + 1}: can't read "${statement.slice(s.pos).trim()}"`)
        const right = group(s)
        if (!right) throw new Error(`Line ${n + 1}: a link needs a node on both sides`)
        for (const from of left) for (const to of right) edges.push({ from, to, ...l })
        left = right
      }
    }
  }
  return { dir, nodes: [...nodes.values()], edges }
}

// ----- export ------------------------------------------------------------------

const OPEN_CLOSE: Record<FlowShape, [string, string] | null> = {
  process: ['[', ']'],
  decision: ['{', '}'],
  terminator: ['([', '])'],
  data: ['[/', '/]'],
  database: ['[(', ')]'],
  subroutine: ['[[', ']]'],
  document: null,
}

function escapeLabel(text: string): string {
  return text.trim().replace(/"/g, '#quot;').replace(/\r?\n/g, '<br>')
}

/**
 * Writes the given objects (default: every flowchart shape) and the links
 * between them as a Mermaid flowchart.
 */
export function toMermaid(b: Board, ids?: ReadonlySet<Id>): string {
  const include = (i: Item) =>
    ids ? ids.has(i.id) && !['pen', 'frame', 'image', 'table', 'kanban', 'timeline', 'data', 'link', 'code'].includes(i.kind) && !i.poll && !i.brainstorm && !i.wheel : i.kind === 'flow'
  const items = b.items.filter(include)
  const set = new Set(items.map((i) => i.id))
  const links = b.connectors.filter((c) => set.has(c.from) && set.has(c.to))

  let horizontal = 0
  for (const c of links) {
    const a = getItem(b, c.from)!
    const z = getItem(b, c.to)!
    if (Math.abs(z.x - a.x) > Math.abs(z.y - a.y)) horizontal++
  }
  const lines = [`flowchart ${horizontal > links.length / 2 ? 'LR' : 'TD'}`]
  for (const i of items) {
    const shape: FlowShape = i.kind === 'flow' ? (i.shape ?? 'process') : i.kind === 'ellipse' ? 'terminator' : 'process'
    const label = `"${escapeLabel(i.text || flowShapeInfo(shape).label)}"`
    const oc = OPEN_CLOSE[shape]
    lines.push(oc ? `    n${i.id}${oc[0]}${label}${oc[1]}` : `    n${i.id}@{ shape: doc, label: ${label} }`)
  }
  for (const c of links) {
    const arrows = c.arrows ?? 'end'
    const body = c.dashed ? (arrows === 'none' ? '-.-' : '-.->') : arrows === 'none' ? '---' : '-->'
    const arrow = arrows === 'both' ? `<${body}` : body
    const label = c.label?.trim() ? `|"${escapeLabel(c.label)}"|` : ''
    lines.push(`    n${c.from} ${arrow}${label} n${c.to}`)
  }
  return lines.join('\n')
}

// ----- import with layout ------------------------------------------------------

const RANK_GAP = 70
const NODE_GAP = 50

/** A flowchart step's size for its words. */
export const stepSize = (shape: FlowShape, label: string) => nodeSize({ shape, label } as MermaidNode)

function nodeSize(n: MermaidNode): { w: number; h: number } {
  const info = flowShapeInfo(n.shape)
  const longest = Math.max(...n.label.split('\n').map((l) => l.length))
  const lines = n.label.split('\n').length
  const perChar = n.shape === 'decision' ? 10 : 8.5
  const pad = n.shape === 'decision' ? 90 : n.shape === 'data' ? 70 : 50
  const w = Math.max(info.w, Math.min(340, longest * perChar + pad))
  const wraps = Math.max(lines, Math.ceil((longest * perChar) / Math.max(1, w - pad)))
  return { w, h: Math.max(info.h, wraps * 22 + (n.shape === 'decision' ? 60 : 36)) }
}

/** Layers: each node one rank below its furthest-back predecessor, ignoring cycle-closing links. */
export function rankNodes(g: MermaidGraph): Map<string, number> {
  const out = new Map<string, string[]>()
  for (const n of g.nodes) out.set(n.key, [])
  for (const e of g.edges) out.get(e.from)?.push(e.to)
  // Find back edges with a DFS so cycles don't loop forever.
  const state = new Map<string, 1 | 2>()
  const back = new Set<string>()
  const visit = (k: string) => {
    state.set(k, 1)
    for (const t of out.get(k) ?? []) {
      if (state.get(t) === 1) back.add(`${k}>${t}`)
      else if (!state.has(t)) visit(t)
    }
    state.set(k, 2)
  }
  for (const n of g.nodes) if (!state.has(n.key)) visit(n.key)
  const rank = new Map(g.nodes.map((n) => [n.key, 0]))
  // Longest path over the remaining DAG (relaxation is bounded by the node count).
  for (let pass = 0; pass < g.nodes.length; pass++) {
    let changed = false
    for (const e of g.edges) {
      if (back.has(`${e.from}>${e.to}`) || e.from === e.to) continue
      const r = rank.get(e.from)! + 1
      if (r > rank.get(e.to)!) {
        rank.set(e.to, r)
        changed = true
      }
    }
    if (!changed) break
  }
  return rank
}

/** Adds the graph to the board, laid out in layers centred on `at`. Returns the new shape ids. */
export function insertMermaid(b: Board, g: MermaidGraph, at: Vec): [Board, Id[]] {
  const rank = rankNodes(g)
  const layers: MermaidNode[][] = []
  for (const n of g.nodes) (layers[rank.get(n.key)!] ??= []).push(n)
  // One barycentre sweep keeps children under their parents.
  const index = new Map<string, number>()
  layers.forEach((layer) => layer.forEach((n, k) => index.set(n.key, k)))
  for (let r = 1; r < layers.length; r++) {
    const bary = (n: MermaidNode) => {
      const preds = g.edges.filter((e) => e.to === n.key && rank.get(e.from) === r - 1).map((e) => index.get(e.from)!)
      return preds.length ? preds.reduce((a, z) => a + z, 0) / preds.length : index.get(n.key)!
    }
    layers[r] = (layers[r] ?? []).map((n) => [n, bary(n)] as const).sort((a, z) => a[1] - z[1]).map(([n]) => n)
    layers[r].forEach((n, k) => index.set(n.key, k))
  }

  const vertical = g.dir === 'TD' || g.dir === 'BT'
  const sizes = new Map(g.nodes.map((n) => [n.key, nodeSize(n)]))
  const pos = new Map<string, Vec>()
  let along = 0
  layers.forEach((layer = []) => {
    const depth = Math.max(0, ...layer.map((n) => (vertical ? sizes.get(n.key)!.h : sizes.get(n.key)!.w)))
    const breadth = layer.reduce((s, n) => s + (vertical ? sizes.get(n.key)!.w : sizes.get(n.key)!.h), 0) + NODE_GAP * Math.max(0, layer.length - 1)
    let across = -breadth / 2
    for (const n of layer) {
      const sz = sizes.get(n.key)!
      const span = vertical ? sz.w : sz.h
      const c = across + span / 2
      pos.set(n.key, vertical ? { x: c, y: along + depth / 2 } : { x: along + depth / 2, y: c })
      across += span + NODE_GAP
    }
    along += depth + RANK_GAP
  })
  const total = along - RANK_GAP
  const flip = g.dir === 'BT' || g.dir === 'RL'

  const ids = new Map<string, Id>()
  for (const n of g.nodes) {
    const p = pos.get(n.key)!
    const local = vertical ? { x: p.x, y: flip ? total - p.y : p.y } : { x: flip ? total - p.x : p.x, y: p.y }
    const centre = vertical ? { x: at.x + local.x, y: at.y + local.y - total / 2 } : { x: at.x + local.x - total / 2, y: at.y + local.y }
    let id: Id
    ;[b, id] = addItem(b, { ...flowItem(n.shape, centre, sizes.get(n.key)), text: n.label })
    ids.set(n.key, id)
  }
  for (const e of g.edges) {
    const from = ids.get(e.from)!
    const to = ids.get(e.to)!
    if (from === to) continue
    ;[b] = connect(b, from, to, {
      style: 'elbow',
      ...(e.arrows !== 'end' ? { arrows: e.arrows } : {}),
      ...(e.label ? { label: e.label } : {}),
      ...(e.dashed ? { dashed: true } : {}),
    })
  }
  return [b, [...ids.values()]]
}
