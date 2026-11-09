/**
 * Each person's categories for the boards they can open ("Webex meetings", "Trips"): theirs alone,
 * so sorting your list never moves anyone else's. Kept in `DATA/accounts/categories.json` as
 * person → board → category.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The longest name a category may have. */
export const CATEGORY_MAX = 60
/** Boards one person may have in categories (anything beyond is simply not kept). */
const PER_PERSON = 5000

/** A category name as it's kept: one line, trimmed and not too long; null for none. */
export function cleanCategory(v: unknown): string | null | undefined {
  if (v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CATEGORY_MAX)
  return t || null
}

export class Categories {
  private file: string
  private data: Record<string, Record<string, string>>
  private timer: NodeJS.Timeout | undefined

  constructor(dir: string) {
    this.file = join(dir, 'categories.json')
    let read: Record<string, Record<string, string>> = {}
    try {
      if (existsSync(this.file)) read = JSON.parse(readFileSync(this.file, 'utf8')) as typeof read
    } catch {
      // Unreadable: start again; boards are only uncategorised.
    }
    this.data = read && typeof read === 'object' ? read : {}
  }

  of(user: string): Readonly<Record<string, string>> {
    return this.data[user] ?? {}
  }

  /** Puts a board in a category, or (null) in none. False when the person has too many. */
  set(user: string, board: string, category: string | null): boolean {
    const mine = { ...(this.data[user] ?? {}) }
    if (category === null) delete mine[board]
    else {
      if (!(board in mine) && Object.keys(mine).length >= PER_PERSON) return false
      mine[board] = category
    }
    this.data[user] = mine
    this.save()
    return true
  }

  /** Renames a category for one person (or, with null, takes its boards out of it). */
  rename(user: string, from: string, to: string | null) {
    const mine = { ...(this.data[user] ?? {}) }
    for (const [board, c] of Object.entries(mine)) {
      if (c !== from) continue
      if (to === null) delete mine[board]
      else mine[board] = to
    }
    this.data[user] = mine
    this.save()
  }

  /** Forgets a board that's gone. */
  forget(board: string) {
    let changed = false
    for (const mine of Object.values(this.data))
      if (board in mine) {
        delete mine[board]
        changed = true
      }
    if (changed) this.save()
  }

  private save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 1000)
    this.timer.unref?.()
  }

  flush() {
    clearTimeout(this.timer)
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }
}
