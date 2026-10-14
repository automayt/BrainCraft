/** The floating controls around the canvas. */

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { TOOLS, type Tool } from '../editor/Editor'
import { FLOW_SHAPES, INKS } from '../model/types'
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
import { useWorkspace } from './useWorkspace'

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

function Popover({ onClose, children, className = '' }: { onClose: () => void; children: ReactNode; className?: string }) {
  useEscape(onClose)
  return (
    <>
      <div className="scrim" onPointerDown={onClose} />
      <div className={`popover ${className}`} role="menu">
        {children}
      </div>
    </>
  )
}

function MenuItem({ label, keys, onClick, checked }: { label: string; keys?: string; onClick: () => void; checked?: boolean }) {
  return (
    <button role="menuitem" className="menu-item" onMouseDown={keepFocus} onClick={onClick}>
      <span className="check">{checked && <CheckIcon />}</span>
      <span>{label}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  )
}

const SAVE_LABELS = { saved: 'Saved', saving: 'Saving…', unsaved: 'Saving…', error: 'Not saved' } as const

/** Whether the board is safely stored, and where. */
function SaveState() {
  const ws = useWorkspace()
  if (ws.readOnly) return null
  const where = ws.persistent ? 'in this browser' : 'nowhere yet — this browser does not keep data'
  const tip = `${SAVE_LABELS[ws.saveState]} ${where}${ws.fileName ? ` · file: ${ws.fileName}` : ''}`
  return (
    <span className={`save-state has-tip ${ws.persistent ? ws.saveState : 'error'}`} aria-live="polite">
      <i aria-hidden="true" />
      <span className="sr-only">{tip}</span>
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
      <input
        className="board-title"
        value={editor.board.title}
        aria-label="Board title"
        spellCheck={false}
        readOnly={ws.readOnly}
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
              <MenuItem label="Download file" keys="Ctrl S" onClick={run(ui.download)} />
            )}
            <MenuItem label="Share read-only link…" onClick={run(ui.openShare)} />
            {!ws.readOnly && <MenuItem label="Version history…" onClick={run(ui.openVersions)} />}
            <hr />
            {!ws.readOnly && <MenuItem label="Import Mermaid / outline / JSON…" onClick={run(ui.openImport)} />}
            <MenuItem label="Export as Mermaid…" onClick={run(ui.openImport)} />
            <hr />
            <MenuItem label="Keyboard shortcuts" keys="?" onClick={run(ui.openHelp)} />
          </Popover>
        )}
      </div>
    </div>
  )
}

export function TopRight() {
  const editor = useEditor()
  const ui = useUi()
  const [themes, setThemes] = useState(false)
  return (
    <div className="island top-right no-canvas">
      <button className="search-pill" onMouseDown={keepFocus} onClick={() => editor.setSearchOpen(true)}>
        <SearchIcon />
        <span>Search or run a command</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button
        className={`icon-btn has-tip${editor.notesOpen ? ' on' : ''}`}
        aria-label="Comments"
        aria-pressed={editor.notesOpen}
        onMouseDown={keepFocus}
        onClick={() => editor.toggleNotes()}
      >
        <CommentsIcon />
        <Tip label="Comments" keys="Shift C" />
      </button>
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
      <button className="icon-btn has-tip" aria-label="Keyboard shortcuts" onMouseDown={keepFocus} onClick={ui.openHelp}>
        <HelpIcon />
        <Tip label="Shortcuts" keys="?" />
      </button>
    </div>
  )
}

const GROUPS: Tool[][] = [
  ['select', 'hand'],
  ['sticky', 'text', 'rect', 'ellipse', 'comment'],
  ['mind', 'flow', 'connector', 'pen'],
  ['table', 'kanban', 'timeline', 'frame'],
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
      {editor.tool === 'flow' && <FlowFlyout />}
      {editor.tool === 'pen' && <PenFlyout />}
    </nav>
  )
}

function FlowFlyout() {
  const editor = useEditor()
  return (
    <div className="flyout island" role="listbox" aria-label="Flowchart shapes">
      <div className="popover-title">Flowchart shape</div>
      {FLOW_SHAPES.map((f, k) => (
        <button
          key={f.shape}
          role="option"
          aria-selected={editor.flowShape === f.shape}
          className={`flyout-option${editor.flowShape === f.shape ? ' on' : ''}`}
          onMouseDown={keepFocus}
          onClick={() => editor.setFlowShape(f.shape)}
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
        Then press <kbd>Tab</kbd> or click a shape's arrows to add the next step.
      </p>
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
  const [shown, setShown] = useState('')
  const last = useRef('')
  useEffect(() => {
    if (!editor.status || editor.status === last.current) return
    last.current = editor.status
    setShown(editor.status)
    const t = setTimeout(() => {
      setShown('')
      last.current = ''
      editor.status = ''
    }, 3200)
    return () => clearTimeout(t)
  }, [editor.status, editor])
  return (
    <div className={`toast${shown ? ' show' : ''}`} role="status" aria-live="polite">
      {shown}
    </div>
  )
}

export const SHORTCUTS: [string, [string, string][]][] = [
  ['Tools', TOOLS.map((t) => [t.key.toUpperCase(), t.label])],
  [
    'Everywhere',
    [
      ['Ctrl K', 'Search the board or run any command'],
      ['Right-click', 'Actions for whatever is under the pointer'],
      ['Shift C', 'Comments on the selected object'],
      ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
      ['Ctrl C / X / V / D', 'Copy, cut, paste, duplicate'],
      ['Ctrl A', 'Select all'],
      ['Ctrl S', 'Download the board'],
      ['Delete', 'Delete'],
      ['Esc', 'Deselect'],
    ],
  ],
  [
    'Canvas',
    [
      ['Scroll · Space-drag · middle-drag', 'Pan'],
      ['Ctrl scroll · pinch · Ctrl + / −', 'Zoom'],
      ['Shift 1', 'Zoom to fit'],
      ['Double-click', 'Edit text, or add a sticky note'],
      ['Drag the blue dot', 'Connect; drop on empty space for a linked note'],
      ['Shift-click · drag a box', 'Select several'],
      ['Arrows (+ Shift)', 'Nudge by 1 (10)'],
      ['Alt while dragging', 'Move without snapping'],
    ],
  ],
  [
    'Mind maps',
    [
      ['M then click', 'Start a mind map'],
      ['Tab', 'Add a child idea'],
      ['Enter', 'Add a sibling (while typing: finish, then add the next)'],
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
      ['D then click', 'Place a shape (choose it in the panel)'],
      ['Tab', 'Add the next connected step'],
      ['Alt arrow', 'Add a connected step in that direction'],
      ['Drag a blue arrow to empty space', 'Pick the next shape (1–7)'],
      ['Double-click a line', 'Label it (e.g. Yes / No)'],
      ['Paste Mermaid', 'Builds the flowchart'],
    ],
  ],
  [
    'Tables, Kanban, timelines',
    [
      ['Click once', 'Select it; then it works inside'],
      ['Drag the title strip', 'Move it (double-click to rename)'],
      ['Table: Enter · ↑ ↓', 'Move between rows (Enter on the last adds one)'],
      ['Paste spreadsheet cells', 'Creates a table'],
      ['Kanban: drag a card', 'Move it to another column'],
      ['Timeline: drag · drag the ends', 'Reschedule · change length'],
    ],
  ],
  [
    'Comments',
    [
      ['Enter', 'Post (Shift Enter for a new line)'],
      ['@', 'Mention another object'],
      ['C then click', 'Place a comment block'],
    ],
  ],
]

const isKey = (token: string) => /^(Ctrl|Shift|Alt|Tab|Enter|Esc|Space|Delete|F2|arrow|scroll|[A-Z0-9]|[↑↓←→/?+−]|1–7)$/.test(token)

export function Help({ onClose }: { onClose: () => void }) {
  useEscape(onClose)
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help" role="dialog" aria-label="Keyboard shortcuts">
        <header>
          <h2>Keyboard shortcuts</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="help-grid">
          {SHORTCUTS.map(([title, rows]) => (
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
