/**
 * Sequence diagrams: people and systems side by side (lanes), and the messages between them from
 * top to bottom (steps). The object's size follows from its contents, so it's laid out here, and
 * it goes in and out as Mermaid (`sequenceDiagram`).
 */

import type { SequenceData, SequenceLane, SequenceStep } from './types'

/** How far apart lanes are, and the height of the participants' boxes and of each step. */
export const LANE_W = 200
export const HEAD_H = 48
export const ROW_H = 56
/** Room above the boxes for the title, and below the last step (where the next one is written). */
export const TOP = 40
export const FOOT = 24

/** At most this many lanes and steps (from a paste or a peer). */
export const MAX_LANES = 30
export const MAX_STEPS = 400

export const newSequence = (names: string[] = ['Client', 'Server']): SequenceData => ({ lanes: names.map((name, k) => ({ id: `l${k + 1}`, name })), steps: [] })

/** The object's size: a lane's width each (two at least), and a row for each step plus one for the next. */
export function sequenceSize(d: SequenceData): { w: number; h: number } {
  return { w: Math.max(2, d.lanes.length) * LANE_W, h: TOP + HEAD_H + (d.steps.length + 1) * ROW_H + FOOT }
}

/** Where lane `k`'s line runs, from the object's left edge. */
export const laneX = (k: number) => LANE_W * (k + 0.5)
/** Where step `r`'s arrow is, from the object's top (r = steps.length is the next one). */
export const rowY = (r: number) => TOP + HEAD_H + ROW_H * (r + 0.6)

const nextId = (prefix: string, used: { id: string }[]) => {
  let n = used.length + 1
  const taken = new Set(used.map((u) => u.id))
  while (taken.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

export const laneIndex = (d: SequenceData, id: string) => d.lanes.findIndex((l) => l.id === id)

export function addLane(d: SequenceData, name: string, at = d.lanes.length): { data: SequenceData; id: string } {
  if (d.lanes.length >= MAX_LANES) return { data: d, id: d.lanes[d.lanes.length - 1]?.id ?? '' }
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

/** Takes a lane out, and every step to or from it. */
export const removeLane = (d: SequenceData, id: string): SequenceData => ({ ...d, lanes: d.lanes.filter((l) => l.id !== id), steps: d.steps.filter((s) => s.from !== id && s.to !== id) })

/** Moves a lane one place left (-1) or right (1). */
export function moveLane(d: SequenceData, id: string, by: -1 | 1): SequenceData {
  const k = laneIndex(d, id)
  const j = k + by
  if (k < 0 || j < 0 || j >= d.lanes.length) return d
  const lanes = [...d.lanes]
  ;[lanes[k], lanes[j]] = [lanes[j], lanes[k]]
  return { ...d, lanes }
}

export function addStep(d: SequenceData, step: Omit<SequenceStep, 'id'>, at = d.steps.length): { data: SequenceData; id: string } {
  if (d.steps.length >= MAX_STEPS) return { data: d, id: '' }
  const id = nextId('s', d.steps)
  const steps = [...d.steps]
  steps.splice(Math.max(0, Math.min(at, steps.length)), 0, { id, ...step })
  return { data: { ...d, steps }, id }
}

export const updateStep = (d: SequenceData, id: string, f: (s: SequenceStep) => SequenceStep): SequenceData => ({ ...d, steps: d.steps.map((s) => (s.id === id ? f(s) : s)) })

export const removeStep = (d: SequenceData, id: string): SequenceData => ({ ...d, steps: d.steps.filter((s) => s.id !== id) })

/** Moves a step one row up (-1) or down (1). */
export function moveStep(d: SequenceData, id: string, by: -1 | 1): SequenceData {
  const k = d.steps.findIndex((s) => s.id === id)
  const j = k + by
  if (k < 0 || j < 0 || j >= d.steps.length) return d
  const steps = [...d.steps]
  ;[steps[k], steps[j]] = [steps[j], steps[k]]
  return { ...d, steps }
}

/** The arrow styles, in the order Tab goes through them. */
export const STYLES: SequenceStep['style'][] = [undefined, 'reply', 'async']
export const STYLE_LABELS = ['Call', 'Reply', 'Message (no wait)'] as const

export const styleLabel = (s: SequenceStep['style']) => STYLE_LABELS[STYLES.indexOf(s)]

/**
 * The step to suggest next, so a diagram can be typed one message after another: after a call,
 * the answer back; after an answer, the answer to whoever is still waiting on that lane (if
 * anyone), or else a call on to the next lane.
 */
export function nextStep(d: SequenceData): Pick<SequenceStep, 'from' | 'to' | 'style'> {
  const ids = d.lanes.map((l) => l.id)
  const last = d.steps[d.steps.length - 1]
  if (!last || !ids.includes(last.from) || !ids.includes(last.to)) return { from: ids[0] ?? '', to: ids[1] ?? ids[0] ?? '' }
  if (!last.style && last.from !== last.to) return { from: last.to, to: last.from, style: 'reply' }
  // Calls still waiting for their answer.
  const open: SequenceStep[] = []
  for (const s of d.steps) {
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
  return [d.lanes.map((l) => l.name).join(', '), ...d.steps.map((s) => `${name.get(s.from) ?? '?'} → ${name.get(s.to) ?? '?'}: ${s.text}`)].join('\n')
}

// ----- Mermaid ------------------------------------------------------------------------------------

export const looksLikeSequence = (text: string) => /^\s*sequenceDiagram\b/.test(text.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('%%')) ?? '')

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

/**
 * A Mermaid sequence diagram: its participants (and actors), with `as` names, and its messages.
 * Notes, boxes, loops and the like are left out; `skipped` says how many lines were. Null if it
 * isn't one.
 */
export function parseSequence(text: string): { data: SequenceData; title: string; skipped: number } | null {
  if (!looksLikeSequence(text)) return null
  let data: SequenceData = { lanes: [], steps: [] }
  const byKey = new Map<string, string>()
  let title = ''
  let skipped = 0
  const lane = (key: string, label = key, actor = false) => {
    const known = byKey.get(key)
    if (known) {
      if (label !== key) data = renameLane(data, known, label)
      if (actor) data = setActor(data, known, true)
      return known
    }
    const made = addLane(data, label)
    data = actor ? setActor(made.data, made.id, true) : made.data
    byKey.set(key, made.id)
    return made.id
  }
  for (const raw of text.split(/\r?\n/).slice(text.split(/\r?\n/).findIndex((l) => looksLikeSequence(l)) + 1)) {
    const line = raw.trim()
    if (!line || line.startsWith('%%')) continue
    const p = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line)
    if (p) {
      lane(p[2].trim(), (p[3] ?? p[2]).trim(), p[1].toLowerCase() === 'actor')
      continue
    }
    if (/^autonumber\b/i.test(line)) {
      data = { ...data, numbered: true }
      continue
    }
    const t = /^title\s*:?\s*(.*)$/i.exec(line)
    if (t) {
      title = t[1].trim()
      continue
    }
    const m = STEP.exec(line)
    if (m) {
      const style = ARROWS.find(([a]) => a === m[2])![1]
      const from = lane(m[1].trim())
      const to = lane(m[3].trim())
      data = addStep(data, { from, to, text: m[4].trim().replace(/<br\s*\/?>/gi, ' '), ...(style ? { style } : {}) }).data
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
  return [
    'sequenceDiagram',
    ...(title.trim() ? [`  title ${clean(title)}`] : []),
    ...(d.numbered ? ['  autonumber'] : []),
    ...d.lanes.map((l) => `  ${l.actor ? 'actor' : 'participant'} ${key.get(l.id)} as ${clean(l.name) || key.get(l.id)}`),
    ...d.steps.filter((s) => key.has(s.from) && key.has(s.to)).map((s) => `  ${key.get(s.from)}${ARROW_OUT[s.style ?? 'call']}${key.get(s.to)}: ${clean(s.text)}`),
  ].join('\n')
}

// ----- checking data that arrives ---------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const ID = /^[\w-]{1,24}$/

/** A diagram from a file, the clipboard or a peer, checked: lanes and steps with known ids, short words. Null if unusable. */
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
    const style = s.style === 'reply' || s.style === 'async' ? s.style : undefined
    steps.push({ id: s.id, from: s.from, to: s.to, text: typeof s.text === 'string' ? s.text.slice(0, 500) : '', ...(style ? { style } : {}) })
  }
  return { lanes, steps, ...(raw.numbered === true ? { numbered: true as const } : {}) }
}
