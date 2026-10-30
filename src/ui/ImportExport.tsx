import { useMemo, useRef, useState } from 'react'
import { useDialog } from './useDialog'
import { addDrawing, addDrawingFiles, addMermaidDrawing, isDrawingFile } from './excalidraw/addDrawing'
import { sceneFromText } from '../model/excalidraw'
import { looksLikeMermaid, otherMermaid, parseMermaid } from '../model/mermaid'
import { parseSequence } from '../model/sequence'
import { parseOutline } from '../model/mindmap'
import { listLines } from '../model/stickyGrid'
import { toJson } from '../model/serialize'
import type { ExcalidrawScene } from '../model/types'
import { useEditor } from './useEditor'

type Tab = 'import' | 'export'

/**
 * What pasted text will become, or why it can't be used. `scene` is an Excalidraw drawing to add;
 * `drawable` is Mermaid that Excalidraw can draw, and `flowchart` Mermaid BrainCraft reads itself.
 */
interface Found {
  label: string
  ok: boolean
  scene?: ExcalidrawScene
  drawable?: boolean
  flowchart?: boolean
  /** What the main button makes, when it isn't "Add to board". */
  as?: string
}

function detect(text: string): Found {
  if (!text.trim()) return { label: 'Type or paste a list (one sticky note per line), an indented list, Mermaid, an Excalidraw drawing or BrainCraft JSON', ok: false }
  if (looksLikeMermaid(text)) {
    try {
      const g = parseMermaid(text)
      return { label: `Mermaid flowchart · ${g.nodes.length} shapes, ${g.edges.length} ${g.edges.length === 1 ? 'link' : 'links'}`, ok: true, drawable: true, flowchart: true, as: 'Add as flowchart' }
    } catch (err) {
      return { label: (err as Error).message, ok: false, drawable: true }
    }
  }
  const seq = parseSequence(text)
  if (seq) {
    const { lanes, steps } = seq.data
    return { label: `Mermaid sequence diagram · ${lanes.length} ${lanes.length === 1 ? 'lane' : 'lanes'}, ${steps.length} ${steps.length === 1 ? 'message' : 'messages'}${seq.skipped ? ` (${seq.skipped} other ${seq.skipped === 1 ? 'line' : 'lines'} left out)` : ''}`, ok: true, drawable: true, flowchart: true, as: 'Add as sequence diagram' }
  }
  const other = otherMermaid(text)
  if (other) return { label: `Mermaid ${other} → an Excalidraw drawing`, ok: true, drawable: true }
  const scene = sceneFromText(text)
  if (scene) return { label: `Excalidraw drawing · ${scene.elements.length} ${scene.elements.length === 1 ? 'element' : 'elements'}`, ok: true, scene }
  try {
    const raw = JSON.parse(text)
    if (raw?.type === 'braincraft/clip') return { label: 'BrainCraft objects', ok: true }
    if (raw?.braincraft === 'ops' || Array.isArray(raw?.ops)) return { label: `BrainCraft API operations (${raw.ops?.length ?? 0})`, ok: true }
  } catch {
    // Not JSON.
  }
  if (/\t/.test(text) && text.trim().includes('\n')) return { label: 'Table (tab-separated)', ok: true }
  const lines = listLines(text)
  if (lines) return { label: `List → ${lines.length} sticky notes (indent it for a mind map)`, ok: true }
  if (parseOutline(text)) return { label: 'Indented list → mind map', ok: true }
  return { label: 'Plain text → sticky note', ok: true }
}

export function ImportExport({ onClose, initialTab = 'import' }: { onClose: () => void; initialTab?: Tab }) {
  const editor = useEditor()
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialog(dialogRef)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [text, setText] = useState('')
  const [format, setFormat] = useState<'mermaid' | 'json'>('mermaid')
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const found = useMemo(() => detect(text), [text])
  const exported = format === 'mermaid' ? editor.exportMermaid() : toJson(editor.board)
  const empty = format === 'mermaid' && exported.split('\n').length === 1

  return (
    <div className="palette-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog"
        ref={dialogRef} role="dialog" aria-modal="true"
        aria-label="Import and export"
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="dialog-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'import'} className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
            Import
          </button>
          <button role="tab" aria-selected={tab === 'export'} className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>
            Export
          </button>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {tab === 'import' ? (
          <>
            <textarea
              autoFocus
              value={text}
              spellCheck={false}
              placeholder={'flowchart TD\n  A([Start]) --> B{Ready?}\n  B -->|Yes| C[Ship it]\n  B -->|No| D[Fix it] --> B'}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="dialog-foot">
              <span className={found.ok || !text.trim() ? 'muted' : 'error'}>{found.label}</span>
              <span className="dialog-foot-actions">
                <button onClick={() => fileInput.current?.click()} title="An .excalidraw drawing, or Mermaid, Markdown or text">
                  Open a file…
                </button>
                {found.drawable && (
                  <button
                    className={found.flowchart ? '' : 'primary'}
                    onClick={() => {
                      void addMermaidDrawing(editor, text)
                      onClose()
                    }}
                  >
                    Add as Excalidraw drawing
                  </button>
                )}
                {(found.flowchart || !found.drawable) && (
                  <button
                    className="primary"
                    disabled={!found.ok}
                    onClick={() => {
                      if (found.scene) void addDrawing(editor, found.scene)
                      else editor.pasteText(text)
                      onClose()
                    }}
                  >
                    {found.as ?? 'Add to board'}
                  </button>
                )}
              </span>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept=".excalidraw,.mmd,.mermaid,.md,.markdown,.txt,.json,.csv,.tsv"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  if (isDrawingFile(f)) {
                    onClose()
                    return addDrawingFiles(editor, [f])
                  }
                  setText(await f.text())
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="dialog-options">
              <label>
                <input type="radio" checked={format === 'mermaid'} onChange={() => setFormat('mermaid')} /> Mermaid flowchart
                <span className="muted"> ({editor.selection.size ? 'selection' : 'all flowchart shapes'})</span>
              </label>
              <label>
                <input type="radio" checked={format === 'json'} onChange={() => setFormat('json')} /> Whole board (JSON)
              </label>
            </div>
            <textarea readOnly value={empty ? '' : exported} placeholder="There are no flowchart shapes to export yet." />
            <div className="dialog-foot">
              <span className="muted">{copied ? 'Copied!' : 'Paste it into any doc or wiki that draws Mermaid'}</span>
              <button
                className="primary"
                disabled={empty}
                onClick={() =>
                  navigator.clipboard?.writeText(exported).then(
                    () => setCopied(true),
                    () => editor.setStatus('Clipboard unavailable — select the text and copy it'),
                  )
                }
              >
                Copy
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
