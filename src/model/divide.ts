/**
 * Dividing a crowded board into child boards. The board is cut into units, the things that must
 * move together (a frame and what's in it, a flowchart with its lines, a whole mind map, a vote and
 * its options…), and units are put in groups: one per frame, one per kind of object, or by topic
 * (the assistant names the topics and says which units go where; see `topicPrompt`). Each group
 * becomes a child board, its units laid out in rows, and a card on this board opens it.
 */

import { objectLabel } from './notes'
import { emptyBoard, itemBounds, newItem } from './board'
import { type Rect, unionAll } from './geom'
import { frameMembers } from './subBoard'
import type { Board, BoardParent, Connector, Id, Item, Kind } from './types'

export type UnitKind = 'frame' | 'flowchart' | 'mindmap' | 'notes' | 'planning' | 'pictures' | 'shapes' | 'code' | 'links' | 'card'

/** Things that move together. `key` names it for the assistant ("u12"). */
export interface Unit {
  key: string
  ids: Id[]
  kind: UnitKind
  /** For a frame, what it mostly holds; for anything else, its own kind. */
  holds: UnitKind
  box: Rect
  title: string
}

/** A child board to make: a title and the units that go there. */
export interface Group {
  title: string
  units: Unit[]
}

export interface Plan {
  groups: Group[]
  /** What stays on this board. */
  stays: Unit[]
}

const KIND_OF: Record<Kind, UnitKind> = {
  sticky: 'notes',
  text: 'notes',
  comment: 'notes',
  rect: 'shapes',
  ellipse: 'shapes',
  frame: 'frame',
  pen: 'pictures',
  image: 'pictures',
  mind: 'mindmap',
  flow: 'flowchart',
  table: 'planning',
  kanban: 'planning',
  timeline: 'planning',
  data: 'planning',
  link: 'links',
  code: 'code',
  sequence: 'flowchart',
}

/** The child boards dividing by kind makes, in this order. */
export const KIND_GROUPS: { kind: UnitKind; title: string }[] = [
  { kind: 'flowchart', title: 'Flowcharts and diagrams' },
  { kind: 'mindmap', title: 'Mind maps' },
  { kind: 'notes', title: 'Notes' },
  { kind: 'planning', title: 'Tables and plans' },
  { kind: 'shapes', title: 'Shapes and diagrams' },
  { kind: 'pictures', title: 'Pictures and drawings' },
  { kind: 'code', title: 'Code' },
  { kind: 'links', title: 'Links' },
]

/** Fewer objects than this of one kind stay on the board rather than getting a board of their own. */
export const MIN_GROUP = 3

/** What a set of items mostly is: flowcharts and mind maps win, then the most common kind. */
function kindOf(items: Item[]): UnitKind {
  // Cards that open other boards (child boards made before, say) stay where they are.
  if (items.every((i) => i.linkTo?.board !== undefined)) return 'card'
  if (items.some((i) => i.kind === 'flow' || i.kind === 'sequence')) return 'flowchart'
  if (items.some((i) => i.kind === 'mind')) return 'mindmap'
  const counts = new Map<UnitKind, number>()
  for (const i of items) if (i.kind !== 'frame') counts.set(KIND_OF[i.kind], (counts.get(KIND_OF[i.kind]) ?? 0) + 1)
  return [...counts].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 'notes'
}

const short = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function titleOf(items: Item[], kind: UnitKind): string {
  const frame = items.find((i) => i.kind === 'frame')
  if (frame) return short(frame.text) || 'Frame'
  const root = kind === 'mindmap' ? items.find((i) => i.kind === 'mind' && i.parent === undefined) : undefined
  const start = kind === 'flowchart' ? items.find((i) => i.kind === 'flow' && i.shape === 'terminator') : undefined
  const first = root ?? start ?? [...items].sort((p, q) => p.y - q.y || p.x - q.x).find((i) => objectLabel(i).trim())
  return first ? short(first.text.trim().split('\n')[0] || objectLabel(first)) : ''
}

/**
 * The board's units. Top-level frames first, each with what's in it (whole mind maps too); then
 * what's left, joined by lines between them, mind-map branches, groups, votes and their options,
 * timelines and the boards they show, brainstorm cards and their notes.
 */
export function unitsOf(b: Board): Unit[] {
  const byId = new Map(b.items.map((i) => [i.id, i]))
  const owner = new Map<Id, number>()
  const sets: Id[][] = []
  const frameOf: Id[] = []
  // Frames not inside another frame, biggest first; an object in two goes with the first.
  const frames = b.items.filter((i) => i.kind === 'frame').sort((p, q) => q.w * q.h - p.w * p.h)
  for (const f of frames) {
    if (owner.has(f.id)) continue
    const ids = [...frameMembers(b, f.id)].filter((id) => !owner.has(id))
    for (const id of ids) owner.set(id, sets.length)
    sets.push(ids)
    frameOf.push(f.id)
  }
  // Everything else, joined up (union–find).
  const up = new Map<Id, Id>()
  const find = (id: Id): Id => {
    let r = id
    while (up.get(r) !== r) r = up.get(r)!
    let c = id
    while (c !== r) {
      const n = up.get(c)!
      up.set(c, r)
      c = n
    }
    return r
  }
  const join = (a: Id, c: Id) => {
    if (!up.has(a) || !up.has(c)) return
    const ra = find(a)
    const rc = find(c)
    if (ra !== rc) up.set(ra, rc)
  }
  for (const i of b.items) if (!owner.has(i.id)) up.set(i.id, i.id)
  const grouped = new Map<string, Id>()
  for (const i of b.items) {
    if (!up.has(i.id)) continue
    if (i.parent !== undefined) join(i.id, i.parent)
    if (i.hiddenRound !== undefined) join(i.id, i.hiddenRound)
    for (const o of i.poll?.options ?? []) join(i.id, o)
    for (const s of i.timeline?.sources ?? []) join(i.id, s)
    if (i.group) {
      const g = grouped.get(i.group)
      if (g === undefined) grouped.set(i.group, i.id)
      else join(i.id, g)
    }
  }
  for (const c of b.connectors) join(c.from, c.to)
  const loose = new Map<Id, Id[]>()
  for (const i of b.items) {
    if (!up.has(i.id)) continue
    const r = find(i.id)
    const list = loose.get(r)
    if (list) list.push(i.id)
    else loose.set(r, [i.id])
  }
  sets.push(...loose.values())

  return sets.map((ids, k) => {
    const items = ids.map((id) => byId.get(id)!)
    const frame = k < frameOf.length ? byId.get(frameOf[k]) : undefined
    const holds = kindOf(items)
    const kind = frame ? 'frame' : holds
    return {
      key: `u${k + 1}`,
      ids,
      kind,
      holds,
      box: unionAll(items.map(itemBounds))!,
      title: titleOf(frame ? [frame] : items, holds),
    }
  })
}

const size = (units: Unit[]) => units.reduce((n, u) => n + u.ids.length, 0)

/** A child board per frame (with at least one thing in it); everything outside frames stays. */
export function planByFrame(units: Unit[]): Plan {
  const framed = units.filter((u) => u.kind === 'frame' && u.ids.length > 1)
  return {
    groups: framed.map((u) => ({ title: u.title, units: [u] })),
    stays: units.filter((u) => !framed.includes(u)),
  }
}

/** A child board per kind of object: flowcharts together, mind maps together… Frames go by what they hold. */
export function planByKind(units: Unit[]): Plan {
  const groups: Group[] = []
  // Anything without a board of its kind (cards to other boards) stays.
  const stays: Unit[] = units.filter((u) => !KIND_GROUPS.some((g) => g.kind === u.holds))
  for (const { kind, title } of KIND_GROUPS) {
    const these = units.filter((u) => u.holds === kind)
    if (!these.length) continue
    if (size(these) < MIN_GROUP) stays.push(...these)
    else groups.push({ title, units: these })
  }
  return { groups, stays }
}

// ----- by topic, with the assistant ------------------------------------------------------------------

/** At most this many units go to the assistant; small loose ones near each other are put together first. */
export const MAX_TOPIC_UNITS = 300

/**
 * Units for the assistant to sort: small loose ones (a note or two) that sit near each other become
 * one, coarser and coarser until there are few enough. Frames, flowcharts and mind maps stay whole.
 */
export function topicUnits(units: Unit[]): Unit[] {
  const merge = (list: Unit[]): Unit => ({
    key: list[0].key,
    ids: list.flatMap((u) => u.ids),
    kind: list[0].kind,
    holds: list[0].holds,
    box: unionAll(list.map((u) => u.box))!,
    title: short(
      list
        .map((u) => u.title)
        .filter(Boolean)
        .join('; '),
      200,
    ),
  })
  // What stays whole: frames, flowcharts and mind maps, and anything already big. Notes put
  // together here can be put together again, more coarsely.
  const whole = new Set(units.filter((u) => u.kind === 'frame' || u.kind === 'flowchart' || u.kind === 'mindmap' || u.ids.length > 6))
  let cell = 400
  let out = units
  while (out.length > MAX_TOPIC_UNITS && cell < 1e7) {
    const keep: Unit[] = []
    const cells = new Map<string, Unit[]>()
    for (const u of out) {
      if (whole.has(u)) {
        keep.push(u)
        continue
      }
      const k = `${Math.floor((u.box.x + u.box.w / 2) / cell)},${Math.floor((u.box.y + u.box.h / 2) / cell)}`
      const list = cells.get(k)
      if (list) list.push(u)
      else cells.set(k, [u])
    }
    out = [...keep, ...[...cells.values()].map((list) => (list.length === 1 ? list[0] : merge(list)))]
    cell *= 2
  }
  // Still too many (hundreds of frames, say): the biggest go as they are, the rest as one.
  if (out.length > MAX_TOPIC_UNITS) {
    const sorted = [...out].sort((p, q) => q.ids.length - p.ids.length)
    out = [...sorted.slice(0, MAX_TOPIC_UNITS - 1), merge(sorted.slice(MAX_TOPIC_UNITS - 1))]
  }
  return out
}

/** What the assistant is asked: the units, each with its kind, size and words. */
export function topicPrompt(units: Unit[], b: Board, title: string): string {
  const byId = new Map(b.items.map((i) => [i.id, i]))
  const lines = units.map((u) => {
    const words = u.ids
      .map((id) => byId.get(id))
      .filter((i): i is Item => !!i && !i.masked)
      .map((i) => short(objectLabel(i), 50))
      .filter(Boolean)
    const text = short(words.join(' · '), 240)
    return `${u.key} | ${u.kind === 'frame' ? `frame "${u.title}"` : u.kind} | ${u.ids.length} object${u.ids.length === 1 ? '' : 's'} | ${text || '(no words)'}`
  })
  return `The board "${title || 'Untitled'}" is too crowded. Split it into child boards by topic.

Its parts, one per line (key | kind | size | words):
${lines.join('\n')}

Reply with JSON only, in this shape:
{"boards": [{"title": "Short topic name", "units": ["u1", "u4"]}], "keep": ["u7"]}

- Between 2 and 8 boards, each a clear topic, titled in a few words in the board's own language.
- Put every part in exactly one board, or in "keep" if it's general (a title, a key, instructions) and belongs on the main board.
- Use only the keys listed.`
}

export const TOPIC_SYSTEM = 'You sort the parts of a crowded whiteboard into topics. You reply with JSON only, no other words.'

/** The assistant's topics, checked: known units, each used once; anything left out stays. Null if unreadable. */
export function parseTopics(reply: string, units: Unit[]): Plan | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  const boards = (raw as { boards?: unknown })?.boards
  if (!Array.isArray(boards)) return null
  const byKey = new Map(units.map((u) => [u.key, u]))
  const used = new Set<string>()
  const groups: Group[] = []
  for (const g of boards.slice(0, 12)) {
    if (!g || typeof g !== 'object') continue
    const { title, units: keys } = g as { title?: unknown; units?: unknown }
    if (!Array.isArray(keys)) continue
    const these = keys.flatMap((k) => {
      const u = typeof k === 'string' && !used.has(k) ? byKey.get(k) : undefined
      if (!u) return []
      used.add(k as string)
      return [u]
    })
    if (these.length)
      groups.push({
        title: typeof title === 'string' && title.trim() ? short(title, 80) : `Topic ${groups.length + 1}`,
        units: these,
      })
  }
  if (!groups.length) return null
  return { groups, stays: units.filter((u) => !used.has(u.key)) }
}

// ----- making the boards ----------------------------------------------------------------------------

const GAP = 160

/**
 * Where each unit goes on a child board: in rows, in the order they were on the board (top to
 * bottom, left to right), each keeping its own layout. Returns how far to move each unit.
 */
export function packUnits(units: Unit[]): Map<Unit, { dx: number; dy: number }> {
  const sorted = [...units].sort((p, q) => p.box.y - q.box.y || p.box.x - q.box.x)
  const area = sorted.reduce((n, u) => n + (u.box.w + GAP) * (u.box.h + GAP), 0)
  const rowWidth = Math.max(2400, Math.sqrt(area) * 1.6)
  const out = new Map<Unit, { dx: number; dy: number }>()
  let x = 0
  let y = 0
  let rowH = 0
  for (const u of sorted) {
    if (x > 0 && x + u.box.w > rowWidth) {
      x = 0
      y += rowH + GAP
      rowH = 0
    }
    out.set(u, { dx: Math.round(x - u.box.x), dy: Math.round(y - u.box.y) })
    x += u.box.w + GAP
    rowH = Math.max(rowH, u.box.h)
  }
  return out
}

const moved = (i: Item, dx: number, dy: number): Item => ({
  ...i,
  x: i.x + dx,
  y: i.y + dy,
  ...(i.points ? { points: i.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : {}),
})

/**
 * A child board for a group: its units laid out in rows, the lines between them, the databases they
 * show, and (given `parent`) a card above that leads back to the board it came from.
 */
export function childBoard(b: Board, group: Group, parent?: BoardParent): Board {
  const shift = packUnits(group.units)
  const unitOf = new Map<Id, Unit>()
  for (const u of group.units) for (const id of u.ids) unitOf.set(id, u)
  const items = b.items.flatMap((i) => {
    const u = unitOf.get(i.id)
    if (!u) return []
    const { dx, dy } = shift.get(u)!
    return [moved(i, dx, dy)]
  })
  const connectors = b.connectors.filter((c) => unitOf.has(c.from) && unitOf.has(c.to))
  if (parent) {
    const title = parent.title || 'the board it came from'
    items.push({
      id: b.nextId,
      ...newItem(
        'rect',
        { x: 0, y: -150, w: 300, h: 90 },
        {
          text: `↩ Back to ${title}`,
          color: '#ffffff',
          linkTo: { board: parent.key, label: title },
        },
      ),
    })
  }
  const shown = new Set(items.flatMap((i) => (i.view ? [i.view.dataset] : [])))
  const datasets = (b.datasets ?? []).filter((d) => shown.has(d.id))
  return {
    ...emptyBoard(group.title || 'Part of a board'),
    items,
    connectors,
    nextId: b.nextId + (parent ? 1 : 0),
    ...(datasets.length ? { datasets } : {}),
    ...(b.sketch ? { sketch: b.sketch } : {}),
    ...(parent ? { parent } : {}),
  }
}

const CARD = { w: 320, h: 130 }

/**
 * This board once its groups have gone to child boards (`keys[k]` links to group k's): their
 * objects gone and a card for each opening it. A group of one frame leaves its card where the frame
 * was; the others' cards go in a grid to the left of what stays. Lines from something that stays to
 * something that went now end at that card, once per object and direction. Null keys are skipped.
 */
export function boardAfter(b: Board, groups: Group[], keys: (string | null)[]): { board: Board; cards: Id[] } {
  const groupOf = new Map<Id, number>()
  groups.forEach((g, k) => {
    if (keys[k] === null) return
    for (const u of g.units) for (const id of u.ids) groupOf.set(id, k)
  })
  const present = new Set(b.items.map((i) => i.id))
  const stay = b.items.filter((i) => !groupOf.has(i.id))
  const left = unionAll(stay.map(itemBounds))
  const all = unionAll(b.items.map(itemBounds)) ?? { x: 0, y: 0, w: 0, h: 0 }
  const live = groups.map((g, k) => ({ g, k })).filter(({ k }) => keys[k] !== null)
  const gridded = live.filter(({ g }) => !(g.units.length === 1 && g.units[0].kind === 'frame'))
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(gridded.length))))
  const origin = left ? { x: left.x - cols * (CARD.w + 40) - 160, y: left.y } : { x: all.x, y: all.y }
  let nextId = b.nextId
  const cardOf = new Map<number, Id>()
  const cards: Item[] = live.map(({ g, k }) => {
    // What really went (anything deleted since the plan was made isn't counted).
    const n = g.units.reduce((s, u) => s + u.ids.filter((id) => groupOf.get(id) === k && present.has(id)).length, 0)
    const frame = g.units.length === 1 && g.units[0].kind === 'frame' ? g.units[0].box : null
    const slot = gridded.findIndex((x) => x.k === k)
    const at = frame ?? {
      x: origin.x + (slot % cols) * (CARD.w + 40),
      y: origin.y + Math.floor(slot / cols) * (CARD.h + 40),
    }
    const id = nextId++
    cardOf.set(k, id)
    return {
      id,
      ...newItem(
        'rect',
        { x: at.x, y: at.y, ...CARD },
        {
          text: `📋 ${g.title}\n${n} object${n === 1 ? '' : 's'}, on a board of their own`,
          color: '#ffffff',
          linkTo: { board: keys[k]!, label: g.title },
        },
      ),
    }
  })
  const connectors: Connector[] = []
  const seen = new Set<string>()
  for (const c of b.connectors) {
    const gf = groupOf.get(c.from)
    const gt = groupOf.get(c.to)
    if (gf === undefined && gt === undefined) {
      connectors.push(c)
      continue
    }
    // Both ends went to the same child board: the line went with them.
    if (gf !== undefined && gf === gt) continue
    const next = {
      ...c,
      from: gf === undefined ? c.from : cardOf.get(gf)!,
      to: gt === undefined ? c.to : cardOf.get(gt)!,
    }
    const k = `${next.from}>${next.to}`
    if (next.from === next.to || seen.has(k)) continue
    seen.add(k)
    connectors.push(next)
  }
  return {
    board: { ...b, items: [...stay, ...cards], connectors, nextId },
    cards: cards.map((c) => c.id),
  }
}
