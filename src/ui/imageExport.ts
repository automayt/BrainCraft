/**
 * Pictures of the board: SVG, PNG, the clipboard, and PDF (one page per slide).
 *
 * The board is already SVG, so an export renders the same components into a standalone SVG
 * document, with the app's stylesheet (for the current theme) and the Inter font embedded.
 * PNG and PDF pages are that SVG drawn onto a canvas. Loaded on demand: it pulls in React's
 * server renderer.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server.browser'
import type { Editor } from '../editor/Editor'
import * as B from '../model/board'
import { type Rect, expand, intersects } from '../model/geom'
import { slides } from '../model/slides'
import type { Board, Id } from '../model/types'
import { BoardView } from './BoardView'
import { StatusMarks } from './StatusMarks'
import { EditorContext } from './useEditor'

const PAD = 32
const MAX_PIXELS = 8192

export interface Picture {
  svg: string
  w: number
  h: number
}

/** The objects to draw: the selection (frames bring their contents), or everything. */
function subset(b: Board, ids?: ReadonlySet<Id>): Board {
  if (!ids?.size) return b
  const keep = B.movingSet(b, ids)
  return { ...b, items: b.items.filter((i) => keep.has(i.id)), connectors: b.connectors.filter((c) => keep.has(c.from) && keep.has(c.to)) }
}

let cssCache: Promise<string> | null = null

/** The app's styles, with the Latin Inter font files inlined so the picture looks the same anywhere. */
function styles(): Promise<string> {
  cssCache ??= (async () => {
    const parts: string[] = []
    const fonts: Promise<string>[] = []
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of rules) {
        if (rule instanceof CSSFontFaceRule) {
          // Latin and Latin Extended cover most text; other scripts fall back to system fonts.
          const range = rule.style.getPropertyValue('unicode-range')
          if (!/U\+0000-00FF|U\+0100-02BA|U\+0100-024F/i.test(range) && !/Excalifont/.test(rule.cssText)) continue
          fonts.push(inlineFont(rule.cssText, sheet.href ?? location.href))
        } else parts.push(rule.cssText)
      }
    }
    return [...(await Promise.all(fonts)), ...parts].join('\n')
  })()
  return cssCache
}

async function inlineFont(css: string, base: string): Promise<string> {
  const m = /url\(["']?([^"')]+)["']?\)/.exec(css)
  if (!m) return css
  try {
    const res = await fetch(new URL(m[1], base))
    const buf = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000))
    return css.replace(m[0], `url(data:font/woff2;base64,${btoa(bin)})`)
  } catch {
    return ''
  }
}

/** HTML inside <foreignObject> needs its namespace in a standalone SVG file. */
const xhtml = (markup: string) => markup.replace(/(<foreignObject\b[^>]*>)\s*<([a-z][a-z0-9]*)(?![^>]*\bxmlns=)/g, '$1<$2 xmlns="http://www.w3.org/1999/xhtml"')

/** A standalone SVG of `area` (or of the objects' bounds), drawn the way the board shows them now. */
export async function boardSvg(editor: Editor, opts: { ids?: ReadonlySet<Id>; area?: Rect; theme?: string } = {}): Promise<Picture | null> {
  // The masked view: an export never shows other people's hidden brainstorm notes.
  let board = subset(editor.viewBoard, opts.ids)
  const bounds = opts.area ?? B.bounds(board)
  if (!bounds) return null
  const r = opts.area ?? expand(bounds, PAD)
  if (opts.area) board = { ...board, items: board.items.filter((i) => intersects(r, i)) }
  const theme = opts.theme ?? document.documentElement.dataset.theme ?? 'dark'
  const view = createElement(BoardView, {
    board,
    hidden: editor.hidden,
    editingId: null,
    editingLabel: null,
    selectedConnector: null,
    selection: new Set<Id>(),
  })
  // Status badges are drawn over the board on screen; the picture gets them too.
  const marks = createElement(StatusMarks, { editor, board, zoom: 1 })
  const body = renderToStaticMarkup(createElement(EditorContext.Provider, { value: editor }, view, marks))
  const css = (await styles()).replace(/]]>/g, ']] >')
  const w = Math.round(r.w)
  const h = Math.round(r.h)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-theme="${theme}" class="board-export" ` +
    `width="${w}" height="${h}" viewBox="${r.x} ${r.y} ${r.w} ${r.h}">` +
    `<style><![CDATA[${css}\n.board-export{font-family:'Inter Variable',Inter,system-ui,sans-serif;color:var(--text)}]]></style>` +
    `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" style="fill:var(--canvas)"/>` +
    `${xhtml(body)}</svg>`
  return { svg, w, h }
}

/** Draws a picture onto a canvas (at up to `scale` times its size). */
async function toCanvas(p: Picture, scale = 2): Promise<HTMLCanvasElement> {
  const s = Math.min(scale, MAX_PIXELS / Math.max(p.w, p.h))
  const img = new Image()
  img.decoding = 'async'
  // A data: URL, not a blob: one: Chrome won't read back a canvas that drew a blob-URL SVG
  // containing HTML (the tables and Kanban boards), but allows it for data: URLs.
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.svg)}`
  {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(p.w * s))
    canvas.height = Math.max(1, Math.round(p.h * s))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  }
}

const blobOf = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('The browser could not make the image'))), type, quality))

export async function pngOf(p: Picture): Promise<Blob> {
  return blobOf(await toCanvas(p), 'image/png')
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}


export async function copyPng(p: Picture) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('This browser can’t copy images; download a PNG instead')
  // Safari wants the promise passed straight in, inside the click.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(p) })])
}

/** One PDF page per slide (frames in reading order; the whole board when it has none). */
export async function slidesPdf(editor: Editor): Promise<Blob | null> {
  const list = slides(editor.board)
  if (!list.length) return null
  const pages: { jpeg: Uint8Array; w: number; h: number }[] = []
  for (const s of list) {
    const pic = await boardSvg(editor, { area: expand(s.rect, 24) })
    if (!pic) continue
    const canvas = await toCanvas(pic, 2)
    const jpeg = new Uint8Array(await (await blobOf(canvas, 'image/jpeg', 0.92)).arrayBuffer())
    pages.push({ jpeg, w: canvas.width, h: canvas.height })
  }
  return pages.length ? pdfOfJpegs(pages) : null
}

/** A minimal PDF: each page is one JPEG, scaled to 960pt wide. */
export function pdfOfJpegs(pages: { jpeg: Uint8Array; w: number; h: number }[]): Blob {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (c: Uint8Array | string) => {
    const bytes = typeof c === 'string' ? enc.encode(c) : c
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (n: number, body: () => void) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    body()
    push('\nendobj\n')
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const pageIds = pages.map((_, k) => 3 + k * 3)
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  object(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`))
  pages.forEach((p, k) => {
    const id = pageIds[k]
    const w = 960
    const h = Math.round((960 * p.h) / p.w)
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
    object(id, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`),
    )
    object(id + 1, () => {
      push(`<< /Length ${draw.length} >>\nstream\n`)
      push(draw)
      push('\nendstream')
    })
    object(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
      push(p.jpeg)
      push('\nendstream')
    })
  })
  const count = 3 + pages.length * 3
  const xref = length
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

/** The objects as a picture for Claude to look at: at most 1568px on the long side, base64. */
export async function aiImageOf(editor: Editor, ids: ReadonlySet<Id>, photo: boolean): Promise<{ mediaType: 'image/png' | 'image/jpeg'; data: string } | null> {
  const pic = await boardSvg(editor, { ids })
  if (!pic) return null
  const canvas = await toCanvas(pic, Math.min(2, 1568 / Math.max(pic.w, pic.h)))
  const mediaType = photo ? 'image/jpeg' : 'image/png'
  const blob = await blobOf(canvas, mediaType, photo ? 0.88 : undefined)
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000))
  return { mediaType, data: btoa(bin) }
}
