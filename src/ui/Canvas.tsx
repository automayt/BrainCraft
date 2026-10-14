import { type ReactNode, useEffect, useLayoutEffect, useRef, type PointerEvent as RPointerEvent } from 'react'
import { type Corner, type Editor, type Handle, cornerOf } from '../editor/Editor'
import type { FlowDir } from '../model/flowchart'
import { flowTextRect } from '../model/shapes'
import * as B from '../model/board'
import { toScreen } from '../model/camera'
import { type Rect, center, rectFromPoints } from '../model/geom'
import { nodeStyle } from '../model/mindmap'
import { defaultColor } from '../model/types'
import { BoardView, ItemShape, inkFor, mindDepths } from './BoardView'
import { FONT_FAMILY, LINE_HEIGHT } from './measure'
import { Minimap } from './Minimap'
import { SelectionToolbar } from './SelectionToolbar'
import { useEditor } from './useEditor'

const ACCENT = '#4262ff'

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
    case 'collapse':
      return { kind, id }
  }
  return undefined
}

export function Canvas() {
  const editor = useEditor()
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
    editor.pointerDown(p, e.button, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey }, readHandle(e.target))
    if (e.button !== 2) e.preventDefault()
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
    editor.pointerMove(p, { alt: e.altKey })
  }

  const onPointerUp = (e: RPointerEvent) => {
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
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if (!(e.target as Element).closest('.no-canvas, [data-handle]')) editor.doubleClick(local(e))
      }}
      onContextMenu={(e) => e.preventDefault()}
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
            <circle cx={1} cy={1} r={Math.min(1.5, Math.max(0.8, camera.zoom))} fill="#cfcfd6" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
          <BoardView
            board={board}
            hidden={editor.hidden}
            editingId={editor.editing && !editor.editing.connector ? editor.editing.id : null}
            editingLabel={editor.editing?.connector ? editor.editing.id : null}
            selectedConnector={editor.selectedConnector}
            selection={editor.selection}
          />
          <DragPreview editor={editor} />
        </g>
        <Overlays editor={editor} />
      </svg>
      {board.items.length === 0 && (
        <div className="empty-hint">
          Double-click to add a sticky note, or press <kbd>M</kbd> and click to start a mind map
        </div>
      )}
      {editor.editing && <TextEditor key={`${editor.editing.connector ? 'c' : 'i'}${editor.editing.id}`} editor={editor} />}
      {editor.hint && <div className="hint-bar">{editor.hint}</div>}
      <SelectionToolbar />
      <Minimap />
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
      const style = { stroke: '#e0457b', strokeWidth: 1 / z, strokeDasharray: `${4 / z} ${3 / z}` }
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
        <rect {...xywh(r)} fill={fill} opacity={0.6} stroke={ACCENT} strokeWidth={1 / z} />
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
          {validTarget && <rect {...xywh(validTarget)} fill="none" stroke={ACCENT} strokeWidth={2 / z} rx={4} />}
          <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={ACCENT} strokeWidth={2 / z} strokeDasharray={`${6 / z} ${4 / z}`} />
          <circle cx={end.x} cy={end.y} r={4 / z} fill={ACCENT} />
        </g>
      )
    }
    case 'branch': {
      if (Math.hypot(d.offset.x, d.offset.y) * z < 4) return null
      const ids = B.subtree(editor.board, d.id)
      const depths = mindDepths(editor.board)
      const target = d.target !== null ? B.getItem(editor.board, d.target) : undefined
      return (
        <g>
          {target && <rect {...xywh(target)} fill="none" stroke={ACCENT} strokeWidth={3 / z} rx={10} />}
          <g transform={`translate(${d.offset.x} ${d.offset.y})`} opacity={0.55} style={{ pointerEvents: 'none' }}>
            {editor.board.items
              .filter((i) => ids.has(i.id) && !editor.hidden.has(i.id))
              .map((i) => (
                <ItemShape key={i.id} item={i} depth={depths.get(i.id) ?? 1} editing={false} />
              ))}
          </g>
        </g>
      )
    }
    default:
      return null
  }
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

  // Grow to fit the text, and keep vertically centred items centred.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  })

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
      color = '#5a5a64'
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
    case 'mind': {
      const depth = mindDepths(editor.board).get(item.id) ?? 0
      const s = nodeStyle(depth)
      box = { x: r.x + s.padX * z, y: r.y + s.padY * z, w: r.w - 2 * s.padX * z, h: r.h - 2 * s.padY * z }
      fontSize = s.fontSize * z
      fontWeight = s.weight
      color = depth === 0 ? '#fff' : '#1e1e24'
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
        spellCheck
        rows={1}
        placeholder={item.kind === 'mind' ? 'Type an idea' : ''}
        style={{
          fontSize,
          fontWeight,
          textAlign: align,
          color,
          fontFamily: FONT_FAMILY,
          lineHeight: LINE_HEIGHT,
          caretColor: item.kind === 'mind' && color === '#fff' ? '#fff' : ACCENT,
        }}
        onChange={(ev) => editor.setEditingText(ev.target.value)}
        onKeyDown={(ev) => {
          ev.stopPropagation()
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

