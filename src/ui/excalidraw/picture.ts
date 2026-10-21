/**
 * A drawing's picture: Excalidraw draws the scene as an SVG with no background, so it sits on the
 * board like everything else. It's drawn in Excalidraw's light colours; dark themes show it the way
 * Excalidraw's own dark mode does (see `.drawing-picture` in the styles).
 */

import './assetPath'
import { exportToSvg, restoreElements } from '@excalidraw/excalidraw'
import type { ExcalidrawScene } from '../../model/types'

export interface Picture {
  src: string
  w: number
  h: number
}

export async function pictureOf(scene: ExcalidrawScene): Promise<Picture> {
  const svg = await exportToSvg({
    elements: restoreElements(scene.elements as never, null),
    appState: { exportBackground: false, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
    files: (scene.files ?? {}) as never,
    exportPadding: 20,
  })
  const w = Number(svg.getAttribute('width')) || 400
  const h = Number(svg.getAttribute('height')) || 300
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`, w, h }
}
