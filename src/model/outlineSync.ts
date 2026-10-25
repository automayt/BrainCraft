/**
 * A mind map and its outline, kept in step both ways. The outline is the map as indented lines
 * (two spaces a level, the central idea first); editing the outline changes the map in place:
 * ideas whose words are unchanged keep their identity, colour and branch wherever they move to,
 * a changed line is a rename, new lines are new ideas and removed lines go. Pure functions.
 */

import { addChild, layoutAll, type Measure, placeholderFor, reparent } from './mindmap'
import { getItem, remove } from './board'
import type { Board, Id, Item } from './types'

/** One line of an outline: its words and how deep it is (0 for the central idea). */
export interface OutlineLine {
  text: string
  depth: number
}

interface Node {
  text: string
  children: Node[]
  /** The idea it matches on the board, once known. */
  id?: Id
}

const kids = (b: Board, id: Id): Item[] => b.items.filter((i) => i.kind === 'mind' && i.parent === id)

/** The central idea of the map `id` belongs to (or the highest idea there is, in part of a board). */
export function rootOf(b: Board, id: Id): Item | undefined {
  let n = getItem(b, id)
  for (let k = 0; n && n.parent !== undefined && k < 10_000; k++) {
    const up = getItem(b, n.parent)
    if (!up) break
    n = up
  }
  return n?.kind === 'mind' ? n : undefined
}

/** Where an outline starts: the whole map `id` is in, or just its branch. */
const topOf = (b: Board, id: Id, branch: boolean) => {
  const n = branch ? getItem(b, id) : rootOf(b, id)
  return n?.kind === 'mind' ? n : undefined
}

const words = (n: Item, depth: number) => (n.text || placeholderFor(depth)).replace(/\s*\n\s*/g, ' ')

/** The map `id` is in (or with `branch`, just `id`'s branch), as an outline: the top idea, then each idea indented under its parent. */
export function outlineOf(b: Board, id: Id, branch = false): string {
  const root = topOf(b, id, branch)
  if (!root) return ''
  const lines: string[] = []
  const walk = (n: Item, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${words(n, depth)}`)
    for (const k of kids(b, n.id)) walk(k, depth + 1)
  }
  walk(root, 0)
  return lines.join('\n')
}

/** The map as simple Markdown: the central idea as a heading, its ideas as nested bullets. */
export function markdownOf(b: Board, id: Id, branch = false): string {
  const root = topOf(b, id, branch)
  if (!root) return ''
  const lines = [`# ${words(root, 0)}`, '']
  const walk = (n: Item, depth: number) => {
    lines.push(`${'  '.repeat(depth - 1)}- ${words(n, depth)}`)
    for (const k of kids(b, n.id)) walk(k, depth + 1)
  }
  for (const k of kids(b, root.id)) walk(k, 1)
  return `${lines.join('\n')}\n`
}

const BULLET = /^(?:[-*+•]|\d+[.)])\s+/

/**
 * An outline's lines with their depths. The first line is the central idea; each line is one
 * level under the nearest line above that's less indented (so any indent works, tabs too), and
 * lines no deeper than the first sit just under it. Bullets and a heading mark are ignored.
 */
export function parseLines(text: string): OutlineLine[] {
  const raw = text
    .replace(/\t/g, '  ')
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (!raw.length) return []
  const out: OutlineLine[] = []
  const stack: number[] = [] // indents of the open lines, by depth
  raw.forEach((line, k) => {
    const indent = line.length - line.trimStart().length
    const text = line
      .trim()
      .replace(/^#+\s+/, '')
      .replace(BULLET, '')
      .trim()
    if (k === 0) {
      stack.push(indent)
      out.push({ text, depth: 0 })
      return
    }
    while (stack.length > 1 && stack[stack.length - 1] >= indent) stack.pop()
    stack.push(Math.max(indent, stack[0] + 1))
    out.push({ text, depth: stack.length - 1 })
  })
  return out
}

function treeOf(lines: OutlineLine[]): Node {
  const root: Node = { text: lines[0].text, children: [] }
  const path: Node[] = [root]
  for (const l of lines.slice(1)) {
    const node: Node = { text: l.text, children: [] }
    path.length = Math.min(path.length, l.depth)
    path[path.length - 1].children.push(node)
    path.push(node)
  }
  return root
}

/**
 * Changes the map `id` belongs to so it matches `text`. Ideas are matched to lines by their
 * words: first among the same parent's ideas, then anywhere (a branch moved elsewhere), and what's
 * left in the same place in the same order counts as renamed. Returns the board unchanged when
 * the outline is empty.
 */
export function applyOutline(b: Board, id: Id, text: string, measure: Measure, branch = false): Board {
  const root = topOf(b, id, branch)
  const lines = parseLines(text)
  if (!root || !lines.length || !lines[0].text) return b
  const tree = treeOf(lines)
  tree.id = root.id

  // Every idea of the map now, and which are spoken for.
  const old = new Map<Id, Item>()
  const collect = (n: Item) => {
    old.set(n.id, n)
    kids(b, n.id).forEach(collect)
  }
  collect(root)
  const used = new Set<Id>([root.id])
  const same = (a: string, z: string) => a.trim().toLowerCase() === z.trim().toLowerCase()

  // 1. Same words under the same parent.
  const byParent = (n: Node) => {
    if (n.id === undefined) return
    const pool = kids(b, n.id).filter((k) => !used.has(k.id))
    for (const c of n.children) {
      const hit = pool.find((k) => !used.has(k.id) && same(k.text || '', c.text))
      if (hit) {
        c.id = hit.id
        used.add(hit.id)
      }
    }
    n.children.forEach(byParent)
  }
  byParent(tree)
  // 2. Same words anywhere else in the map: moved, with what's under it.
  const anywhere = (n: Node) => {
    for (const c of n.children) {
      if (c.id === undefined) {
        const hit = [...old.values()].find((o) => !used.has(o.id) && same(o.text || '', c.text))
        if (hit) {
          c.id = hit.id
          used.add(hit.id)
          byParent(c)
        }
      }
      anywhere(c)
    }
  }
  anywhere(tree)
  // 3. What's left under the same parent, in order: renamed.
  const renamed = (n: Node) => {
    if (n.id !== undefined) {
      const pool = kids(b, n.id).filter((k) => !used.has(k.id))
      for (const c of n.children) {
        if (c.id !== undefined || !pool.length) continue
        const hit = pool.shift()!
        c.id = hit.id
        used.add(hit.id)
        byParent(c)
      }
    }
    n.children.forEach(renamed)
  }
  renamed(tree)

  // Apply, parents before children: rename, move, or make each idea.
  let next = b
  const setText = (nid: Id, t: string) => {
    if ((getItem(next, nid)?.text ?? '') !== t) next = { ...next, items: next.items.map((i) => (i.id === nid ? { ...i, text: t } : i)) }
  }
  setText(root.id, tree.text)
  const order: Id[] = [root.id]
  const place = (n: Node, parent: Id) => {
    if (n.id === undefined) {
      let made: Id
      ;[next, made] = addChild(next, parent, undefined, n.text)
      n.id = made
    } else {
      if (getItem(next, n.id)?.parent !== parent) next = reparent(next, n.id, parent)
      setText(n.id, n.text)
    }
    order.push(n.id)
    for (const c of n.children) place(c, n.id!)
  }
  for (const c of tree.children) place(c, root.id)

  // Ideas no longer in the outline go.
  const gone = new Set([...old.keys()].filter((k) => !used.has(k)))
  if (gone.size) next = remove(next, gone)

  // Siblings in the outline's order: the map's ideas, in that order, where the map was.
  const inMap = new Set(order)
  const first = next.items.findIndex((i) => inMap.has(i.id))
  const at = next.items.slice(0, Math.max(0, first)).filter((i) => !inMap.has(i.id)).length
  const rest = next.items.filter((i) => !inMap.has(i.id))
  const ideas = order.map((k) => getItem(next, k)!).filter(Boolean)
  rest.splice(Math.max(0, Math.min(at, rest.length)), 0, ...ideas)
  next = { ...next, items: rest }
  return layoutAll(next, measure)
}
