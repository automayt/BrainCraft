import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent as RPointerEvent } from 'react'
import { type Corner, type Editor, type Handle, cornerOf } from '../editor/Editor'
import * as F from '../model/flowchart'
import * as M from '../model/mindmap'
import { applyPatches } from '../collab/patch'
import type { FlowDir } from '../model/flowchart'
import { flowTextRect } from '../model/shapes'
import { ACCENT, mindRootText } from './paint'
import { type Item, WIDGET_TITLE_H } from '../model/types'
import * as B from '../model/board'
import { toScreen, toWorld } from '../model/camera'
import { type Rect, center, rectFromPoints } from '../model/geom'
import { nodeStyle } from '../model/mindmap'
import { defaultColor } from '../model/types'
import { Social } from './Social'
import { StatusMarks } from './StatusMarks'
import { StatusKey } from './StatusKey'
import { CatchUpOverlay } from './CatchUp'
import { BoardView, COARSE_ZOOM, ItemShape, commentBodyRect, inkFor, mindDepths } from './BoardView'
import { FONT_FAMILY, LINE_HEIGHT } from './measure'
import { Minimap } from './Minimap'
import { CODE_FONT, codeBodyRect } from './CodeBlockView'
import { TOOL_ICONS } from './icons'
import { imageFiles, readImage } from './images'
import { SelectionToolbar } from './SelectionToolbar'
import { PeerLayer } from './Live'
import { Moments } from './Moments'
import { ShapePicker } from './ShapePicker'
import { useUi } from './uiContext'
import { useEditor } from './useEditor'


function readHandle(target: EventTarget | null): Handle | undefined {
  const el = (target as Element | null)?.closest?.('[data-handle]')
  if (!el) return undefined
  const kind = el.getAttribute('data-handle')
  const id = Number(el.getAttribute('data-id'))
  switch (kind) {
    case 'resize':
      return { kind, corner: el.getAttribute('data-corner') as Corner }
    case 'connect':
      return { kind }
    case 'mindAdd':
      return { kind, id, side: (el.getAttribute('data-side') as 'left' | 'right' | null) ?? undefined }
    case 'flowAdd':
      return { kind, dir: el.getAttribute('data-dir') as FlowDir }
    case 'notes':
      return { kind, id }
    case 'react':
      return { kind, id, emoji: el.getAttribute('data-emoji') ?? '' }
    case 'flip':
      return { kind, id }
    case 'vote':
      return { kind, id, poll: Number(el.getAttribute('data-poll')), delta: el.getAttribute('data-delta') === '-1' ? -1 : 1 }
    case 'collapse':
      return { kind, id }
  }
  return undefined
}

export function Canvas() {
  const editor = useEditor()
  const ui = useUi()
  const ref = useRef<HTMLDivElement>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null)

  // Track the canvas size.
  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => editor.setViewport(el.clientWidth, el.clientHeight))
    ro.observe(el)
    editor.setViewport(el.clientWidth, el.clientHeight)
    return () => ro.disconnect()
  }, [editor])

  // Wheel needs a non-passive listener to stop the page from scrolling or zooming.
  useEffect(() => {
    const el = ref.current!
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.no-canvas')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * scale
      const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * scale
      editor.wheel({ x: e.clientX - r.left, y: e.clientY - r.top }, dx, dy, e.ctrlKey || e.metaKey)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [editor])

  const longPress = useRef<{ at: { x: number; y: number }; timer: ReturnType<typeof setTimeout> } | null>(null)

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = (e: RPointerEvent) => {
    if ((e.target as Element).closest('.no-canvas')) return
    const p = local(e)
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, p)
      if (touches.current.size === 2) {
        editor.cancelDrag()
        const [a, b] = [...touches.current.values()]
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
        return
      }
    }
    ref.current!.setPointerCapture(e.pointerId)
    // Keep focus off any text box so canvas shortcuts work.
    if (document.activeElement instanceof HTMLElement && !editor.editing) document.activeElement.blur()
    editor.pointerDown(p, e.button, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, touch: e.pointerType === 'touch' }, readHandle(e.target))
    if (e.button !== 2) e.preventDefault()
    // Touch has no right-click: holding a finger still opens the context menu instead.
    if (e.pointerType === 'touch') {
      clearTimeout(longPress.current?.timer)
      longPress.current = {
        at: p,
        timer: setTimeout(() => {
          longPress.current = null
          if (touches.current.size !== 1) return
          editor.cancelDrag()
          editor.pointerDown(p, 2, {})
          ui.openMenu(p)
          // Lifting the finger "clicks" whatever is now under it: a menu item. Swallow that one click.
          const swallow = (ev: Event) => {
            ev.preventDefault()
            ev.stopPropagation()
          }
          window.addEventListener('click', swallow, { capture: true, once: true })
          setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 800)
        }, LONG_PRESS_MS),
      }
    }
  }

  const onPointerMove = (e: RPointerEvent) => {
    const p = local(e)
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, p)
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        editor.pan(mid.x - pinch.current.mid.x, mid.y - pinch.current.mid.y)
        editor.zoomBy(dist / pinch.current.dist, mid)
        pinch.current = { dist, mid }
        return
      }
    }
    // A finger that moves is dragging or panning, not holding.
    if (longPress.current && Math.hypot(p.x - longPress.current.at.x, p.y - longPress.current.at.y) > 8) {
      clearTimeout(longPress.current.timer)
      longPress.current = null
    }
    editor.pointerMove(p, { alt: e.altKey })
  }

  const onPointerUp = (e: RPointerEvent) => {
    if (longPress.current) {
      clearTimeout(longPress.current.timer)
      longPress.current = null
    }
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId)
      if (pinch.current) {
        if (touches.current.size === 0) pinch.current = null
        return
      }
    }
    if (editor.drag.type !== 'none') editor.pointerUp(local(e))
  }

  const { camera, board } = editor
  const step = gridStep(camera.zoom)
  const cull = cullArea(editor)
  const cursor =
    editor.drag.type === 'pan'
      ? 'grabbing'
      : editor.tool === 'hand' || editor.spaceDown
        ? 'grab'
        : editor.tool === 'select'
          ? 'default'
          : 'crosshair'

  return (
    <div
      ref={ref}
      className="canvas"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => editor.pointerLeave()}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if (!(e.target as Element).closest('.no-canvas, [data-handle]')) editor.doubleClick(local(e))
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        if ((e.target as Element).closest('.no-canvas')) return
        ui.openMenu(local(e))
      }}
      // Focusing an input inside a board object makes the browser scroll this
      // clipped container; the camera does all the moving, so undo that.
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0
        e.currentTarget.scrollLeft = 0
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
      }}
      onDrop={async (e) => {
        const files = imageFiles(e.dataTransfer.files)
        if (!files.length) return
        e.preventDefault()
        const at = toWorld(editor.camera, local(e))
        for (const [k, file] of files.entries()) {
          try {
            const img = await readImage(file)
            editor.addImage(img.src, img.w, img.h, { x: at.x + k * 40, y: at.y + k * 40 })
          } catch (err) {
            editor.setStatus((err as Error).message)
          }
        }
      }}
    >
      <svg className="board" width="100%" height="100%">
        <defs>
          <pattern
            id="grid"
            width={step * camera.zoom}
            height={step * camera.zoom}
            patternUnits="userSpaceOnUse"
            x={camera.x % (step * camera.zoom)}
            y={camera.y % (step * camera.zoom)}
          >
            <circle cx={1} cy={1} r={Math.min(1.5, Math.max(0.8, camera.zoom))} style={{ fill: 'var(--grid)' }} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
          <BoardView
            board={editor.viewBoard}
            hidden={editor.hidden}
            editingId={editor.editing && !editor.editing.connector ? editor.editing.id : null}
            editingLabel={editor.editing?.connector ? editor.editing.id : null}
            selectedConnector={editor.selectedConnector}
            selection={editor.selection}
            view={cull}
            coarse={camera.zoom < COARSE_ZOOM && !editor.presenting}
            statusFilter={editor.statusFilter}
          />
          <Social editor={editor} />
          <StatusMarks editor={editor} />
          <CatchUpOverlay editor={editor} />
          <DragPreview editor={editor} />
          <MagnetPreview editor={editor} />
          {editor.aiPreview && <AiPreview editor={editor} />}
        </g>
        <Overlays editor={editor} />
        {editor.running && <RunOverlay editor={editor} />}
      </svg>
      {board.items.length === 0 && editor.tool === 'select' && <EmptyBoard />}
      {editor.editing && <TextEditor key={`${editor.editing.connector ? 'c' : 'i'}${editor.editing.id}`} editor={editor} />}
      {editor.hint && <div className="hint-bar">{editor.hint}</div>}
      <PeerLayer />
      <Moments />
      <SelectionToolbar />
      <ShapePicker />
      <Minimap />
      <StatusKey />
    </div>
  )
}

function gridStep(zoom: number) {
  let step = 40
  while (step * zoom < 14) step *= 5
  return step
}

/** In-progress gestures, drawn in world space. */
function DragPreview({ editor }: { editor: Editor }) {
  const d = editor.drag
  const z = editor.camera.zoom
  switch (d.type) {
    case 'move': {
      const v = editor.visibleWorld
      const style = { style: { stroke: 'var(--guide)' }, strokeWidth: 1 / z, strokeDasharray: `${4 / z} ${3 / z}` }
      return (
        <g>
          {d.guides.x !== undefined && <line x1={d.guides.x} x2={d.guides.x} y1={v.y} y2={v.y + v.h} {...style} />}
          {d.guides.y !== undefined && <line y1={d.guides.y} y2={d.guides.y} x1={v.x} x2={v.x + v.w} {...style} />}
        </g>
      )
    }
    case 'create': {
      if (d.kind === 'mind') return null
      const r = rectFromPoints(d.start, d.current)
      const fill = defaultColor(d.kind)
      return d.kind === 'ellipse' ? (
        <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} fill={fill} opacity={0.6} />
      ) : (
        <rect {...xywh(r)} fill={fill} opacity={0.6} style={{ stroke: ACCENT }} strokeWidth={1 / z} />
      )
    }
    case 'draw':
      return (
        <polyline
          points={d.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={editor.penColor}
          strokeWidth={editor.penWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    case 'connect': {
      const from = B.getItem(editor.board, d.from)
      if (!from) return null
      const hit = B.hitTest(editor.board, d.current, 4 / z, editor.hidden)
      const target = hit?.type === 'item' && hit.id !== d.from ? B.getItem(editor.board, hit.id) : undefined
      const validTarget = target && target.kind !== 'frame' ? target : undefined
      const end = validTarget ? B.anchorTowards(validTarget, center(from)) : d.current
      const start = B.anchorTowards(from, validTarget ? center(validTarget) : d.current)
      return (
        <g>
          {validTarget && <rect {...xywh(validTarget)} fill="none" style={{ stroke: ACCENT }} strokeWidth={2 / z} rx={4} />}
          <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} style={{ stroke: ACCENT }} strokeWidth={2 / z} strokeDasharray={`${6 / z} ${4 / z}`} />
          <circle cx={end.x} cy={end.y} r={4 / z} style={{ fill: ACCENT }} />
        </g>
      )
    }
    case 'branch': {
      // The idea moves for real while dragged; just show where it would be re-parented.
      const target = d.target !== null ? B.getItem(editor.board, d.target) : undefined
      return target ? <rect {...xywh(target)} fill="none" style={{ stroke: ACCENT }} strokeWidth={3 / z} rx={10} /> : null
    }
    default:
      return null
  }
}

const LONG_PRESS_MS = 500

/**
 * The area of the board worth drawing: the view plus half a screen around it, snapped to a
 * grid so small pans keep the same area (and the board doesn't redraw). Small boards draw
 * everything.
 */
const CULL_FROM = 400
let lastCull: { key: string; rect: Rect } | null = null
function cullArea(editor: Editor): Rect | null {
  if (editor.board.items.length < CULL_FROM) return null
  const v = editor.visibleWorld
  const cell = Math.max(v.w, v.h) / 2
  const snap = (n: number) => Math.floor(n / cell) * cell
  const x = snap(v.x - cell)
  const y = snap(v.y - cell)
  const rect = { x, y, w: snap(v.x + v.w + cell) + cell - x, h: snap(v.y + v.h + cell) + cell - y }
  const key = `${rect.x}|${rect.y}|${rect.w}|${rect.h}`
  if (lastCull?.key !== key) lastCull = { key, rect }
  return lastCull.rect
}

/** An AI proposal before it's applied: new and changed objects as ghosts, removed ones crossed out. */
function AiPreview({ editor }: { editor: Editor }) {
  const z = editor.camera.zoom
  const patches = editor.aiPreview!.patches
  const ghost = useMemo(() => M.layoutAll(applyPatches(editor.board, patches), editor.measure), [editor.board, patches, editor.measure])
  const depths = useMemo(() => mindDepths(ghost), [ghost])
  const out: ReactNode[] = []
  for (const p of patches) {
    if (p.k === 'item') {
      const now = B.getItem(editor.board, p.id)
      const next = B.getItem(ghost, p.id)
      if (!next && now) {
        out.push(
          <g key={`x${p.id}`} className="ai-removed">
            <rect {...xywh(now)} rx={6} strokeWidth={2 / z} strokeDasharray={`${6 / z} ${4 / z}`} />
            <path d={`M${now.x} ${now.y}L${now.x + now.w} ${now.y + now.h}M${now.x + now.w} ${now.y}L${now.x} ${now.y + now.h}`} strokeWidth={2 / z} />
          </g>,
        )
      } else if (next) {
        out.push(
          <g key={`g${p.id}`} className={now ? 'ai-changed' : 'ai-added'}>
            <g opacity={now ? 0.85 : 0.6}>
              <ItemShape item={next} depth={depths.get(next.id) ?? 1} editing={false} />
            </g>
            <rect {...xywh(next)} rx={6} fill="none" strokeWidth={2 / z} strokeDasharray={`${6 / z} ${4 / z}`} />
          </g>,
        )
      }
    } else if (p.k === 'conn' && p.v) {
      const r = B.connectorRoute(ghost, p.v)
      if (r) out.push(<path key={`c${p.id}`} d={r.d} className="ai-line" strokeWidth={2 / z} strokeDasharray={`${6 / z} ${4 / z}`} />)
    }
  }
  return <g style={{ pointerEvents: 'none' }}>{out}</g>
}

/** Flowchart magnets: the shape being placed or dragged snaps beside another and will connect to it. */
function MagnetPreview({ editor }: { editor: Editor }) {
  const z = editor.camera.zoom
  const p = editor.paletteDrag
  const d = editor.drag
  const magnet = p ? p.magnet : d.type === 'move' ? d.magnet : null
  const moving = d.type === 'move' && d.magnet ? B.getItem(editor.board, [...d.ids][0]) : undefined
  const ghost = p ? (F.flowItem(p.shape, p.magnet?.at ?? p.at) as Item) : undefined
  const target = magnet ? B.getItem(editor.board, magnet.target) : undefined
  const other = ghost ?? moving
  const connects = p ? true : !!(moving && F.MAGNET_RULES[moving.kind]?.connect)
  const showLine = connects && target && other && !(moving && F.linked(editor.board, target.id, moving.id))
  return (
    <g style={{ pointerEvents: 'none' }}>
      {ghost && (
        <g opacity={0.6}>
          <ItemShape item={{ ...ghost, id: -1 }} depth={1} editing={false} />
        </g>
      )}
      {target && <rect {...xywh(target)} fill="none" rx={6} style={{ stroke: ACCENT }} strokeWidth={2.5 / z} className="magnet-target" />}
      {showLine && (
        <line
          {...(() => {
            const a = B.anchorTowards(target, center(other))
            const b = B.anchorTowards(other, center(target))
            return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
          })()}
          style={{ stroke: ACCENT }}
          strokeWidth={2 / z}
          strokeDasharray={`${6 / z} ${4 / z}`}
        />
      )}
    </g>
  )
}

const xywh = (r: Rect) => ({ x: r.x, y: r.y, width: Math.max(r.w, 0), height: Math.max(r.h, 0) })

/** Selection outlines and handles, in screen space so they stay the same size at any zoom. */
function Overlays({ editor }: { editor: Editor }) {
  const out: ReactNode[] = []
  for (const i of editor.selectedItems) {
    const r = editor.screenRect(i)
    const pad = i.kind === 'mind' ? 4 : 3
    out.push(
      <rect key={`sel${i.id}`} {...xywh({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad })} className="sel-outline" rx={i.kind === 'mind' ? 12 : 2} />,
    )
  }
  if (editor.selection.size > 1) {
    const b = B.bounds(editor.board, editor.selection)
    if (b) {
      const r = editor.screenRect(b)
      out.push(<rect key="multi" {...xywh({ x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 })} className="sel-bounds" />)
    }
  }
  // Comment counts on objects that have work notes (none on others' hidden brainstorm notes).
  for (const i of editor.viewBoard.items) {
    if (!i.notes?.length || editor.hidden.has(i.id)) continue
    const r = editor.screenRect(i)
    if (r.x > editor.viewport.w || r.y > editor.viewport.h || r.x + r.w < 0 || r.y + r.h < 0) continue
    out.push(
      <g key={`notes${i.id}`} data-handle="notes" data-id={i.id} className="notes-badge" transform={`translate(${r.x + r.w + 14} ${r.y - 4})`}>
        <title>{`${i.notes.length} comment${i.notes.length === 1 ? '' : 's'} — click to open`}</title>
        <path d="M-10 -12h20a4 4 0 0 1 4 4v9a4 4 0 0 1 -4 4h-11l-5 4v-4h-4a4 4 0 0 1 -4 -4v-9a4 4 0 0 1 4 -4z" />
        <text x={0} y={-3} dy="0.35em" textAnchor="middle">
          {i.notes.length > 99 ? '99+' : i.notes.length}
        </text>
      </g>,
    )
  }
  const single = editor.single
  if (single && !editor.editing && editor.drag.type === 'none') {
    const r = editor.screenRect(single)
    if (editor.resizable) {
      for (const c of ['nw', 'ne', 'sw', 'se'] as Corner[]) {
        const p = cornerOf(r, c)
        out.push(
          <rect
            key={c}
            data-handle="resize"
            data-corner={c}
            x={p.x - 5}
            y={p.y - 5}
            width={10}
            height={10}
            rx={2}
            className={`handle resize-${c}`}
          />,
        )
      }
    }
    if (single.kind === 'mind') {
      const sides: ('left' | 'right')[] =
        single.parent === undefined ? ['left', 'right'] : [single.x >= parentCenterX(editor, single) ? 'right' : 'left']
      const hasKids = editor.board.items.some((i) => i.parent === single.id)
      for (const side of sides) {
        // Leave room for the collapse toggle on nodes with children.
        const gap = single.parent !== undefined && hasKids ? 34 * editor.camera.zoom + 14 : 18
        const x = side === 'right' ? r.x + r.w + gap : r.x - gap
        out.push(
          <g key={`add-${side}`} data-handle="mindAdd" data-id={single.id} data-side={side} className="mind-add">
            <title>Add idea (Tab)</title>
            <circle cx={x} cy={r.y + r.h / 2} r={11} />
            <path d={`M${x - 5} ${r.y + r.h / 2}h10M${x} ${r.y + r.h / 2 - 5}v10`} />
          </g>,
        )
      }
    } else if (single.kind === 'flow') {
      const arrows: [FlowDir, number, number, number][] = [
        ['up', r.x + r.w / 2, r.y - 22, -90],
        ['right', r.x + r.w + 22, r.y + r.h / 2, 0],
        ['down', r.x + r.w / 2, r.y + r.h + 22, 90],
        ['left', r.x - 22, r.y + r.h / 2, 180],
      ]
      for (const [dir, x, y, angle] of arrows) {
        out.push(
          <g key={dir} data-handle="flowAdd" data-dir={dir} className="flow-add" transform={`translate(${x} ${y}) rotate(${angle})`}>
            <title>Click to add the next step, or drag to connect</title>
            <circle r={11} />
            <path d="M-4.5 0H4.5M1 -3.5L4.5 0L1 3.5" />
          </g>,
        )
      }
    } else if (single.kind !== 'pen') {
      const p = { x: r.x + r.w + 18, y: r.y + r.h / 2 }
      out.push(
        <g key="connect" data-handle="connect" className="connect-handle">
          <title>Drag to connect</title>
          <circle cx={p.x} cy={p.y} r={7} />
        </g>,
      )
    }
  }
  const d = editor.drag
  if (d.type === 'marquee') {
    const a = toScreen(editor.camera, d.start)
    const b = toScreen(editor.camera, d.current)
    out.push(<rect key="marquee" {...xywh(rectFromPoints(a, b))} className="marquee" />)
  }
  return <g>{out}</g>
}

/** Runbook mode: the route taken so far, the current step and the ways on from it. */
function RunOverlay({ editor }: { editor: Editor }) {
  const run = editor.running!
  const z = editor.camera.zoom
  const path = (points: { x: number; y: number }[]) =>
    points.map((p, k) => `${k ? 'L' : 'M'}${toScreen(editor.camera, p).x} ${toScreen(editor.camera, p).y}`).join('')
  const out: ReactNode[] = []
  run.steps.forEach((s, k) => {
    const next = run.steps[k + 1]
    if (!next) return
    const c = editor.board.connectors.find((x) => x.from === s.node && x.to === next.node)
    const r = c && B.connectorRoute(editor.board, c)
    if (r) out.push(<path key={`r${k}`} d={path(r.points)} className="run-route" />)
  })
  const visited = new Set(run.steps.slice(0, -1).map((s) => s.node))
  for (const id of visited) {
    const i = B.getItem(editor.board, id)
    if (!i) continue
    const r = editor.screenRect(i)
    out.push(
      <g key={`v${id}`} className="run-visited" transform={`translate(${r.x + r.w} ${r.y})`}>
        <circle r={9} />
        <path d="M-4 0l3 3 5-6" />
      </g>,
    )
  }
  editor.runOptions.forEach((o, k) => {
    const r = editor.screenRect(o.to)
    const pad = 6
    out.push(<rect key={`o${o.to.id}`} {...xywh({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad })} rx={8} className="run-next" />)
    if (editor.runOptions.length > 1)
      out.push(
        <g key={`n${o.to.id}`} className="run-num" transform={`translate(${r.x - pad} ${r.y - pad})`}>
          <circle r={10} />
          <text dy="0.35em" textAnchor="middle">
            {k + 1}
          </text>
        </g>,
      )
  })
  const at = editor.runStep !== null ? B.getItem(editor.board, editor.runStep) : undefined
  if (at) {
    const r = editor.screenRect(at)
    const pad = 8 + 2 * Math.min(1, z)
    out.push(<rect key="at" {...xywh({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad })} rx={10} className="run-current" />)
  }
  return <g className="run-overlay">{out}</g>
}

function parentCenterX(editor: Editor, node: { parent?: number }) {
  const p = node.parent !== undefined ? B.getItem(editor.board, node.parent) : undefined
  return p ? p.x + p.w / 2 : -Infinity
}

/** The text box laid over the item being edited. */
function TextEditor({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const e = editor.editing!
  const item = e.connector ? undefined : B.getItem(editor.board, e.id)
  const z = editor.camera.zoom
  const label = e.connector ? B.connectorRoute(editor.board, B.getConnector(editor.board, e.id)!) : null

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [e.id])

  // Grow to fit the text, and keep vertically centred items centred. Only when something that
  // changes the height changes: measuring forces a layout of the whole board.
  const text = editor.editingText
  const fit = `${text}|${z}|${item?.w}|${item?.h}|${item?.fontSize}`
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [fit])

  if (label) {
    const m = editor.screenRect({ x: label.mid.x, y: label.mid.y, w: 0, h: 0 })
    return (
      <div
        className="text-editor label-editor no-canvas"
        style={{ left: m.x - 110, top: m.y - 18, width: 220, height: 36, alignItems: 'center' }}
        onPointerDown={(ev) => ev.stopPropagation()}
      >
        <textarea
          ref={ref}
          value={editor.editingText}
          rows={1}
          placeholder="Label"
          style={{ fontSize: Math.max(12, 14 * z), textAlign: 'center', fontFamily: FONT_FAMILY, lineHeight: LINE_HEIGHT }}
          onChange={(ev) => editor.setEditingText(ev.target.value.replace(/\n/g, ' '))}
          onKeyDown={(ev) => {
            ev.stopPropagation()
            if (ev.key === 'Enter' || ev.key === 'Escape') {
              ev.preventDefault()
              editor.finishEditing()
            }
          }}
          onBlur={() => {
            if (editor.editing?.id === e.id) editor.finishEditing()
          }}
        />
      </div>
    )
  }
  if (!item) return null
  const r = editor.screenRect(item)
  let box: Rect
  let fontSize = item.fontSize * z
  let fontWeight = 400
  let align: 'left' | 'center' = 'center'
  let color = inkFor(item)
  let vcenter = true
  switch (item.kind) {
    case 'frame':
      box = editor.screenRect(B.frameTitleRect(item))
      align = 'left'
      color = 'var(--muted)'
      break
    case 'text':
      box = inset(r, 4 * z)
      align = 'left'
      vcenter = false
      break
    case 'ellipse':
      box = inset(r, Math.min(r.w, r.h) * 0.15 + 14 * z)
      break
    case 'flow':
      box = editor.screenRect(flowTextRect(item))
      break
    case 'table':
    case 'kanban':
    case 'timeline':
      box = editor.screenRect({ x: item.x + 14, y: item.y + 8, w: item.w * 0.5, h: WIDGET_TITLE_H - 16 })
      align = 'left'
      fontWeight = 700
      fontSize = 16 * z
      break
    case 'comment':
      box = editor.screenRect(commentBodyRect(item))
      align = 'left'
      vcenter = false
      break
    case 'code':
      box = editor.screenRect(codeBodyRect(item))
      align = 'left'
      vcenter = false
      color = '#e6e8ee'
      break
    case 'mind': {
      const depth = mindDepths(editor.board).get(item.id) ?? 0
      const s = nodeStyle(depth)
      box = { x: r.x + s.padX * z, y: r.y + s.padY * z, w: r.w - 2 * s.padX * z, h: r.h - 2 * s.padY * z }
      fontSize = s.fontSize * z
      fontWeight = s.weight
      color = depth === 0 ? mindRootText(item.color) : 'var(--ink)'
      break
    }
    default:
      box = inset(r, 14 * z)
  }
  return (
    <div
      className="text-editor no-canvas"
      style={{ left: box.x, top: box.y, width: Math.max(box.w, 20), height: box.h, alignItems: vcenter ? 'center' : 'flex-start' }}
      onPointerDown={(ev) => ev.stopPropagation()}
    >
      <textarea
        ref={ref}
        value={item.text}
        spellCheck={item.kind !== 'code'}
        rows={1}
        placeholder={item.kind === 'mind' ? 'Type an idea' : ''}
        style={{
          fontSize,
          fontWeight,
          textAlign: align,
          color,
          fontFamily: item.kind === 'code' ? CODE_FONT : FONT_FAMILY,
          lineHeight: item.kind === 'code' ? 1.5 : LINE_HEIGHT,
          whiteSpace: item.kind === 'code' ? 'pre' : undefined,
          caretColor: item.kind === 'mind' && color !== 'var(--ink)' ? color : ACCENT,
        }}
        onChange={(ev) => editor.setEditingText(ev.target.value)}
        onKeyDown={(ev) => {
          ev.stopPropagation()
          // In code, Tab indents (two spaces) instead of leaving the box.
          if (item.kind === 'code' && ev.key === 'Tab' && !ev.shiftKey) {
            ev.preventDefault()
            const ta = ev.currentTarget
            ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end')
            editor.setEditingText(ta.value)
            return
          }
          if (editor.editingKey(ev.key, { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey })) ev.preventDefault()
        }}
        onBlur={() => {
          if (editor.editing?.id === e.id) editor.finishEditing()
        }}
      />
    </div>
  )
}

function inset(r: Rect, m: number): Rect {
  return { x: r.x + m, y: r.y + m, w: Math.max(r.w - 2 * m, 1), h: Math.max(r.h - 2 * m, 1) }
}


const STARTERS: { tool: Parameters<Editor['setTool']>[0]; label: string; hint: string }[] = [
  { tool: 'mind', label: 'Mind map', hint: 'Tab and Enter to branch out' },
  { tool: 'flow', label: 'Flowchart', hint: 'Tab adds the next step' },
  { tool: 'sticky', label: 'Sticky notes', hint: 'Quick ideas, anywhere' },
  { tool: 'kanban', label: 'Kanban board', hint: 'Drag cards across' },
  { tool: 'table', label: 'Table', hint: 'Sort, filter, hide' },
  { tool: 'timeline', label: 'Timeline', hint: 'Plan in time' },
  { tool: 'data', label: 'Database', hint: 'Records as a table, Kanban, calendar…' },
]

/** A blank board offers a few ways to start, each placed in the middle of the view. */
function EmptyBoard() {
  const editor = useEditor()
  const ui = useUi()
  const start = (tool: (typeof STARTERS)[number]['tool']) => {
    editor.setTool(tool)
    const c = { x: editor.viewport.w / 2, y: editor.viewport.h / 2 }
    editor.pointerDown(c, 0, {})
    editor.pointerUp(c)
  }
  return (
    <div className="empty-board no-canvas" onPointerDown={(e) => e.stopPropagation()}>
      <h1>Start with an idea</h1>
      <p className="muted">Pick a starting point, double-click (or double-tap) anywhere for a sticky note, or paste a list of ideas, a link, Mermaid, an outline or a spreadsheet. Your boards (Ctrl O) has templates.</p>
      <div className="starters">
        {STARTERS.map((s) => (
          <button key={s.tool} onClick={() => start(s.tool)}>
            <span className="starter-icon">{TOOL_ICONS[s.tool]}</span>
            <strong>{s.label}</strong>
            <small>{s.hint}</small>
          </button>
        ))}
      </div>
      <button className="link" onClick={() => ui.openImport()}>
        Import Mermaid, an outline or AI-generated JSON…
      </button>
    </div>
  )
}
