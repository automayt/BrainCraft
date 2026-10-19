/**
 * Protected wiki pages: a page (and every page under it) that only people who manage the wiki may
 * change. On a server with accounts the server refuses anyone else's changes to them, live or
 * through the API; without accounts nobody "manages", so protection is a guard in the app that
 * anyone who can edit may lift.
 */

import type { Patch } from '../collab/patch'
import type { Board } from './types'
import { getPage, pagePath } from './wiki'

/** Whether a page, or a page above it, is protected. */
export function isProtected(b: Board, pageId: string | undefined): boolean {
  if (pageId === undefined || !getPage(b, pageId)) return false
  return pagePath(b, pageId).some((p) => p.protected)
}

/**
 * Why these changes (from someone who doesn't manage the wiki) would touch protected pages, or
 * null when they don't. Embed copies are fine: they follow boards, not anyone's writing.
 */
export function protectedChange(b: Board, patches: Patch[]): string | null {
  for (const p of patches) {
    if (p.k === 'page') {
      const was = getPage(b, p.id)
      if (was && isProtected(b, p.id)) return `“${was.title}” is protected: only people who manage this wiki can change it`
      if (p.v?.protected && !was?.protected) return 'Only people who manage this wiki can protect pages'
      if (p.v && isProtected(b, p.v.parent)) return `Pages under “${getPage(b, p.v.parent!)?.title}” are protected: only people who manage this wiki can add or move them there`
    } else if (p.k === 'body' || (p.k === 'rev' && p.v)) {
      const page = p.k === 'body' ? p.id : p.v!.page
      // A version already kept may get a note or a mark; a new one is a change to the page.
      if (p.k === 'rev' && (b.revs ?? []).some((r) => r.id === p.id)) continue
      if (isProtected(b, page)) return `“${getPage(b, page)?.title}” is protected: only people who manage this wiki can change it`
    }
  }
  return null
}
