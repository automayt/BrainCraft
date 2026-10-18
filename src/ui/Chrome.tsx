/** The floating controls around the canvas. */

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useDialog } from './useDialog'
import { preloadAi } from './lazyAi'
import { createPortal } from 'react-dom'
import { TOOLS, type Tool } from '../editor/Editor'
import { FLOW_SHAPES, type FlowShape, INKS } from '../model/types'
import {
  BoardsIcon,
  CheckIcon,
  CommentsIcon,
  FitIcon,
  FlowShapeIcon,
  HelpIcon,
  ImageIcon,
  Logo,
  MenuIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  SearchIcon,
  TOOL_ICONS,
  ThemeIcon,
  UndoIcon,
} from './icons'
import { ink } from './paint'
import { THEMES } from './theme'
import { useUi } from './uiContext'
import { useEditor } from './useEditor'
import { useEscape } from './useEscape'
import { isWiki } from '../model/wiki'
import { focusFirst, moveFocus } from './menuKeys'
import { useWorkspace } from './useWorkspace'
import { AiChip } from './AiConnect'
import { LiveBar } from './Live'

/** A label with an optional key shown on hover, positioned by the parent's `data-tip-side`. */
function Tip({ label, keys }: { label: string; keys?: string }) {
  return (
    <span className="tip" role="tooltip">
      {label}
      {keys && keys.split(' ').map((k) => <kbd key={k}>{k}</kbd>)}
    </span>
  )
}

/** Buttons in floating panels never take focus from the board, so shortcuts keep working. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

const BOARD_ICONS = ['🚗', '🏎️', '🔧', '🛠️', '🏠', '🌱', '📚', '🎮', '🎵', '🎬', '🍕', '✈️', '🏕️', '💡', '🧠', '📈', '💼', '🎨', '📷', '🐶', '🐱', '⚽', '🎉', '❤️', '⭐', '🔥', '🚀', '🧪', '💻', '📝', '🗺️', '🧩', '🎲', '🏋️', '🍳', '🛒', '💰', '📅', '🎁', '🌍']

/** The board's emoji, next to its title: click to pick one. */
function BoardIcon() {
  const editor = useEditor()
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const icon = editor.board.icon
  // The browser tab shows it too.
  useEffect(() => {
    const t = editor.board.title || 'Untitled board'
    document.title = `${icon ? `${icon} ` : ''}${t} · BrainCraft`
  }, [icon, editor.board.title])
  if (ws.viewOnly && !icon) return null
  return (
    <div className="anchor">
      <button
        className={`board-icon${icon ? '' : ' empty'}`}
        aria-label={icon ? 'Change the board icon' : 'Pick a board icon'}
        title={icon ? 'Change the board icon' : 'Pick an icon for this board'}
        disabled={ws.viewOnly}
        onMouseDown={keepFocus}
        onClick={() => setOpen(!open)}
      >
        {icon ?? (
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="9" cy="10" r="1.2" fill="currentColor" />
            <circle cx="15" cy="10" r="1.2" fill="currentColor" />
          </svg>
        )}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="icon-picker">
          <div className="icon-grid">
            {BOARD_ICONS.map((e) => (
              <button
                key={e}
                className={e === icon ? 'on' : ''}
                aria-label={`Use ${e} as the board icon`}
                title={e === icon ? 'The icon now' : undefined}
                onClick={() => {
                  editor.setBoardIcon(e)
                  setOpen(false)
                }}
              >
                {e}
              </button>
            ))}
          </div>
          {icon && (
            <button
              className="icon-clear"
              onClick={() => {
                editor.setBoardIcon(null)
                setOpen(false)
              }}
            >
              No icon
            </button>
          )}
        </Popover>
      )}
    </div>
  )
}

function Popover({ onClose, children, className = '' }: { onClose: () => void; children: ReactNode; className?: string }) {
  useEscape(onClose)
  const ref = useRef<HTMLDivElement>(null)
  // Opened from the keyboard (its button has focus; a click keeps focus on the board): the
  // first item takes focus, and the arrows move through the rest.
  useEffect(() => {
    const opener = document.activeElement?.tagName === 'BUTTON' ? (document.activeElement as HTMLElement) : null
    if (opener) focusFirst(ref.current)
    // ...and back to its button when it closes, unless something else (a dialog) took the keyboard.
    return () => {
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body || ref.current?.contains(document.activeElement))) opener.focus()
    }
  }, [])
  return (
    <>
      <div className="scrim" onPointerDown={onClose} />
      <div ref={ref} className={`popover ${className}`} role="menu" onKeyDown={moveFocus}>
        {children}
      </div>
    </>
  )
}

function MenuItem({ label, keys, onClick, checked }: { label: string; keys?: string; onClick: () => void; checked?: boolean }) {
  return (
    <button role="menuitem" className="menu-item" onMouseDown={keepFocus} onClick={onClick}>
      {checked !== undefined && <span className="check">{checked && <CheckIcon />}</span>}
      <span>{label}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  )
}

const SAVE_LABELS = { saved: 'Saved', saving: 'Saving…', unsaved: 'Saving…', error: 'Not saved' } as const

/** Whether the board is safely stored, and where. */
function SaveState() {
  const ws = useWorkspace()
  const ui = useUi()
  if (ws.readOnly) return null
  const tip = ws.persistent
    ? `${SAVE_LABELS[ws.saveState]} in this browser${ws.fileName ? ` · file: ${ws.fileName}` : ''}`
    : 'Not kept in this browser (it doesn’t keep data here) — save to a file to keep it'
  return (
    <span className={`save-state has-tip ${ws.persistent ? ws.saveState : 'error'}`}>
      <i aria-hidden="true" />
      {/* A problem is spelled out, not left to a red dot. */}
      {(!ws.persistent || ws.saveState === 'error') && (
        <button className="save-warning" aria-label="Not saved: save to a file" onMouseDown={keepFocus} onClick={() => (ws.canWriteFiles ? ui.saveFile() : ui.download())}>
          Not saved
        </button>
      )}
      <span className="sr-only">{tip}</span>
      {/* Only problems are announced, not every save. */}
      <span className="sr-only" aria-live="polite">
        {!ws.persistent || ws.saveState === 'error' ? tip : ''}
      </span>
      <Tip label={tip} />
    </span>
  )
}

export function TopLeft() {
  const editor = useEditor()
  const ui = useUi()
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const run = (f: () => void) => () => {
    close()
    f()
  }
  return (
    <div className="island top-left no-canvas">
      <div className="brand">
        <Logo />
        <span className="wordmark">BrainCraft</span>
      </div>
      <span className="divider" />
      <button className="icon-btn has-tip" aria-label="Your boards" onMouseDown={keepFocus} onClick={ui.openBoards}>
        <BoardsIcon />
        <Tip label="Your boards" keys="Ctrl O" />
      </button>
      <BoardIcon />
      <input
        className="board-title"
        value={editor.board.title}
        aria-label="Board title"
        spellCheck={false}
        readOnly={ws.viewOnly}
        onChange={(e) => editor.setTitle(e.target.value)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
      />
      <SaveState />
      <div className="anchor">
        <button className={`icon-btn${open ? ' on' : ''}`} aria-label="Board menu" aria-expanded={open} onMouseDown={keepFocus} onClick={() => setOpen(!open)}>
          <MenuIcon />
        </button>
        {open && (
          <Popover onClose={close} className="file-menu">
            <MenuItem label="Your boards…" keys="Ctrl O" onClick={run(ui.openBoards)} />
            <MenuItem label="New board" onClick={run(ui.newBoard)} />
            <MenuItem label="Open file…" onClick={run(ui.openFile)} />
            <hr />
            {ws.canWriteFiles ? (
              <>
                <MenuItem label={ws.fileName ? `Save to ${ws.fileName}` : 'Save to file…'} keys="Ctrl S" onClick={run(() => ui.saveFile())} />
                <MenuItem label="Save as…" keys="Ctrl Shift S" onClick={run(() => ui.saveFile(true))} />
              </>
            ) : (
              <MenuItem label="Download a copy" keys="Ctrl S" onClick={run(ui.download)} />
            )}
            <MenuItem label="Share…" onClick={run(ui.openShare)} />
            <MenuItem label="Connect an AI assistant…" onClick={run(ui.openAi)} />
            {!ws.viewOnly && <MenuItem label="Version history…" onClick={run(ui.openVersions)} />}
            {!isWiki(editor.board) && (
              <>
                <hr />
                {!ws.viewOnly && <MenuItem label="Import Mermaid / outline / JSON…" onClick={run(ui.openImport)} />}
                <MenuItem label="Export image or PDF…" keys="Ctrl Shift E" onClick={run(ui.openExport)} />
                <MenuItem label="Export as Mermaid…" onClick={run(() => ui.openImport('export'))} />
              </>
            )}
            <hr />
            <MenuItem label="Help and shortcuts" keys="?" onClick={run(ui.openHelp)} />
          </Popover>
        )}
      </div>
    </div>
  )
}

export function TopRight() {
  const editor = useEditor()
  const ws = useWorkspace()
  const ui = useUi()
  const [themes, setThemes] = useState(false)
  const wiki = isWiki(editor.board)
  return (
    <div className="island top-right no-canvas">
      <AiChip bridge={ui.ai} onClick={ui.openAi} />
      <LiveBar onOpen={ui.openShare} />
      {!ws.liveInfo && !ws.readOnly && (
        <button className="share-btn has-tip" aria-label="Share" onMouseDown={keepFocus} onClick={ui.openShare}>
          <span>Share</span>
          <Tip label="Invite friends to this board" />
        </button>
      )}
      <button
        className={`ask-btn has-tip${ui.assistant ? ' on' : ''}`}
        aria-label="Ask AI"
        aria-pressed={ui.assistant}
        onPointerEnter={() => void preloadAi()}
        onFocus={() => void preloadAi()}
        onMouseDown={keepFocus}
        onClick={ui.toggleAssistant}
      >
        <span aria-hidden="true">✦</span>
        <span>Ask AI</span>
        <Tip label="Chat with this board" keys="Ctrl J" />
      </button>
      {!wiki && (
        <button className="present-btn has-tip" aria-label="Present" onMouseDown={keepFocus} onClick={ui.present}>
          <PlayIcon />
          <span>Present</span>
          <Tip label="Frames become slides" keys="Shift P" />
        </button>
      )}
      <button className="search-pill" aria-label="Search or run a command" onMouseDown={keepFocus} onClick={() => editor.setSearchOpen(true)}>
        <SearchIcon />
        <span>Search or run a command</span>
        <kbd>Ctrl K</kbd>
      </button>
      {!wiki && (
        <button
          className={`icon-btn has-tip${editor.notesOpen ? ' on' : ''}`}
          aria-label="Comments"
          aria-pressed={editor.notesOpen}
          onMouseDown={keepFocus}
          onClick={() => editor.toggleNotes()}
        >
          <CommentsIcon />
          <Tip label="Comments" keys="Alt C" />
        </button>
      )}
      <div className="anchor">
        <button className={`icon-btn has-tip${themes ? ' on' : ''}`} aria-label="Theme" aria-expanded={themes} onMouseDown={keepFocus} onClick={() => setThemes(!themes)}>
          <ThemeIcon />
          {!themes && <Tip label="Theme" />}
        </button>
        {themes && (
          <Popover onClose={() => setThemes(false)} className="theme-menu">
            <div className="popover-title">Theme</div>
            {THEMES.map((t) => (
              <button
                key={t.id}
                role="menuitemradio"
                aria-checked={ui.theme === t.id}
                className={`theme-option${ui.theme === t.id ? ' on' : ''}`}
                onMouseDown={keepFocus}
                onClick={() => ui.setTheme(t.id)}
              >
                <span className={`theme-swatch swatch-${t.id}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <strong>{t.label}</strong>
                  <small>{t.hint}</small>
                </span>
              </button>
            ))}
          </Popover>
        )}
      </div>
      <button className="icon-btn has-tip" aria-label="Help and shortcuts" onMouseDown={keepFocus} onClick={ui.openHelp}>
        <HelpIcon />
        <Tip label="Help and shortcuts" keys="?" />
      </button>
    </div>
  )
}

const GROUPS: Tool[][] = [
  ['select', 'hand'],
  ['sticky', 'text', 'rect', 'ellipse', 'comment'],
  ['mind', 'flow', 'connector', 'pen'],
  ['table', 'kanban', 'timeline', 'data', 'frame'],
]

export function ToolRail() {
  const editor = useEditor()
  const ui = useUi()
  return (
    <nav className="island tool-rail no-canvas" aria-label="Tools">
      {GROUPS.map((group, g) => (
        <div className="tool-group" key={g}>
          {group.map((tool) => {
            const t = TOOLS.find((x) => x.tool === tool)!
            return (
              <button
                key={tool}
                className={`tool has-tip${editor.tool === tool ? ' active' : ''}`}
                aria-label={t.label}
                aria-pressed={editor.tool === tool}
                onMouseDown={keepFocus}
                onClick={() => editor.setTool(tool)}
              >
                {TOOL_ICONS[tool]}
                <Tip label={t.label} keys={t.key.toUpperCase()} />
              </button>
            )
          })}
          {g === GROUPS.length - 1 && (
            <button className="tool has-tip" aria-label="Add an image" onMouseDown={keepFocus} onClick={ui.openImage}>
              <ImageIcon />
              <Tip label="Image — or paste / drop one" />
            </button>
          )}
        </div>
      ))}
      {editor.flowPalette && <FlowFlyout />}
      {editor.tool === 'pen' && <PenFlyout />}
    </nav>
  )
}

/** Canvas-local point under the pointer, or null when it isn't over the board. */
function overCanvas(x: number, y: number) {
  const el = document.elementFromPoint(x, y)
  const canvas = el?.closest<HTMLElement>('.canvas')
  if (!canvas || el?.closest('.no-canvas')) return null
  const r = canvas.getBoundingClientRect()
  return { x: x - r.left, y: y - r.top }
}

/** The flowchart shapes: click one then click the board, or drag one straight onto the board. Stays open while you build. */
function FlowFlyout() {
  const editor = useEditor()
  const [ghost, setGhost] = useState<{ shape: FlowShape; x: number; y: number } | null>(null)
  const drag = useRef<{ shape: FlowShape; x: number; y: number; moved: boolean } | null>(null)
  return (
    <div className="flyout island flow-palette" role="listbox" aria-label="Flowchart shapes">
      <div className="popover-title flyout-head">
        <span>Flowchart shapes</span>
        <button className="icon-close" aria-label="Close the shape panel" title="Close (Esc)" onMouseDown={keepFocus} onClick={() => editor.closeFlowPalette()}>
          ×
        </button>
      </div>
      {FLOW_SHAPES.map((f, k) => (
        <button
          key={f.shape}
          role="option"
          aria-selected={editor.tool === 'flow' && editor.flowShape === f.shape}
          className={`flyout-option${editor.tool === 'flow' && editor.flowShape === f.shape ? ' on' : ''}`}
          title="Click, then click the board — or drag it onto the board"
          onMouseDown={keepFocus}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
            drag.current = { shape: f.shape, x: e.clientX, y: e.clientY, moved: false }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return
            d.moved = true
            const at = overCanvas(e.clientX, e.clientY)
            editor.paletteDragMove(d.shape, at)
            setGhost(at ? null : { shape: d.shape, x: e.clientX, y: e.clientY })
          }}
          onPointerUp={(e) => {
            const d = drag.current
            drag.current = null
            setGhost(null)
            if (!d) return
            if (!d.moved) return editor.setFlowShape(d.shape)
            const at = overCanvas(e.clientX, e.clientY)
            if (at) editor.paletteDrop(d.shape, at)
            else editor.paletteDragMove(d.shape, null)
          }}
          onPointerCancel={() => {
            drag.current = null
            setGhost(null)
            editor.paletteDragMove(f.shape, null)
          }}
        >
          <FlowShapeIcon shape={f.shape} />
          <span>
            <strong>{f.label}</strong>
            <small>{f.hint}</small>
          </span>
          <kbd>{k + 1}</kbd>
        </button>
      ))}
      <p className="flyout-tip">
        Drag a shape onto the board. Drop it near another shape and it snaps on and connects. <kbd>Tab</kbd> adds the next step.
      </p>
      {ghost &&
        createPortal(
          <div className="palette-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
            <FlowShapeIcon shape={ghost.shape} size={44} />
          </div>,
          document.body,
        )}
    </div>
  )
}

function PenFlyout() {
  const editor = useEditor()
  return (
    <div className="flyout island pen-flyout">
      <div className="popover-title">Pen</div>
      <div className="swatch-row">
        {INKS.map(([name, color]) => (
          <button
            key={color}
            className={`swatch${editor.penColor === color ? ' active' : ''}`}
            style={{ background: ink(color) }}
            title={k(name)}
            aria-label={name}
            onMouseDown={keepFocus}
            onClick={() => {
              editor.penColor = color
              editor.emit()
            }}
          />
        ))}
      </div>
      <div className="swatch-row">
        {[2, 4, 8, 14].map((w) => (
          <button
            key={w}
            className={`stroke-width${editor.penWidth === w ? ' active' : ''}`}
            aria-label={`${w} pixel stroke`}
            onMouseDown={keepFocus}
            onClick={() => {
              editor.penWidth = w
              editor.emit()
            }}
          >
            <span style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
      </div>
    </div>
  )
}

const k = (name: string) => (name === 'Black' ? 'Ink (adapts to the theme)' : name)

export function BottomLeft() {
  const editor = useEditor()
  return (
    <div className="island bottom-left no-canvas">
      <button className="icon-btn has-tip" aria-label="Undo" disabled={!editor.history.canUndo} onMouseDown={keepFocus} onClick={() => editor.undo()}>
        <UndoIcon />
        <Tip label="Undo" keys="Ctrl Z" />
      </button>
      <button className="icon-btn has-tip" aria-label="Redo" disabled={!editor.history.canRedo} onMouseDown={keepFocus} onClick={() => editor.redo()}>
        <RedoIcon />
        <Tip label="Redo" keys="Ctrl Shift Z" />
      </button>
      <span className="divider" />
      <button className="icon-btn has-tip" aria-label="Zoom out" onMouseDown={keepFocus} onClick={() => editor.zoomBy(1 / 1.25)}>
        <MinusIcon />
        <Tip label="Zoom out" keys="Ctrl −" />
      </button>
      <button className="zoom-readout has-tip" onMouseDown={keepFocus} onClick={() => editor.setZoom(1)}>
        {Math.round(editor.camera.zoom * 100)}%
        <Tip label="Reset to 100%" />
      </button>
      <button className="icon-btn has-tip" aria-label="Zoom in" onMouseDown={keepFocus} onClick={() => editor.zoomBy(1.25)}>
        <PlusIcon />
        <Tip label="Zoom in" keys="Ctrl +" />
      </button>
      <button className="icon-btn has-tip" aria-label="Zoom to fit" onMouseDown={keepFocus} onClick={() => editor.zoomToFit()}>
        <FitIcon />
        <Tip label="Fit" keys="Shift 1" />
      </button>
    </div>
  )
}

/** Status messages appear briefly, then fade. */
export function Toast() {
  const editor = useEditor()
  const [shown, setShown] = useState(false)
  // The words stay while the message fades out, so it never flashes an empty pill.
  const [text, setText] = useState('')
  const last = useRef('')
  useEffect(() => {
    if (!editor.status || editor.status === last.current) return
    last.current = editor.status
    setText(editor.status)
    setShown(true)
    const t = setTimeout(() => {
      setShown(false)
      last.current = ''
      editor.status = ''
    }, 3200)
    return () => clearTimeout(t)
  }, [editor.status, editor])
  return (
    <div className={`toast${shown ? ' show' : ''}`} role="status" aria-live="polite">
      {text}
    </div>
  )
}

export const SHORTCUTS: [string, [string, string][]][] = [
  [
    'Touch',
    [
      ['Drag on empty space', 'Move around the board (two fingers work anywhere)'],
      ['Pinch', 'Zoom in and out'],
      ['Press and hold → Select several', 'Then tap objects to add them, or drag a box'],
      ['Press and hold', 'Actions for whatever is under your finger (the right-click menu)'],
      ['Double-tap', 'Edit text, or add a sticky note'],
      ['☰ Pages', 'In a wiki on a phone: the list of pages'],
    ],
  ],
  ['Tools (with nothing selected)', TOOLS.map((t) => [t.key.toUpperCase(), t.label])],
  [
    'Everywhere',
    [
      ['Ctrl K · Ctrl F', 'Search the board or run any command (type > for commands only)'],
      ['Ctrl J', 'Ask AI about the board (changes are previewed first)'],
      ['Ctrl Shift E', 'Export the board or selection as an image or PDF'],
      ['E', 'Send an emote from your cursor (nothing selected; 1–6 pick one)'],
      ['Ctrl G', 'Group the selection (Ctrl Shift G ungroups)'],
      ['Ctrl Shift L', 'Lock or unlock the selection'],
      ['/', 'Cursor chat: say something next to your pointer (nothing selected)'],
      ['Enter', 'Place the current tool in the middle of the view'],
      ['Type', 'With one object selected, typing replaces its text (? and Shift P type too: press Esc first)'],
      ['Right-click · Shift F10', 'Actions for whatever is under the pointer (or the selection)'],
      ['Alt C', 'Comments on the selected object'],
      ['Ctrl Z / Ctrl Shift Z · Ctrl Y', 'Undo / redo'],
      ['Ctrl C / X / V / D', 'Copy, cut, paste, duplicate'],
      ['Ctrl A', 'Select all'],
      ['Ctrl S · Ctrl Shift S', 'Save to a file · save as'],
      ['Ctrl O', 'Your boards'],
      ['Shift P', 'Present (frames become slides)'],
      ['Delete', 'Delete'],
      ['Esc', 'Deselect'],
    ],
  ],
  [
    'Canvas',
    [
      ['Scroll · pinch', 'Zoom at the pointer'],
      ['Ctrl + / −', 'Zoom in and out around the middle of the view'],
      ['Middle-drag · Space-drag · Shift scroll', 'Pan'],
      ['Shift 1 · Ctrl 0', 'Zoom to fit · back to 100%'],
      ['Double-click', 'Edit text, or add a sticky note'],
      ['Drag the blue dot', 'Connect; drop on empty space for a linked note'],
      ['Shift-click · drag a box', 'Select several'],
      ['Arrows (+ Shift)', 'Nudge by 1 (10)'],
      ['Ctrl arrows (+ Shift)', 'Nudge by 10 (50), mind-map ideas too'],
      ['Alt while dragging', 'Move without snapping'],
      ['Alt-click', 'Reach a locked object (to select and unlock it)'],
    ],
  ],
  [
    'Presenting',
    [
      ['→ · Space · click', 'Next slide'],
      ['← · Shift-click', 'Previous slide'],
      ['1 – 9 · Home · End', 'Jump to a slide'],
      ['L · N · O', 'Laser pointer · speaker notes · overview'],
      ['Esc', 'Stop presenting'],
    ],
  ],
  [
    'Mind maps',
    [
      ['M then click', 'Start a mind map'],
      ['Tab · Shift Tab', 'Add a sub-idea · an idea below'],
      ['Enter', 'Add an idea below (while typing: finish, then add the next)'],
      ['Shift Enter', 'New line while typing'],
      ['Arrows', 'Move between ideas'],
      ['Alt ↑ / ↓', 'Reorder an idea'],
      ['Space · F2', 'Edit the idea'],
      ['/', 'Collapse or expand a branch'],
      ['Drag an idea', 'Drop it on another idea to move the branch'],
    ],
  ],
  [
    'Flowcharts',
    [
      ['D then click', 'Place a shape (choose it in the panel, or press 1–7)'],
      ['Tab', 'Add the next connected step'],
      ['Alt arrow', 'Add a connected step in that direction'],
      ['Drag a blue arrow to empty space', 'Pick the next shape (1–7)'],
      ['Double-click a line', 'Label it (e.g. Yes / No)'],
      ['Paste Mermaid', 'Builds the flowchart'],
      ['Alt R', 'Run the flowchart step by step (Enter moves on, 1–9 pick a way, Backspace goes back, Esc stops)'],
    ],
  ],
  [
    'Tables, Kanban, timelines',
    [
      ['Click once', 'Select it; then it works inside'],
      ['Drag the title strip', 'Move it (double-click to rename)'],
      ['Table: Enter · ↑ ↓', 'Move between rows (Enter on the last adds one)'],
      ['Paste spreadsheet cells', 'Creates a table'],
      ['Kanban: drag a card · Alt arrows', 'Move it to another column or up and down'],
      ['Timeline: drag · drag the ends', 'Reschedule · change length'],
      ['Timeline: Waits for… · Line up', 'Link events · move them so none starts too early'],
      ['B then click', 'A database: table, Kanban, timeline, calendar or gallery views'],
      ['Calendar: drag · double-click a day', 'Move a record · add one on that day'],
    ],
  ],
  [
    'Wikis',
    [
      ['Ctrl O → New wiki', 'Start a wiki: pages in a tree, to write things down together'],
      ['Edit · double-click the page', 'Write on the page (it saves as you type)'],
      ['Enter', 'In the title: start writing the page'],
      ['/ (at the start of a line) · Insert', 'Add a heading, checklist, table, sub-page… or embed something from a board'],
      ['[[', 'While writing: link to a page or a board'],
      ['Enter · Tab · Shift Tab', 'Continue a list or checklist · indent · outdent'],
      ['Ctrl B · Ctrl I', 'Bold · italic'],
      ['Esc · Ctrl Enter · Done', 'Stop writing'],
      ['Ctrl K', 'Find a page in this wiki'],
      ['Arrows · Home · End', 'In the page list: move between pages, open and close them'],
      ['Alt Shift ↑ ↓ ← →', 'In the page list: move a page up, down, out or in'],
      ['Drag a page · Move…', 'Put it under another page, or somewhere else in the list'],
      ['#', 'Beside a heading: copy a link to it'],
      ['Copy link', 'A link to the page (in a live session it opens for friends too); pasted in a page or comment it becomes a link, on a board a page card'],
      ['Right-click → Copy embed for a wiki page', 'On a board: show that object in a page'],
      ['Trash', 'Pages go to the Trash at the bottom of the page list first, so they can be restored'],
    ],
  ],
  [
    'Pasting',
    [
      ['A list, one idea per line', 'Sticky notes in a grid (indent it for a mind map)'],
      ['A web address', 'A link card; videos and music play on it'],
      ['A fenced block (three backticks)', 'A code block in its language'],
      ['Images · spreadsheet cells', 'Pictures · a table'],
    ],
  ],
  [
    'Together',
    [
      ['Status on the toolbar', 'Mark to do, in progress, done…; the key at the bottom filters'],
      ['Right-click → Private brainstorm', 'Notes stay hidden until someone reveals them'],
      ['Right-click → Spinner wheel', 'Spin, and everyone sees the same answer'],
      ['Flip card on the toolbar', 'Give a sticky note a back; ↻ turns it over'],
      ['Select several → Vote', 'A dot vote; counts stay hidden until revealed'],
    ],
  ],
  [
    'Comments',
    [
      ['Enter', 'Post (Shift Enter for a new line)'],
      ['@', 'Mention another object'],
      ['[[', 'Link a board or object (in comments and descriptions)'],
      ['C then click', 'Place a comment block'],
    ],
  ],
]

const isKey = (token: string) => /^(Ctrl|Shift|Alt|Tab|Enter|Esc|Space|Delete|Backspace|Home|End|F2|F10|Arrows|arrow|arrows|scroll|[A-Z0-9]|[↑↓←→/?+−#]|1–7|1–9)$/.test(token)

/** What a wiki's Help shows: wiki keys first, without the canvas-only sections. */
const CANVAS_ONLY = new Set(['Tools (with nothing selected)', 'Canvas', 'Presenting', 'Mind maps', 'Flowcharts', 'Tables, Kanban, timelines', 'Pasting', 'Together'])
const WIKI_EVERYWHERE = new Set(['Ctrl K · Ctrl F', 'Ctrl J', 'Ctrl Z / Ctrl Shift Z · Ctrl Y', 'Ctrl S · Ctrl Shift S', 'Ctrl O'])
function sections(wiki: boolean): typeof SHORTCUTS {
  const list = touchFirst() ? SHORTCUTS : [...SHORTCUTS.slice(1), SHORTCUTS[0]]
  if (!wiki) return list
  const kept = list.filter(([title]) => !CANVAS_ONLY.has(title)).map(([title, rows]): (typeof SHORTCUTS)[number] => [title, title === 'Everywhere' ? rows.filter(([k]) => WIKI_EVERYWHERE.has(k)) : rows])
  return [...kept.filter(([t]) => t === 'Wikis'), ...kept.filter(([t]) => t !== 'Wikis')]
}

/** On a touch screen the touch gestures come first; elsewhere they come last. */
const touchFirst = () => !!globalThis.matchMedia?.('(pointer: coarse)').matches

export function Help({ onClose, wiki = false }: { onClose: () => void; wiki?: boolean }) {
  useEscape(onClose)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialog(dialogRef)
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Help and shortcuts">
        <header>
          <h2>Help and shortcuts</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="help-grid">
          {sections(wiki).map(([title, rows]) => (
            <section key={title}>
              <h3>{title}</h3>
              <dl>
                {rows.map(([keys, what]) => (
                  <div key={keys}>
                    <dt>
                      {keys.split(' · ').map((part, i) => (
                        <span key={i}>
                          {i > 0 && <span className="or">or</span>}
                          {part.split(' ').map((x, j) =>
                            isKey(x) && !(x === '/' && part !== '/') ? <kbd key={j}>{x}</kbd> : <span key={j}> {x} </span>,
                          )}
                        </span>
                      ))}
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
