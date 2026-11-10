/**
 * Meeting notes: while a meeting is heard, the assistant takes notes on the board, and when it
 * ends everything the meeting made goes into one frame, titled for what it was about.
 */

import * as B from './board'
import type { Board, Id } from './types'

/**
 * What a meeting made: the objects that weren't on the board when it started, apart from ideas
 * added to a mind map that was there before (the map stays where it is, outside the frame).
 */
export function meetingItems(b: Board, before: ReadonlySet<Id>): Id[] {
  const hidden = B.hiddenIds(b)
  return b.items
    .filter((i) => {
      if (before.has(i.id) || hidden.has(i.id)) return false
      if (i.kind === 'mind' && i.parent !== undefined) {
        const root = B.rootOf(b, i.id)
        if (root && before.has(root.id)) return false
      }
      return true
    })
    .map((i) => i.id)
}

/** The title the assistant gave the meeting in its last words ("Title: Q3 launch plan"), if it gave one. */
export function meetingTitle(reply: string): string | null {
  const m = /^[\s>*_#-]*title\s*[:：]\s*(.+)$/im.exec(reply)
  if (!m) return null
  const t = m[1]
    .replace(/[*_`#"“”]+/g, '')
    .trim()
    .replace(/[.。]$/, '')
    .slice(0, 80)
    .trim()
  return t || null
}

/** A title for a meeting the assistant didn't name. */
export function untitledMeeting(at: number, locale?: string): string {
  return `Meeting, ${new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
}
