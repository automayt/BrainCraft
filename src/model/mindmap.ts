/**
 * Mind maps. A map is a tree of `mind` items: the root has no `parent`, main
 * branches carry the `side` of the root they grow on, and every node's colour
 * is its branch colour. Node positions are derived: {@link layoutAll} sizes
 * nodes from their text and lays branches out as tidy trees either side of the
 * root, which stays where the user put it.
 */

import { getItem, newItem, rootOf, subtree } from './board'
import type { Vec } from './geom'
import { BRANCHES, type Board, type Id, type Item, MIND_ROOT_COLOR, type Side } from './types'

/** Measures `text` laid out in the app font, wrapped at `maxWidth`. */
export type Measure = (text: string, fontSize: number, weight: number, maxWidth: number) => { w: number; h: number }

export interface NodeStyle {
  fontSize: number
  weight: number
  padX: number
  padY: number
  maxText: number
  minW: number
}

export function nodeStyle(depth: number): NodeStyle {
  if (depth === 0) return { fontSize: 22, weight: 700, padX: 26, padY: 16, maxText: 300, minW: 120 }
  if (depth === 1) return { fontSize: 18, weight: 600, padX: 16, padY: 10, maxText: 260, minW: 60 }
  return { fontSize: 15, weight: 400, padX: 12, padY: 7, maxText: 240, minW: 40 }
}

export const PLACEHOLDER = ['Central idea', 'Main topic', 'Idea']
export const placeholderFor = (depth: number) => PLACEHOLDER[Math.min(depth, 2)]

const H_GAP_ROOT = 72
const H_GAP = 44
const V_GAP_MAIN = 22
const V_GAP = 10

export function isRoot(i: Item): boolean {
  return i.kind === 'mind' && i.parent === undefined
}

/** Children in sibling order (their order in the board). */
function kids(b: Board, id: Id): Item[] {
  return b.items.filter((i) => i.kind === 'mind' && i.parent === id)
}

/** Which side of its root a node grows on (`undefined` for a root). */
export function sideOf(b: Board, id: Id): Side | undefined {
  let node = getItem(b, id)
  while (node && node.parent !== undefined) {
    const parent = getItem(b, node.parent)
    if (parent && parent.parent === undefined) return node.side ?? 'right'
    node = parent
  }
  return undefined
}

// ----- layout --------------------------------------------------------------------

/** Re-sizes and positions every node of every mind map. Unchanged nodes keep their identity. */
export function layoutAll(b: Board, measure: Measure): Board {
  const pos = new Map<Id, { x: number; y: number; w: number; h: number }>()
  const children = new Map<Id, Item[]>()
  for (const i of b.items) {
    if (i.kind !== 'mind' || i.parent === undefined) continue
    const list = children.get(i.parent)
    if (list) list.push(i)
    else children.set(i.parent, [i])
  }
  const kidsOf = (id: Id) => children.get(id) ?? []

  const size = (i: Item, depth: number) => {
    const s = nodeStyle(depth)
    const m = measure(i.text || placeholderFor(depth), s.fontSize, s.weight, s.maxText)
    return { w: Math.max(s.minW, Math.ceil(m.w) + 2 * s.padX), h: Math.ceil(m.h) + 2 * s.padY }
  }

  const heights = new Map<Id, number>()
  const subtreeHeight = (i: Item, depth: number, visiting: Set<Id>): number => {
    const own = size(i, depth)
    pos.set(i.id, { x: i.x, y: i.y, ...own })
    let h = own.h
    const list = i.collapsed || visiting.has(i.id) ? [] : kidsOf(i.id)
    if (list.length) {
      visiting.add(i.id)
      const gap = depth === 0 ? V_GAP_MAIN : V_GAP
      const total = list.reduce((sum, k) => sum + subtreeHeight(k, depth + 1, visiting), 0) + gap * (list.length - 1)
      h = Math.max(h, total)
    }
    heights.set(i.id, h)
    return h
  }

  const place = (parent: Item, list: Item[], side: Side, depth: number) => {
    if (!list.length) return
    const p = pos.get(parent.id)!
    const gap = depth === 0 ? V_GAP_MAIN : V_GAP
    const hGap = depth === 0 ? H_GAP_ROOT : H_GAP
    const total = list.reduce((s, k) => s + heights.get(k.id)!, 0) + gap * (list.length - 1)
    let y = p.y + p.h / 2 - total / 2
    for (const k of list) {
      const kp = pos.get(k.id)!
      const sh = heights.get(k.id)!
      kp.y = y + sh / 2 - kp.h / 2
      kp.x = side === 'right' ? p.x + p.w + hGap : p.x - hGap - kp.w
      // Ideas moved by hand keep their nudge; their own branches follow them.
      if (k.offset) {
        kp.x += k.offset.x
        kp.y += k.offset.y
      }
      if (!k.collapsed) place(k, kidsOf(k.id), side, depth + 1)
      y += sh + gap
    }
  }

  for (const root of b.items) {
    if (!isRoot(root)) continue
    const before = { x: root.x + root.w / 2, y: root.y + root.h / 2 }
    subtreeHeight(root, 0, new Set())
    const rp = pos.get(root.id)!
    // The root grows and shrinks about its centre.
    rp.x = before.x - rp.w / 2
    rp.y = before.y - rp.h / 2
    if (root.collapsed) continue
    const main = kidsOf(root.id)
    place(root, main.filter((k) => k.side !== 'left'), 'right', 0)
    place(root, main.filter((k) => k.side === 'left'), 'left', 0)
  }

  let changed = false
  const items = b.items.map((i) => {
    const p = pos.get(i.id)
    if (!p || (p.x === i.x && p.y === i.y && p.w === i.w && p.h === i.h)) return i
    changed = true
    return { ...i, ...p }
  })
  return changed ? { ...b, items } : b
}

// ----- editing -------------------------------------------------------------------

/** Puts every idea of the map containing `id` back where the automatic layout wants it. */
export function tidy(b: Board, id: Id): Board {
  let root = getItem(b, id)
  while (root?.parent !== undefined) root = getItem(b, root.parent)
  if (!root) return b
  const ids = subtree(b, root.id)
  if (!b.items.some((i) => ids.has(i.id) && i.offset)) return b
  return {
    ...b,
    items: b.items.map((i) => {
      if (!ids.has(i.id) || !i.offset) return i
      const next = { ...i }
      delete next.offset
      return next
    }),
  }
}

/** Starts a new map whose root is centred on `at`. */
export function createMap(b: Board, at: Vec, text = ''): [Board, Id] {
  const id = b.nextId
  const root: Item = { ...newItem('mind', { x: at.x - 80, y: at.y - 26, w: 160, h: 52 }, { color: MIND_ROOT_COLOR, text }), id }
  return [{ ...b, items: [...b.items, root], nextId: id + 1 }, id]
}

function nextBranchColor(b: Board, rootId: Id): string {
  const used = kids(b, rootId).map((k) => k.color)
  return BRANCHES.find(([, c]) => !used.includes(c))?.[1] ?? BRANCHES[used.length % BRANCHES.length][1]
}

/** Inserts `node` into the item list right after `afterId`'s position (or at the end). */
function insertAfter(b: Board, node: Item, afterId?: Id): Board {
  const items = [...b.items]
  const idx = afterId === undefined ? -1 : items.findIndex((i) => i.id === afterId)
  items.splice(idx < 0 ? items.length : idx + 1, 0, node)
  return { ...b, items, nextId: Math.max(b.nextId, node.id + 1) }
}

/** Adds a child as the last child of `parentId`. On a root, `side` picks the side (default: the emptier one). */
export function addChild(b: Board, parentId: Id, side?: Side, text = ''): [Board, Id] {
  const parent = getItem(b, parentId)
  if (!parent || parent.kind !== 'mind') return [b, -1]
  const id = b.nextId
  const node: Item = { ...newItem('mind', { x: parent.x, y: parent.y, w: 60, h: 30 }, { text }), id, parent: parentId }
  if (parent.parent === undefined) {
    const main = kids(b, parentId)
    const right = main.filter((k) => k.side !== 'left').length
    node.side = side ?? (right <= main.length - right ? 'right' : 'left')
    node.color = nextBranchColor(b, parentId)
  } else {
    node.color = parent.color
  }
  const siblings = kids(b, parentId)
  const last = siblings.length ? siblings[siblings.length - 1].id : parentId
  b = insertAfter(b, node, lastDescendantIndexId(b, last))
  // Adding to a collapsed node opens it so the new node is visible.
  if (parent.collapsed) b = { ...b, items: b.items.map((i) => (i.id === parentId ? { ...i, collapsed: false } : i)) }
  return [b, id]
}

function lastDescendantIndexId(b: Board, id: Id): Id {
  const ids = subtree(b, id)
  let last = id
  for (const i of b.items) if (ids.has(i.id)) last = i.id
  return last
}

/** Adds a sibling just after `id` (a child, for a root). */
export function addSibling(b: Board, id: Id, text = ''): [Board, Id] {
  const node = getItem(b, id)
  if (!node || node.kind !== 'mind') return [b, -1]
  if (node.parent === undefined) return addChild(b, id, undefined, text)
  const newId = b.nextId
  const sib: Item = {
    ...newItem('mind', { x: node.x, y: node.y + node.h, w: 60, h: 30 }, { text, color: node.color }),
    id: newId,
    parent: node.parent,
    side: node.side,
  }
  return [insertAfter(b, sib, lastDescendantIndexId(b, id)), newId]
}

/** Moves `id` (and its branch) under `newParent`. Refuses to create a cycle. */
export function reparent(b: Board, id: Id, newParent: Id, side?: Side): Board {
  const node = getItem(b, id)
  const target = getItem(b, newParent)
  if (!node || !target || node.kind !== 'mind' || target.kind !== 'mind') return b
  if (node.parent === undefined || subtree(b, id).has(newParent)) return b
  const branch = subtree(b, id)
  const toRoot = target.parent === undefined
  const color = toRoot
    ? node.parent === newParent
      ? node.color
      : nextBranchColor({ ...b, items: b.items.filter((i) => !branch.has(i.id)) }, newParent)
    : target.color
  const moved = b.items
    .filter((i) => branch.has(i.id))
    .map((i) => {
      const next: Item = { ...i, color }
      if (i.id === id) {
        next.parent = newParent
        if (toRoot) next.side = side ?? node.side ?? 'right'
        else delete next.side
      }
      return next
    })
  const rest = b.items.filter((i) => !branch.has(i.id))
  // Re-insert the branch after the new parent's last descendant so it becomes its last child.
  const anchor = lastDescendantIndexId({ ...b, items: rest }, newParent)
  const idx = rest.findIndex((i) => i.id === anchor)
  rest.splice(idx + 1, 0, ...moved)
  return { ...b, items: rest.map((i) => (i.id === newParent && i.collapsed ? { ...i, collapsed: false } : i)) }
}

/** Swaps `id` with its previous (`-1`) or next (`+1`) sibling on the same side. */
export function moveAmongSiblings(b: Board, id: Id, dir: -1 | 1): Board {
  const node = getItem(b, id)
  if (!node || node.parent === undefined) return b
  const side = sideOf(b, id)
  const sibs = kids(b, node.parent).filter((k) => sideOf(b, k.id) === side)
  const k = sibs.findIndex((s) => s.id === id)
  const other = sibs[k + dir]
  if (!other) return b
  const [first, second] = dir < 0 ? [other, node] : [node, other]
  // Rebuild the order: everything else, with the two branches swapped in place.
  const a = subtree(b, first.id)
  const z = subtree(b, second.id)
  const aItems = b.items.filter((i) => a.has(i.id))
  const zItems = b.items.filter((i) => z.has(i.id))
  const out: Item[] = []
  let placed = false
  for (const i of b.items) {
    if (a.has(i.id) || z.has(i.id)) {
      if (!placed) {
        out.push(...zItems, ...aItems)
        placed = true
      }
      continue
    }
    out.push(i)
  }
  return { ...b, items: out }
}

export function toggleCollapsed(b: Board, id: Id): Board {
  const node = getItem(b, id)
  if (!node || node.kind !== 'mind' || !kids(b, id).length) return b
  return { ...b, items: b.items.map((i) => (i.id === id ? { ...i, collapsed: !i.collapsed } : i)) }
}

/** Colours `id` and its whole branch (a root only colours itself). */
export function setBranchColor(b: Board, id: Id, color: string): Board {
  const node = getItem(b, id)
  if (!node) return b
  const ids = node.parent === undefined ? new Set([id]) : subtree(b, id)
  return { ...b, items: b.items.map((i) => (ids.has(i.id) ? { ...i, color } : i)) }
}

/** The node to select after deleting `ids`: the parent (or previous sibling) of the first one. */
export function selectionAfterDelete(b: Board, ids: ReadonlySet<Id>): Id | undefined {
  for (const id of ids) {
    const node = getItem(b, id)
    if (!node || node.parent === undefined) continue
    const sibs = kids(b, node.parent).filter((s) => !ids.has(s.id))
    const prev = [...sibs].reverse().find((s) => b.items.indexOf(s) < b.items.indexOf(node))
    let candidate: Item | undefined = prev ?? getItem(b, node.parent)
    while (candidate && ids.has(candidate.id)) candidate = candidate.parent !== undefined ? getItem(b, candidate.parent) : undefined
    if (candidate) return candidate.id
  }
  return undefined
}

// ----- keyboard navigation -------------------------------------------------------

export type Direction = 'left' | 'right' | 'up' | 'down'

/** The neighbouring node in `dir`, following the map's visual layout. */
export function navigate(b: Board, id: Id, dir: Direction): Id | undefined {
  const node = getItem(b, id)
  if (!node || node.kind !== 'mind') return undefined
  const side = sideOf(b, id)
  const cy = node.y + node.h / 2
  const closest = (list: Item[]) =>
    list.reduce<Item | undefined>(
      (best, k) => (!best || Math.abs(k.y + k.h / 2 - cy) < Math.abs(best.y + best.h / 2 - cy) ? k : best),
      undefined,
    )?.id

  if (dir === 'left' || dir === 'right') {
    if (side === undefined) {
      if (node.collapsed) return undefined
      return closest(kids(b, id).filter((k) => (k.side ?? 'right') === dir))
    }
    const outward = dir === side
    if (outward) return node.collapsed ? undefined : closest(kids(b, id))
    return node.parent
  }
  if (node.parent === undefined) return undefined
  const sibs = kids(b, node.parent).filter((k) => sideOf(b, k.id) === side)
  const k = sibs.findIndex((s) => s.id === id)
  return sibs[dir === 'up' ? k - 1 : k + 1]?.id
}

// ----- outlines ------------------------------------------------------------------

export interface OutlineNode {
  text: string
  children: OutlineNode[]
}

/** The map rooted at `rootId` as an indented Markdown list. */
export function toOutline(b: Board, rootId: Id): string {
  const lines: string[] = []
  const walk = (id: Id, depth: number) => {
    const n = getItem(b, id)
    if (!n) return
    lines.push(`${'  '.repeat(depth)}- ${(n.text || placeholderFor(depth)).replace(/\s*\n\s*/g, ' ')}`)
    for (const k of kids(b, id)) walk(k.id, depth + 1)
  }
  const root = rootOf(b, rootId)
  if (root) walk(root.id, 0)
  return lines.join('\n')
}

const BULLET = /^(?:[-*+•]|\d+[.)]|#+)\s+/

/**
 * Parses an indented list (Markdown bullets, numbers, headings or plain
 * indentation) into a tree. Several top-level lines get a shared root.
 * Returns `null` unless the text has at least two non-empty lines.
 */
export function parseOutline(text: string): OutlineNode | null {
  const lines = text
    .replace(/\t/g, '    ')
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (lines.length < 2) return null
  const top: OutlineNode[] = []
  const stack: { indent: number; node: OutlineNode }[] = []
  for (const line of lines) {
    const heading = /^\s*(#+)\s/.exec(line)
    // Headings nest by level; everything else by indentation (offset past any headings).
    const indent = heading ? (heading[1].length - 1) * 2 : line.length - line.trimStart().length + 100
    const node: OutlineNode = { text: line.trim().replace(BULLET, '').trim(), children: [] }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else top.push(node)
    stack.push({ indent, node })
  }
  return top.length === 1 ? top[0] : { text: 'Mind map', children: top }
}

/** Builds a new map from an outline, its root centred on `at`. */
export function createMapFromOutline(b: Board, outline: OutlineNode, at: Vec): [Board, Id] {
  let [next, rootId] = createMap(b, at, outline.text)
  const add = (parent: Id, nodes: OutlineNode[]) => {
    for (const n of nodes) {
      const [after, id] = addChild(next, parent, undefined, n.text)
      next = after
      add(id, n.children)
    }
  }
  add(rootId, outline.children)
  return [next, rootId]
}
