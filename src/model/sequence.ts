/**
 * Sequence diagrams: people and systems side by side (lanes), and the messages between them from
 * top to bottom (steps), with notes, boxes around runs of messages (loops, alternatives…) and the
 * bars showing who is busy answering a call. The object's size follows from its contents, so it's
 * laid out here, and it goes in and out as Mermaid (`sequenceDiagram`).
 */

import type { SequenceBox, SequenceBoxKind, SequenceData, SequenceLane, SequenceStep } from './types'

/** How far apart lanes are, and the height of the participants' boxes and of each step. */
export const LANE_W = 200
export const HEAD_H = 48
export const ROW_H = 56
/** Room above the boxes for the title, and below the last step (where the next one is written). */
export const TOP = 40
export const FOOT = 24
/** Room a box takes above its first step (its tag) and below its last, and a divider. */
export const BOX_HEAD = 30
export const BOX_FOOT = 12
export const ELSE_H = 28

/** At most this many lanes, steps and boxes (from a paste or a peer). */
export const MAX_LANES = 30
export const MAX_STEPS = 400
export const MAX_BOXES = 100

export const BOX_KINDS: SequenceBoxKind[] = ['loop', 'alt', 'opt', 'par', 'critical', 'break']
/** What the dividers inside a box are called in Mermaid. */
const DIVIDER: Partial<Record<SequenceBoxKind, string>> = { alt: 'else', par: 'and', critical: 'option' }
export const canDivide = (kind: SequenceBoxKind) => !!DIVIDER[kind]

export const newSequence = (names: string[] = ['Client', 'Server']): SequenceData => ({ lanes: names.map((name, k) => ({ id: `l${k + 1}`, name })), steps: [] })

export const isNote = (s: Pick<SequenceStep, 'style'>) => s.style === 'note'

// ----- layout ------------------------------------------------------------------------------------

export interface SequenceLayout {
  /** Where each step's arrow (or note) sits, from the object's top; one more for the next step. */
  rows: number[]
  h: number
  /** Each box's top and bottom, and how many boxes it sits inside. */
  boxes: Map<string, { top: number; bottom: number; depth: number; a: number; z: number }>
  /** The dividers: their box, height and words. */
  elses: { box: string; y: number; label: string }[]
}

/** Boxes by position: the first and last step's index, and their dividers' (null if broken). */
function spans(d: SequenceData) {
  const at = new Map(d.steps.map((s, k) => [s.id, k]))
  return (d.boxes ?? []).flatMap((b) => {
    const f = at.get(b.first)
    const l = at.get(b.last)
    if (f === undefined || l === undefined || f > l) return []
    return [{ box: b, f, l, elses: (b.elses ?? []).flatMap((e) => (at.has(e.before) && at.get(e.before)! > f && at.get(e.before)! <= l ? [{ k: at.get(e.before)!, label: e.label }] : [])) }]
  })
}

const memo = new WeakMap<SequenceData, SequenceLayout>()

/** Where everything goes, top to bottom. */
export function sequenceLayout(d: SequenceData): SequenceLayout {
  const hit = memo.get(d)
  if (hit) return hit
  const all = spans(d)
  const rows: number[] = []
  const boxes = new Map<string, { top: number; bottom: number; depth: number; a: number; z: number }>()
  const elses: SequenceLayout['elses'] = []
  let y = TOP + HEAD_H + 8
  const n = d.steps.length
  for (let k = 0; k <= n; k++) {
    // Dividers of boxes already open come before boxes opening here (which sit inside them).
    for (const s of all)
      for (const e of s.elses) {
        if (e.k !== k || s.f >= k) continue
        elses.push({ box: s.box.id, y, label: e.label })
        y += ELSE_H
      }
    // Outer boxes open first and close last.
    for (const s of all.filter((x) => x.f === k).sort((p, q) => q.l - p.l)) {
      const depth = all.filter((o) => o !== s && o.f <= s.f && o.l >= s.l && (o.f < s.f || o.l > s.l || all.indexOf(o) < all.indexOf(s))).length
      boxes.set(s.box.id, { top: y, bottom: y, depth, ...laneSpan(d, s.f, s.l) })
      y += BOX_HEAD
    }
    rows.push(y + ROW_H * 0.6)
    y += ROW_H
    if (k === n) break
    for (const s of all.filter((x) => x.l === k).sort((p, q) => p.f - q.f).reverse()) {
      y += BOX_FOOT
      boxes.get(s.box.id)!.bottom = y - 4
    }
  }
  const out = { rows, h: y + FOOT, boxes, elses }
  memo.set(d, out)
  return out
}

/** The lanes the steps from `f` to `l` touch (indexes), for a box's width. */
function laneSpan(d: SequenceData, f: number, l: number): { a: number; z: number } {
  let a = Infinity
  let z = -Infinity
  for (const s of d.steps.slice(f, l + 1))
    for (const id of [s.from, s.to]) {
      const k = laneIndex(d, id)
      if (k < 0) continue
      a = Math.min(a, k)
      z = Math.max(z, k)
    }
  return a === Infinity ? { a: 0, z: Math.max(0, d.lanes.length - 1) } : { a, z }
}

/** The object's size: a lane's width each (two at least), and room for every row and box. */
export function sequenceSize(d: SequenceData): { w: number; h: number } {
  return { w: Math.max(2, d.lanes.length) * LANE_W, h: sequenceLayout(d).h }
}

/** Where lane `k`'s line runs, from the object's left edge. */
export const laneX = (k: number) => LANE_W * (k + 0.5)
/** Where step `r`'s arrow is, from the object's top (r = steps.length is the next one). */
export const rowY = (d: SequenceData, r: number) => sequenceLayout(d).rows[Math.max(0, Math.min(r, d.steps.length))]

/**
 * Who is busy when: a call (not to itself) starts a bar on the lane called, and the answer back
 * ends it. Calls never answered draw no bar. `depth` is for calls into a lane already busy.
 */
export function activations(d: SequenceData): { lane: string; from: number; to: number; depth: number }[] {
  const open: { s: SequenceStep; k: number; depth: number }[] = []
  const out: { lane: string; from: number; to: number; depth: number }[] = []
  d.steps.forEach((s, k) => {
    if (s.style === 'reply') {
      const i = open.map((c) => c.s.to === s.from && c.s.from === s.to).lastIndexOf(true)
      if (i >= 0) {
        const c = open[i]
        out.push({ lane: c.s.to, from: c.k, to: k, depth: c.depth })
        open.splice(i, 1)
      }
    } else if (!s.style && s.from !== s.to) open.push({ s, k, depth: open.filter((c) => c.s.to === s.to).length })
  })
  return out
}

// ----- changes -----------------------------------------------------------------------------------

const nextId = (prefix: string, used: { id: string }[]) => {
  let n = used.length + 1
  const taken = new Set(used.map((u) => u.id))
  while (taken.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

export const laneIndex = (d: SequenceData, id: string) => d.lanes.findIndex((l) => l.id === id)

export function addLane(d: SequenceData, name: string, at = d.lanes.length): { data: SequenceData; id: string } {
  if (d.lanes.length >= MAX_LANES) return { data: d, id: '' }
  const id = nextId('l', d.lanes)
  const lanes = [...d.lanes]
  lanes.splice(Math.max(0, Math.min(at, lanes.length)), 0, { id, name: name.trim() || `Participant ${d.lanes.length + 1}` })
  return { data: { ...d, lanes }, id }
}

export const renameLane = (d: SequenceData, id: string, name: string): SequenceData => ({ ...d, lanes: d.lanes.map((l) => (l.id === id ? { ...l, name } : l)) })

export const setActor = (d: SequenceData, id: string, actor: boolean): SequenceData => ({
  ...d,
  lanes: d.lanes.map((l): SequenceLane => {
    if (l.id !== id) return l
    const { actor: _, ...rest } = l
    return actor ? { ...rest, actor: true } : rest
  }),
})

/**
 * The steps changed to `steps`, where `place` says where each old step went (its new index, or
 * null if it's gone); boxes and dividers keep their places among the steps.
 */
function restep(d: SequenceData, steps: SequenceStep[], place: (k: number) => number | null): SequenceData {
  const boxes = spans(d).flatMap(({ box, f, l, elses }) => {
    // A box's ends move to the nearest step that's still there, inside it.
    let nf: number | null = null
    for (let k = f; k <= l && nf === null; k++) nf = place(k)
    let nl: number | null = null
    for (let k = l; k >= f && nl === null; k--) nl = place(k)
    if (nf === null || nl === null || nf > nl) return []
    const kept = elses.flatMap((e) => {
      const at = place(e.k)
      return at !== null && at > nf! && at <= nl! ? [{ before: steps[at].id, label: e.label }] : []
    })
    const { elses: _, ...rest } = box
    return [{ ...rest, first: steps[nf].id, last: steps[nl].id, ...(kept.length ? { elses: kept } : {}) }]
  })
  const { boxes: _, ...rest } = d
  return { ...rest, steps, ...(boxes.length ? { boxes } : {}) }
}

/** Numbers the messages, or not. */
export function setNumbered(d: SequenceData, on: boolean): SequenceData {
  const { numbered: _, ...rest } = d
  return on ? { ...rest, numbered: true } : rest
}

/** Takes a lane out, and every step to or from it. */
export function removeLane(d: SequenceData, id: string): SequenceData {
  const keep = d.steps.map((s) => s.from !== id && s.to !== id)
  const index: (number | null)[] = []
  let n = 0
  for (const k of keep) index.push(k ? n++ : null)
  return { ...restep(d, d.steps.filter((_, k) => keep[k]), (k) => index[k]), lanes: d.lanes.filter((l) => l.id !== id) }
}

/** Moves a lane one place left (-1) or right (1). */
export function moveLane(d: SequenceData, id: string, by: -1 | 1): SequenceData {
  const k = laneIndex(d, id)
  const j = k + by
  if (k < 0 || j < 0 || j >= d.lanes.length) return d
  const lanes = [...d.lanes]
  ;[lanes[k], lanes[j]] = [lanes[j], lanes[k]]
  return { ...d, lanes }
}

/** Adds a step at `at` (the end by default); one put inside a box's run of steps joins the box. */
export function addStep(d: SequenceData, step: Omit<SequenceStep, 'id'>, at = d.steps.length): { data: SequenceData; id: string } {
  if (d.steps.length >= MAX_STEPS) return { data: d, id: '' }
  const id = nextId('s', d.steps)
  const where = Math.max(0, Math.min(at, d.steps.length))
  const steps = [...d.steps]
  steps.splice(where, 0, { id, ...step })
  return { data: restep(d, steps, (k) => (k < where ? k : k + 1)), id }
}

export const updateStep = (d: SequenceData, id: string, f: (s: SequenceStep) => SequenceStep): SequenceData => ({ ...d, steps: d.steps.map((s) => (s.id === id ? f(s) : s)) })

export function removeStep(d: SequenceData, id: string): SequenceData {
  const gone = d.steps.findIndex((s) => s.id === id)
  if (gone < 0) return d
  return restep(
    d,
    d.steps.filter((s) => s.id !== id),
    (k) => (k === gone ? null : k < gone ? k : k - 1),
  )
}

/** Moves a step one row up (-1) or down (1); boxes stay where they are, so it can move in or out of one. */
export function moveStep(d: SequenceData, id: string, by: -1 | 1): SequenceData {
  const k = d.steps.findIndex((s) => s.id === id)
  const j = k + by
  if (k < 0 || j < 0 || j >= d.steps.length) return d
  const steps = [...d.steps]
  ;[steps[k], steps[j]] = [steps[j], steps[k]]
  // Boxes keep their rows: the step now at their first row is their first, whichever it is.
  return restep(d, steps, (x) => x)
}

/** Whether a box around steps `f` to `l` would cross one already there (boxes nest, never cross). */
export const crossesBox = (d: SequenceData, f: number, l: number) => spans(d).some((s) => (s.f < f && f <= s.l && s.l < l) || (f < s.f && s.f <= l && l < s.l))

/** A box around the steps at indexes `f` to `l` (in either order); none if it would cross another. */
export function addBox(d: SequenceData, kind: SequenceBoxKind, label: string, f: number, l: number): { data: SequenceData; id: string } {
  const [a, z] = f <= l ? [f, l] : [l, f]
  const first = d.steps[a]
  const last = d.steps[z]
  if (!first || !last || (d.boxes?.length ?? 0) >= MAX_BOXES || crossesBox(d, a, z)) return { data: d, id: '' }
  const id = nextId('b', d.boxes ?? [])
  return { data: { ...d, boxes: [...(d.boxes ?? []), { id, kind, label: label.trim(), first: first.id, last: last.id }] }, id }
}

export const updateBox = (d: SequenceData, id: string, f: (b: SequenceBox) => SequenceBox): SequenceData => ({ ...d, boxes: (d.boxes ?? []).map((b) => (b.id === id ? f(b) : b)) })

export function removeBox(d: SequenceData, id: string): SequenceData {
  const boxes = (d.boxes ?? []).filter((b) => b.id !== id)
  const { boxes: _, ...rest } = d
  return boxes.length ? { ...rest, boxes } : rest
}

/** Sets (or, with null, takes away) the divider above step `before` in a box. */
export function setDivider(d: SequenceData, boxId: string, before: string, label: string | null): SequenceData {
  // Only inside the box, after its first step.
  const span = spans(d).find((x) => x.box.id === boxId)
  const k = d.steps.findIndex((s) => s.id === before)
  if (label !== null && (!span || k <= span.f || k > span.l)) return d
  return updateBox(d, boxId, (b) => {
    const others = (b.elses ?? []).filter((e) => e.before !== before)
    const elses = label === null ? others : [...others, { before, label: label.trim() }].sort((p, q) => d.steps.findIndex((s) => s.id === p.before) - d.steps.findIndex((s) => s.id === q.before))
    const { elses: _, ...rest } = b
    return elses.length ? { ...rest, elses } : rest
  })
}

/** The boxes around step `k`, innermost first. */
export function boxesAround(d: SequenceData, k: number): SequenceBox[] {
  return spans(d)
    .filter((s) => s.f <= k && s.l >= k)
    .sort((p, q) => p.l - p.f - (q.l - q.f))
    .map((s) => s.box)
}

/** The box exactly around steps `f` to `l`, if there is one. */
export const boxOver = (d: SequenceData, f: number, l: number) => spans(d).find((s) => s.f === Math.min(f, l) && s.l === Math.max(f, l))?.box

/** The arrow styles, in the order Tab goes through them. */
export const STYLES: SequenceStep['style'][] = [undefined, 'reply', 'async', 'note']
export const STYLE_LABELS = ['Call', 'Reply', 'Message (no wait)', 'Note'] as const

export const styleLabel = (s: SequenceStep['style']) => STYLE_LABELS[STYLES.indexOf(s)]

/**
 * The step to suggest next, so a diagram can be typed one message after another: after a call,
 * the answer back; after an answer, the answer to whoever is still waiting on that lane (if
 * anyone), or else a call on to the next lane. Notes don't count.
 */
export function nextStep(d: SequenceData): Pick<SequenceStep, 'from' | 'to' | 'style'> {
  const ids = d.lanes.map((l) => l.id)
  const steps = d.steps.filter((s) => !isNote(s))
  const last = steps[steps.length - 1]
  if (!last || !ids.includes(last.from) || !ids.includes(last.to)) return { from: ids[0] ?? '', to: ids[1] ?? ids[0] ?? '' }
  if (!last.style && last.from !== last.to) return { from: last.to, to: last.from, style: 'reply' }
  // Calls still waiting for their answer.
  const open: SequenceStep[] = []
  for (const s of steps) {
    if (s.style === 'reply') {
      const k = open.map((c) => c.to === s.from && c.from === s.to).lastIndexOf(true)
      if (k >= 0) open.splice(k)
    } else if (!s.style && s.from !== s.to) open.push(s)
  }
  const from = last.to
  const waiting = [...open].reverse().find((c) => c.to === from)
  if (waiting) return { from, to: waiting.from, style: 'reply' }
  const k = ids.indexOf(from)
  return { from, to: ids[k + 1] ?? ids[k - 1] ?? from }
}

/** The words in a diagram, for search, assistants and outlines. */
export function sequenceText(d: SequenceData): string {
  const name = new Map(d.lanes.map((l) => [l.id, l.name]))
  return [
    d.lanes.map((l) => l.name).join(', '),
    ...d.steps.map((s) => (isNote(s) ? `Note: ${s.text}` : `${name.get(s.from) ?? '?'} → ${name.get(s.to) ?? '?'}: ${s.text}`)),
    ...(d.boxes ?? []).map((b) => `${b.kind} ${b.label}`.trim()),
  ].join('\n')
}

// ----- Mermaid ------------------------------------------------------------------------------------

/** The lines of Mermaid after any front matter (a block between `---` lines at the top). */
function body(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const first = lines.findIndex((l) => l.trim())
  if (first >= 0 && lines[first].trim() === '---') {
    const end = lines.findIndex((l, k) => k > first && l.trim() === '---')
    if (end > first) return lines.slice(end + 1)
  }
  return lines
}

export const looksLikeSequence = (text: string) => /^\s*sequenceDiagram\b/.test(body(text).find((l) => l.trim() && !l.trim().startsWith('%%')) ?? '')

/** A line with an arrow in it is a message, whatever word it starts with. */
const HAS_ARROW = /--?(?:>>|>|\)|x)/

/** Arrows, longest first: dashed ones are replies, `)` and `x` ones don't wait. */
const ARROWS: [string, SequenceStep['style']][] = [
  ['-->>', 'reply'],
  ['--)', 'reply'],
  ['--x', 'reply'],
  ['-->', 'reply'],
  ['->>', undefined],
  ['-)', 'async'],
  ['-x', undefined],
  ['->', undefined],
]

const name = String.raw`[^\s:;,>+\-()]+(?:\s+[^\s:;,>+\-()]+)*?`
const STEP = new RegExp(String.raw`^(${name})\s*(-->>|--\)|--x|-->|->>|-\)|-x|->)\s*[+-]?\s*(${name})\s*:\s*(.*)$`)
const NOTE = /^note\s+(?:over|left\s+of|right\s+of)\s+([^:,]+?)(?:\s*,\s*([^:]+?))?\s*:\s*(.*)$/i

/**
 * A Mermaid sequence diagram: its participants (and actors), with `as` names, its messages and
 * notes, and loop/alt/opt/par/critical/break boxes with their dividers. Activation markers are
 * left to the diagram (it works them out); anything else is left out, and `skipped` says how many
 * lines were. Null if it isn't one.
 */
export function parseSequence(text: string): { data: SequenceData; title: string; skipped: number } | null {
  if (!looksLikeSequence(text)) return null
  let data: SequenceData = { lanes: [], steps: [] }
  const byKey = new Map<string, string>()
  let title = ''
  let skipped = 0
  // Open blocks: a box being read, or another kind of block (rect, box) whose `end` is just closed.
  const open: ({ kind: SequenceBoxKind; label: string; f: number; elses: { k: number; label: string }[] } | null)[] = []
  const lane = (key: string, label = key, actor = false) => {
    const known = byKey.get(key)
    if (known) {
      if (label !== key) data = renameLane(data, known, label)
      if (actor) data = setActor(data, known, true)
      return known
    }
    const made = addLane(data, label)
    if (!made.id) return ''
    data = actor ? setActor(made.data, made.id, true) : made.data
    byKey.set(key, made.id)
    return made.id
  }
  const words = (s: string) => s.trim().replace(/<br\s*\/?>/gi, ' ')
  const lines = body(text)
  for (const raw of lines.slice(lines.findIndex((l) => looksLikeSequence(l)) + 1)) {
    const line = raw.trim()
    if (!line || line.startsWith('%%')) continue
    const arrow = HAS_ARROW.test(line)
    const p = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line)
    if (p && !arrow) {
      if (!lane(p[2].trim(), (p[3] ?? p[2]).trim(), p[1].toLowerCase() === 'actor')) skipped++
      continue
    }
    if (/^autonumber\b/i.test(line)) {
      data = { ...data, numbered: true }
      continue
    }
    const t = arrow ? null : /^title\b\s*:?\s*(.*)$/i.exec(line)
    if (t) {
      title = t[1].trim()
      continue
    }
    if (!arrow && /^(?:activate|deactivate)\s/i.test(line)) continue
    const block = arrow ? null : /^(loop|alt|opt|par|critical|break)\b\s*(.*)$/i.exec(line)
    if (block) {
      open.push({ kind: block[1].toLowerCase() as SequenceBoxKind, label: words(block[2]), f: data.steps.length, elses: [] })
      continue
    }
    if (!arrow && /^(?:rect|box)\b/i.test(line)) {
      open.push(null)
      continue
    }
    const divider = arrow ? null : /^(else|and|option)\b\s*(.*)$/i.exec(line)
    if (divider && open.length) {
      open[open.length - 1]?.elses.push({ k: data.steps.length, label: words(divider[2]) })
      continue
    }
    if (/^end$/i.test(line)) {
      const b = open.pop()
      if (b && data.steps.length > b.f) {
        const made = addBox(data, b.kind, b.label, b.f, data.steps.length - 1)
        data = made.data
        for (const e of b.elses) if (e.k > b.f && e.k < data.steps.length) data = setDivider(data, made.id, data.steps[e.k].id, e.label)
      }
      continue
    }
    const note = arrow ? null : NOTE.exec(line)
    if (note) {
      const from = lane(note[1].trim())
      const to = note[2] ? lane(note[2].trim()) : from
      // Past the most lanes a diagram holds, a line is left out (and counted) rather than misdrawn.
      if (from && to) data = addStep(data, { from, to, text: words(note[3]), style: 'note' }).data
      else skipped++
      continue
    }
    const m = STEP.exec(line)
    if (m) {
      const style = ARROWS.find(([a]) => a === m[2])![1]
      const from = lane(m[1].trim())
      const to = lane(m[3].trim())
      if (from && to) data = addStep(data, { from, to, text: words(m[4]), ...(style ? { style } : {}) }).data
      else skipped++
      continue
    }
    skipped++
  }
  if (!data.lanes.length) return null
  return { data, title, skipped }
}

const ARROW_OUT: Record<string, string> = { call: '->>', reply: '-->>', async: '-)' }

/** A diagram as Mermaid, to paste into anything that draws it. */
export function toMermaidSequence(d: SequenceData, title = ''): string {
  const key = new Map(d.lanes.map((l, k) => [l.id, `P${k + 1}`]))
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/[;#]/g, ' ').trim()
  const all = spans(d)
  const out = ['sequenceDiagram', ...(title.trim() ? [`  title ${clean(title)}`] : []), ...(d.numbered ? ['  autonumber'] : [])]
  out.push(...d.lanes.map((l) => `  ${l.actor ? 'actor' : 'participant'} ${key.get(l.id)} as ${clean(l.name) || key.get(l.id)}`))
  let depth = 1
  const pad = () => '  '.repeat(depth)
  d.steps.forEach((s, k) => {
    // A divider belongs to a box already open, so it comes before any box opening here.
    for (const b of all) for (const e of b.elses) if (e.k === k) out.push(`${'  '.repeat(Math.max(1, depth - 1))}${DIVIDER[b.box.kind] ?? 'else'}${e.label ? ` ${clean(e.label)}` : ''}`)
    for (const b of all.filter((x) => x.f === k).sort((p, q) => q.l - p.l)) {
      out.push(`${pad()}${b.box.kind}${b.box.label ? ` ${clean(b.box.label)}` : ''}`)
      depth++
    }
    if (key.has(s.from) && key.has(s.to)) {
      if (isNote(s)) out.push(`${pad()}Note over ${key.get(s.from)}${s.to !== s.from ? `,${key.get(s.to)}` : ''}: ${clean(s.text)}`)
      else out.push(`${pad()}${key.get(s.from)}${ARROW_OUT[s.style ?? 'call']}${key.get(s.to)}: ${clean(s.text)}`)
    }
    for (let n = all.filter((x) => x.l === k).length; n > 0; n--) {
      depth--
      out.push(`${pad()}end`)
    }
  })
  return out.join('\n')
}

// ----- checking data that arrives ---------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const ID = /^[\w-]{1,24}$/
const STEP_STYLES = new Set(['reply', 'async', 'note'])

/** A diagram from a file, the clipboard or a peer, checked: lanes, steps and boxes with known ids, short words. Null if unusable. */
export function cleanSequence(raw: unknown): SequenceData | null {
  if (!isObj(raw) || !Array.isArray(raw.lanes) || !Array.isArray(raw.steps)) return null
  const lanes: SequenceLane[] = []
  for (const l of raw.lanes.slice(0, MAX_LANES)) {
    if (!isObj(l) || typeof l.id !== 'string' || !ID.test(l.id) || lanes.some((x) => x.id === l.id)) continue
    lanes.push({ id: l.id, name: typeof l.name === 'string' ? l.name.slice(0, 200) : '', ...(l.actor === true ? { actor: true as const } : {}) })
  }
  const known = new Set(lanes.map((l) => l.id))
  const steps: SequenceStep[] = []
  for (const s of raw.steps.slice(0, MAX_STEPS)) {
    if (!isObj(s) || typeof s.id !== 'string' || !ID.test(s.id) || steps.some((x) => x.id === s.id)) continue
    if (typeof s.from !== 'string' || typeof s.to !== 'string' || !known.has(s.from) || !known.has(s.to)) continue
    const style = typeof s.style === 'string' && STEP_STYLES.has(s.style) ? (s.style as SequenceStep['style']) : undefined
    steps.push({ id: s.id, from: s.from, to: s.to, text: typeof s.text === 'string' ? s.text.slice(0, 500) : '', ...(style ? { style } : {}) })
  }
  const stepIds = new Set(steps.map((s) => s.id))
  const boxes: SequenceBox[] = []
  for (const b of Array.isArray(raw.boxes) ? raw.boxes.slice(0, MAX_BOXES) : []) {
    if (!isObj(b) || typeof b.id !== 'string' || !ID.test(b.id) || boxes.some((x) => x.id === b.id)) continue
    if (typeof b.kind !== 'string' || !BOX_KINDS.includes(b.kind as SequenceBoxKind)) continue
    if (typeof b.first !== 'string' || typeof b.last !== 'string' || !stepIds.has(b.first) || !stepIds.has(b.last)) continue
    // Dividers only in boxes that have them, one per step.
    const seen = new Set<string>()
    const elses = (canDivide(b.kind as SequenceBoxKind) && Array.isArray(b.elses) ? b.elses.slice(0, 20) : []).flatMap((e) => {
      if (!isObj(e) || typeof e.before !== 'string' || !stepIds.has(e.before) || seen.has(e.before)) return []
      seen.add(e.before)
      return [{ before: e.before, label: typeof e.label === 'string' ? e.label.slice(0, 200) : '' }]
    })
    boxes.push({ id: b.id, kind: b.kind as SequenceBoxKind, label: typeof b.label === 'string' ? b.label.slice(0, 200) : '', first: b.first, last: b.last, ...(elses.length ? { elses } : {}) })
  }
  const data: SequenceData = { lanes, steps, ...(raw.numbered === true ? { numbered: true as const } : {}) }
  // Boxes that don't fit (an end before their start, a divider outside) are dropped or trimmed, and
  // one crossing a box kept before it goes: boxes nest, never cross.
  const fitted = boxes.length ? restep({ ...data, boxes }, steps, (k) => k) : data
  const at = new Map(steps.map((s, k) => [s.id, k]))
  const kept: SequenceBox[] = []
  for (const b of fitted.boxes ?? []) if (!crossesBox({ ...fitted, boxes: kept }, at.get(b.first)!, at.get(b.last)!)) kept.push(b)
  const { boxes: _, ...rest } = fitted
  return kept.length ? { ...rest, boxes: kept } : rest
}
