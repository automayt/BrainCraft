/**
 * Excalidraw, drawing right on the board. It opens over the canvas with a see-through background
 * and the board's own camera, so the drawing stays where it is: panning or zooming moves the board
 * with it, and the drawing's sheet of paper grows as you draw. Each pause saves the drawing (its
 * scene and its picture), so friends see it as it goes; all of it undoes as one step.
 * Loaded only when a drawing is opened.
 */

import './assetPath'
import '@excalidraw/excalidraw/index.css'
import { Excalidraw, getCommonBounds, getSceneVersion, restoreElements } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getItem } from '../../model/board'
import { cleanExcalidraw } from '../../model/excalidraw'
import { useEditor } from '../useEditor'
import { PAD, pictureOf } from './picture'
import { placement } from './placement'

/** A pause this long after drawing saves it. */
const SAVE_AFTER_MS = 700
/** The sheet a new, empty drawing starts on (board units). */
const NEW_SHEET = { w: 480, h: 320 }

type Elements = Parameters<typeof getCommonBounds>[0]

export default function DrawingEditor() {
  const editor = useEditor()
  const open = editor.drawing!
  const readOnly = editor.readOnly
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const [error, setError] = useState('')

  const start = useMemo(() => {
    const item = open.id === null ? undefined : getItem(editor.board, open.id)
    const scene = open.scene ?? item?.excalidraw ?? { elements: [] }
    const elements = restoreElements(scene.elements as never, null)
    let place = placement(1, 0, 0)
    if (elements.length) {
      const [x0, y0, x1, y1] = getCommonBounds(elements as Elements)
      if (item) {
        // As its picture shows it: the scene's bounds and the picture's margin, at the item's size.
        const s = item.w / Math.max(1, x1 - x0 + 2 * PAD)
        place = placement(s, item.x - (x0 - PAD) * s, item.y - (y0 - PAD) * s)
      } else {
        // A scene brought in (a sketched flowchart): its middle where it was asked for.
        place = placement(1, open.at.x - (x0 + x1) / 2, open.at.y - (y0 + y1) / 2)
      }
    }
    return { place, elements, files: scene.files ?? {}, version: getSceneVersion(elements) }
    // Fixed while it's open: later changes on the board don't move or reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { place } = start

  // What Excalidraw shows, in step with the board camera.
  const [view, setView] = useState(() => place.view(editor.camera))
  const [bounds, setBounds] = useState<readonly [number, number, number, number] | null>(() =>
    start.elements.length ? getCommonBounds(start.elements as Elements) : null,
  )

  // ----- saving as you go ------------------------------------------------------------
  const id = useRef(open.id)
  const savedVersion = useRef(open.scene ? -1 : start.version)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saving = useRef<Promise<void> | null>(null)
  const again = useRef(false)

  const save = async (): Promise<void> => {
    clearTimeout(timer.current)
    if (readOnly || !api.current) return
    if (saving.current) {
      again.current = true
      return saving.current
    }
    const elements = api.current.getSceneElements()
    const version = getSceneVersion(elements)
    // An emptied drawing isn't kept (delete it on the board to remove it).
    if (version === savedVersion.current || !elements.length) return
    const run = (async () => {
      try {
        // Plain data, as a board keeps it (and checked the same way as any drawing that arrives).
        const scene = cleanExcalidraw(JSON.parse(JSON.stringify({ elements, files: api.current!.getFiles() })))
        if (!scene) throw new Error('the drawing is too big to keep on a board')
        const picture = await pictureOf(scene)
        const [x0, y0] = getCommonBounds(elements as Elements)
        const made = editor.saveDrawing(id.current, scene, picture, undefined, place.rect(x0 - PAD, y0 - PAD, picture.w, picture.h))
        if (made !== null) id.current = made
        savedVersion.current = version
        setError('')
      } catch (err) {
        setError(`Couldn’t keep the drawing: ${(err as Error).message}`)
      }
    })()
    saving.current = run
    await run
    saving.current = null
    if (again.current) {
      again.current = false
      return save()
    }
  }

  const done = async () => {
    await save()
    editor.closeDrawing()
  }

  // Leaving the page with a drawing open keeps what's drawn so far.
  useEffect(() => {
    const flush = () => void save()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const initial = useMemo(
    () => ({
      elements: start.elements,
      files: start.files as never,
      appState: { viewBackgroundColor: 'transparent', currentItemFontFamily: 1, scrollX: view.scrollX, scrollY: view.scrollY, zoom: { value: view.zoom as never } },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Handlers that always see the latest state, so Excalidraw itself renders once: it reports a
  // change on every render, and re-rendering it on each change would never stop.
  const latest = useRef({ save, done })
  latest.current = { save, done }
  const excalidraw = useMemo(
    () => (
      <Excalidraw
        excalidrawAPI={(a) => (api.current = a)}
        initialData={initial}
        theme="light"
        viewModeEnabled={readOnly}
        onScrollChange={(scrollX, scrollY, zoom) => {
          // A pane with no size yet reports nonsense.
          if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY) || !(zoom.value > 0)) return
          setView((v) => (v.scrollX === scrollX && v.scrollY === scrollY && v.zoom === zoom.value ? v : { scrollX, scrollY, zoom: zoom.value }))
          editor.setCamera(place.camera(scrollX, scrollY, zoom.value))
        }}
        onChange={(elements, appState) => {
          const live = elements.filter((e) => !e.isDeleted)
          const drawing = appState.newElement ? [...live, appState.newElement] : live
          const next = drawing.length ? getCommonBounds(drawing as Elements) : null
          setBounds((b) => (b === next || (b && next && b.every((v, k) => v === next[k])) ? b : next))
          if (readOnly || getSceneVersion(live) === savedVersion.current) return
          clearTimeout(timer.current)
          timer.current = setTimeout(() => void latest.current.save(), SAVE_AFTER_MS)
        }}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, changeViewBackgroundColor: false, clearCanvas: false } }}
        renderTopRightUI={() => (
          <button className="drawing-done primary" onClick={() => void latest.current.done()} title="Back to the board (Ctrl Enter). Your drawing is saved as you go.">
            Done
          </button>
        )}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // The sheet of paper under the drawing, as its picture will show it (a new one starts as a blank sheet).
  const sheet = (() => {
    const [x0, y0, x1, y1] = bounds ?? (() => {
      const c = { x: (open.at.x - place.ox) / place.s, y: (open.at.y - place.oy) / place.s }
      const w = NEW_SHEET.w / place.s
      const h = NEW_SHEET.h / place.s
      return [c.x - w / 2 + PAD, c.y - h / 2 + PAD, c.x + w / 2 - PAD, c.y + h / 2 - PAD]
    })()
    const left = (x0 - PAD + view.scrollX) * view.zoom
    const top = (y0 - PAD + view.scrollY) * view.zoom
    return { left, top, width: (x1 - x0 + 2 * PAD) * view.zoom, height: (y1 - y0 + 2 * PAD) * view.zoom }
  })()

  return (
    <div
      className="drawing-editor no-canvas"
      role="application"
      aria-label={readOnly ? 'Drawing (view only)' : 'Drawing with Excalidraw on the board'}
      // Keys and clipboard belong to Excalidraw while it's open, not to the board under it.
      onKeyDown={(e) => {
        e.stopPropagation()
        // Ctrl Enter, as for text on the board: done.
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void done()
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="drawing-sheet" style={sheet} aria-hidden="true" />
      {error && (
        <p className="drawing-editor-error" role="alert">
          {error}
        </p>
      )}
      {excalidraw}
    </div>
  )
}
