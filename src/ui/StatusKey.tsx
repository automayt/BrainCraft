import { statusCounts } from '../model/status'
import { StatusDot } from './SelectionToolbar'
import { useEditor } from './useEditor'

/** The board's status key: how many objects have each status. Click one to dim everything else. */
export function StatusKey() {
  const editor = useEditor()
  if (editor.presenting) return null
  const counts = statusCounts(editor.board)
  if (!counts.length) return null
  const filter = editor.statusFilter
  return (
    <div className={`status-key no-canvas${editor.hint ? ' above-hint' : ''}`} role="toolbar" aria-label="Status key" onPointerDown={(e) => e.stopPropagation()}>
      {counts.map(({ info, count }) => (
        <button
          key={info.id}
          aria-pressed={filter === info.id}
          className={filter === info.id ? 'on' : filter ? 'off' : ''}
          title={filter === info.id ? 'Show everything again' : `Show only what's ${info.label.toLowerCase()}`}
          onClick={() => editor.setStatusFilter(info.id)}
        >
          <StatusDot status={info.id} size={14} />
          <span>{info.label}</span>
          <strong>{count}</strong>
        </button>
      ))}
      {filter && (
        <button className="status-key-clear" title="Show everything" onClick={() => editor.setStatusFilter(null)}>
          Show all
        </button>
      )}
    </div>
  )
}
