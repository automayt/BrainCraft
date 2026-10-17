/**
 * Fills in link cards: asks the BrainCraft server for the title, description and
 * picture of every card that hasn't had a preview looked for yet. Without a
 * server, cards keep their address and site name (players still work).
 */

import type { Editor } from '../editor/Editor'
import { getItem } from '../model/board'
import type { Board, Id, LinkCard } from '../model/types'

const AT_ONCE = 3
const RETRY_AFTER = 30_000

type Answer = Partial<LinkCard> | 'retry' | 'unsupported'

async function ask(server: string, url: string): Promise<Answer> {
  try {
    const res = await fetch(new URL(`api/unfurl?url=${encodeURIComponent(url)}`, server))
    // An older server without previews.
    if (res.status === 404) return 'unsupported'
    // The page couldn't be read: the card stays as it is, and isn't asked about again.
    if (res.status === 422) return {}
    if (!res.ok) return 'retry'
    const p = (await res.json()) as Record<string, unknown>
    const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)
    const out: Partial<LinkCard> = {}
    const title = str(p.title, 200)
    const description = str(p.description, 300)
    const image = str(p.image, 2048)
    const site = str(p.site, 80)
    if (title) out.title = title
    if (description) out.description = description
    if (image) out.image = image
    if (site) out.site = site
    return out
  } catch {
    return 'retry'
  }
}

/** Starts watching; returns a function that stops. */
export function watchLinkPreviews(editor: Editor, server: () => string | null, subscribeServer: (fn: () => void) => () => void): () => void {
  const asked = new Set<string>()
  const queue: { id: Id; url: string; key: string }[] = []
  let running = 0
  let unsupported = false
  let last: Board | null = null
  let stopped = false

  const pump = () => {
    const base = server()
    while (!stopped && base && running < AT_ONCE && queue.length) {
      const job = queue.shift()!
      running++
      void ask(base, job.url).then((answer) => {
        running--
        if (stopped) return
        if (answer === 'unsupported') unsupported = true
        else if (answer === 'retry') setTimeout(() => asked.delete(job.key), RETRY_AFTER)
        else {
          // Only if the card is still there, still for this address, and nobody filled it meanwhile.
          const now = getItem(editor.board, job.id)?.link
          if (now && now.url === job.url && !now.checked) editor.fillLink(job.id, answer)
        }
        pump()
      })
    }
  }

  const check = () => {
    const b = editor.board
    if (stopped || unsupported || editor.readOnly || b === last || !server()) return
    last = b
    for (const i of b.items) {
      if (i.kind !== 'link' || !i.link || i.link.checked) continue
      const key = `${i.id} ${i.link.url}`
      if (asked.has(key)) continue
      asked.add(key)
      queue.push({ id: i.id, url: i.link.url, key })
    }
    pump()
  }

  const offEditor = editor.subscribe(check)
  const offServer = subscribeServer(() => {
    last = null
    check()
  })
  check()
  return () => {
    stopped = true
    offEditor()
    offServer()
  }
}
