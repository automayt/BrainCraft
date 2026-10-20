/**
 * Reading a PDF's text with pdf.js (loaded only when a PDF is added). The words come out with their
 * size and place; `pdfText.ts` turns those into Markdown.
 */

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Converted } from './office'
import { type PdfLine, pdfLinesToMarkdown } from './pdfText'

GlobalWorkerOptions.workerSrc = workerUrl

/** At most this many pages are read. */
const MAX_PAGES = 2000

export async function pdfToMarkdown(bytes: Uint8Array): Promise<Converted> {
  // pdf.js takes the bytes over (detaching them), so it gets its own copy.
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise
  try {
    const pages: PdfLine[][] = []
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n)
      const height = page.getViewport({ scale: 1 }).height
      const content = await page.getTextContent()
      const lines: PdfLine[] = []
      let line: PdfLine | null = null
      for (const raw of content.items) {
        if (!('str' in raw)) continue
        const it = raw as TextItem
        const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10
        const y = height - it.transform[5]
        // A new line when the words move down (or up, to a new column) by more than half a line.
        if (!line || Math.abs(y - line.y) > size * 0.5) {
          if (line) lines.push(line)
          line = { text: it.str, size, y }
        } else {
          line.text += it.str
          line.size = Math.max(line.size, size)
        }
        if (it.hasEOL) {
          lines.push(line)
          line = null
        }
      }
      if (line) lines.push(line)
      pages.push(lines)
      page.cleanup()
    }
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: unknown } | undefined
    const title = typeof info?.Title === 'string' && info.Title.trim() ? info.Title.trim() : undefined
    return { markdown: pdfLinesToMarkdown(pages), pages: doc.numPages, ...(title ? { title } : {}) }
  } finally {
    void doc.destroy()
  }
}
