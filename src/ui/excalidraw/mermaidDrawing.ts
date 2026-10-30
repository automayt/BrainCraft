/**
 * Mermaid drawn by Excalidraw's converter, as a scene: flowcharts and sequence diagrams become
 * hand-drawn shapes to change; other kinds of diagram come in as a picture inside it.
 */

import './assetPath'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw'
import { cleanExcalidraw } from '../../model/excalidraw'
import type { ExcalidrawScene } from '../../model/types'

export async function mermaidScene(mermaid: string): Promise<ExcalidrawScene> {
  const { elements, files } = await parseMermaidToExcalidraw(mermaid, { themeVariables: { fontSize: '18px' } })
  const drawn = convertToExcalidrawElements(elements, { regenerateIds: true })
  // Plain data, checked like any drawing that arrives.
  const scene = cleanExcalidraw(JSON.parse(JSON.stringify({ elements: drawn, files: files ?? {} })))
  if (!scene?.elements.length) throw new Error('Excalidraw couldn’t read this Mermaid')
  return scene
}
