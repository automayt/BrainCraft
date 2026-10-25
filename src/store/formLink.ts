/**
 * Links to shared forms: `<server>/?form=<board>/<view>` opens just the form, for someone who
 * never opens the board. On a server with accounts the form asks them to sign in first, and the
 * link is kept for the tab so signing in (single sign-on included) comes back to it.
 */

const AFTER = 'braincraft:after-signin'

/** The board and view a form link names. */
export function formOfSearch(search: string): { board: string; item: number } | null {
  const m = /[?&]form=([\w-]{1,64})(?:\/|%2F)(\d{1,9})(?:&|$)/i.exec(search)
  return m ? { board: m[1], item: Number(m[2]) } : null
}

export const formLink = (server: string, board: string, item: number) => new URL(`?form=${encodeURIComponent(board)}/${item}`, server.endsWith('/') ? server : `${server}/`).href

/** Remembers where to come back to once signed in (this tab only). */
export function returnAfterSignIn(href: string) {
  try {
    sessionStorage.setItem(AFTER, href)
  } catch {
    // Without storage, signing in just opens the app.
  }
}

/** The page to go back to after signing in, if one is waiting (forgotten once read). */
export function takeReturn(): string | null {
  try {
    const href = sessionStorage.getItem(AFTER)
    sessionStorage.removeItem(AFTER)
    // Only this app's own form links.
    return href && typeof location !== 'undefined' && new URL(href, location.href).origin === location.origin && formOfSearch(new URL(href).search) ? href : null
  } catch {
    return null
  }
}
