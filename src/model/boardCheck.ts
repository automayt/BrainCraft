/**
 * A check of a whole board for the things that make it look messy or hard to follow, with a fix
 * for each where one is safe: objects lying on top of each other, empty notes and ideas, a stray
 * far from everything else, a flowchart decision with only one way out or a step nothing leads to,
 * and several ideas crammed into one. Pure functions.
 */

import * as B from './board'
import { addChild, layoutAll, type Measure } from './mindmap'
import { rootOf } from './outlineSync'
import type { Board, Id, Item, Kind } from './types'
import { objectLabel } from './notes'

export type ProblemKind = 'overlap' | 'empty' | 'stray' | 'oneWay' | 'deadStart' | 'loose' | 'crammed'

export interface Problem {
  key: string
  kind: ProblemKind
  /** What it's about: the first is the one to go to (and to fix). */
  ids: Id[]
  text: string
  /** What the fix does, when there's a safe one. */
  fix?: string
}

/** Things it's fine to have on top of others: areas, drawings and comments. */
const LAYERED = new Set<Kind>(['frame', 'pen', 'comment'])
/** Things that mean nothing empty (a plain shape may be a background, so isn't counted). */
const NEEDS_WORDS = new Set<Kind>(['sticky', 'text', 'mind', 'flow'])
const GAP = 40
/** How far from everything else counts as stray (board units). */
const STRAY = 2500

const name = (i: Item) => `“${objectLabel(i).slice(0, 40) || i.kind}”`
const area = (r: { w: number; h: number }) => Math.max(1, r.w * r.h)
const inter = (a: Item, z: Item) => {
  const w = Math.min(a.x + a.w, z.x + z.w) - Math.max(a.x, z.x)
  const h = Math.min(a.y + a.h, z.y + z.h) - Math.max(a.y, z.y)
  return w > 0 && h > 0 ? w * h : 0
}
const inside = (a: Item, z: Item) => a.x >= z.x && a.y >= z.y && a.x + a.w <= z.x + z.w && a.y + a.h <= z.y + z.h

/** What moves when `i` is moved clear: a whole mind map for an idea, else just it. */
function group(b: Board, i: Item): Set<Id> {
  if (i.kind === 'mind') {
    const r = rootOf(b, i.id)
    if (r) return B.subtree(b, r.id)
  }
  return new Set([i.id])
}

export function checkBoard(b: Board): Problem[] {
  const out: Problem[] = []
  const hidden = B.hiddenIds(b)
  const shown = b.items.filter((i) => !hidden.has(i.id))

  // On top of each other.
  const solid = shown.filter((i) => !LAYERED.has(i.kind))
  const seen = new Set<string>()
  for (let a = 0; a < solid.length; a++)
    for (let z = a + 1; z < solid.length; z++) {
      const [p, q] = [solid[a], solid[z]]
      if (inter(p, q) < 0.3 * Math.min(area(p), area(q))) continue
      // Ideas of one map, and words set on a shape on purpose, belong together.
      if (p.kind === 'mind' && q.kind === 'mind' && rootOf(b, p.id)?.id === rootOf(b, q.id)?.id) continue
      if ((p.kind === 'text' && inside(p, q)) || (q.kind === 'text' && inside(q, p))) continue
      // The one drawn on top is the one to move.
      const key = `overlap:${[...group(b, q)].sort()[0]}:${[...group(b, p)].sort()[0]}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, kind: 'overlap', ids: [q.id, p.id], text: `${name(q)} is on top of ${name(p)}`, fix: q.kind === 'mind' ? 'Move the mind map clear' : 'Move it clear' })
    }

  // Empty.
  for (const i of shown)
    if (NEEDS_WORDS.has(i.kind) && !i.text.trim() && !i.back)
      out.push({
        key: `empty:${i.id}`,
        kind: 'empty',
        ids: [i.id],
        text: `An empty ${i.kind === 'mind' ? 'idea' : i.kind === 'flow' ? 'flowchart step' : i.kind === 'text' ? 'text box' : 'sticky note'}`,
        ...(i.kind === 'mind' && B.childrenOf(b, i.id).length ? {} : { fix: 'Delete it' }),
      })

  // Far from everything else (and stretching "fit to screen" with it).
  if (shown.length >= 4) {
    for (const i of shown) {
      if (i.kind === 'mind' && i.parent !== undefined) continue
      const mine = group(b, i)
      const rest = B.bounds(b, new Set(shown.filter((x) => !mine.has(x.id) && !(i.kind === 'frame' && inside(x, i))).map((x) => x.id)))
      if (!rest) continue
      const cx = i.x + i.w / 2
      const cy = i.y + i.h / 2
      const dx = Math.max(rest.x - cx, 0, cx - (rest.x + rest.w))
      const dy = Math.max(rest.y - cy, 0, cy - (rest.y + rest.h))
      if (Math.hypot(dx, dy) > STRAY) out.push({ key: `stray:${i.id}`, kind: 'stray', ids: [i.id], text: `${name(i)} is far from everything else`, fix: 'Bring it back' })
    }
  }

  // Flowcharts that don't flow.
  const flows = shown.filter((i) => i.kind === 'flow')
  if (flows.length > 1) {
    const outs = new Map<Id, number>()
    const ins = new Map<Id, number>()
    for (const c of b.connectors) {
      if (B.getItem(b, c.from)?.kind !== 'flow' || B.getItem(b, c.to)?.kind !== 'flow') continue
      outs.set(c.from, (outs.get(c.from) ?? 0) + 1)
      ins.set(c.to, (ins.get(c.to) ?? 0) + 1)
    }
    for (const f of flows) {
      const o = outs.get(f.id) ?? 0
      const n = ins.get(f.id) ?? 0
      if (!o && !n) out.push({ key: `loose:${f.id}`, kind: 'loose', ids: [f.id], text: `Step ${name(f)} isn't joined to the flowchart` })
      else if (f.shape === 'decision' && o < 2) out.push({ key: `oneWay:${f.id}`, kind: 'oneWay', ids: [f.id], text: `Decision ${name(f)} has only ${o ? 'one way' : 'no way'} out` })
      else if (!n && f.shape !== 'terminator' && f.shape !== 'data') out.push({ key: `deadStart:${f.id}`, kind: 'deadStart', ids: [f.id], text: `Nothing leads to step ${name(f)}` })
    }
  }

  // Several ideas in one.
  for (const i of shown)
    if (i.kind === 'mind' && i.text.trim().includes('\n'))
      out.push({ key: `crammed:${i.id}`, kind: 'crammed', ids: [i.id], text: `Idea ${name(i)} holds ${i.text.trim().split(/\n+/).length} lines`, fix: 'Make each line an idea under it' })

  return out
}

/** Somewhere `ids` (as one group) can go without overlapping anything: tried beside, then further out. */
function clearSpot(b: Board, ids: Set<Id>, near: Item): { dx: number; dy: number } {
  const box = B.bounds(b, ids)!
  const others = b.items.filter((i) => !ids.has(i.id) && !LAYERED.has(i.kind))
  const free = (x: number, y: number) => others.every((o) => x + box.w + GAP <= o.x || o.x + o.w + GAP <= x || y + box.h + GAP <= o.y || o.y + o.h + GAP <= y)
  for (let step = 1; step <= 40; step++) {
    const d = step * (GAP + Math.max(near.w, 120) / 2)
    for (const [x, y] of [
      [near.x + near.w + GAP + (step - 1) * d, box.y],
      [box.x, near.y + near.h + GAP + (step - 1) * d],
      [near.x - box.w - GAP - (step - 1) * d, box.y],
      [box.x, near.y - box.h - GAP - (step - 1) * d],
    ])
      if (free(x, y)) return { dx: x - box.x, dy: y - box.y }
  }
  return { dx: near.x + near.w + GAP - box.x, dy: 0 }
}

/** Fixes one problem (if it has a fix and still applies). */
export function fixProblem(b: Board, p: Problem, measure: Measure): Board {
  const it = B.getItem(b, p.ids[0])
  if (!it || !p.fix) return b
  switch (p.kind) {
    case 'overlap': {
      const other = B.getItem(b, p.ids[1])
      if (!other) return b
      const ids = group(b, it)
      const { dx, dy } = clearSpot(b, ids, other)
      return layoutAll(B.translate(b, ids, dx, dy), measure)
    }
    case 'empty':
      return B.remove(b, new Set([it.id]))
    case 'stray': {
      const mine = group(b, it)
      const moving = it.kind === 'frame' ? new Set([...mine, ...b.items.filter((x) => x.id !== it.id && inside(x, it)).map((x) => x.id)]) : mine
      const rest = B.bounds(b, new Set(b.items.filter((x) => !moving.has(x.id)).map((x) => x.id)))
      const box = B.bounds(b, moving)
      if (!rest || !box) return b
      return layoutAll(B.translate(b, moving, rest.x + rest.w + GAP * 2 - box.x, rest.y - box.y), measure)
    }
    case 'crammed': {
      const [first, ...more] = it.text
        .trim()
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
      let next = B.updateItem(b, it.id, (i) => ({ ...i, text: first }))
      for (const line of more) [next] = addChild(next, it.id, undefined, line)
      return layoutAll(next, measure)
    }
    default:
      return b
  }
}

/** Fixes every problem that has a fix, checking again after each (one fix can settle another). */
export function fixAll(b: Board, measure: Measure): Board {
  let next = b
  const tried = new Set<string>()
  for (let round = 0; round < 100; round++) {
    const p = checkBoard(next).find((x) => x.fix && !tried.has(x.key))
    if (!p) break
    tried.add(p.key)
    next = fixProblem(next, p, measure)
  }
  return next
}
