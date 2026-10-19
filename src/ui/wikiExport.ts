/**
 * The wiki as a web page from the app: the same page the server makes (model/wikiHtml.ts), with
 * pictures of the canvas objects its pages show, drawn the way the board looks in the light theme.
 * Printing it gives a handbook, each page on its own sheet.
 */

import type { Editor as EditorType } from '../editor/Editor'
import { maskFor } from '../model/brainstorm'
import { embedBoard, getSnap, snapBoard } from '../model/embed'
import { embedKeys } from '../model/markdown'
import type { Board } from '../model/types'
import { wikiHtml } from '../model/wikiHtml'
import type { Workspace } from '../store/workspace'

const dataUrl = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result))
    r.onerror = () => fail(r.error)
    r.readAsDataURL(blob)
  })

/** A picture of each embedded object the pages show (from the board when it's here, else the wiki's copy). */
async function pictures(ws: Workspace, editor: EditorType, wiki: Board, pages?: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const { boardSvg, pngOf } = await import('./imageExport')
  const { Editor } = await import('../editor/Editor')
  const wanted = pages ? new Set(pages) : null
  const keys = new Set((wiki.bodies ?? []).filter((x) => !wanted || wanted.has(x.id)).flatMap((x) => embedKeys(x.text)))
  for (const key of keys) {
    const [board, item] = key.split('#')
    try {
      const source = ws.findBoard(board) ? await ws.readBoard(board) : null
      const part = source ? embedBoard(maskFor(source, ''), item === undefined ? undefined : Number(item)) : (() => {
        const snap = getSnap(wiki, key)
        return snap ? snapBoard(snap) : null
      })()
      if (!part?.items.length) continue
      const pic = await boardSvg(new Editor(part, editor.measure), { theme: 'light' })
      if (pic) out.set(key, await dataUrl(await pngOf(pic)))
    } catch {
      // That picture is left out; the page still says what was there.
    }
  }
  return out
}

/** The wiki (or the chosen pages) as one web page, pictures included. */
export async function wikiPage(ws: Workspace, editor: EditorType, wiki: Board, pages?: string[]): Promise<string> {
  return wikiHtml(wiki, { pages, webLink: (to) => ws.linkTo(to), pictures: await pictures(ws, editor, wiki, pages) })
}

/** Prints the web page (the browser offers saving it as a PDF), from a frame nobody sees. */
export function printHtml(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  frame.srcdoc = html
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    // Long enough for the print dialog to have taken its copy.
    setTimeout(() => frame.remove(), 60_000)
  }
  document.body.append(frame)
}
