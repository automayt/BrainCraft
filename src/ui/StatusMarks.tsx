/** Status badges on objects, and done-counts on mind-map branches, drawn over the board. */

import type { Editor } from '../editor/Editor'
import { branchProgress, statusInfo } from '../model/status'

/** Readable when zoomed out (up to 3x), without growing when zoomed in. */
const scaleFor = (zoom: number) => Math.min(3, Math.max(1, 1 / zoom))

export function StatusMarks({ editor }: { editor: Editor }) {
  const { board, hidden } = editor
  const marked = board.items.filter((i) => statusInfo(i.status) && !hidden.has(i.id))
  if (!marked.length) return null
  const k = scaleFor(editor.camera.zoom)
  // Ideas with marked ideas under them show how much of their branch is done.
  const parents = new Set<number>()
  for (const i of marked) {
    for (let p = i.parent; p !== undefined; ) {
      if (parents.has(p)) break
      parents.add(p)
      p = board.items.find((x) => x.id === p)?.parent
    }
  }
  const dim = (status: string | undefined) => editor.statusFilter !== null && status !== editor.statusFilter
  return (
    <g className="status-marks">
      {marked.map((i) => {
        const s = statusInfo(i.status)!
        const size = 20 * k
        return (
          <g key={i.id} className={`status-badge${dim(s.id) ? ' dimmed' : ''}`} transform={`translate(${i.x - size * 0.35} ${i.y - size * 0.35}) scale(${k})`}>
            <title>{s.label}</title>
            <circle cx="10" cy="10" r="10" style={{ fill: s.color }} />
            <g transform="translate(2 2)">
              <path d={s.icon} />
            </g>
          </g>
        )
      })}
      {[...parents].map((id) => {
        const node = board.items.find((x) => x.id === id)
        if (!node || hidden.has(id)) return null
        const p = branchProgress(board, id)
        if (!p) return null
        const label = `${p.done}/${p.total}`
        const w = (14 + label.length * 7) * k
        const h = 18 * k
        const all = p.done === p.total
        return (
          <g key={`p${id}`} className={`branch-progress${all ? ' all-done' : ''}${editor.statusFilter ? ' dimmed' : ''}`}>
            <title>{`${p.done} of ${p.total} ideas in this branch done`}</title>
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
