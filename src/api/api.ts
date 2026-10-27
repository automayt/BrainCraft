/**
 * `window.BrainCraft`: the operations API bound to the open board, plus
 * read-only queries. Everything a batch of operations does is one undo step.
 */

import type { Editor } from '../editor/Editor'
import * as B from '../model/board'
import { center } from '../model/geom'
import type { Board, Id, Kind } from '../model/types'
import { OPS, type Op, OpError, type OpResult, applyOps, maskedIds } from './ops'
import { type ObjectDetail, type ObjectSummary, findObjects, getObject, listObjects, mermaidOf } from './queries'

export type { ObjectSummary }

export class BrainCraftAPI {
  readonly version = 1
  readonly operations = OPS
  private editor: Editor

  constructor(editor: Editor) {
    this.editor = editor
  }

  /** Applies a batch of operations as one undo step. Throws (changing nothing) if any is invalid. */
  apply(ops: Op[] | Op): OpResult[] {
    const list = Array.isArray(ops) ? ops : [ops]
    // Otherwise the change would be dropped while reporting new ids as if it had worked.
    if (this.editor.readOnly) throw new OpError('This board can’t be changed right now (it’s view-only, being presented, or running a flowchart)')
    let results: OpResult[] = []
    this.editor.edit((b) => {
      const out = applyOps(b, list, { measure: this.editor.measure, origin: center(this.editor.visibleWorld), protect: maskedIds(this.editor.viewBoard), who: this.editor.person })
      results = out.results
      return out.board
    })
    const created = results.flatMap((r) => r.ids ?? (r.id !== undefined && r.op.startsWith('create') ? [r.id] : []))
    if (created.length) {
      this.editor.select(created.filter((id) => B.getItem(this.editor.board, id)))
      this.editor.zoomToFit()
    }
    return results
  }

  /** The whole board as plain data (the same format as a downloaded file), as this person may see it. */
  getBoard(): Board {
    return structuredClone(this.editor.viewBoard)
  }

  /** Every object, optionally of one kind. */
  list(kind?: Kind): ObjectSummary[] {
    return listObjects(this.editor.viewBoard, kind)
  }

  /** One object with its content and comments. */
  get(id: Id): ObjectDetail | null {
    return getObject(this.editor.viewBoard, id)
  }

  /** Searches text, comments, cells, cards and labels. */
  find(query: string) {
    return findObjects(this.editor.viewBoard, query)
  }

  /** The selection's (or every flowchart's) Mermaid source. */
  exportMermaid(ids?: Id[]): string {
    return mermaidOf(this.editor.viewBoard, ids)
  }

  select(ids: Id[]) {
    this.editor.select(ids.filter((id) => B.getItem(this.editor.board, id)))
  }

  zoomTo(ids?: Id[]) {
    if (ids) this.select(ids)
    this.editor.zoomToFit()
  }

  get selection(): Id[] {
    return [...this.editor.selection]
  }
}
