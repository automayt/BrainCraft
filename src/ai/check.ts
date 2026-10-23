/**
 * Looks over a change the assistant proposes for the messes models tend to make, before anyone
 * sees it: lines drawn between mind-map ideas, several ideas crammed into one, a mind map or
 * flowchart faked out of plain boxes and lines, and things dropped on top of what's there. Each
 * problem says how to do it properly; the assistant gets one chance to fix them (see assistant.ts).
 */

import type { Op } from '../api/ops'
import * as B from '../model/board'
import { objectLabel } from '../model/notes'
import type { Board, Id, Item, Kind } from '../model/types'

/** Plain things that, joined up by lines, are usually a mind map or flowchart drawn by hand. */
const PLAIN = new Set<Kind>(['rect', 'ellipse', 'sticky', 'text'])
/** Things it's fine to overlap: areas and pen drawings. */
const LAYERED = new Set<Kind>(['frame', 'pen'])

const name = (i: Item) => `"${objectLabel(i).slice(0, 40)}" (${i.id})`

const overlap = (a: Item, z: Item) => {
  const w = Math.min(a.x + a.w, z.x + z.w) - Math.max(a.x, z.x)
  const h = Math.min(a.y + a.h, z.y + z.h) - Math.max(a.y, z.y)
  return w > 0 && h > 0 ? (w * h) / Math.max(1, Math.min(a.w * a.h, z.w * z.h)) : 0
}

const rootOf = (b: Board, i: Item): Item => {
  let r = i
  for (let k = 0; r.parent !== undefined && k < 1000; k++) r = B.getItem(b, r.parent) ?? r
  return r
}

export function problemsWith(before: Board, after: Board, ops: readonly Op[]): string[] {
  const out: string[] = []
  const old = new Map(before.items.map((i) => [i.id, i]))
  const oldLines = new Set(before.connectors.map((c) => c.id))
  const fresh = after.connectors.filter((c) => !oldLines.has(c.id))
  const get = (id: Id) => B.getItem(after, id)

  // Lines between mind-map ideas: ideas hang off their parent instead.
  if (fresh.some((c) => get(c.from)?.kind === 'mind' || get(c.to)?.kind === 'mind'))
    out.push('Lines were drawn to or from mind-map ideas. Ideas hang off their parent instead: add them with addIdeas {"parent", "ideas"}, move one with moveIdea; draw no lines in a mind map.')

  // Several ideas in one.
  for (const i of after.items)
    if (i.kind === 'mind' && i.text.includes('\n') && old.get(i.id)?.text !== i.text)
      out.push(`Idea ${name(i)} holds several lines. One idea per idea: give it one, and add the others with addIdeas under the right parent.`)

  // A tree of plain boxes and lines: a mind map or flowchart drawn by hand.
  const freeform = ops.some((o) => o.op === 'connect' && o.freeform === true)
  if (!freeform) {
    const fan = new Map<Id, number>()
    for (const c of fresh) {
      const [a, z] = [get(c.from), get(c.to)]
      if (!a || !z || !PLAIN.has(a.kind) || !PLAIN.has(z.kind)) continue
      fan.set(a.id, (fan.get(a.id) ?? 0) + 1)
      fan.set(z.id, (fan.get(z.id) ?? 0) + 1)
    }
    const hub = [...fan].find(([, n]) => n >= 2)
    if (hub)
      out.push(
        `Plain boxes joined by lines around ${name(get(hub[0])!)} look like a mind map or flowchart drawn by hand, which won't lay itself out or look right. Use createMindMap and addIdeas for ideas branching from a topic, or createFlowchart and addSteps for steps; delete the boxes and lines you made. (If loose boxes and lines really are wanted, add "freeform": true to the connect operations.)`,
      )
  }

  // Dropped on top of what's already there.
  const hidden = B.hiddenIds(after)
  const moved = after.items.filter((i) => !LAYERED.has(i.kind) && !hidden.has(i.id) && old.get(i.id) !== i)
  const still = after.items.filter((i) => !LAYERED.has(i.kind) && !hidden.has(i.id) && old.get(i.id) === i)
  const seen = new Set<string>()
  for (const m of moved) {
    for (const s of still) {
      if (overlap(m, s) < 0.2) continue
      // Inside the same mind map or table, the layout's own business.
      if (m.kind === 'mind' && s.kind === 'mind' && rootOf(after, m).id === rootOf(after, s).id) continue
      const key = `${m.kind === 'mind' ? rootOf(after, m).id : m.id}:${s.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(
        m.kind === 'mind'
          ? `The mind map ${name(rootOf(after, m))} now runs into ${name(s)}. Move the map clear by moving its central idea (update {"id": ${rootOf(after, m).id}, "x", "y"}), or move ${name(s)}.`
          : `${name(m)} lands on top of ${name(s)}. Leave out "at" so it goes into free space, or move it clear (update x and y).`,
      )
      if (out.length >= 6) return out
    }
  }
  return out
}
