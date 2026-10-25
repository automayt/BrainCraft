/**
 * Adding an embed line to a page is choosing to share what it shows, however it got there: picked,
 * pasted, typed or written by the assistant. So any embed in a page that the wiki has no copy of
 * yet gets one, from the board as this browser has it, for search, exports and friends who don't
 * have the board. (Reading a page never copies anything; only adding the line does.)
 */

import type { Editor } from '../../editor/Editor'
import { getSnap, makeSnap } from '../../model/embed'
import { embedKeys } from '../../model/markdown'
import { isWiki, pageText } from '../../model/wiki'
import type { Workspace } from '../../store/workspace'

/** Saves copies for embeds in `text` (by default, every page) that the wiki doesn't have yet. */
export function saveMissingCopies(ws: Workspace, editor: Editor, text?: string) {
  const b = editor.board
  if (editor.readOnly || !isWiki(b)) return
  const all = text ?? (b.pages ?? []).map((p) => pageText(b, p.id)).join('\n')
  for (const key of new Set(embedKeys(all))) {
    if (getSnap(editor.board, key)) continue
    const [board, item] = key.split('#')
    const meta = ws.findBoard(board)
    if (!meta) continue
    void ws.readBoard(board).then((source) => {
      if (!source || getSnap(editor.board, key) || editor.readOnly) return
      const s = makeSnap(source, board, item === undefined ? undefined : Number(item), meta.updated, editor.me)
      if (s) editor.keepSnap(s)
    })
  }
}
