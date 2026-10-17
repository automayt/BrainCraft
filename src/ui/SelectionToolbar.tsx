import * as B from '../model/board'
import { rectToWorld } from '../model/camera'
import { intersects } from '../model/geom'
import { BRANCHES, FILLS, FLOW_SHAPES, type FlowShape, INKS, MIND_ROOT_COLOR, isWidget, usesInk } from '../model/types'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUi } from './uiContext'
import { useEditor } from './useEditor'

/** Floating controls above the selection: colour, text size, mind-map and arrangement actions. */
export function SelectionToolbar() {
  const editor = useEditor()
  const ui = useUi()
  const [size, setSize] = useState({ w: 0, h: 40 })
  const width = size.w
  // Measure the bar so it can be kept fully on screen and clear of the tool rail. A resize
  // observer, not a read after every render: that would force a layout of the whole board.
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(([e]) => {
      const w = Math.round(e.borderBoxSize?.[0]?.inlineSize ?? el.offsetWidth)
      const h = Math.round(e.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight)
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    })
    observer.current.observe(el)
  }, [])
  if (editor.drag.type !== 'none' || editor.editing || editor.shapePicker || ui.menu) return null
  const { board } = editor
  let anchor: { x: number; y: number }
  /** Where it goes if there's no room above (its top edge). */
  let below: number | null = null
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
    // Flowchart shapes have "add a step" arrows just outside them: keep clear of those.
    const gap = items.some((i) => i.kind === 'flow') ? 40 : 16
    anchor = { x: r.x + r.w / 2, y: r.y - gap }
    below = r.y + r.h + gap
    if (items.every((i) => i.kind === 'mind')) {
      palette = mind?.parent === undefined && mind ? [['Ink', MIND_ROOT_COLOR], ...BRANCHES] : BRANCHES
    } else palette = items.every((i) => usesInk(i.kind)) ? INKS : FILLS
  } else return null

  const connector = editor.selectedConnector !== null ? B.getConnector(board, editor.selectedConnector) : undefined
  const flows = items.filter((i) => i.kind === 'flow')
  // Clear of the tool rail on the left (on phones it sits at the bottom instead).
  const minX = (editor.viewport.w > 720 ? 68 : 12) + width / 2
  const maxX = editor.viewport.w - 12 - width / 2
  const x = maxX < minX ? minX : Math.min(Math.max(anchor.x, minX), maxX)
  // Above the selection unless that's under the top bar or covers more of the board than below.
  const covered = (top: number) => {
    const box = rectToWorld(editor.camera, { x: x - width / 2, y: top, w: width, h: size.h })
    let area = 0
    for (const i of board.items) {
      if (editor.selection.has(i.id) || !intersects(box, i)) continue
      area += (Math.min(box.x + box.w, i.x + i.w) - Math.max(box.x, i.x)) * (Math.min(box.y + box.h, i.y + i.h) - Math.max(box.y, i.y))
    }
    return area
  }
  const aboveTop = anchor.y - size.h
  // On phones the tool rail and zoom bar take the bottom ~130px.
  const fitsBelow = below !== null && below + size.h < editor.viewport.h - (editor.viewport.w > 720 ? 12 : 140)
  const useBelow = fitsBelow && (aboveTop < 64 || (width > 0 && covered(below!) < covered(aboveTop) * 0.5))
  const y = useBelow ? below! : Math.max(anchor.y, 64 + size.h)
  const plain = (i: (typeof items)[number]) => i.kind !== 'image' && !isWidget(i.kind)
  const hasFontSize = items.some((i) => i.kind !== 'mind' && i.kind !== 'pen' && plain(i))
  const colorable = !items.length || items.some(plain)
  const current = items[0]?.color

  return (
    <div ref={ref} className={`selection-toolbar no-canvas${useBelow ? ' below' : ''}`} style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      {colorable && (
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
      )}
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
 <button
            className={connector.dashed ? 'on' : ''}
            title="Dashed line"
            onClick={() => editor.setDashed(!connector.dashed)}
          >
            ┅
          </button>
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
      {items.length > 1 && <AlignMenu count={items.length} />}
      {items.length > 1 && items.every((i) => i.kind === 'mind' && i.parent !== undefined) && new Set(items.map((i) => i.parent)).size === 1 && (
        <button title="Put these ideas under a new idea (Ctrl+G)" onClick={() => editor.groupIdeas()}>
          Group
        </button>
      )}
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

const ALIGN: { how: B.AlignHow; label: string; d: string }[] = [
  { how: 'left', label: 'Align left', d: 'M3 2v14M6 5h9M6 11h5' },
  { how: 'center', label: 'Align centres', d: 'M9 2v14M4 5h10M6 11h6' },
  { how: 'right', label: 'Align right', d: 'M15 2v14M3 5h9M7 11h5' },
  { how: 'top', label: 'Align tops', d: 'M2 3h14M5 6v9M11 6v5' },
  { how: 'middle', label: 'Align middles', d: 'M2 9h14M5 4v10M11 6v6' },
  { how: 'bottom', label: 'Align bottoms', d: 'M2 15h14M5 3v9M11 7v5' },
]

/** Align and distribute for a multiple selection. */
function AlignMenu({ count }: { count: number }) {
  const editor = useEditor()
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const open = !!at
  const setOpen = (v: boolean) => !v && setAt(null)
  const icon = (d: string) => (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
  return (
    <span className="align-anchor">
      <button
        title="Align and distribute"
        aria-expanded={open}
        className={open ? 'on' : ''}
        onClick={(e) => {
          // The toolbar scrolls sideways on small screens, so the menu lives outside it.
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setAt(open ? null : { x: r.left + r.width / 2, y: r.bottom + 8 })
        }}
      >
        Align
      </button>
      {at &&
        createPortal(
        <div className="align-menu no-canvas" role="menu" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
          {ALIGN.map((a) => (
            <button
              key={a.how}
              role="menuitem"
              title={a.label}
              aria-label={a.label}
              onClick={() => {
                editor.align(a.how)
                setOpen(false)
              }}
            >
              {icon(a.d)}
            </button>
          ))}
          <button role="menuitem" title="Space evenly across" aria-label="Distribute horizontally" disabled={count < 3} onClick={() => (editor.distribute('x'), setOpen(false))}>
            {icon('M2 3v12M16 3v12M7 6h4v6H7z')}
          </button>
          <button role="menuitem" title="Space evenly down" aria-label="Distribute vertically" disabled={count < 3} onClick={() => (editor.distribute('y'), setOpen(false))}>
            {icon('M3 2h12M3 16h12M6 7h6v4H6z')}
          </button>
        </div>,
          document.body,
        )}
    </span>
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
