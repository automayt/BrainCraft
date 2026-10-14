/**
 * Runbook mode: walking a flowchart one step at a time, as a procedure.
 * Decisions become choices, every step is timestamped, and finished runs are kept on the
 * flowchart's start shape so the board remembers how the procedure has gone.
 */

import { getItem } from './board'
import { plainNote } from './notes'
import { uid } from './uid'
import type { Board, Connector, Id, Item, RunRecord, RunStep } from './types'
import { flowShapeInfo } from './types'

export type { RunRecord, RunStep }

export interface RunOption {
  connector: Id
  to: Item
  /** The line's label ("Yes", "No"), or the next step's text when unlabelled. */
  label: string
  labelled: boolean
}

/** Runs kept per flowchart. */
export const RUNS_KEPT = 100

const isStep = (i: Item | undefined): i is Item => !!i && i.kind === 'flow'

/** Where you can go from a step: its outgoing lines to other flowchart shapes. */
export function options(b: Board, id: Id): RunOption[] {
  return b.connectors
    .filter((c) => c.from === id)
    .flatMap((c: Connector) => {
      const to = getItem(b, c.to)
      if (!isStep(to)) return []
      const label = c.label?.trim()
      return [{ connector: c.id, to, label: label || to.text.trim() || flowShapeInfo(to.shape).label, labelled: !!label }]
    })
}

/** Every flowchart shape linked to `id`, following lines either way. */
export function component(b: Board, id: Id): Set<Id> {
  const seen = new Set<Id>()
  const stack = [id]
  while (stack.length) {
    const at = stack.pop()!
    if (seen.has(at) || !isStep(getItem(b, at))) continue
    seen.add(at)
    for (const c of b.connectors) {
      if (c.from === at) stack.push(c.to)
      if (c.to === at) stack.push(c.from)
    }
  }
  return seen
}

/**
 * The shape a run of the flowchart containing `id` starts from: a start/end shape nothing
 * leads into, else any shape nothing leads into, else the topmost-leftmost shape (a pure loop).
 */
export function runStart(b: Board, id: Id): Id | null {
  const ids = component(b, id)
  if (!ids.size) return null
  const items = [...ids].map((x) => getItem(b, x)!).sort((a, z) => a.y - z.y || a.x - z.x)
  const hasIncoming = (x: Id) => b.connectors.some((c) => c.to === x && ids.has(c.from))
  return (
    items.find((i) => i.shape === 'terminator' && !hasIncoming(i.id))?.id ??
    items.find((i) => !hasIncoming(i.id))?.id ??
    items[0].id
  )
}

/** What a run shows for a step: the comments on that shape are its instructions. */
export function instructions(b: Board, id: Id): string[] {
  return (getItem(b, id)?.notes ?? []).map((n) => plainNote(n.text))
}

/** Keeps a finished run on the flowchart's start shape (newest last, oldest dropped past the limit). */
export function recordRun(b: Board, start: Id, run: RunRecord): Board {
  return {
    ...b,
    items: b.items.map((i) => (i.id === start ? { ...i, runs: [...(i.runs ?? []), run].slice(-RUNS_KEPT) } : i)),
  }
}

export function deleteRun(b: Board, start: Id, runId: string): Board {
  return {
    ...b,
    items: b.items.map((i) => (i.id === start && i.runs ? { ...i, runs: i.runs.filter((r) => r.id !== runId) } : i)),
  }
}

export function newRun(steps: RunStep[], status: RunRecord['status'], startedAt: number, endedAt: number, by?: string): RunRecord {
  return { id: uid(), startedAt, endedAt, status, steps, ...(by ? { by } : {}) }
}

/** The runs recorded for the flowchart containing `id`. */
export function runsOf(b: Board, id: Id): { start: Id; runs: RunRecord[] } | null {
  const start = runStart(b, id)
  if (start === null) return null
  return { start, runs: getItem(b, start)?.runs ?? [] }
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export interface RunStats {
  total: number
  finished: number
  /** Median time of finished runs. */
  typical?: number
  /** The route finished runs take most often, as step texts. */
  commonPath?: string[]
  commonPathShare?: number
}

export function runStats(runs: RunRecord[]): RunStats {
  const done = runs.filter((r) => r.status === 'done')
  const stats: RunStats = { total: runs.length, finished: done.length }
  if (!done.length) return stats
  const times = done.map((r) => r.endedAt - r.startedAt).sort((a, z) => a - z)
  stats.typical = times[Math.floor(times.length / 2)]
  const counts = new Map<string, { n: number; path: string[] }>()
  for (const r of done) {
    const path = r.steps.map((s) => s.text)
    const key = path.join('\u0000')
    const c = counts.get(key) ?? { n: 0, path }
    c.n++
    counts.set(key, c)
  }
  const best = [...counts.values()].sort((a, z) => z.n - a.n)[0]
  stats.commonPath = best.path
  stats.commonPathShare = best.n / done.length
  return stats
}

/** A run as a Markdown checklist, for pasting into tickets or chat. */
export function runToMarkdown(title: string, r: RunRecord): string {
  const when = new Date(r.startedAt).toLocaleString()
  const lines = [
    `## ${title} — ${r.status === 'done' ? 'completed' : 'stopped'}`,
    '',
    `Started ${when}${r.by ? ` by ${r.by}` : ''} · took ${formatDuration(r.endedAt - r.startedAt)}`,
    '',
  ]
  for (const s of r.steps) {
    const time = new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    lines.push(`- [x] ${s.text}${s.choice ? ` → **${s.choice}**` : ''} _(${time})_`)
    if (s.note) lines.push(`  - ${s.note.replace(/\n/g, '\n    ')}`)
  }
  return lines.join('\n')
}
