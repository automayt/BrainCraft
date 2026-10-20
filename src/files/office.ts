/**
 * Word (.docx), PowerPoint (.pptx) and Excel (.xlsx) files as Markdown, read straight from the XML
 * inside them: headings, lists, bold and italics, links and tables from documents; each slide's
 * title, points and notes from decks; each sheet as a table from workbooks. Also CSV.
 */

import { unzip, type Unzipped } from './unzip'
import { type XmlNode, attr, find, findAll, kids, nameIs, parseXml, textOf } from './xml'

/** At most this many rows and columns of a sheet become a table. */
const MAX_ROWS = 300
const MAX_COLS = 40

export interface Converted {
  markdown: string
  /** Slides in a deck, sheets in a workbook. */
  pages?: number
  /** The document's own title, when it says. */
  title?: string
}

async function xml(z: Unzipped, name: string): Promise<XmlNode | null> {
  const t = await z.text(name)
  return t ? parseXml(t) : null
}

/** A part's relationships: id → target path (resolved against the part's folder). */
async function rels(z: Unzipped, part: string): Promise<Map<string, { target: string; external: boolean }>> {
  const slash = part.lastIndexOf('/')
  const dir = part.slice(0, slash + 1)
  const doc = await xml(z, `${dir}_rels/${part.slice(slash + 1)}.rels`)
  const out = new Map<string, { target: string; external: boolean }>()
  for (const r of doc ? findAll(doc, 'Relationship') : []) {
    const id = r.attrs.Id
    const target = r.attrs.Target ?? ''
    const external = r.attrs.TargetMode === 'External'
    if (id) out.set(id, { target: external ? target : resolvePath(dir, target), external })
  }
  return out
}

/** A relationship id (`r:id`), not an element's own `id`. */
const relId = (node: XmlNode) => Object.entries(node.attrs).find(([k]) => k.endsWith(':id'))?.[1]

function resolvePath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (dir + target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.') out.push(p)
  }
  return out.join('/')
}

/** Inline text with its marks, merged so neighbouring runs of the same style read as one. */
interface Span {
  text: string
  b?: boolean
  i?: boolean
  s?: boolean
  href?: string
}

function spansToMarkdown(spans: Span[]): string {
  const merged: Span[] = []
  for (const sp of spans) {
    const last = merged.at(-1)
    if (last && !!last.b === !!sp.b && !!last.i === !!sp.i && !!last.s === !!sp.s && last.href === sp.href) last.text += sp.text
    else merged.push({ ...sp })
  }
  return merged
    .map((sp) => {
      if (!sp.text.trim()) return sp.text
      // Marks hug the words; spaces stay outside them.
      const lead = /^\s*/.exec(sp.text)![0]
      const trail = /\s*$/.exec(sp.text)![0]
      let core = sp.text.trim()
      if (sp.s) core = `~~${core}~~`
      if (sp.i) core = `*${core}*`
      if (sp.b) core = `**${core}**`
      if (sp.href && /^(https?:|mailto:)/i.test(sp.href)) core = `[${core}](${sp.href.replace(/[()\s]/g, encodeURIComponent)})`
      return lead + core + trail
    })
    .join('')
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

/** A Markdown table: the first row is the header. */
export function markdownTable(rows: string[][]): string {
  const width = Math.min(MAX_COLS, Math.max(1, ...rows.map((r) => r.length)))
  const pad = (r: string[]) => Array.from({ length: width }, (_, k) => cell(r[k] ?? ''))
  const [head, ...rest] = rows
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`
  return [line(head ?? []), `| ${Array(width).fill('---').join(' | ')} |`, ...rest.map(line)].join('\n')
}

// ----- Word -------------------------------------------------------------------------------

const on = (props: XmlNode | null, name: string) => {
  const el = props && kids(props, name)[0]
  if (!el) return false
  const v = attr(el, 'val')
  return v === undefined || !/^(0|false|off|none)$/i.test(v)
}

export async function docxToMarkdown(bytes: Uint8Array): Promise<Converted> {
  const z = unzip(bytes)
  const doc = await xml(z, 'word/document.xml')
  if (!doc) throw new Error('This isn’t a Word document (no word/document.xml inside)')
  const links = await rels(z, 'word/document.xml')
  // Style ids → names, so "Heading 1" is found whatever language the document was written in.
  const styles = new Map<string, string>()
  const st = await xml(z, 'word/styles.xml')
  for (const s of st ? findAll(st, 'style') : []) {
    const id = attr(s, 'styleId')
    const name = attr(kids(s, 'name')[0], 'val')
    if (id && name) styles.set(id, name.toLowerCase())
  }
  // Numbered or bulleted: numId → abstract numbering → each level's format.
  const formats = new Map<string, string[]>()
  const num = await xml(z, 'word/numbering.xml')
  if (num) {
    const abstract = new Map<string, string[]>()
    for (const a of kids(num, 'abstractNum')) {
      const lv: string[] = []
      for (const l of kids(a, 'lvl')) lv[Number(attr(l, 'ilvl') ?? 0)] = attr(kids(l, 'numFmt')[0], 'val') ?? 'bullet'
      abstract.set(attr(a, 'abstractNumId') ?? '', lv)
    }
    for (const n of kids(num, 'num')) formats.set(attr(n, 'numId') ?? '', abstract.get(attr(kids(n, 'abstractNumId')[0], 'val') ?? '') ?? [])
  }

  let title: string | undefined
  const out: string[] = []
  const runs = (p: XmlNode, href?: string): Span[] => {
    const spans: Span[] = []
    for (const c of kids(p)) {
      if (nameIs(c, 'r')) {
        const rPr = kids(c, 'rPr')[0] ?? null
        const marks = { b: on(rPr, 'b'), i: on(rPr, 'i'), s: on(rPr, 'strike'), ...(href ? { href } : {}) }
        for (const t of kids(c)) {
          if (nameIs(t, 't')) spans.push({ text: textOf(t), ...marks })
          else if (nameIs(t, 'tab')) spans.push({ text: ' ', ...marks })
          else if (nameIs(t, 'br') || nameIs(t, 'cr')) spans.push({ text: ' ', ...marks })
        }
      } else if (nameIs(c, 'hyperlink')) {
        const id = attr(c, 'id')
        const target = id ? links.get(id) : undefined
        spans.push(...runs(c, target?.external ? target.target : undefined))
      } else if (nameIs(c, 'ins') || nameIs(c, 'smartTag') || nameIs(c, 'sdtContent') || nameIs(c, 'sdt') || nameIs(c, 'fldSimple')) spans.push(...runs(c, href))
    }
    return spans
  }
  const paragraph = (p: XmlNode) => {
    const pPr = kids(p, 'pPr')[0]
    const style = styles.get(attr(pPr && kids(pPr, 'pStyle')[0], 'val') ?? '') ?? attr(pPr && kids(pPr, 'pStyle')[0], 'val')?.toLowerCase() ?? ''
    const text = spansToMarkdown(runs(p)).trim()
    if (!text) return
    if (style === 'title') {
      title ??= text.replace(/\*+/g, '')
      out.push(`# ${text.replace(/\*+/g, '')}`)
      return
    }
    const h = /^heading (\d)$/.exec(style)
    if (h) {
      out.push(`${'#'.repeat(Math.min(6, Number(h[1]) + 1))} ${text.replace(/\*\*/g, '')}`)
      return
    }
    const numPr = pPr && kids(pPr, 'numPr')[0]
    if (numPr) {
      const level = Number(attr(kids(numPr, 'ilvl')[0], 'val') ?? 0)
      const fmt = formats.get(attr(kids(numPr, 'numId')[0], 'val') ?? '')?.[level] ?? 'bullet'
      out.push(`${'  '.repeat(Math.min(level, 6))}${fmt === 'bullet' || fmt === 'none' ? '-' : '1.'} ${text}`)
      return
    }
    if (style === 'quote' || style === 'intense quote') out.push(`> ${text}`)
    else out.push(text)
  }
  const table = (t: XmlNode) => {
    const rows = kids(t, 'tr').map((tr) => kids(tr, 'tc').map((tc) => kids(tc, 'p').map((p) => spansToMarkdown(runs(p)).trim()).filter(Boolean).join(' ')))
    if (rows.length) out.push(markdownTable(rows.slice(0, MAX_ROWS)))
  }
  const block = (node: XmlNode) => {
    for (const c of kids(node)) {
      if (nameIs(c, 'p')) paragraph(c)
      else if (nameIs(c, 'tbl')) table(c)
      else if (nameIs(c, 'sdt') || nameIs(c, 'sdtContent') || nameIs(c, 'customXml')) block(c)
    }
  }
  const body = find(doc, 'body')
  if (body) block(body)
  return { markdown: joinBlocks(out), ...(title ? { title } : {}) }
}

/** Blocks with blank lines between them, except between items of the same list. */
function joinBlocks(lines: string[]): string {
  let s = ''
  const isItem = (l: string) => /^\s*(?:-|1\.) /.test(l)
  lines.forEach((l, k) => {
    if (k) s += isItem(l) && isItem(lines[k - 1]) ? '\n' : '\n\n'
    s += l
  })
  return `${s}\n`
}

// ----- PowerPoint -------------------------------------------------------------------------

export async function pptxToMarkdown(bytes: Uint8Array): Promise<Converted> {
  const z = unzip(bytes)
  const pres = await xml(z, 'ppt/presentation.xml')
  if (!pres) throw new Error('This isn’t a PowerPoint deck (no ppt/presentation.xml inside)')
  const presRels = await rels(z, 'ppt/presentation.xml')
  const slides = findAll(pres, 'sldId')
    .map((s) => presRels.get(relId(s) ?? '')?.target)
    .filter((t): t is string => !!t)
  const out: string[] = []
  let deckTitle: string | undefined
  for (const [k, path] of slides.entries()) {
    const slide = await xml(z, path)
    if (!slide) continue
    let title = ''
    const points: string[] = []
    for (const sp of findAll(slide, 'sp')) {
      const ph = find(sp, 'ph')
      const isTitle = /title/i.test(attr(ph, 'type') ?? '')
      const body = find(sp, 'txBody')
      if (!body) continue
      for (const p of kids(body, 'p')) {
        const level = Number(attr(kids(p, 'pPr')[0], 'lvl') ?? 0)
        const text = spansToMarkdown(
          findAll(p, 'r').map((r) => {
            const rPr = kids(r, 'rPr')[0]
            return { text: textOf(kids(r, 't')[0] ?? { name: '', attrs: {}, children: [] }), b: attr(rPr, 'b') === '1', i: attr(rPr, 'i') === '1' }
          }),
        ).trim()
        if (!text) continue
        if (isTitle && !title) title = text.replace(/\*+/g, '')
        else points.push(`${'  '.repeat(Math.min(level, 6))}- ${text}`)
      }
    }
    // Tables on the slide.
    const tables = findAll(slide, 'tbl').map((t) => markdownTable(kids(t, 'tr').map((tr) => kids(tr, 'tc').map((tc) => textOf(tc)))))
    if (k === 0 && title) deckTitle = title
    out.push(`## ${k + 1}. ${title || `Slide ${k + 1}`}`)
    if (points.length) out.push(points.join('\n'))
    out.push(...tables)
    // The speaker's notes, when there are some.
    const slideRels = await rels(z, path)
    const notesPath = [...slideRels.values()].find((r) => /notesSlide/.test(r.target))?.target
    const notes = notesPath ? await xml(z, notesPath) : null
    if (notes) {
      const said = findAll(notes, 'sp')
        .filter((sp) => attr(find(sp, 'ph'), 'type') === 'body')
        .flatMap((sp) => findAll(sp, 'p').map((p) => findAll(p, 't').map(textOf).join('').trim()))
        .filter(Boolean)
      if (said.length) out.push(`> **Notes:** ${said.join(' ')}`)
    }
  }
  return { markdown: `${out.join('\n\n')}\n`, pages: slides.length, ...(deckTitle ? { title: deckTitle } : {}) }
}

// ----- Excel ------------------------------------------------------------------------------

/** "C12" → column 2 (from 0). */
const colOf = (ref: string) => {
  let n = 0
  for (const ch of /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A') n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export async function xlsxToMarkdown(bytes: Uint8Array): Promise<Converted> {
  const z = unzip(bytes)
  const book = await xml(z, 'xl/workbook.xml')
  if (!book) throw new Error('This isn’t an Excel workbook (no xl/workbook.xml inside)')
  const bookRels = await rels(z, 'xl/workbook.xml')
  const shared: string[] = []
  const ss = await xml(z, 'xl/sharedStrings.xml')
  for (const si of ss ? kids(ss, 'si') : []) shared.push(findAll(si, 't').map(textOf).join(''))
  const out: string[] = []
  const sheets = findAll(book, 'sheet')
  for (const s of sheets) {
    const path = bookRels.get(relId(s) ?? '')?.target
    const sheet = path ? await xml(z, path) : null
    if (!sheet) continue
    const rows: string[][] = []
    for (const row of findAll(sheet, 'row').slice(0, MAX_ROWS)) {
      const r: string[] = []
      for (const c of kids(row, 'c')) {
        const col = colOf(attr(c, 'r') ?? 'A')
        if (col >= MAX_COLS) continue
        const t = attr(c, 't')
        const v = kids(c, 'v')[0]
        const value = t === 's' ? (shared[Number(v ? textOf(v) : -1)] ?? '') : t === 'inlineStr' ? findAll(c, 't').map(textOf).join('') : t === 'b' ? (v && textOf(v) === '1' ? 'TRUE' : 'FALSE') : v ? textOf(v) : ''
        r[col] = value
      }
      if (r.some((x) => x?.trim())) rows.push(Array.from(r, (x) => x ?? ''))
    }
    out.push(`## ${attr(s, 'name') ?? 'Sheet'}`)
    out.push(rows.length ? markdownTable(rows) : '_Empty._')
  }
  return { markdown: `${out.join('\n\n')}\n`, pages: sheets.length }
}

// ----- CSV --------------------------------------------------------------------------------

/** Rows of a CSV (or, with a tab, TSV) file: quoted fields, doubled quotes, line breaks in quotes. */
export function parseCsv(text: string, sep = text.split('\n', 1)[0].includes('\t') ? '\t' : ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && !field) quoted = true
    else if (ch === sep) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (rows.length >= MAX_ROWS) return rows
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export const csvToMarkdown = (text: string): Converted => ({ markdown: `${markdownTable(parseCsv(text))}\n` })
