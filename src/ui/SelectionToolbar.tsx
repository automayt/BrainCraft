import * as B from '../model/board'
import { isDrawing } from '../model/excalidraw'
import { canSketch } from '../model/sketch'
import { rectToWorld } from '../model/camera'
import { intersects } from '../model/geom'
import * as RX from '../model/reactions'
import { canHaveStatus, STATUSES, statusInfo } from '../model/status'
import { hasSketch, sketchToBoard } from './sketch'
import { BRANCHES, FILLS, FLOW_SHAPES, type FlowShape, INKS, MIND_ROOT_COLOR, isWidget, usesInk } from '../model/types'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useButtonMenu } from './menuKeys'
import { AssignMenu, TrackMenu } from './TimeTracking'
import { canLink, describeLink, type ItemLink } from '../model/itemLink'
import { mentionCandidates, objectLabel } from '../model/notes'
import { targetFromUrl } from '../store/deepLink'
import { useWorkspace } from './useWorkspace'
import { followLink } from './followLink'
import { useUi } from './uiContext'
import { useEditor } from './useEditor'

/** A toolbar too wide for the screen scrolls sideways with an ordinary mouse wheel. */
const scrollSideways = (e: React.WheelEvent<HTMLElement>) => {
  const el = e.currentTarget
  if (e.deltaY && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY
}

/** Clicking a button here leaves the keyboard with the board, so Ctrl Z, Delete and arrows still work. */
const keepCanvasKeys = (e: React.MouseEvent) => {
  if ((e.target as Element).closest('button')) e.preventDefault()
}

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
    // Clear of the whole line, so a second click (to label it) lands on the line, not a button.
    const xs = r.points.map((p) => p.x)
    const ys = r.points.map((p) => p.y)
    const box = editor.screenRect({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) })
    anchor = { x: s.x, y: box.y - 20 }
    below = box.y + box.h + 20
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
  // (and of the flowchart shape panel beside it, when that's open).
  // (The rail ends at 62px, or 94px and 128px where short screens give it two or three columns;
  // the panel is 270px wide, 12px to its right.)
  const rail = editor.viewport.h <= 450 ? 128 : editor.viewport.h <= 660 ? 94 : 62
  const leftInset = editor.viewport.w > 720 ? (editor.flowPalette ? rail + 292 : rail + 6) : 12
  const minX = leftInset + width / 2
  // ...and clear of the comments panel or assistant on the right.
  const maxX = editor.viewport.w - editor.rightInset - 12 - width / 2
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
  // Below the top bar, and below what stacks under it while that's showing: "Since you were
  // here", the timer, the "Watching live" banner. (The board fills the window, so the stack's
  // page position is its position here too.)
  const stack = editor.catchUp || editor.timer || editor.readOnly ? document.querySelector('.top-stack')?.getBoundingClientRect() : undefined
  const topLimit = stack && stack.height ? Math.max(64, stack.bottom + 8) : 64
  const aboveTop = anchor.y - size.h
  // On phones the tool rail and zoom bar take the bottom ~130px.
  // On desktops the status key, hint and zoom bar sit along the bottom; on phones the tool rail too.
  // Over the minimap's corner, keep above the minimap (200 × 136, 12px in from the edges).
  const overMinimap = editor.viewport.w > 720 && x + width / 2 > editor.viewport.w - editor.rightInset - 12 - 200
  const bottomLimit = editor.viewport.w > 720 ? (overMinimap ? 160 : 64) : 140
  const fitsBelow = below !== null && below + size.h < editor.viewport.h - bottomLimit
  const useBelow = fitsBelow && (aboveTop < topLimit || (width > 0 && covered(below!) < covered(aboveTop) * 0.5))
  const y = useBelow ? below! : Math.max(anchor.y, topLimit + size.h)
  const plain = (i: (typeof items)[number]) => i.kind !== 'image' && i.kind !== 'link' && i.kind !== 'code' && !isWidget(i.kind)
  const hasFontSize = items.some((i) => i.kind !== 'mind' && i.kind !== 'pen' && plain(i))
  const colorable = !items.length || items.some(plain)
  const current = items[0]?.color

  return (
    <div ref={ref} className={`selection-toolbar no-canvas${useBelow ? ' below' : ''}`} style={{ left: x, top: y, maxWidth: Math.max(240, editor.viewport.w - editor.rightInset - leftInset - 12) }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={keepCanvasKeys} onWheel={scrollSideways}>
      {colorable && (
      <div className="swatches">
        {palette.map(([name, color]) => (
          <button
            key={name + color}
            className={`swatch${current === color ? ' active' : ''}`}
            style={{ background: color }}
            title={name}
            aria-label={name}
            aria-pressed={current === color}
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
              aria-label={`${style[0].toUpperCase()}${style.slice(1)} line`}
              aria-pressed={(connector.style ?? 'straight') === style}
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
              aria-label={title}
              aria-pressed={(connector.arrows ?? 'end') === arrows}
              onClick={() => editor.setArrowheads(arrows)}
            >
              {glyph}
            </button>
          ))}
 <button
            className={connector.dashed ? 'on' : ''}
            title="Dashed line"
            aria-label="Dashed line"
            aria-pressed={!!connector.dashed}
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
          <button title="Smaller text" aria-label="Smaller text" onClick={() => editor.scaleFont(1 / 1.2)}>
            A−
          </button>
          <button title="Larger text" aria-label="Larger text" onClick={() => editor.scaleFont(1.2)}>
            A+
          </button>
        </>
      )}
      {mind && (
        <>
          <span className="sep" />
          <button title="Add a sub-idea (Tab)" onClick={() => editor.addMindNode(mind.id, 'child')}>
            + Sub-idea
          </button>
          {mind.parent !== undefined && (
            <button title="Add an idea below this one (Enter)" onClick={() => editor.addMindNode(mind.id, 'sibling')}>
              + Idea below
            </button>
          )}
          {board.items.some((i) => i.parent === mind.id) && (
            <button title="Collapse or expand (/)" onClick={() => editor.toggleCollapsed(mind.id)}>
              {mind.collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          <button title="Edit the whole map as an outline beside the board, or copy it as Markdown" onClick={() => editor.openOutline(mind.id)}>
            Outline
          </button>
        </>
      )}
      <span className="sep" />
      {items.length > 1 && <AlignMenu count={items.length} />}
      {items.length > 1 && items.every((i) => i.kind === 'mind' && i.parent !== undefined) && new Set(items.map((i) => i.parent)).size === 1 && (
        <button title="Put these ideas under a new idea (Ctrl G)" onClick={() => editor.groupIdeas()}>
          Group
        </button>
      )}
      {items.length > 1 && !items.every((i) => i.kind === 'mind') && !(items.every((i) => i.group) && new Set(items.map((i) => i.group)).size === 1) && (
        <button title="Group: select and move these as one (Ctrl G)" onClick={() => editor.group()}>
          Group
        </button>
      )}
      {items.some((i) => i.group) && (
        <button title="Ungroup (Ctrl Shift G)" onClick={() => editor.ungroup()}>
          Ungroup
        </button>
      )}
      {items.length > 0 && (
        <button
          title={items.every((i) => i.locked) ? 'Unlock (Ctrl Shift L)' : 'Lock: can’t be moved or changed by accident (Ctrl Shift L)'}
          aria-pressed={items.every((i) => i.locked)}
          onClick={() => editor.setLocked(!items.every((i) => i.locked))}
        >
          {items.every((i) => i.locked) ? 'Unlock' : 'Lock'}
        </button>
      )}
      {items.length > 0 && !mind && (
        <>
          <button title="Bring to front (draw on top of everything)" onClick={() => editor.bringToFront()}>
            To front
          </button>
          <button title="Send to back (draw under everything)" onClick={() => editor.sendToBack()}>
            To back
          </button>
        </>
      )}
      {items.length > 0 && items.every((i) => i.kind === 'sticky') &&
        (items.every((i) => typeof i.back === 'string') ? (
          <button title="Turn over (or click ↻ on the card)" onClick={() => editor.flipCards()}>
            ↻ Turn over
          </button>
        ) : (
          <button title="Give this note a back to write on: a flip card" onClick={() => editor.setFlipCards(true)}>
            Add a back
          </button>
        ))}
      {items.some((i) => canHaveStatus(i.kind)) && <StatusMenu />}
      {!editor.readOnly && items.some((i) => canHaveStatus(i.kind)) && <AssignMenu />}
      {items.some((i) => canHaveStatus(i.kind)) && <TrackMenu />}
      {!editor.readOnly && items.length > 0 && items.every((i) => canLink(i.kind)) && <LinkMenu />}
      {items.length > 0 && <ReactMenu />}
      {items.length === 1 && isDrawing(items[0]) && (
        <button title="Open this drawing in Excalidraw (or double-click it)" onClick={() => editor.openDrawing(items[0].id)}>
          {editor.readOnly ? 'Open drawing' : 'Edit drawing'}
        </button>
      )}
      {items.some((i) => canSketch(i.kind)) && (
        <button
          className={editor.selectionSketched ? 'on' : ''}
          aria-pressed={editor.selectionSketched}
          title={editor.selectionSketched ? 'Draw with clean lines again' : 'Draw by hand: wobbly outlines and handwriting, like a sketch (a flowchart goes all at once)'}
          onClick={() => editor.setSketch(!editor.selectionSketched)}
        >
          ✎ Hand-drawn
        </button>
      )}
      {hasSketch(editor) && !items.some(isDrawing) && (
        <button title="Turn this drawing or photo into real objects with the AI assistant (previewed first)" onClick={() => void sketchToBoard(editor)}>
          ✦ To board
        </button>
      )}
      {items.length > 1 && !items.some((i) => i.poll || i.kind === 'frame') && !items.every((i) => isWidget(i.kind)) && (
        <button title="Start a dot vote on these: everyone gets a few votes, counts hidden until revealed" onClick={() => editor.startVote()}>
          Vote
        </button>
      )}
      {items.length > 0 && (
        <button title="Duplicate (Ctrl D)" onClick={() => editor.duplicate()}>
          Duplicate
        </button>
      )}
      {editor.single && (
        <button title="Comments (Alt C)" onClick={() => editor.toggleNotes(true)}>
          Comments{editor.single.notes?.length ? ` (${editor.single.notes.length})` : ''}
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
  const { at, close, toggle, menuProps } = useButtonMenu()
  const open = !!at
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
        aria-haspopup="menu"
        onClick={toggle}
      >
        Align
      </button>
      {at &&
        createPortal(
        <div className="align-menu no-canvas" role="menu" {...menuProps} style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={keepCanvasKeys}>
          {ALIGN.map((a) => (
            <button
              key={a.how}
              role="menuitem"
              title={a.label}
              aria-label={a.label}
              onClick={() => {
                editor.align(a.how)
                close()
              }}
            >
              {icon(a.d)}
            </button>
          ))}
          <button role="menuitem" title="Space evenly across" aria-label="Distribute horizontally" disabled={count < 3} onClick={() => (editor.distribute('x'), close())}>
            {icon('M2 3v12M16 3v12M7 6h4v6H7z')}
          </button>
          <button role="menuitem" title="Space evenly down" aria-label="Distribute vertically" disabled={count < 3} onClick={() => (editor.distribute('y'), close())}>
            {icon('M3 2h12M3 16h12M6 7h6v4H6z')}
          </button>
        </div>,
          document.body,
        )}
    </span>
  )
}

/** A small round status icon, as drawn on the board. */
export function StatusDot({ status, size = 16 }: { status: string | undefined; size?: number }) {
  const s = statusInfo(status)
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="status-dot">
      {s ? (
        <>
          <circle cx="10" cy="10" r="10" style={{ fill: s.color }} />
          <path d={s.icon} transform="translate(2 2)" />
        </>
      ) : (
        <circle cx="10" cy="10" r="8.5" className="status-none" />
      )}
    </svg>
  )
}

/** What a link can lead to, found by name (or pasted as an address). */
interface LinkChoice {
  link: ItemLink
  label: string
  hint: string
}

/** Make the selection lead somewhere: a wiki page, a board, an object, or a web address. */
function LinkMenu() {
  const editor = useEditor()
  const ws = useWorkspace()
  const { at, close, toggle, menuProps } = useButtonMenu()
  const [query, setQuery] = useState('')
  const items = editor.selectedItems
  const current = items.length === 1 ? items[0].linkTo : undefined
  const q = query.trim().toLowerCase()

  const choices: LinkChoice[] = []
  // A pasted address: a BrainCraft link becomes a place in BrainCraft, anything else stays a web address.
  const pasted = query.trim()
  const place = pasted ? targetFromUrl(pasted) : null
  if (place) {
    const board = place.board ? ws.findBoard(place.board) : undefined
    const page = place.page !== undefined ? board?.outline?.find((p) => p.id === place.page) : undefined
    const label = page?.title ?? board?.title ?? 'That place'
    choices.push({ link: { ...place, label }, label, hint: page ? `📘 ${board!.title}` : 'From the link' })
  } else if (/^https?:\/\/\S+$/i.test(pasted)) choices.push({ link: { url: pasted }, label: pasted, hint: 'Web address' })
  // Pages of every wiki here first: what links from a board usually lead to.
  for (const r of ws.otherBoards) {
    for (const p of r.pages ?? []) {
      if (choices.length >= 10) break
      if (!q || p.title.toLowerCase().includes(q)) choices.push({ link: { board: r.key, page: p.id, label: p.title || 'Untitled' }, label: p.title || 'Untitled', hint: `${p.icon ?? '📄'} ${r.title}` })
    }
  }
  for (const r of ws.otherBoards) {
    if (choices.length >= 14) break
    if (!q || r.title.toLowerCase().includes(q)) choices.push({ link: { board: r.key, label: r.title }, label: r.title || 'Untitled', hint: r.kind === 'wiki' ? '📘 Wiki' : '📋 Board' })
  }
  if (q)
    for (const i of mentionCandidates(editor.board, q, items[0]?.id, 4))
      if (!items.some((s) => s.id === i.id)) choices.push({ link: { item: i.id, label: objectLabel(i) }, label: objectLabel(i), hint: 'On this board' })

  const pick = (l: ItemLink | null) => {
    editor.setLink(l)
    setQuery('')
    close()
  }
  return (
    <span className="align-anchor">
      <button title="Link: make this lead to a wiki page, a board, an object or a web address" aria-label="Link" aria-expanded={!!at} className={`${current ? 'linked-button ' : ''}${at ? 'on' : ''}`} aria-haspopup="menu" onClick={toggle}>
        🔗 {current ? 'Linked' : 'Link'}
      </button>
      {at &&
        createPortal(
          <div className="align-menu link-menu no-canvas" role="menu" {...menuProps} style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
            {current && (
              <div className="link-current">
                <span>
                  <small className="muted">Leads to</small> {describeLink(current)}
                </span>
                <button
                  role="menuitem"
                  onClick={() => {
                    followLink(ws, editor, current)
                    close()
                  }}
                >
                  Open
                </button>
                <button role="menuitem" className="danger-quiet" onClick={() => pick(null)}>
                  Remove
                </button>
              </div>
            )}
            <input
              autoFocus
              className="link-search"
              placeholder="Find a page or board, or paste a link"
              aria-label="Find a page or board, or paste a link"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Typing stays here; Enter takes the first choice.
                e.stopPropagation()
                if (e.key === 'Enter' && choices[0]) pick(choices[0].link)
                if (e.key === 'Escape') close()
                if (e.key === 'ArrowDown') (e.currentTarget.parentElement?.querySelector('.link-choice') as HTMLElement | null)?.focus()
              }}
            />
            {choices.length ? (
              choices.map((c, k) => (
                <button key={k} role="menuitem" className="link-choice" onClick={() => pick(c.link)}>
                  <span>{c.label}</span>
                  <small className="muted">{c.hint}</small>
                </button>
              ))
            ) : (
              <p className="muted link-none">{q ? `Nothing called “${query.trim()}” here. Paste a page’s link (Copy link on the page) or a web address.` : 'No wikis or boards here yet.'}</p>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}

/** Where the selection stands: to do, in progress, done… */
function StatusMenu() {
  const editor = useEditor()
  const { at, close, toggle, menuProps } = useButtonMenu()
  const marked = editor.selectedItems.filter((i) => canHaveStatus(i.kind))
  const same = marked.every((i) => i.status === marked[0]?.status) ? marked[0]?.status : undefined
  return (
    <span className="align-anchor">
      <button
        title="Status: where this stands"
        aria-label="Status"
        aria-expanded={!!at}
        className={`status-button${at ? ' on' : ''}`}
        aria-haspopup="menu"
        onClick={toggle}
      >
        <StatusDot status={same} />
        {statusInfo(same)?.label ?? 'Status'}
      </button>
      {at &&
        createPortal(
          <div className="align-menu status-menu no-canvas" role="menu" {...menuProps} style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={keepCanvasKeys}>
            {STATUSES.map((st) => (
              <button
                key={st.id}
                role="menuitemradio"
                aria-checked={same === st.id}
                className={same === st.id ? 'on' : ''}
                onClick={() => {
                  editor.markStatus(st.id)
                  close()
                }}
              >
                <StatusDot status={st.id} />
                {st.label}
                {st.id === 'done' && <kbd>Ctrl Enter</kbd>}
              </button>
            ))}
            {marked.some((i) => i.status) && (
              <button
                role="menuitem"
                onClick={() => {
                  editor.markStatus(null)
                  close()
                }}
              >
                <StatusDot status={undefined} />
                No status
              </button>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}

/** Emoji reactions for the selection. */
function ReactMenu() {
  const editor = useEditor()
  const { at, close, toggle, menuProps } = useButtonMenu()
  const me = editor.me
  return (
    <span className="align-anchor">
      <button
        title="React"
        aria-label="React"
        aria-expanded={!!at}
        className={at ? 'on' : ''}
        aria-haspopup="menu"
        onClick={toggle}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 10.5c.8 1.2 1.8 1.8 3 1.8s2.2-.6 3-1.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="6.6" cy="7" r="1" fill="currentColor" />
          <circle cx="11.4" cy="7" r="1" fill="currentColor" />
        </svg>
      </button>
      {at &&
        createPortal(
          <div className="align-menu react-menu no-canvas" role="menu" {...menuProps} style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={keepCanvasKeys}>
            {RX.REACTIONS.map((emoji) => {
              const on = editor.selectedItems.length > 0 && editor.selectedItems.every((i) => i.reactions?.[emoji]?.includes(me))
              return (
                <button
                  key={emoji}
                  role="menuitemcheckbox"
                  aria-checked={on}
                  className={on ? 'on' : ''}
                  title={on ? 'Take your reaction off' : 'React'}
                  onClick={() => {
                    editor.toggleReaction(emoji)
                    close()
                  }}
                >
                  {emoji}
                </button>
              )
            })}
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
