/** Status badges on objects, and done-counts on mind-map branches, drawn over the board. */

import type { Editor } from '../editor/Editor'
import { getItem } from '../model/board'
import { branchProgress, statusInfo } from '../model/status'
import type { Board, Id, Item } from '../model/types'

/** Readable when zoomed out (up to 3x), without growing when zoomed in. */
const scaleFor = (zoom: number) => Math.min(3, Math.max(1, 1 / zoom))

interface Marks {
  marked: Item[]
  progress: { node: Item; done: number; total: number }[]
}

// Worked out once per board, not on every pan and zoom.
const cache = new WeakMap<Board, Marks>()

function marksOf(board: Board, hidden: ReadonlySet<Id>): Marks {
  const hit = cache.get(board)
  if (hit) return hit
  const marked = board.items.filter((i) => statusInfo(i.status) && !hidden.has(i.id))
  // Ideas with marked ideas under them show how much of their branch is done.
  const parents = new Set<Id>()
  for (const i of marked) {
    for (let p = i.parent; p !== undefined; ) {
      if (parents.has(p)) break
      parents.add(p)
      p = getItem(board, p)?.parent
    }
  }
  const progress: Marks['progress'] = []
  for (const id of parents) {
    const node = getItem(board, id)
    const p = node && !hidden.has(id) ? branchProgress(board, id) : null
    if (node && p) progress.push({ node, ...p })
  }
  const out = { marked, progress }
  cache.set(board, out)
  return out
}

/** `board` and `zoom` override the editor's (image export draws a part of the board at full size). */
export function StatusMarks({ editor, board = editor.board, zoom = editor.camera.zoom }: { editor: Editor; board?: Board; zoom?: number }) {
  const { marked, progress } = marksOf(board, editor.hidden)
  if (!marked.length) return null
  const k = scaleFor(zoom)
  const dim = (status: string | undefined) => board === editor.board && editor.statusFilter !== null && status !== editor.statusFilter
  return (
    <g className="status-marks">
      {marked.map((i) => {
        const s = statusInfo(i.status)!
        // Just inside the top-left corner (clear of the resize handle); ideas are small, so theirs sits outside.
        const x = i.kind === 'mind' ? i.x - 24 * k : i.x + 4 * k
        const y = i.kind === 'mind' ? i.y + i.h / 2 - 10 * k : i.y + 4 * k
        return (
          <g key={i.id} className={`status-badge${dim(s.id) ? ' dimmed' : ''}`} transform={`translate(${x} ${y}) scale(${k})`}>
            <title>{s.label}</title>
            <circle cx="10" cy="10" r="10" style={{ fill: s.color }} />
            <g transform="translate(2 2)">
              <path d={s.icon} />
            </g>
          </g>
        )
      })}
      {progress.map(({ node, done, total }) => {
        const label = `${done}/${total}`
        const w = (14 + label.length * 7) * k
        const h = 18 * k
        const all = done === total
        return (
          <g key={`p${node.id}`} className={`branch-progress${all ? ' all-done' : ''}${editor.statusFilter ? ' dimmed' : ''}`}>
            <title>{`${done} of ${total} marked ideas in this branch done`}</title>
            <rect x={node.x + node.w - w + 6 * k} y={node.y + node.h - h / 2} width={w} height={h} rx={h / 2} strokeWidth={1.2 * k} />
            <text x={node.x + node.w - w / 2 + 6 * k} y={node.y + node.h + 4.5 * k} fontSize={11.5 * k} textAnchor="middle">
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}
