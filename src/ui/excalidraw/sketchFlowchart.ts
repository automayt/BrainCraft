/**
 * "Sketch in Excalidraw": a BrainCraft flowchart drawn again by Excalidraw, hand-drawn, as a drawing
 * beside it. It goes through Mermaid (BrainCraft's own export, and Excalidraw's converter), so the
 * flowchart itself stays as it was: the one to change, run and export.
 */

import type { Editor } from '../../editor/Editor'
import * as B from '../../model/board'
import { toMermaid } from '../../model/mermaid'
import { flowComponent } from '../../model/sketch'
import type { Id } from '../../model/types'
import { mermaidScene } from './mermaidDrawing'
import { pictureOf } from './picture'

export async function sketchFlowchart(editor: Editor, id: Id): Promise<Id | null> {
  const ids = flowComponent(editor.board, id)
  if (!ids.size) return null
  const scene = await mermaidScene(toMermaid(editor.board, ids))
  const picture = await pictureOf(scene)
  // Beside the flowchart, on its right, level with its top.
  const box = B.bounds(editor.board, ids)!
  const scale = Math.min(1, 640 / Math.max(picture.w, picture.h))
  const at = { x: box.x + box.w + 120 + (picture.w * scale) / 2, y: box.y + (picture.h * scale) / 2 }
  return editor.saveDrawing(null, scene, picture, at)
}
