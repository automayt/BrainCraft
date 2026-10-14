/** Renders the board itself, in world coordinates (the caller applies the camera transform). */

import { memo } from 'react'
import * as B from '../model/board'
import { type Vec, center } from '../model/geom'
import { nodeStyle, placeholderFor } from '../model/mindmap'
import { flowDetail, flowOutline, flowTextRect } from '../model/shapes'
import { KanbanView } from './widgets/KanbanView'
import { TableView } from './widgets/TableView'
import { TimelineView } from './widgets/TimelineView'
import { type Board, type Connector, type Id, type Item, TEXT_ON_FILL, usesInk } from '../model/types'

export function darken(hex: string, k = 0.72): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (s: number) => Math.round(((n >> s) & 255) * k)
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`
}

function Text({ item, className, color }: { item: Item; className: string; color?: string }) {
  return (
    <foreignObject x={item.x} y={item.y} width={Math.max(item.w, 1)} height={Math.max(item.h, 1)}>
      <div className={`item-text ${className}`} style={{ fontSize: item.fontSize, color }}>
        {item.text}
      </div>
    </foreignObject>
  )
}

function penPath(points: { x: number; y: number }[]): string {
  if (points.length === 1) return `M${points[0].x} ${points[0].y}h0.01`
  // Quadratic curves through midpoints smooth out the sampled stroke.
  let d = `M${points[0].x} ${points[0].y}`
  for (let k = 1; k < points.length - 1; k++) {
    const mx = (points[k].x + points[k + 1].x) / 2
    const my = (points[k].y + points[k + 1].y) / 2
    d += `Q${points[k].x} ${points[k].y} ${mx} ${my}`
  }
  const last = points[points.length - 1]
  return `${d}L${last.x} ${last.y}`
}

export function ItemShape({ item, depth, editing, live = false }: { item: Item; depth: number; editing: boolean; live?: boolean }) {
  const text = editing ? null : item.text
  switch (item.kind) {
    case 'frame': {
      const t = B.frameTitleRect(item)
      return (
        <g>
          <rect x={item.x} y={item.y} width={item.w} height={item.h} fill={item.color} stroke="#c8c8ce" rx={2} />
          {!editing && (
            <foreignObject x={t.x} y={t.y} width={t.w} height={t.h}>
              <div className="frame-title" style={{ fontSize: item.fontSize }}>
                {item.text || 'Untitled frame'}
              </div>
            </foreignObject>
          )}
        </g>
      )
    }
    case 'sticky':
      return (
        <g>
          <rect x={item.x} y={item.y + 3} width={item.w} height={item.h} rx={4} fill="rgba(0,0,0,0.09)" />
          <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={4} fill={item.color} />
          {text && <Text item={item} className="centered" color={TEXT_ON_FILL} />}
        </g>
      )
    case 'rect':
      return (
        <g>
          <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={6} fill={item.color} stroke={darken(item.color)} strokeWidth={2} />
          {text && <Text item={item} className="centered" color={TEXT_ON_FILL} />}
        </g>
      )
    case 'ellipse': {
      const c = center(item)
      return (
        <g>
          <ellipse cx={c.x} cy={c.y} rx={item.w / 2} ry={item.h / 2} fill={item.color} stroke={darken(item.color)} strokeWidth={2} />
          {text && <Text item={item} className="centered ellipse" color={TEXT_ON_FILL} />}
        </g>
      )
    }
    case 'text':
      return text ? <Text item={item} className="plain" color={item.color} /> : null
    case 'pen':
      return (
        <path
          d={penPath(item.points ?? [])}
          fill="none"
          stroke={item.color}
          strokeWidth={item.strokeWidth ?? 4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    case 'mind':
      return <MindNode item={item} depth={depth} editing={editing} />
    case 'flow':
      return <FlowNode item={item} editing={editing} />
    case 'comment':
      return <CommentBlock item={item} editing={editing} />
    case 'image':
      return <image href={item.src} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="none" />
    case 'table':
      return item.table ? <TableView item={item} live={live} editingTitle={editing} /> : null
    case 'kanban':
      return item.kanban ? <KanbanView item={item} live={live} editingTitle={editing} /> : null
    case 'timeline':
      return item.timeline ? <TimelineView item={item} live={live} editingTitle={editing} /> : null
    default:
      return null
  }
}

/** Where a comment block's text goes. */
export function commentBodyRect(i: Item) {
  return { x: i.x + 12, y: i.y + 38, w: Math.max(1, i.w - 24), h: Math.max(1, i.h - 46) }
}

export function formatTime(at: number, now = Date.now()): string {
  const s = Math.round((now - at) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  const d = new Date(at)
  const today = new Date(now)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Today ${time}`
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`
}

function CommentBlock({ item, editing }: { item: Item; editing: boolean }) {
  const body = commentBodyRect(item)
  return (
    <g>
      <rect x={item.x} y={item.y + 2} width={item.w} height={item.h} rx={10} fill="rgba(0,0,0,0.07)" />
      <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={10} fill={item.color} stroke={darken(item.color, 0.8)} />
      <foreignObject x={item.x} y={item.y} width={item.w} height={30}>
        <div className="comment-head">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16v11H10l-4 4v-4H4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          <span>Comment</span>
          {item.createdAt && <time>{formatTime(item.createdAt)}</time>}
        </div>
      </foreignObject>
      {!editing && (
        <foreignObject x={body.x} y={body.y} width={body.w} height={body.h}>
          <div className="item-text comment-body" style={{ fontSize: item.fontSize, color: TEXT_ON_FILL }}>
            {item.text || <span className="muted">Write a comment…</span>}
          </div>
        </foreignObject>
      )}
    </g>
  )
}

/** Outline colour for a filled shape; white fills get a neutral grey. */
export function strokeFor(color: string): string {
  return color.toLowerCase() === '#ffffff' ? '#6e6e78' : darken(color, 0.6)
}

function FlowNode({ item, editing }: { item: Item; editing: boolean }) {
  const detail = flowDetail(item)
  const stroke = strokeFor(item.color)
  const t = flowTextRect(item)
  return (
    <g>
      <path d={flowOutline(item)} fill={item.color} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
      {detail && <path d={detail} fill="none" stroke={stroke} strokeWidth={2} />}
      {!editing && item.text && (
        <foreignObject x={t.x} y={t.y} width={t.w} height={t.h}>
          <div className="item-text centered flow" style={{ fontSize: item.fontSize, color: TEXT_ON_FILL }}>
            {item.text}
          </div>
        </foreignObject>
      )}
    </g>
  )
}

function MindNode({ item, depth, editing }: { item: Item; depth: number; editing: boolean }) {
  const s = nodeStyle(depth)
  const shape =
    depth === 0 ? (
      <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={14} fill={item.color} />
    ) : depth === 1 ? (
      <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={10} fill="#fff" stroke={item.color} strokeWidth={2.5} />
    ) : (
      <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={8} fill={item.color} fillOpacity={0.13} />
    )
  return (
    <g>
      {shape}
      {!editing && (
        <foreignObject x={item.x} y={item.y} width={item.w} height={item.h}>
          <div
            className={`mind-text${item.text ? '' : ' placeholder'}`}
            style={{
              fontSize: s.fontSize,
              fontWeight: s.weight,
              padding: `${s.padY}px ${s.padX}px`,
              color: depth === 0 ? '#fff' : TEXT_ON_FILL,
            }}
          >
            {item.text || placeholderFor(depth)}
          </div>
        </foreignObject>
      )}
    </g>
  )
}

/** Curved branches from each visible mind node to its parent. */
export function MindEdges({ board, hidden, depths }: { board: Board; hidden: ReadonlySet<Id>; depths: Map<Id, number> }) {
  const byId = new Map(board.items.map((i) => [i.id, i]))
  return (
    <g fill="none" strokeLinecap="round">
      {board.items.map((n) => {
        if (n.kind !== 'mind' || n.parent === undefined || hidden.has(n.id)) return null
        const p = byId.get(n.parent)
        if (!p) return null
        const right = n.x >= p.x + p.w / 2
        const x0 = right ? p.x + p.w : p.x
        const y0 = p.y + p.h / 2
        const x1 = right ? n.x : n.x + n.w
        const y1 = n.y + n.h / 2
        const mx = (x0 + x1) / 2
        const depth = depths.get(n.id) ?? 1
        return (
          <path
            key={n.id}
            d={`M${x0} ${y0}C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`}
            stroke={n.color}
            strokeWidth={depth === 1 ? 3.5 : 2.2}
          />
        )
      })}
    </g>
  )
}

/** Collapse toggles on mind nodes with children: always shown when collapsed. */
export function CollapseToggles({
  board,
  hidden,
  selection,
}: {
  board: Board
  hidden: ReadonlySet<Id>
  selection: ReadonlySet<Id>
}) {
  const childCount = new Map<Id, number>()
  for (const i of board.items) if (i.kind === 'mind' && i.parent !== undefined) childCount.set(i.parent, (childCount.get(i.parent) ?? 0) + 1)
  return (
    <g>
      {board.items.map((n) => {
        if (n.kind !== 'mind' || hidden.has(n.id) || !childCount.has(n.id) || n.parent === undefined) return null
        if (!n.collapsed && !selection.has(n.id)) return null
        const parent = board.items.find((i) => i.id === n.parent)
        const right = !parent || n.x >= parent.x + parent.w / 2
        const cx = right ? n.x + n.w + 12 : n.x - 12
        const cy = n.y + n.h / 2
        const count = B.subtree(board, n.id).size - 1
        return (
          <g key={n.id} data-handle="collapse" data-id={n.id} className="collapse-toggle">
            <circle cx={cx} cy={cy} r={10} fill="#fff" stroke={n.color} strokeWidth={2} />
            <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={n.collapsed ? 10 : 14} fill={n.color} fontWeight={700}>
              {n.collapsed ? count : '−'}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Arrowhead({ tip, dir, size, color }: { tip: Vec; dir: Vec; size: number; color: string }) {
  const bx = tip.x - dir.x * size
  const by = tip.y - dir.y * size
  const w = size * 0.45
  return <polygon points={`${tip.x},${tip.y} ${bx - dir.y * w},${by + dir.x * w} ${bx + dir.y * w},${by - dir.x * w}`} fill={color} />
}

export function ConnectorView({
  board,
  c,
  selected,
  editing,
}: {
  board: Board
  c: Connector
  selected: boolean
  editing: boolean
}) {
  const r = B.connectorRoute(board, c)
  if (!r || Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y) < 1) return null
  const color = selected ? '#4262ff' : c.color
  const arrows = c.arrows ?? 'end'
  const head = 12
  return (
    <g>
      <path
        d={r.d}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 3 : 2}
        strokeLinejoin="round"
        strokeDasharray={c.dashed ? '7 5' : undefined}
      />
      {arrows !== 'none' && <Arrowhead tip={r.end} dir={r.endDir} size={head} color={color} />}
      {arrows === 'both' && <Arrowhead tip={r.start} dir={{ x: -r.startDir.x, y: -r.startDir.y }} size={head} color={color} />}
      {c.label && !editing && (
        <foreignObject x={r.mid.x - 120} y={r.mid.y - 20} width={240} height={40}>
          <div className="connector-label">
            <span style={{ color }}>{c.label}</span>
          </div>
        </foreignObject>
      )}
    </g>
  )
}

/** Depth of every mind node (0 for roots). */
export function mindDepths(board: Board): Map<Id, number> {
  const parent = new Map<Id, Id | undefined>()
  for (const i of board.items) if (i.kind === 'mind') parent.set(i.id, i.parent)
  const depths = new Map<Id, number>()
  const depth = (id: Id, guard = 0): number => {
    const known = depths.get(id)
    if (known !== undefined) return known
    const p = parent.get(id)
    const d = p === undefined || guard > 500 || !parent.has(p) ? 0 : depth(p, guard + 1) + 1
    depths.set(id, d)
    return d
  }
  for (const id of parent.keys()) depth(id)
  return depths
}

/** The whole board: frames, mind-map branches, items, then connectors on top. */
export const BoardView = memo(function BoardView({
  board,
  hidden,
  editingId,
  editingLabel,
  selectedConnector,
  selection,
}: {
  board: Board
  hidden: ReadonlySet<Id>
  editingId: Id | null
  editingLabel: Id | null
  selectedConnector: Id | null
  selection: ReadonlySet<Id>
}) {
  const depths = mindDepths(board)
  const visible = board.items.filter((i) => !hidden.has(i.id))
  return (
    <g>
      {visible
        .filter((i) => i.kind === 'frame')
        .map((i) => (
          <ItemShape key={i.id} item={i} depth={0} editing={editingId === i.id} />
        ))}
      <MindEdges board={board} hidden={hidden} depths={depths} />
      {visible
        .filter((i) => i.kind !== 'frame')
        .map((i) => (
          <ItemShape
            key={i.id}
            item={i}
            depth={depths.get(i.id) ?? 0}
            editing={editingId === i.id}
            live={selection.size === 1 && selection.has(i.id) && editingId === null}
          />
        ))}
      <CollapseToggles board={board} hidden={hidden} selection={selection} />
      {board.connectors
        .filter((c) => !hidden.has(c.from) && !hidden.has(c.to))
        .map((c) => (
          <ConnectorView key={c.id} board={board} c={c} selected={c.id === selectedConnector} editing={c.id === editingLabel} />
        ))}
    </g>
  )
})

export const inkFor = (i: Item) => (usesInk(i.kind) ? i.color : TEXT_ON_FILL)
