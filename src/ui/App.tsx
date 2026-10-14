import { useEffect, useRef, useState } from 'react'
import { Editor, TOOLS } from '../editor/Editor'
import { emptyBoard } from '../model/board'
import { fromJson, toJson, welcomeBoard } from '../model/serialize'
import { FLOW_SHAPES, INKS } from '../model/types'
import { Canvas } from './Canvas'
import { CommentsIcon, FlowShapeIcon, Logo, RedoIcon, SearchIcon, TOOL_ICONS, UndoIcon } from './icons'
import { NotesPanel } from './NotesPanel'
import { SearchPalette } from './SearchPalette'
import { measureText } from './measure'
import { EditorContext, useEditor } from './useEditor'

const STORAGE_KEY = 'braincraft:board'

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return fromJson(raw)
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return welcomeBoard()
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function download(editor: Editor) {
  const name = (editor.board.title || 'board').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'board'
  const url = URL.createObjectURL(new Blob([toJson(editor.board)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.braincraft.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  editor.setStatus(`Downloaded ${a.download}`)
}

export function App() {
  const [editor] = useState(() => new Editor(loadStored(), measureText))

  useEffect(() => {
    // Autosave to this browser, debounced.
    let timer: number | undefined
    editor.onBoardChange = (b) => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        try {
          localStorage.setItem(STORAGE_KEY, toJson(b))
        } catch {
          editor.setStatus('Could not save in this browser — download a copy to keep your work')
        }
      }, 400)
    }
    // Frame the board once the canvas has its size.
    requestAnimationFrame(() => editor.zoomToFit())

    const onKeyDown = (e: KeyboardEvent) => {
      // Search works from anywhere, even while typing.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        editor.setSearchOpen(!editor.searchOpen)
        return
      }
      if (isTyping(e.target) || editor.searchOpen) return
      // Space edits a selected mind-map idea; otherwise holding it pans.
      if (e.key === ' ' && editor.single?.kind !== 'mind') {
        if (!editor.spaceDown) {
          editor.spaceDown = true
          editor.emit()
        }
        e.preventDefault()
        return
      }
      const result = editor.keyDown(e.key, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey })
      if (result === 'save') download(editor)
      if (result) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && editor.spaceDown) {
        editor.spaceDown = false
        editor.emit()
      }
    }
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const text = editor.copyText()
      if (!text) return
      e.clipboardData?.setData('text/plain', text)
      e.preventDefault()
      if (e.type === 'cut') editor.deleteSelection()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const text = e.clipboardData?.getData('text/plain')
      if (text) {
        editor.pasteText(text)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      editor.onBoardChange = null
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [editor])

  return (
    <EditorContext.Provider value={editor}>
      <div className="app">
        <TopBar />
        <div className="workspace">
          <ToolBar />
          <Canvas />
          <NotesPanel />
        </div>
        <SearchPalette />
      </div>
    </EditorContext.Provider>
  )
}

function TopBar() {
  const editor = useEditor()
  const file = useRef<HTMLInputElement>(null)
  const [help, setHelp] = useState(false)
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span>BrainCraft</span>
      </div>
      <input
        className="board-title"
        value={editor.board.title}
        aria-label="Board title"
        onChange={(e) => editor.setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="group">
        <button
          onClick={() => {
            if (editor.board.items.length && !confirm('Start a new board? This replaces the board saved in this browser.')) return
            editor.load(emptyBoard(), 'New board')
          }}
        >
          New
        </button>
        <button onClick={() => file.current?.click()}>Open…</button>
        <button title="Download as a .braincraft.json file (Ctrl+S)" onClick={() => download(editor)}>
          Download
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              editor.load(fromJson(await f.text()), `Opened ${f.name}`)
            } catch (err) {
              editor.setStatus(`Could not open ${f.name}: ${(err as Error).message}`)
            }
          }}
        />
      </div>
      <div className="group">
        <button className="icon" title="Undo (Ctrl+Z)" disabled={!editor.history.canUndo} onClick={() => editor.undo()}>
          <UndoIcon />
        </button>
        <button className="icon" title="Redo (Ctrl+Shift+Z)" disabled={!editor.history.canRedo} onClick={() => editor.redo()}>
          <RedoIcon />
        </button>
      </div>
      <div className="group">
        <button title="Zoom out" onClick={() => editor.zoomBy(1 / 1.25)}>
          −
        </button>
        <button className="zoom" title="Reset to 100%" onClick={() => editor.setZoom(1)}>
          {Math.round(editor.camera.zoom * 100)}%
        </button>
        <button title="Zoom in" onClick={() => editor.zoomBy(1.25)}>
          +
        </button>
        <button title="Zoom to fit the board or selection (Shift+1)" onClick={() => editor.zoomToFit()}>
          Fit
        </button>
      </div>
      <div className="status" role="status">
        {editor.status}
      </div>
      <button className="search-button" title="Search and browse objects (Ctrl+K)" onClick={() => editor.setSearchOpen(true)}>
        <SearchIcon />
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button
        className={`icon${editor.notesOpen ? ' on' : ''}`}
        title="Comments (Shift+C)"
        aria-pressed={editor.notesOpen}
        onClick={() => editor.toggleNotes()}
      >
        <CommentsIcon />
      </button>
      <button className="help-button" title="Keyboard shortcuts" onClick={() => setHelp(!help)}>
        ?
      </button>
      {help && <Help onClose={() => setHelp(false)} />}
    </header>
  )
}

function ToolBar() {
  const editor = useEditor()
  return (
    <nav className="toolbar" aria-label="Tools">
      {TOOLS.map(({ tool, key, label }) => (
        <button
          key={tool}
          className={editor.tool === tool ? 'active' : ''}
          title={`${label} (${key.toUpperCase()})`}
          aria-label={label}
          aria-pressed={editor.tool === tool}
          // Keep keyboard focus on the board so shortcuts like Tab keep working.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.setTool(tool)}
        >
          {TOOL_ICONS[tool]}
        </button>
      ))}
      {editor.tool === 'flow' && (
        <div className="flyout no-canvas" role="listbox" aria-label="Flowchart shapes">
          <div className="flyout-title">Flowchart</div>
          {FLOW_SHAPES.map((f) => (
            <button
              key={f.shape}
              role="option"
              aria-selected={editor.flowShape === f.shape}
              className={editor.flowShape === f.shape ? 'active' : ''}
              title={f.hint}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.setFlowShape(f.shape)}
            >
              <FlowShapeIcon shape={f.shape} />
              <span>{f.label}</span>
            </button>
          ))}
          <p className="flyout-tip">
            Place a shape, then press <kbd>Tab</kbd> or click its blue arrows to add the next step.
          </p>
        </div>
      )}
      {editor.tool === 'pen' && (
        <div className="pen-options">
          {INKS.map(([name, color]) => (
            <button
              key={color}
              className={`swatch${editor.penColor === color ? ' active' : ''}`}
              style={{ background: color }}
              title={name}
              aria-label={name}
              onClick={() => {
                editor.penColor = color
                editor.emit()
              }}
            />
          ))}
          {[2, 4, 8, 14].map((w) => (
            <button
              key={w}
              className={`width${editor.penWidth === w ? ' active' : ''}`}
              title={`${w}px`}
              onClick={() => {
                editor.penWidth = w
                editor.emit()
              }}
            >
              <span style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
        </div>
      )}
    </nav>
  )
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    'Tools',
    TOOLS.map((t) => [t.key.toUpperCase(), t.label]),
  ],
  [
    'Mind maps',
    [
      ['M then click', 'Start a mind map'],
      ['Tab', 'Add a child idea'],
      ['Enter', 'Add a sibling (while typing: finish, then add the next)'],
      ['Shift + Enter', 'New line while typing'],
      ['Arrows', 'Move between ideas'],
      ['Alt + ↑ / ↓', 'Reorder an idea'],
      ['Space / F2', 'Edit the idea'],
      ['/', 'Collapse or expand a branch'],
      ['Drag an idea', 'Drop it on another idea to move the branch'],
      ['Paste an indented list', 'Turns it into a mind map'],
    ],
  ],
  [
    'Flowcharts',
    [
      ['D then click', 'Place a shape (pick the shape in the panel)'],
      ['Tab', 'Add the next connected step'],
      ['Alt + arrow', 'Add a connected step in that direction'],
      ['Blue arrows', 'Click to add a step, drag to connect'],
      ['Enter / double-click', 'Edit the text'],
      ['Double-click a line', 'Label it (e.g. Yes / No)'],
      ['Drag', 'Snaps into line with nearby shapes (hold Alt to move freely)'],
    ],
  ],
  [
    'Comments & search',
    [
      ['Shift + C', 'Open comments on the selected object'],
      ['Enter', 'Post a comment (Shift + Enter for a new line)'],
      ['@', 'Mention another object in a comment'],
      ['Ctrl + K / Ctrl + F', 'Search everything, or browse all objects'],
      ['C then click', 'Place a comment block on the board'],
    ],
  ],
  [
    'Canvas',
    [
      ['Scroll / Space + drag / middle-drag', 'Pan'],
      ['Ctrl + scroll, pinch', 'Zoom'],
      ['Shift + 1', 'Zoom to fit'],
      ['Double-click', 'Edit text, or add a sticky note'],
      ['Drag the blue dot', 'Connect; drop on empty space for a linked note'],
      ['Shift + click / drag', 'Add to the selection'],
      ['Arrows (+ Shift)', 'Nudge by 1 (10)'],
      ['Ctrl + C / X / V / D', 'Copy, cut, paste, duplicate'],
      ['Ctrl + A', 'Select all'],
      ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo'],
      ['Ctrl + S', 'Download the board'],
      ['Delete', 'Delete'],
      ['Esc', 'Deselect'],
    ],
  ],
]

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="help no-canvas" role="dialog" aria-label="Keyboard shortcuts">
      <div className="help-head">
        <strong>Shortcuts</strong>
        <button onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {SHORTCUTS.map(([title, rows]) => (
        <section key={title}>
          <h3>{title}</h3>
          <dl>
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
