/**
 * Excalidraw drawings on a board. A drawing is an `image` item whose picture (`src`, an SVG) was
 * drawn by Excalidraw, with the scene (`excalidraw`) kept beside it so it opens again for editing.
 * Everything here is plain data: rendering and the editor live in `src/ui/excalidraw/`.
 */

import type { ExcalidrawFile, ExcalidrawScene, Item } from './types'

/** At most this many elements in one drawing. */
export const MAX_ELEMENTS = 10_000
/** At most this much scene (elements and pictures together), as JSON. */
export const MAX_SCENE_CHARS = 8 * 1024 * 1024
/** Pictures inside one drawing. */
export const MAX_FILES = 50

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function cleanFile(id: string, v: unknown): ExcalidrawFile | null {
  if (!isObj(v)) return null
  const { mimeType, dataURL, created } = v
  if (typeof mimeType !== 'string' || !/^image\/[\w.+-]{1,40}$/.test(mimeType)) return null
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image/')) return null
  return { id, mimeType, dataURL, created: typeof created === 'number' && Number.isFinite(created) ? created : 0 }
}

/**
 * A scene from anywhere (a board file, a live peer, the clipboard), checked: a list of element
 * objects with an id and a type, and pictures as image data. Excalidraw checks each element's
 * fields again when it opens the scene. Null when it isn't one, or is too big.
 */
export function cleanExcalidraw(raw: unknown): ExcalidrawScene | null {
  if (!isObj(raw) || !Array.isArray(raw.elements) || raw.elements.length > MAX_ELEMENTS) return null
  const elements = raw.elements.filter((e): e is Record<string, unknown> => isObj(e) && typeof e.id === 'string' && typeof e.type === 'string' && e.isDeleted !== true)
  const files: Record<string, ExcalidrawFile> = {}
  if (isObj(raw.files)) {
    for (const [id, f] of Object.entries(raw.files).slice(0, MAX_FILES)) {
      const file = /^[\w-]{1,100}$/.test(id) ? cleanFile(id, f) : null
      // Only pictures the drawing uses.
      if (file && elements.some((e) => e.type === 'image' && e.fileId === id)) files[id] = file
    }
  }
  const scene: ExcalidrawScene = { elements, ...(Object.keys(files).length ? { files } : {}) }
  return JSON.stringify(scene).length <= MAX_SCENE_CHARS ? scene : null
}

/** Whether an item is an Excalidraw drawing. */
export const isDrawing = (i: Item | undefined): i is Item & { excalidraw: ExcalidrawScene } => !!i && i.kind === 'image' && !!i.excalidraw

/** The words in a drawing (its text elements), for search and for assistants. */
export function sceneText(scene: ExcalidrawScene): string {
  return scene.elements
    .filter((e) => (e as { type?: unknown }).type === 'text')
    .map((e) => String((e as { text?: unknown }).text ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 20_000)
}

/**
 * A scene from pasted or dropped text: an `.excalidraw` file or what Excalidraw puts on the
 * clipboard. Null for anything else.
 */
export function sceneFromText(text: string): ExcalidrawScene | null {
  const t = text.trimStart()
  if (!t.startsWith('{') || !t.includes('excalidraw')) return null
  try {
    const raw = JSON.parse(t) as { type?: unknown }
    if (raw.type !== 'excalidraw' && raw.type !== 'excalidraw/clipboard') return null
    const scene = cleanExcalidraw(raw)
    return scene && scene.elements.length ? scene : null
  } catch {
    return null
  }
}

/** A drawing as an `.excalidraw` file, to open in Excalidraw itself. */
export function excalidrawFile(scene: ExcalidrawScene, source = 'BrainCraft'): string {
  return JSON.stringify(
    { type: 'excalidraw', version: 2, source, elements: scene.elements, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: scene.files ?? {} },
    null,
    2,
  )
}
