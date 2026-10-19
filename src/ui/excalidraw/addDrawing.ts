import type { Editor } from '../../editor/Editor'
import type { Vec } from '../../model/geom'
import type { ExcalidrawScene } from '../../model/types'

/** Puts a drawing brought in from a file or the clipboard on the board (Excalidraw loads only now). */
export async function addDrawing(editor: Editor, scene: ExcalidrawScene, at?: Vec) {
  if (editor.readOnly) return
  editor.setStatus('Drawing it…')
  try {
    const { pictureOf } = await import('./picture')
    editor.saveDrawing(null, scene, await pictureOf(scene), at)
    editor.setStatus('Added the drawing: double-click it to open it in Excalidraw')
  } catch (err) {
    editor.setStatus(`Couldn’t draw that: ${(err as Error).message}`)
  }
}
