import type { Editor } from '../../editor/Editor'
import { sceneFromText } from '../../model/excalidraw'
import { center, type Vec } from '../../model/geom'
import type { ExcalidrawScene } from '../../model/types'
import { isWiki } from '../../model/wiki'

/** Whether drawings can go on the open board (a wiki's pages hold drawings from boards instead). */
function canAdd(editor: Editor): boolean {
  if (editor.readOnly) return false
  if (isWiki(editor.board)) {
    editor.setStatus('Drawings go on boards: open a board, then add it there')
    return false
  }
  return true
}

/** Puts a drawing brought in from a file or the clipboard on the board (Excalidraw loads only now). */
export async function addDrawing(editor: Editor, scene: ExcalidrawScene, at?: Vec) {
  if (!canAdd(editor)) return
  editor.setStatus('Drawing it…')
  try {
    const { pictureOf } = await import('./picture')
    editor.saveDrawing(null, scene, await pictureOf(scene), at)
    editor.setStatus('Added the drawing: double-click it to open it in Excalidraw')
  } catch (err) {
    editor.setStatus(`Couldn’t draw that: ${(err as Error).message}`)
  }
}

/** Mermaid (any kind of diagram) drawn by Excalidraw, put on the board as a drawing. */
export async function addMermaidDrawing(editor: Editor, mermaid: string, at?: Vec) {
  if (!canAdd(editor)) return
  editor.setStatus('Drawing the diagram…')
  try {
    const [{ mermaidScene }, { pictureOf }] = await Promise.all([import('./mermaidDrawing'), import('./picture')])
    const scene = await mermaidScene(mermaid)
    const made = editor.saveDrawing(null, scene, await pictureOf(scene), at)
    if (made !== null) editor.focusObject(made)
    editor.setStatus('Drawn with Excalidraw: double-click it to change it there')
  } catch (err) {
    editor.setStatus(`Couldn’t draw that Mermaid: ${(err as Error).message}`)
  }
}

export const isDrawingFile = (f: File) => /\.excalidraw$/i.test(f.name)

/** `.excalidraw` files as drawings on the board, a little apart from each other. */
export async function addDrawingFiles(editor: Editor, files: File[], at: Vec = center(editor.visibleWorld)) {
  for (const [k, f] of files.entries()) {
    const scene = sceneFromText(await f.text())
    if (!scene) {
      editor.setStatus(`${f.name} isn’t an Excalidraw drawing`)
      continue
    }
    await addDrawing(editor, scene, { x: at.x + k * 40, y: at.y + k * 40 })
  }
}

/** Asks for `.excalidraw` files and puts them on the board. */
export function chooseDrawingFiles(editor: Editor) {
  if (!canAdd(editor)) return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.excalidraw,application/vnd.excalidraw+json'
  input.multiple = true
  input.onchange = () => void addDrawingFiles(editor, Array.from(input.files ?? []))
  input.click()
}
