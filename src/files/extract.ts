/**
 * The words in a file, as Markdown: PDFs, Word documents, slides, spreadsheets, CSV, web pages,
 * Markdown and plain text. Pictures and other files have none (they're kept, just not read).
 */

import { type FileKind, extOf, kindOf } from '../model/files'
import { type Converted, csvToMarkdown, docxToMarkdown, pptxToMarkdown, xlsxToMarkdown } from './office'

export interface Extracted extends Converted {
  kind: FileKind
}

/** At most this much text is kept from one file. */
export const MAX_TEXT = 2_000_000

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

export async function extract(name: string, type: string, bytes: Uint8Array): Promise<Extracted> {
  const kind = kindOf(name, type)
  const ext = extOf(name)
  let got: Converted = { markdown: '' }
  if (kind === 'pdf') got = await (await import('./pdf')).pdfToMarkdown(bytes)
  else if (ext === 'docx') got = await docxToMarkdown(bytes)
  else if (ext === 'pptx') got = await pptxToMarkdown(bytes)
  else if (ext === 'xlsx') got = await xlsxToMarkdown(bytes)
  else if (ext === 'csv' || ext === 'tsv') got = csvToMarkdown(decode(bytes))
  else if (kind === 'web') got = htmlToMarkdown(decode(bytes))
  else if (kind === 'markdown' || kind === 'text') got = { markdown: decode(bytes) }
  else if (kind === 'data') got = { markdown: `\`\`\`${ext === 'json' ? 'json' : ''}\n${decode(bytes).slice(0, 200_000)}\n\`\`\`\n` }
  const markdown = got.markdown.length > MAX_TEXT ? `${got.markdown.slice(0, MAX_TEXT)}\n\n…` : got.markdown
  return { ...got, markdown, kind }
}

/** Files whose words BrainCraft can read (the rest are kept as they are). */
export function canRead(name: string, type = ''): boolean {
  const kind = kindOf(name, type)
  const ext = extOf(name)
  return kind === 'pdf' || ['docx', 'pptx', 'xlsx', 'csv', 'tsv'].includes(ext) || ['web', 'markdown', 'text', 'data'].includes(kind)
}

/** Plain words from Markdown, for excerpts. */
export function plainWords(md: string, max = 300): string {
  const s = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*]|\d+\.)\s+(?:\[[ x]\]\s+)?/gim, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>|~]+/g, ' ')
    .replace(/\s*-{3,}\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** A web page's content as Markdown (in the browser, which reads the HTML). */
export function htmlToMarkdown(html: string): Converted {
  if (typeof DOMParser === 'undefined') return { markdown: plainWords(html.replace(/<[^>]+>/g, ' '), MAX_TEXT) }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.querySelectorAll('script, style, noscript, template, nav, footer, iframe, svg')) el.remove()
  const inline = (n: Node): string => {
    if (n.nodeType === 3) return (n.textContent ?? '').replace(/\s+/g, ' ')
    if (n.nodeType !== 1) return ''
    const el = n as Element
    const inner = () => [...el.childNodes].map(inline).join('')
    switch (el.tagName.toLowerCase()) {
      case 'strong':
      case 'b': {
        const t = inner().trim()
        return t ? `**${t}**` : ''
      }
      case 'em':
      case 'i': {
        const t = inner().trim()
        return t ? `*${t}*` : ''
      }
      case 'code':
        return `\`${el.textContent ?? ''}\``
      case 'br':
        return ' '
      case 'img':
        return el.getAttribute('alt') ? `(${el.getAttribute('alt')})` : ''
      case 'a': {
        const href = el.getAttribute('href') ?? ''
        const t = inner().trim()
        return /^(https?:|mailto:)/i.test(href) && t ? `[${t}](${href})` : t
      }
      default:
        return inner()
    }
  }
  const out: string[] = []
  /** A list with its sub-lists under their items. */
  const list = (el: Element, depth: number): string =>
    [...el.children]
      .filter((li) => li.tagName.toLowerCase() === 'li')
      .map((li) => {
        const nested = (x: Node) => x.nodeType === 1 && /^(ul|ol)$/i.test((x as Element).tagName)
        const own = [...li.childNodes].filter((x) => !nested(x)).map(inline).join('').trim()
        const subs = [...li.children].filter(nested).map((s) => list(s, depth + 1))
        return [`${'  '.repeat(depth)}${el.tagName.toLowerCase() === 'ol' ? '1.' : '-'} ${own}`, ...subs].join('\n')
      })
      .join('\n')
  const block = (el: Element, depth = 0) => {
    for (const c of el.children) {
      const tag = c.tagName.toLowerCase()
      const h = /^h([1-6])$/.exec(tag)
      if (h) out.push(`${'#'.repeat(Math.min(6, Number(h[1]) + 1))} ${inline(c).trim()}`)
      else if (tag === 'p') {
        const t = inline(c).trim()
        if (t) out.push(t)
      } else if (tag === 'ul' || tag === 'ol') out.push(list(c, depth))
      else if (tag === 'pre') out.push(`\`\`\`\n${c.textContent ?? ''}\n\`\`\``)
      else if (tag === 'blockquote') out.push(`> ${inline(c).trim()}`)
      else if (tag === 'table') {
        const rows = [...c.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th, td')].map((td) => inline(td).trim().replace(/\|/g, '\\|')))
        if (rows.length) {
          const w = Math.max(...rows.map((r) => r.length))
          const line = (r: string[]) => `| ${Array.from({ length: w }, (_, k) => r[k] ?? '').join(' | ')} |`
          out.push([line(rows[0]), `| ${Array(w).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n'))
        }
      } else if (tag === 'hr') out.push('---')
      else block(c, depth)
    }
  }
  if (doc.body) block(doc.body)
  const title = doc.querySelector('title')?.textContent?.trim()
  return { markdown: `${out.filter(Boolean).join('\n\n')}\n`, ...(title ? { title } : {}) }
}
