/**
 * Status marks: where any object stands (to do, in progress, waiting,
 * undecided, done, dropped). Each status has a colour and an icon; mind-map
 * branches count how much of them is done.
 */

import { getItem, updateItem } from './board'
import { type Board, type Id, type Item, type Kind, type Status, isWidget } from './types'

export interface StatusInfo {
  id: Status
  label: string
  color: string
  /** An SVG path on a 0–16 grid, drawn in white on the status colour. */
  icon: string
}

export const STATUSES: readonly StatusInfo[] = [
  { id: 'todo', label: 'To do', color: '#8a909c', icon: 'M8 4.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7' },
  { id: 'doing', label: 'In progress', color: '#3b82f6', icon: 'M8 3v5l3.5 2' },
  { id: 'waiting', label: 'Waiting', color: '#d99a06', icon: 'M6 4.5v7M10 4.5v7' },
  { id: 'undecided', label: 'Undecided', color: '#8b5cf6', icon: 'M5.8 6a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4M8 12.2v.3' },
  { id: 'done', label: 'Done', color: '#16a34a', icon: 'M4 8.5l2.7 2.7L12 5.6' },
  { id: 'dropped', label: 'Dropped', color: '#dc2626', icon: 'M5 5l6 6M11 5l-6 6' },
]

const BY_ID = new Map(STATUSES.map((s) => [s.id, s]))

/** The status's details, or undefined for anything that isn't one (a hand-edited file, say). */
export const statusInfo = (s: unknown): StatusInfo | undefined => (typeof s === 'string' ? BY_ID.get(s as Status) : undefined)

/** Finds a status by id or name, ignoring case ("done", "In progress", "in-progress"). */
export function parseStatus(s: string): Status | undefined {
  const k = s.trim().toLowerCase().replace(/[\s_-]+/g, '')
  return STATUSES.find((x) => x.id === k || x.label.toLowerCase().replace(/\s+/g, '') === k)?.id
}

/** Objects that can carry a status: not drawings, frames or the data widgets. */
export const canHaveStatus = (k: Kind) => k !== 'pen' && k !== 'frame' && !isWidget(k)

/** Sets (or, with null, clears) the status of the objects that can have one. */
export function setStatus(b: Board, ids: Iterable<Id>, status: Status | null): Board {
  for (const id of ids) {
    const item = getItem(b, id)
    if (!item || !canHaveStatus(item.kind) || (item.status ?? null) === status) continue
    b = updateItem(b, id, (i) => {
      const next: Item = { ...i }
      if (status) next.status = status
      else delete next.status
      return next
    })
  }
  return b
}

/** How many objects have each status, in the statuses' order (only those in use). */
export function statusCounts(b: Board): { info: StatusInfo; count: number }[] {
  const counts = new Map<Status, number>()
  for (const i of b.items) {
    const s = statusInfo(i.status)
    if (s) counts.set(s.id, (counts.get(s.id) ?? 0) + 1)
  }
  return STATUSES.filter((s) => counts.has(s.id)).map((info) => ({ info, count: counts.get(info.id)! }))
}

/**
 * How far along a mind-map idea's branch is: of the ideas under it that have a
 * status (dropped ones aside), how many are done. Null when none have one.
 */
export function branchProgress(b: Board, id: Id): { done: number; total: number } | null {
  const kids = new Map<Id, Item[]>()
  for (const i of b.items) if (i.parent !== undefined) (kids.get(i.parent) ?? kids.set(i.parent, []).get(i.parent)!).push(i)
  let done = 0
  let total = 0
  const walk = (at: Id) => {
    for (const k of kids.get(at) ?? []) {
      const s = statusInfo(k.status)?.id
      if (s && s !== 'dropped') {
        total++
        if (s === 'done') done++
      }
      walk(k.id)
    }
  }
  walk(id)
  return total ? { done, total } : null
}
