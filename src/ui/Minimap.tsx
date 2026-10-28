import { type PointerEvent, useLayoutEffect, useMemo, useRef } from 'react'
import * as B from '../model/board'
import { expand, union } from '../model/geom'
import { type Board, type Id, isWidget, usesInk } from '../model/types'
import { ink, mindRootFill } from './paint'
import { darken } from './BoardView'
import { useEditor } from './useEditor'

const W = 200
const H = 136

/** A CSS colour as the canvas takes it: `var(--x)` looked up on the page. */
function resolve(color: string, vars: Map<string, string>): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color)
  if (!m) return color
  let v = vars.get(m[1])
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#888'
    vars.set(m[1], v)
  }
  return v
}

/**
 * The board's objects, painted on a canvas: thousands of them cost about a millisecond, where as
 * separate shapes they'd slow every change on a busy board. Painted again only when the board, the
 * view or the theme changes.
 */
function MinimapCanvas({ board, hidden, ox, oy, s }: { board: Board; hidden: ReadonlySet<Id>; ox: number; oy: number; s: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ board: Board; hidden: ReadonlySet<Id>; ox: number; oy: number; s: number; theme: string } | null>(null)
  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const root = document.documentElement
    const theme = `${root.dataset.theme ?? ''}|${getComputedStyle(root).getPropertyValue('--ink')}`
    const l = last.current
    if (l && l.board === board && l.hidden === hidden && l.ox === ox && l.oy === oy && l.s === s && l.theme === theme) return
    last.current = { board, hidden, ox, oy, s, theme }
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr
      canvas.height = H * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const vars = new Map<string, string>()
    const box = (i: { x: number; y: number; w: number; h: number }) => [ox + i.x * s, oy + i.y * s, Math.max(0.5, i.w * s), Math.max(0.5, i.h * s)] as const
    for (const i of board.items) {
      if (hidden.has(i.id)) continue
      if (i.kind === 'frame') {
        ctx.globalAlpha = 1
        ctx.fillStyle = resolve('var(--frame-fill)', vars)
        ctx.strokeStyle = resolve('var(--frame-stroke)', vars)
        ctx.lineWidth = 1
        ctx.fillRect(...box(i))
        ctx.strokeRect(...box(i))
        continue
      }
      ctx.globalAlpha = usesInk(i.kind) ? 0.5 : 1
      ctx.fillStyle = resolve(usesInk(i.kind) ? ink(i.color) : isWidget(i.kind) ? 'var(--surface-2)' : i.kind === 'mind' ? mindRootFill(i.color) : darken(i.color, 0.85), vars)
      ctx.fillRect(...box(i))
    }
    ctx.globalAlpha = 1
  })
  return (
    <foreignObject x={0} y={0} width={W} height={H}>
      <canvas ref={ref} style={{ width: W, height: H, display: 'block' }} />
    </foreignObject>
  )
}

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
      <MinimapCanvas board={editor.board} hidden={editor.hidden} ox={ox} oy={oy} s={s} />
      <g transform={`translate(${ox} ${oy}) scale(${s})`}>
        <rect x={view.x} y={view.y} width={view.w} height={view.h} className="minimap-view" strokeWidth={1.5 / s} />
      </g>
    </svg>
  )
}
