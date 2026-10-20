import type { Editor } from '../../editor/Editor'
import type { Id } from '../../model/types'

/** Sketches the flowchart `id` is in as an Excalidraw drawing beside it (Excalidraw loads only now). */
export async function sketchIt(editor: Editor, id: Id) {
  editor.setStatus('Sketching the flowchart…')
  try {
    const { sketchFlowchart } = await import('./sketchFlowchart')
    const made = await sketchFlowchart(editor, id)
    editor.setStatus(made === null ? 'That isn’t part of a flowchart' : 'Sketched beside the flowchart: double-click the drawing to change it in Excalidraw')
    if (made !== null) editor.focusObject(made)
  } catch (err) {
    editor.setStatus(`Couldn’t sketch it: ${(err as Error).message}`)
  }
}
