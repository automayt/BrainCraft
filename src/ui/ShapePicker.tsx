import { isPlainNext, type NextShape } from '../editor/Editor'
import { FLOW_SHAPES, flowShapeInfo, KIND_LABELS } from '../model/types'
import { FlowShapeIcon } from './icons'
import { useEditor } from './useEditor'

/** What a plain choice is for, under its name. */
const PLAIN_HINT: Record<string, string> = {
  rect: 'A box',
  ellipse: 'An oval',
  sticky: 'A note',
  text: 'Words on their own',
}

/** A small picture of a plain choice, drawn like the flowchart ones. */
function PlainIcon({ kind }: { kind: string }) {
  return (
    <svg width={30} height={28} viewBox="0 0 32 30" aria-hidden="true">
      {kind === 'rect' && <rect x="3" y="7" width="26" height="16" rx="2" fill="var(--icon-fill)" stroke="currentColor" strokeWidth="1.6" />}
      {kind === 'ellipse' && <ellipse cx="16" cy="15" rx="13" ry="8.5" fill="var(--icon-fill)" stroke="currentColor" strokeWidth="1.6" />}
      {kind === 'sticky' && <rect x="7" y="5" width="18" height="20" rx="1.5" fill="#fff9b1" stroke="currentColor" strokeWidth="1.2" />}
      {kind === 'text' && <path d="M9 9h14M16 9v13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  )
}

/** "What comes next?" — shown where a flowchart line was dropped on empty space. */
export function ShapePicker() {
  const editor = useEditor()
  const p = editor.shapePicker
  if (!p) return null
  // Flowchart symbols keep the shape panel's numbers; a list with plain shapes counts down it.
  const mixed = p.options.some(isPlainNext)
  const number = (s: NextShape, k: number) => (mixed ? k + 1 : FLOW_SHAPES.findIndex((f) => f.shape === s) + 1)
  const s = editor.screenRect({ x: p.at.x, y: p.at.y, w: 0, h: 0 })
  const left = Math.min(Math.max(8, s.x + 12), editor.viewport.w - 300)
  const top = Math.min(Math.max(8, s.y - 20), editor.viewport.h - 380)
  return (
    <div className="shape-picker no-canvas" style={{ left, top }} role="menu" aria-label="Next shape" onPointerDown={(e) => e.stopPropagation()}>
      <div className="picker-head">
        <strong>Next step</strong>
        <span className="muted">Likeliest first · its number, Enter or click · Esc</span>
      </div>
      {p.options.map((shape, k) => {
        const plain = isPlainNext(shape)
        const info = plain ? null : flowShapeInfo(shape)
        return (
          <button key={shape} role="menuitem" onClick={() => editor.pickShape(shape)} className={k === 0 ? 'suggested' : ''}>
            <kbd>{number(shape, k)}</kbd>
            {plain ? <PlainIcon kind={shape} /> : <FlowShapeIcon shape={shape} size={30} />}
            <span>
              <strong>{plain ? KIND_LABELS[shape] : info!.label}</strong>
              <small>{plain ? PLAIN_HINT[shape] : info!.hint}</small>
            </span>
          </button>
        )
      })}
    </div>
  )
}
