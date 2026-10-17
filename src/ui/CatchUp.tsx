/** "Since you were here": the news banner, and the changes highlighted on the board. */

import type { Editor } from '../editor/Editor'
import * as B from '../model/board'
import { catchUpSummary, catchUpText } from '../model/catchup'
import { objectLabel } from '../model/notes'
import { timeAgo } from './Boards'
import { useEditor } from './useEditor'

export function CatchUpBanner() {
  const editor = useEditor()
  const c = editor.catchUp
  if (!c) return null
  const rows = [
    ...c.added.map((id) => ({ id, what: 'New' })),
    ...c.changed.map((id) => ({ id, what: 'Changed' })),
    ...c.comments.map((x) => ({ id: x.id, what: `${x.count} comment${x.count === 1 ? '' : 's'}` })),
  ].filter((r) => B.getItem(editor.board, r.id))
  return (
    <div className="catchup no-canvas" role="status">
      <div className="catchup-head">
        <span className="catchup-spark" aria-hidden="true">
          ✦
        </span>
        <span className="catchup-msg">
          <strong>Since you were here</strong> <small>({timeAgo(c.since)})</small>: {catchUpSummary(c)}
        </span>
        <span className="catchup-actions">
          <button className="primary" onClick={() => editor.showCatchUp()}>
            {editor.showingCatchUp ? 'Hide' : 'Show me'}
          </button>
          <button
            title="Ask the AI assistant for a short summary"
            onClick={() => editor.askAi(`Summarise in a few bullets what changed on this board since I last looked, linking each object:\n\n${catchUpText(c, editor.board)}`, undefined, 'What changed since I was last here?')}
          >
            Summarise with AI
          </button>
          <button className="icon-close" aria-label="Dismiss" title="Got it" onClick={() => editor.dismissCatchUp()}>
            ×
          </button>
        </span>
      </div>
      {editor.showingCatchUp && (
        <ul className="catchup-list">
          {rows.slice(0, 12).map((r) => (
            <li key={`${r.what}${r.id}`}>
              <button onClick={() => editor.focusObject(r.id)}>
                <span className={`catchup-tag ${r.what === 'New' ? 'new' : r.what === 'Changed' ? 'changed' : 'comment'}`}>{r.what}</span>
                {objectLabel(B.getItem(editor.board, r.id)!)}
              </button>
            </li>
          ))}
          {c.removed.slice(0, 6).map((i) => (
            <li key={`r${i.id}`}>
              <span className="catchup-row">
                <span className="catchup-tag removed">Removed</span>
                {objectLabel(i)}
              </span>
            </li>
          ))}
          {rows.length + c.removed.length > 18 && <li className="muted">…and more</li>}
        </ul>
      )}
    </div>
  )
}

/** Green for new, blue for changed, red crosses for removed: drawn in board space. */
export function CatchUpOverlay({ editor }: { editor: Editor }) {
  const c = editor.catchUp
  if (!c || !editor.showingCatchUp) return null
  const z = editor.camera.zoom
  const sw = 2.5 / z
  const pad = 6 / z
  const box = (id: number, cls: string) => {
    const i = B.getItem(editor.board, id)
    if (!i || editor.hidden.has(id)) return null
    const r = B.itemBounds(i)
    return <rect key={`${cls}${id}`} className={cls} x={r.x - pad} y={r.y - pad} width={r.w + 2 * pad} height={r.h + 2 * pad} rx={8 / z} strokeWidth={sw} />
  }
  return (
    <g className="catchup-overlay" style={{ pointerEvents: 'none' }}>
      {c.added.map((id) => box(id, 'cu-added'))}
      {c.changed.map((id) => box(id, 'cu-changed'))}
      {c.comments.filter((x) => !c.added.includes(x.id) && !c.changed.includes(x.id)).map((x) => box(x.id, 'cu-changed'))}
      {c.removed.map((i) => (
        <g key={`x${i.id}`} className="cu-removed">
          <rect x={i.x} y={i.y} width={i.w} height={i.h} rx={6 / z} strokeWidth={sw} strokeDasharray={`${6 / z} ${4 / z}`} />
          <path d={`M${i.x} ${i.y}L${i.x + i.w} ${i.y + i.h}M${i.x + i.w} ${i.y}L${i.x} ${i.y + i.h}`} strokeWidth={sw} />
        </g>
      ))}
    </g>
  )
}
