import { hasSketch, sketchToBoard } from './sketch'
import { copyImage } from './ExportImage'
import { runsOf } from '../model/runbook'
import { FLOW_SHAPES } from '../model/types'
import { useUi } from './uiContext'
import { useEditor } from './useEditor'
import { useEscape } from './useEscape'

type Entry = { label: string; keys?: string; run: () => void; danger?: boolean } | 'sep' | { heading: string }

/** Right-click: the actions that make sense for what's under the pointer. */
export function ContextMenu() {
  const editor = useEditor()
  const ui = useUi()
  const m = ui.menu
  useEscape(ui.closeMenu, !!m)
  if (!m) return null

  const single = editor.single
  const entries: Entry[] = []
  const paste = {
    label: 'Paste here',
    keys: 'Ctrl V',
    run: () =>
      navigator.clipboard?.readText().then(
        (text) => text && editor.pasteText(text),
        () => editor.setStatus('Press Ctrl+V to paste'),
      ),
  }
  const place = (tool: Parameters<typeof editor.setTool>[0]) => () => {
    // Place the object right where the menu was opened.
    editor.setTool(tool)
    editor.pointerDown({ x: m.x, y: m.y }, 0, {})
    editor.pointerUp({ x: m.x, y: m.y })
  }

  if (editor.selectedConnector !== null) {
    const id = editor.selectedConnector
    entries.push(
      { label: 'Label…', run: () => editor.startEditingLabel(id) },
      { label: 'Straight', run: () => editor.setConnectorStyle('straight') },
      { label: 'Right-angled', run: () => editor.setConnectorStyle('elbow') },
      { label: 'Curved', run: () => editor.setConnectorStyle('curved') },
      'sep',
      { label: 'Delete', keys: 'Del', danger: true, run: () => editor.deleteSelection() },
    )
  } else if (editor.selection.size) {
    if (single && single.kind !== 'pen' && single.kind !== 'image' && single.kind !== 'link')
      entries.push({ label: single.kind === 'table' || single.kind === 'kanban' || single.kind === 'timeline' ? 'Rename' : 'Edit text', keys: 'Enter', run: () => editor.startEditing(single.id) })
    if (single) entries.push({ label: `Comments${single.notes?.length ? ` (${single.notes.length})` : ''}`, keys: 'Shift C', run: () => editor.toggleNotes(true) })
    if (single?.kind === 'mind') {
      entries.push('sep', { label: 'Add sub-idea', keys: 'Tab', run: () => editor.addMindNode(single.id, 'child') })
      if (single.parent !== undefined) entries.push({ label: 'Add idea below', keys: 'Enter', run: () => editor.addMindNode(single.id, 'sibling') })
      if (editor.board.items.some((i) => i.parent === single.id))
        entries.push({ label: single.collapsed ? 'Expand branch' : 'Collapse branch', keys: '/', run: () => editor.toggleCollapsed(single.id) })
      entries.push({ label: 'Tidy mind map', run: () => editor.tidyMindMap(single.id) })
    }
    if (single?.kind === 'flow') {
      const runs = runsOf(editor.board, single.id)?.runs.length ?? 0
      entries.push(
        'sep',
        { label: 'Run flowchart', keys: 'Shift R', run: () => editor.startRun(single.id) },
        { label: 'Run from this step', run: () => editor.startRun(single.id, true) },
        { label: runs ? `Run history (${runs})` : 'Run history', run: () => ui.openRuns(single.id) },
      )
      entries.push('sep', { label: 'Add next step', keys: 'Tab', run: () => editor.addFlowStep(single.id) }, { heading: 'Change shape' })
      for (const f of FLOW_SHAPES) if (f.shape !== single.shape) entries.push({ label: f.label, run: () => editor.setShape(f.shape) })
    }
    entries.push(
      'sep',
      { label: 'Copy', keys: 'Ctrl C', run: () => {
          const text = editor.copyText()
          if (text) navigator.clipboard?.writeText(text).then(() => editor.setStatus('Copied'), () => editor.setStatus('Press Ctrl+C to copy'))
        } },
      paste,
      { label: 'Duplicate', keys: 'Ctrl D', run: () => editor.duplicate() },
      { label: 'Copy as image', run: () => void copyImage(editor, new Set(editor.selection)) },
      ...(hasSketch(editor) ? [{ label: 'Turn sketch into a board (AI)', run: () => void sketchToBoard(editor) }] : []),
      editor.selectedItems.every((i) => i.locked)
        ? { label: 'Unlock', keys: 'Ctrl Shift L', run: () => editor.setLocked(false) }
        : { label: 'Lock', keys: 'Ctrl Shift L', run: () => editor.setLocked(true) },
      ...(editor.selection.size > 1 && !editor.selectedItems.every((i) => i.kind === 'mind') ? [{ label: 'Group', keys: 'Ctrl G', run: () => editor.group() }] : []),
      ...(editor.selection.size > 1 ? [{ label: 'Spin a wheel between these', run: () => editor.addWheel() }] : []),
      ...(editor.selectedItems.some((i) => i.group) ? [{ label: 'Ungroup', keys: 'Ctrl Shift G', run: () => editor.ungroup() }] : []),
      'sep',
      { label: 'Bring to front', run: () => editor.bringToFront() },
      { label: 'Send to back', run: () => editor.sendToBack() },
    )
    if (editor.selectedItems.some((i) => i.kind === 'flow'))
      entries.push({ label: 'Copy as Mermaid', run: () => navigator.clipboard?.writeText(editor.exportMermaid()).then(() => editor.setStatus('Copied Mermaid')) })
    if (single && (single.kind === 'table' || single.kind === 'kanban' || single.kind === 'timeline'))
      entries.push({ label: 'Convert to linked data', run: () => editor.convertToData(single.id) })
    if (single?.kind === 'data') {
      entries.push(
        { label: 'Add a table view', run: () => editor.addDataView(single.id, 'table') },
        { label: 'Add a board view', run: () => editor.addDataView(single.id, 'board') },
        { label: 'Add a timeline view', run: () => editor.addDataView(single.id, 'timeline') },
      )
    }
    if (single?.kind === 'mind') {
      entries.push({ label: 'Copy as outline', run: () => {
          const o = editor.outlineOfSelection()
          if (o) navigator.clipboard?.writeText(o).then(() => editor.setStatus('Copied outline'))
        } })
    }
    entries.push('sep', { label: 'Delete', keys: 'Del', danger: true, run: () => editor.deleteSelection() })
  } else {
    entries.push(
      paste,
      'sep',
      { heading: 'Add here' },
      { label: 'Sticky note', keys: 'N', run: place('sticky') },
      { label: 'Mind map', keys: 'M', run: place('mind') },
      { label: 'Flowchart shape', keys: 'D', run: place('flow') },
      { label: 'Comment', keys: 'C', run: place('comment') },
      { label: 'Table', keys: 'G', run: place('table') },
      { label: 'Kanban board', keys: 'K', run: place('kanban') },
      { label: 'Timeline', keys: 'I', run: place('timeline') },
      { label: 'Private brainstorm', run: () => editor.startBrainstorm() },
      { label: 'Spinner wheel', run: () => editor.addWheel() },
      'sep',
      { label: 'Select all', keys: 'Ctrl A', run: () => editor.selectAll() },
      { label: 'Zoom to fit', keys: 'Shift 1', run: () => editor.zoomToFit() },
      { label: 'Import Mermaid / outline…', run: ui.openImport },
    )
  }
  const left = Math.min(m.x, editor.viewport.w - 250)
  const top = Math.min(m.y, Math.max(8, editor.viewport.h - entries.length * 32 - 16))
  return (
    <>
      <div className="scrim no-canvas" onPointerDown={ui.closeMenu} onContextMenu={(e) => { e.preventDefault(); ui.closeMenu() }} />
      <div className="popover context-menu no-canvas" role="menu" style={{ left, top }}>
        {entries.map((e, k) =>
          e === 'sep' ? (
            <hr key={k} />
          ) : 'heading' in e ? (
            <div key={k} className="popover-title">
              {e.heading}
            </div>
          ) : (
            <button
              key={k}
              role="menuitem"
              className={`menu-item${e.danger ? ' danger' : ''}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => {
                ui.closeMenu()
                e.run()
              }}
            >
              <span>{e.label}</span>
              {e.keys && <kbd>{e.keys}</kbd>}
            </button>
          ),
        )}
      </div>
    </>
  )
}
