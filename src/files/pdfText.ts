/**
 * A PDF's lines of text as Markdown. A PDF only knows where words are and how big: headings are
 * lines set larger than the body text, paragraphs are lines close together, lists start with a
 * bullet or a number, and running heads and page numbers (the same line on most pages) are dropped.
 */

export interface PdfLine {
  text: string
  /** Font size. */
  size: number
  /** Distance down the page (bigger is lower). */
  y: number
}

const BULLET = /^\s*(?:[•◦▪▫●○■□‣⁃–—-]|\*)\s+/
const NUMBERED = /^\s*(\d{1,3}|[a-z])[.)]\s+/i

/** A line's shape with its numbers taken out, to spot running heads and page numbers. */
const shape = (s: string) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()

export function pdfLinesToMarkdown(pages: PdfLine[][]): string {
  // Running heads and feet: a line near the top or bottom that most pages share.
  const edges = new Map<string, number>()
  for (const lines of pages) {
    const ends = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map((l) => shape(l.text)))
    for (const e of ends) edges.set(e, (edges.get(e) ?? 0) + 1)
  }
  const running = new Set([...edges].filter(([s, n]) => n >= 3 && n >= pages.length * 0.6 && s.length < 120).map(([s]) => s))
  const kept = pages.map((lines) =>
    lines.filter((l, k) => {
      const t = l.text.trim()
      if (!t) return false
      // A bare page number.
      if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(t)) return false
      const edge = k < 2 || k >= lines.length - 2
      return !(edge && running.has(shape(t)))
    }),
  )

  // The body size: the size most of the words are set in.
  const weight = new Map<number, number>()
  for (const lines of kept) for (const l of lines) weight.set(Math.round(l.size * 2) / 2, (weight.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length)
  const body = [...weight].sort((a, z) => z[1] - a[1])[0]?.[0] ?? 10
  const level = (size: number, text: string) => {
    if (text.length > 120 || size < body * 1.15) return 0
    if (size >= body * 1.8) return 2
    if (size >= body * 1.4) return 3
    return 4
  }

  const out: string[] = []
  let para = ''
  let item = ''
  const flush = () => {
    if (para) out.push(para.trim())
    if (item) out.push(item.trim())
    para = ''
    item = ''
  }
  // Joins a line to what came before: a word broken with a hyphen is put back together.
  const join = (a: string, b: string) => (/[a-z]-$/i.test(a) && /^[a-z]/.test(b) ? a.slice(0, -1) + b : a ? `${a} ${b}` : b)
  for (const lines of kept) {
    let prev: PdfLine | null = null
    for (const l of lines) {
      const text = l.text.replace(/\s+/g, ' ').trim()
      const h = level(l.size, text)
      const gap = prev ? l.y - prev.y : 0
      const far = !prev || gap > Math.max(prev.size, l.size) * 1.7 || gap < 0
      if (h) {
        // A heading on two lines stays one heading.
        const last = out.at(-1)
        if (!para && !item && prev && !far && last?.startsWith('#'.repeat(h) + ' ') && level(prev.size, prev.text) === h) out[out.length - 1] = join(last, text)
        else {
          flush()
          out.push(`${'#'.repeat(h)} ${text}`)
        }
      } else if (BULLET.test(text) || NUMBERED.test(text)) {
        flush()
        item = BULLET.test(text) ? `- ${text.replace(BULLET, '')}` : `1. ${text.replace(NUMBERED, '')}`
      } else if (item && !far) item = join(item, text)
      else {
        if (far || item) flush()
        para = join(para, text)
      }
      prev = l
    }
    // A new page carries a paragraph on only when it didn't end a sentence.
    if (para && /[.!?:]["”’)]?$/.test(para)) flush()
  }
  flush()
  // Lists stay together; everything else gets a blank line between.
  let md = ''
  out.forEach((b, k) => {
    const listy = (s: string) => /^(?:-|1\.) /.test(s)
    if (k) md += listy(b) && listy(out[k - 1]) ? '\n' : '\n\n'
    md += b
  })
  return `${md}\n`
}
