/** "Turn this sketch into a board": a pen drawing or photo becomes real objects, via the assistant (previewed). */

import type { Editor } from '../editor/Editor'
import * as B from '../model/board'

/** Whether the selection has something drawn or photographed to read. */
export const hasSketch = (editor: Editor) => editor.selectedItems.some((i) => i.kind === 'pen' || i.kind === 'image')

export async function sketchToBoard(editor: Editor) {
  const ids = new Set(editor.selection)
  const box = B.bounds(editor.board, ids)
  if (!box || !hasSketch(editor)) return editor.setStatus('Select a drawing or a photo first')
  editor.setStatus('Reading the sketch…')
  try {
    const m = await import('./exportImage')
    const image = await m.aiImageOf(editor, ids, editor.selectedItems.some((i) => i.kind === 'image'))
    if (!image) return editor.setStatus('Nothing to read')
    const at = { x: Math.round(box.x + box.w + 80), y: Math.round(box.y) }
    editor.askAi(
      `The picture is a hand-drawn sketch or a photo from my board (objects ${[...ids].join(', ')}). Recreate what it shows as real BrainCraft objects with one propose_changes call:
- boxes joined by arrows → createFlowchart (Mermaid), with decisions where the sketch has questions or branches
- ideas branching from a centre → createMindMap
- columns of cards → createKanban; a grid → createTable; loose notes or lists → createNote (one per note)
Keep the sketch's wording (fix obvious spelling). Put the new objects to the right of the sketch, starting at {"x": ${at.x}, "y": ${at.y}}, and wrap them in one createFrame titled after what the sketch is about. Don't change or delete the sketch itself. Then say in one line what you made.`,
      [image],
      'Turn this sketch into a board',
    )
  } catch (err) {
    editor.setStatus(`Couldn't read the sketch: ${(err as Error).message}`)
  }
}
