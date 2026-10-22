/** Following an object's link: a wiki page opens beside the board, a board or object opens, a web address opens in a new tab. */

import type { Editor } from '../editor/Editor'
import type { ItemLink } from '../model/itemLink'
import { isWiki } from '../model/wiki'
import type { Workspace } from '../store/workspace'

export function followLink(ws: Workspace, editor: Editor, l: ItemLink) {
  if (l.url) {
    window.open(l.url, '_blank', 'noopener,noreferrer')
    return
  }
  if (l.page !== undefined) {
    // A page of the open wiki opens right here; a page of another wiki opens beside the board.
    if (!l.board || ws.selfKeys.includes(l.board)) {
      if (isWiki(editor.board)) editor.openPage(l.page, l.heading ?? null)
      else editor.setStatus('That page’s wiki isn’t known here')
      return
    }
    editor.peekPage({ board: l.board, page: l.page, ...(l.heading ? { heading: l.heading } : {}) })
    return
  }
  void ws.openLink({ ...(l.board ? { board: l.board } : {}), ...(l.item !== undefined ? { item: l.item } : {}) })
}
