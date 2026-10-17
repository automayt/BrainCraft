/**
 * Boards arrive from files, share links and other people in live sessions, so
 * their newer optional fields are checked before anything draws them: wrong
 * types are dropped and long strings cut, rather than crashing every viewer.
 */

import type { Patch } from '../collab/patch'
import type { Board, Item, LinkCard, Status } from './types'

const STATUSES: readonly Status[] = ['todo', 'doing', 'waiting', 'undecided', 'done', 'dropped']

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function cleanLink(v: unknown): LinkCard | undefined {
  if (!v || typeof v !== 'object') return undefined
  const l = v as Record<string, unknown>
  const url = str(l.url, 2048)
  if (!url) return undefined
  const out: LinkCard = { url }
  const title = str(l.title, 300)
  const description = str(l.description, 500)
  const image = str(l.image, 2048)
  const site = str(l.site, 120)
  if (title) out.title = title
  if (description) out.description = description
  if (image) out.image = image
  if (site) out.site = site
  if (l.checked === true) out.checked = true
  return out
}

/** The item with its optional newer fields checked (null if it can't be used at all). */
export function cleanItem(i: Item): Item | null {
  const out: Item = { ...i }
  const drop = (k: keyof Item) => delete out[k]
  if (out.kind === 'link') {
    const link = cleanLink(out.link)
    if (!link) return null
    out.link = link
  } else if ('link' in out) drop('link')
  if (out.status !== undefined && !STATUSES.includes(out.status)) drop('status')
  for (const k of ['by', 'hiddenBy'] as const) {
    const v = str(out[k], 60)
    if (v) out[k] = v
    else if (k in out) drop(k)
  }
  if (out.hiddenRound !== undefined && num(out.hiddenRound) === undefined) drop('hiddenRound')
  if (out.back !== undefined && typeof out.back !== 'string') drop('back')
  if (out.flipped !== undefined && typeof out.flipped !== 'boolean') drop('flipped')
  if (out.lang !== undefined && typeof out.lang !== 'string') drop('lang')
  if ('masked' in out) drop('masked')
  if (out.brainstorm !== undefined) {
    const b = out.brainstorm as unknown as Record<string, unknown>
    if (!b || typeof b !== 'object') drop('brainstorm')
    else out.brainstorm = { by: str(b.by, 60) ?? '', ...(b.revealed === true ? { revealed: true } : {}) }
  }
  if (out.wheel !== undefined) {
    const w = out.wheel as unknown as Record<string, unknown>
    if (!w || typeof w !== 'object') drop('wheel')
    else {
      const s = w.spin as Record<string, unknown> | undefined
      const spin = s && typeof s === 'object' ? { at: num(s.at), from: num(s.from), to: num(s.to), result: num(s.result) } : undefined
      const label = s && typeof s === 'object' ? str(s.label, 200) : undefined
      out.wheel =
        spin && spin.at !== undefined && spin.from !== undefined && spin.to !== undefined && spin.result !== undefined
          ? { spin: { at: spin.at, from: spin.from, to: spin.to, result: Math.max(0, Math.floor(spin.result)), ...(label ? { label } : {}) } }
          : {}
    }
  }
  if (out.timeline) {
    out.timeline = {
      ...out.timeline,
      entries: Array.isArray(out.timeline.entries)
        ? out.timeline.entries.map((e) => (e.after === undefined || (Array.isArray(e.after) && e.after.every((x) => typeof x === 'string')) ? e : { ...e, after: undefined }))
        : [],
    }
  }
  if (out.view && out.view.month !== undefined && !(typeof out.view.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(out.view.month))) {
    const view = { ...out.view }
    delete view.month
    out.view = view
  }
  return out
}

/** A board icon worth keeping: a short string. */
export const cleanIcon = (v: unknown): string | undefined => (typeof v === 'string' && v && v.length <= 16 ? v : undefined)

/** The board with every item checked and the icon validated. */
export function cleanBoard(b: Board): Board {
  const items = b.items.map(cleanItem).filter((i): i is Item => !!i)
  const out: Board = { ...b, items }
  const icon = cleanIcon(b.icon)
  if (icon) out.icon = icon
  else delete out.icon
  return out
}

/** Live-session patches with their items checked the same way (patches that can't be used are dropped). */
export function cleanPatches(patches: readonly Patch[]): Patch[] {
  const out: Patch[] = []
  for (const p of patches) {
    if (!p || typeof p !== 'object') continue
    if (p.k === 'item') {
      if (p.v === null) out.push(p)
      else if (p.v && typeof p.v === 'object') {
        const v = cleanItem(p.v)
        if (v) out.push({ ...p, v })
      }
    } else if (p.k === 'icon') out.push({ k: 'icon', v: cleanIcon(p.v) ?? null })
    else out.push(p)
  }
  return out
}
