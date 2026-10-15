import { type PointerEvent, memo, useMemo, useRef } from 'react'
import * as B from '../model/board'
import { expand, union } from '../model/geom'
import { type Board, type Id, isWidget, usesInk } from '../model/types'
import { ink, mindRootFill } from './paint'
import { darken } from './BoardView'
import { useEditor } from './useEditor'

const W = 200
const H = 136

/** The board's objects, drawn once per board change (not on every pan or zoom). */
const MinimapItems = memo(function MinimapItems({ board, hidden }: { board: Board; hidden: ReadonlySet<Id> }) {
  return (
    <>
      {board.items.map((i) =>
        hidden.has(i.id) ? null : i.kind === 'frame' ? (
          <rect key={i.id} x={i.x} y={i.y} width={i.w} height={i.h} vectorEffect="non-scaling-stroke" style={{ fill: 'var(--frame-fill)', stroke: 'var(--frame-stroke)' }} />
        ) : (
          <rect
            key={i.id}
            x={i.x}
            y={i.y}
            width={i.w}
            height={i.h}
            style={{ fill: usesInk(i.kind) ? ink(i.color) : isWidget(i.kind) ? 'var(--surface-2)' : i.kind === 'mind' ? mindRootFill(i.color) : darken(i.color, 0.85) }}
            opacity={usesInk(i.kind) ? 0.5 : 1}
          />
        ),
      )}
    </>
  )
})

/** Overview of the whole board; click or drag to move the view. */
export function Minimap() {
  const editor = useEditor()
  const dragging = useRef(false)
  const view = editor.visibleWorld
  const content = useMemo(() => B.bounds(editor.board), [editor.board])
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
        <MinimapItems board={editor.board} hidden={editor.hidden} />
        <rect x={view.x} y={view.y} width={view.w} height={view.h} className="minimap-view" strokeWidth={1.5 / s} />
      </g>
    </svg>
  )
}
