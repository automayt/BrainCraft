import { FLOW_SHAPES, flowShapeInfo } from '../model/types'
import { FlowShapeIcon } from './icons'
import { useEditor } from './useEditor'

/** "What comes next?" — shown where a flowchart line was dropped on empty space. */
export function ShapePicker() {
  const editor = useEditor()
  const p = editor.shapePicker
  if (!p) return null
  const s = editor.screenRect({ x: p.at.x, y: p.at.y, w: 0, h: 0 })
  const left = Math.min(Math.max(8, s.x + 12), editor.viewport.w - 300)
  const top = Math.min(Math.max(8, s.y - 20), editor.viewport.h - 380)
  return (
    <div className="shape-picker no-canvas" style={{ left, top }} role="menu" aria-label="Next shape" onPointerDown={(e) => e.stopPropagation()}>
      <div className="picker-head">
        <strong>Next step</strong>
        <span className="muted">Likeliest first · its number or click · Esc</span>
      </div>
      {p.options.map((shape, k) => {
        const info = flowShapeInfo(shape)
        return (
          <button key={shape} role="menuitem" onClick={() => editor.pickShape(shape)} className={k === 0 ? 'suggested' : ''}>
            <kbd>{FLOW_SHAPES.findIndex((f) => f.shape === shape) + 1}</kbd>
            <FlowShapeIcon shape={shape} size={30} />
            <span>
              <strong>{info.label}</strong>
              <small>{info.hint}</small>
            </span>
          </button>
        )
      })}
    </div>
  )
}
