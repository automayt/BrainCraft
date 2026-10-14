import { type PointerEvent, useRef } from 'react'
import * as B from '../model/board'
import { expand, union } from '../model/geom'
import { usesInk } from '../model/types'
import { darken } from './BoardView'
import { useEditor } from './useEditor'

const W = 200
const H = 136

/** Overview of the whole board; click or drag to move the view. */
export function Minimap() {
  const editor = useEditor()
  const dragging = useRef(false)
  const view = editor.visibleWorld
  const content = B.bounds(editor.board)
  const world = expand(content ? union(content, view) : view, 40)
  const s = Math.min(W / world.w, H / world.h)
  const ox = (W - world.w * s) / 2 - world.x * s
  const oy = (H - world.h * s) / 2 - world.y * s

  const go = (e: PointerEvent) => {
    const r = (e.currentTarget as Element).getBoundingClientRect()
    editor.centerOn({ x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s })
  }

  return (
    <svg
      className="minimap no-canvas"
      width={W}
      height={H}
      onPointerDown={(e) => {
        e.stopPropagation()
        dragging.current = true
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        go(e)
      }}
      onPointerMove={(e) => dragging.current && go(e)}
      onPointerUp={() => (dragging.current = false)}
    >
      <g transform={`translate(${ox} ${oy}) scale(${s})`}>
        {editor.board.items.map((i) =>
          editor.hidden.has(i.id) ? null : i.kind === 'frame' ? (
            <rect key={i.id} x={i.x} y={i.y} width={i.w} height={i.h} fill="#fff" stroke="#b4b4bc" strokeWidth={1 / s} />
          ) : (
            <rect
              key={i.id}
              x={i.x}
              y={i.y}
              width={i.w}
              height={i.h}
              fill={usesInk(i.kind) ? i.color : i.kind === 'mind' ? i.color : darken(i.color, 0.85)}
              opacity={usesInk(i.kind) ? 0.5 : 1}
            />
          ),
        )}
        <rect x={view.x} y={view.y} width={view.w} height={view.h} className="minimap-view" strokeWidth={1.5 / s} />
      </g>
    </svg>
  )
}
