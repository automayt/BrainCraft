import * as B from '../model/board'
import { BRANCHES, FILLS, FLOW_SHAPES, type FlowShape, INKS, MIND_ROOT_COLOR, usesInk } from '../model/types'
import { useEditor } from './useEditor'

/** Floating controls above the selection: colour, text size, mind-map and arrangement actions. */
export function SelectionToolbar() {
  const editor = useEditor()
  if (editor.drag.type !== 'none' || editor.editing) return null
  const { board } = editor
  let anchor: { x: number; y: number }
  let palette: readonly [string, string][]
  const items = editor.selectedItems
  const mind = editor.single?.kind === 'mind' ? editor.single : undefined

  if (editor.selectedConnector !== null) {
    const c = B.getConnector(board, editor.selectedConnector)
    const r = c && B.connectorRoute(board, c)
    if (!r) return null
    const s = editor.screenRect({ x: r.mid.x, y: r.mid.y, w: 0, h: 0 })
    anchor = { x: s.x, y: s.y - 24 }
    palette = INKS
  } else if (items.length) {
    const bounds = B.bounds(board, editor.selection)
    if (!bounds) return null
    const r = editor.screenRect(bounds)
    anchor = { x: r.x + r.w / 2, y: r.y - 22 }
    if (items.every((i) => i.kind === 'mind')) {
      palette = mind?.parent === undefined && mind ? [['Ink', MIND_ROOT_COLOR], ...BRANCHES] : BRANCHES
    } else palette = items.every((i) => usesInk(i.kind)) ? INKS : FILLS
  } else return null

  const connector = editor.selectedConnector !== null ? B.getConnector(board, editor.selectedConnector) : undefined
  const flows = items.filter((i) => i.kind === 'flow')
  const x = Math.min(Math.max(anchor.x, 220), editor.viewport.w - 220)
  const y = Math.max(anchor.y, 56)
  const hasFontSize = items.some((i) => i.kind !== 'mind' && i.kind !== 'pen')
  const current = items[0]?.color

  return (
    <div className="selection-toolbar no-canvas" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="swatches">
        {palette.map(([name, color]) => (
          <button
            key={name + color}
            className={`swatch${current === color ? ' active' : ''}`}
            style={{ background: color }}
            title={name}
            aria-label={name}
            onClick={() => editor.setColor(color)}
          />
        ))}
      </div>
      {connector && (
        <>
          <span className="sep" />
          {(['straight', 'elbow', 'curved'] as const).map((style) => (
            <button
              key={style}
              className={(connector.style ?? 'straight') === style ? 'on' : ''}
              title={`${style[0].toUpperCase()}${style.slice(1)} line`}
              onClick={() => editor.setConnectorStyle(style)}
            >
              <LineStyleIcon style={style} />
            </button>
          ))}
          <span className="sep" />
          {(
            [
              ['end', '→', 'Arrow at the end'],
              ['both', '↔', 'Arrows at both ends'],
              ['none', '—', 'No arrows'],
            ] as const
          ).map(([arrows, glyph, title]) => (
            <button
              key={arrows}
              className={(connector.arrows ?? 'end') === arrows ? 'on' : ''}
              title={title}
              onClick={() => editor.setArrowheads(arrows)}
            >
              {glyph}
            </button>
          ))}
          <span className="sep" />
          <button title="Label this line (or double-click it)" onClick={() => editor.startEditingLabel(connector.id)}>
            Label
          </button>
        </>
      )}
      {flows.length > 0 && (
        <>
          <span className="sep" />
          <select
            aria-label="Shape"
            title="Change shape"
            value={flows.every((f) => f.shape === flows[0].shape) ? (flows[0].shape ?? 'process') : ''}
            onChange={(e) => editor.setShape(e.target.value as FlowShape)}
          >
            {flows.some((f) => f.shape !== flows[0].shape) && <option value="">Mixed</option>}
            {FLOW_SHAPES.map((f) => (
              <option key={f.shape} value={f.shape}>
                {f.label}
              </option>
            ))}
          </select>
        </>
      )}
      {hasFontSize && (
        <>
          <span className="sep" />
          <button title="Smaller text" onClick={() => editor.scaleFont(1 / 1.2)}>
            A−
          </button>
          <button title="Larger text" onClick={() => editor.scaleFont(1.2)}>
            A+
          </button>
        </>
      )}
      {mind && (
        <>
          <span className="sep" />
          <button title="Add idea (Tab)" onClick={() => editor.addMindNode(mind.id, 'child')}>
            + Idea
          </button>
          {board.items.some((i) => i.parent === mind.id) && (
            <button title="Collapse or expand (C)" onClick={() => editor.toggleCollapsed(mind.id)}>
              {mind.collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          <button
            title="Copy the whole map as an indented list"
            onClick={() => {
              const outline = editor.outlineOfSelection()
              if (outline)
                navigator.clipboard
                  ?.writeText(outline)
                  .then(() => editor.setStatus('Copied map as outline'))
                  .catch(() => editor.setStatus('Clipboard unavailable'))
            }}
          >
            Copy outline
          </button>
        </>
      )}
      <span className="sep" />
      {items.length > 0 && !mind && (
        <>
          <button title="Bring to front" onClick={() => editor.bringToFront()}>
            Front
          </button>
          <button title="Send to back" onClick={() => editor.sendToBack()}>
            Back
          </button>
        </>
      )}
      {items.length > 0 && (
        <button title="Duplicate (Ctrl+D)" onClick={() => editor.duplicate()}>
          Duplicate
        </button>
      )}
      {editor.single && (
        <button title="Comments (Shift+C)" onClick={() => editor.toggleNotes(true)}>
          Comment{editor.single.notes?.length ? ` (${editor.single.notes.length})` : ''}
        </button>
      )}
      <button className="danger" title="Delete (Del)" onClick={() => editor.deleteSelection()}>
        Delete
      </button>
    </div>
  )
}

function LineStyleIcon({ style }: { style: 'straight' | 'elbow' | 'curved' }) {
  const d = style === 'straight' ? 'M3 15L15 3' : style === 'elbow' ? 'M3 15H9V3H15' : 'M3 15C10 15 8 3 15 3'
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
