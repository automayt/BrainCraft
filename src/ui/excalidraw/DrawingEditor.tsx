/**
 * Excalidraw, full screen, for one drawing on the board. Loaded only when a drawing is opened.
 * Done keeps the drawing (its scene and its picture, one undo step); Cancel leaves it as it was.
 * It follows the app's theme, and the drawing goes on the board without a background of its own.
 */

import './assetPath'
import '@excalidraw/excalidraw/index.css'
import { Excalidraw, getSceneVersion, restoreElements } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useMemo, useRef, useState } from 'react'
import { getItem } from '../../model/board'
import { cleanExcalidraw } from '../../model/excalidraw'
import { useEditor } from '../useEditor'
import { useUi } from '../uiContext'
import { pictureOf } from './picture'

export default function DrawingEditor() {
  const editor = useEditor()
  const ui = useUi()
  const open = editor.drawing!
  const item = open.id === null ? undefined : getItem(editor.board, open.id)
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const readOnly = editor.readOnly

  const initial = useMemo(() => {
    const scene = open.scene ?? item?.excalidraw ?? { elements: [] }
    return {
      elements: restoreElements(scene.elements as never, null),
      files: (scene.files ?? {}) as never,
      appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 1 },
      scrollToContent: true,
    }
    // The drawing as it was when opened; later changes on the board don't reset the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const startVersion = useMemo(() => getSceneVersion(initial.elements), [initial])

  const changed = () => !!api.current && (getSceneVersion(api.current.getSceneElements()) !== startVersion || !!open.scene)

  const cancel = () => {
    if (!readOnly && changed() && !window.confirm('Leave without keeping your changes to this drawing?')) return
    editor.closeDrawing()
  }

  const done = async () => {
    if (readOnly || !api.current) return editor.closeDrawing()
    if (!changed()) return editor.closeDrawing()
    const elements = api.current.getSceneElements()
    if (!elements.length) {
      setError(item ? 'The drawing is empty. To remove it, delete it on the board.' : 'Draw something first, or press Cancel.')
      return
    }
    setBusy(true)
    setError('')
    try {
      // Plain data, as a board keeps it (and checked the same way as any drawing that arrives).
      const scene = cleanExcalidraw(JSON.parse(JSON.stringify({ elements, files: api.current.getFiles() })))
      if (!scene) throw new Error('the drawing is too big to keep on a board')
      editor.saveDrawing(open.id, scene, await pictureOf(scene), open.at)
      editor.closeDrawing()
    } catch (err) {
      setError(`Couldn’t keep the drawing: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  // Excalidraw's own dark mode on a dark app: the drawing reads the same here as on the board.
  const dark = ui.theme === 'dark' || ui.theme === 'hc-dark'
  return (
    <div
      className="drawing-editor no-canvas"
      role="dialog"
      aria-modal="true"
      aria-label={item ? 'Edit drawing in Excalidraw' : 'New Excalidraw drawing'}
      // Keys and clipboard belong to Excalidraw while it's open, not to the board behind it.
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void done()
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <header className="drawing-editor-bar">
        <strong>{item ? 'Drawing' : 'New drawing'}</strong>
        <span className="muted drawing-editor-hint">{readOnly ? 'View only' : 'Drawn with Excalidraw. It goes on the board with no background of its own; double-click it to come back.'}</span>
        {error && (
          <span className="drawing-editor-error" role="alert">
            {error}
          </span>
        )}
        <span className="drawing-editor-actions">
          {!readOnly && <button onClick={cancel}>Cancel</button>}
          <button className="primary" disabled={busy} onClick={() => void done()} title="Ctrl Enter">
            {readOnly ? 'Close' : busy ? 'Keeping…' : item ? 'Done' : 'Put on the board'}
          </button>
        </span>
      </header>
      <div className="drawing-editor-body">
        <Excalidraw
          excalidrawAPI={(a) => (api.current = a)}
          initialData={initial}
          theme={dark ? 'dark' : 'light'}
          viewModeEnabled={readOnly}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, changeViewBackgroundColor: false } }}
        />
      </div>
    </div>
  )
}
