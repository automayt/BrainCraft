/**
 * `window.BrainCraft`: the operations API bound to the open board, plus
 * read-only queries. Everything a batch of operations does is one undo step.
 */

import type { Editor } from '../editor/Editor'
import * as B from '../model/board'
import { center } from '../model/geom'
import { toMermaid } from '../model/mermaid'
import { toOutline } from '../model/mindmap'
import { objectLabel, plainNote } from '../model/notes'
import { search } from '../model/search'
import { toCsv } from '../model/table'
import type { Board, Id, Item, Kind } from '../model/types'
import { OPS, type Op, type OpResult, applyOps } from './ops'

export interface ObjectSummary {
  id: Id
  kind: Kind
  label: string
  x: number
  y: number
  w: number
  h: number
  commentCount: number
}

const summary = (i: Item): ObjectSummary => ({
  id: i.id,
  kind: i.kind,
  label: objectLabel(i),
  x: Math.round(i.x),
  y: Math.round(i.y),
  w: Math.round(i.w),
  h: Math.round(i.h),
  commentCount: i.notes?.length ?? 0,
})

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
    let results: OpResult[] = []
    this.editor.edit((b) => {
      const out = applyOps(b, list, { measure: this.editor.measure, origin: center(this.editor.visibleWorld) })
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

  /** The whole board as plain data (the same format as a downloaded file). */
  getBoard(): Board {
    return structuredClone(this.editor.board)
  }

  /** Every object, optionally of one kind. */
  list(kind?: Kind): ObjectSummary[] {
    return this.editor.board.items.filter((i) => !kind || i.kind === kind).map(summary)
  }

  /** One object with its content and comments. */
  get(id: Id): (ObjectSummary & { text: string; comments: { text: string; at: string; author?: string }[]; data?: unknown }) | null {
    const i = B.getItem(this.editor.board, id)
    if (!i) return null
    return {
      ...summary(i),
      text: i.text,
      comments: (i.notes ?? []).map((n) => ({ text: plainNote(n.text), at: new Date(n.at).toISOString(), ...(n.author ? { author: n.author } : {}) })),
      data: i.table ? { csv: toCsv(i.table) } : (i.kanban ?? i.timeline ?? (i.kind === 'mind' ? { outline: toOutline(this.editor.board, i.id) } : undefined)),
    }
  }

  /** Searches text, comments, cells, cards and labels. */
  find(query: string) {
    return search(this.editor.board, query).map((r) => ({ id: r.id, kind: r.kind, label: r.title, where: r.where, snippet: r.snippet }))
  }

  /** The selection's (or every flowchart's) Mermaid source. */
  exportMermaid(ids?: Id[]): string {
    return toMermaid(this.editor.board, ids ? new Set(ids) : undefined)
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
