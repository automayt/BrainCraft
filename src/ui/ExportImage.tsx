/** "Export image or PDF": a picture of the board or the selection, as PNG, SVG, the clipboard, or slides as PDF. */

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '../editor/Editor'
import { slides } from '../model/slides'
import type { Id } from '../model/types'
import { useDialog } from './useDialog'
import { useEditor } from './useEditor'
import { useEscape } from './useEscape'

const load = () => import('./imageExport')

/** Copies the selection (or the whole board) to the clipboard as a PNG. */
export async function copyImage(editor: Editor, ids?: ReadonlySet<Id>) {
  try {
    const m = await load()
    const pic = await m.boardSvg(editor, { ids })
    if (!pic) return editor.setStatus('Nothing to copy')
    await m.copyPng(pic)
    editor.setStatus('Copied as an image — paste it into a chat or document')
  } catch (err) {
    editor.setStatus((err as Error).message || 'Could not copy the image')
  }
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  useEscape(onClose)
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  const hasSelection = editor.selection.size > 0
  const [scope, setScope] = useState<'board' | 'selection'>(hasSelection ? 'selection' : 'board')
  const [preview, setPreview] = useState<{ url: string; w: number; h: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const ids = scope === 'selection' ? new Set(editor.selection) : undefined
  const pages = slides(editor.board).length
  const name = (ext: string) => `${(editor.board.title.trim() || 'board').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}.${ext}`

  useEffect(() => {
    let live = true
    let url = ''
    void load()
      .then((m) => m.boardSvg(editor, { ids: scope === 'selection' ? new Set(editor.selection) : undefined }))
      .then((pic) => {
        if (!live || !pic) return
        url = URL.createObjectURL(new Blob([pic.svg], { type: 'image/svg+xml' }))
        setPreview({ url, w: pic.w, h: pic.h })
      })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [editor, scope])

  const act = (label: string, f: (m: Awaited<ReturnType<typeof load>>) => Promise<void>) => async () => {
    setBusy(label)
    setError('')
    try {
      await f(await load())
    } catch (err) {
      setError((err as Error).message || 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }
  const picture = async (m: Awaited<ReturnType<typeof load>>) => {
    const pic = await m.boardSvg(editor, { ids })
    if (!pic) throw new Error('Nothing to export')
    return pic
  }

  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal export-dialog" role="dialog" aria-modal="true" aria-label="Export image or PDF" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
        <header>
          <h2>Export image or PDF</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="export-body">
          <div className="export-preview">{preview ? <img src={preview.url} alt="Preview of the export" /> : <span className="muted">Preparing…</span>}</div>
          <div className="export-options">
            <fieldset>
              <legend>What</legend>
              <label>
                <input type="radio" checked={scope === 'board'} onChange={() => setScope('board')} /> The whole board
              </label>
              <label className={hasSelection ? '' : 'muted'}>
                <input type="radio" disabled={!hasSelection} checked={scope === 'selection'} onChange={() => setScope('selection')} /> The selection
                {hasSelection ? ` (${editor.selection.size})` : ' (nothing selected)'}
              </label>
            </fieldset>
            {preview && (
              <p className="muted">
                {preview.w} × {preview.h} px (PNG at twice that)
              </p>
            )}
            <div className="export-actions">
              <button className="primary" disabled={!!busy} onClick={act('png', async (m) => m.download(await m.pngOf(await picture(m)), name('png')))}>
                {busy === 'png' ? 'Making PNG…' : 'Download PNG'}
              </button>
              <button disabled={!!busy} onClick={act('copy', async (m) => {
                await m.copyPng(await picture(m))
                editor.setStatus('Copied as an image — paste it into a chat or document')
                onClose()
              })}>
                {busy === 'copy' ? 'Copying…' : 'Copy image'}
              </button>
              <button disabled={!!busy} onClick={act('svg', async (m) => m.download(new Blob([(await picture(m)).svg], { type: 'image/svg+xml' }), name('svg')))}>
                Download SVG
              </button>
              <button disabled={!!busy || !pages} onClick={act('pdf', async (m) => {
                const pdf = await m.slidesPdf(editor)
                if (!pdf) throw new Error('Nothing to export')
                m.download(pdf, name('pdf'))
              })}>
                {busy === 'pdf' ? 'Making PDF…' : `Download PDF (${pages} page${pages === 1 ? '' : 's'})`}
              </button>
            </div>
            <p className="muted small">The PDF has one page per frame, in slide order — a handout of the presentation.</p>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
