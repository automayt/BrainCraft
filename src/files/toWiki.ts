/**
 * A file's words as wiki pages that read well: a note saying where it came from first,
 * headings in order, and a long document split into a page per section under a contents page,
 * so it's easy to find your way around, link to and search.
 */

import { FILE_KIND_LABEL, type FileKind, titleOfFile } from '../model/files'
import { plainWords } from './extract'

export interface PagePlan {
  title: string
  text: string
  icon?: string
  children: PagePlan[]
}

/** Split into sub-pages above this many words, when there are sections to split by. */
const SPLIT_WORDS = 1500
/** A contents list on a single page with at least this many headings. */
const TOC_HEADINGS = 4
/** Longer than this goes in parts (a page holds 200,000 characters). */
const PART_CHARS = 150_000

const words = (s: string) => (s.match(/\S+/g) ?? []).length

/** Headings one level up (### becomes ##), for a section that becomes a page of its own. */
const promote = (md: string) => md.replace(/^(#{3,6}) /gm, (_, h: string) => `${h.slice(1)} `)

/** Tidies Markdown: no runs of blank lines, no spaces at line ends. */
const tidy = (md: string) =>
  md
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export interface FileFacts {
  name: string
  kind: FileKind
  pages?: number
  at: number
  by?: string
}

function sourceNote(f: FileFacts): string {
  const what = FILE_KIND_LABEL[f.kind]
  const size = f.pages ? `, ${f.pages} ${f.kind === 'slides' ? (f.pages === 1 ? 'slide' : 'slides') : f.kind === 'sheet' ? (f.pages === 1 ? 'sheet' : 'sheets') : f.pages === 1 ? 'page' : 'pages'}` : ''
  const when = new Date(f.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return `> [!note] From a file\n> **${f.name.replace(/[*`[\]]/g, '')}** (${what}${size}), added ${when}${f.by ? ` by ${f.by}` : ''}. The original is in this wiki's Files.`
}

/** The page (and sub-pages) a file becomes. */
export function wikiPagesFor(f: FileFacts, md: string, docTitle?: string): PagePlan {
  const title = (docTitle && docTitle.length <= 100 ? docTitle : titleOfFile(f.name)).trim()
  // The document's own title heading goes: the page's title says it.
  let body = tidy(md).replace(new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(\\n|$)`, 'i'), '')
  body = tidy(body)
  const note = sourceNote(f)
  const sections = [...body.matchAll(/^## (.+)$/gm)]
  if (words(body) > SPLIT_WORDS && sections.length >= 3) {
    const intro = tidy(body.slice(0, sections[0].index))
    const children = sections.map((m, k) => {
      const end = k + 1 < sections.length ? sections[k + 1].index : body.length
      const name = plainWords(m[1], 100) || `Part ${k + 1}`
      return { title: name, text: `${tidy(promote(body.slice(m.index! + m[0].length, end)))}\n`, children: [] }
    })
    return { title, children, text: `${note}\n\n${intro ? `${intro}\n\n` : ''}## Contents\n{{children}}\n` }
  }
  // Too long for one page, with no sections to split by: parts, cut between paragraphs.
  if (body.length > PART_CHARS) {
    const parts: string[] = []
    let rest = body
    while (rest.length > PART_CHARS) {
      const cut = rest.lastIndexOf('\n\n', PART_CHARS)
      const at = cut > PART_CHARS / 2 ? cut : PART_CHARS
      parts.push(rest.slice(0, at))
      rest = rest.slice(at)
    }
    parts.push(rest)
    const children = parts.map((p, k) => ({ title: `${title} (part ${k + 1})`, text: `${tidy(p)}\n`, children: [] }))
    return { title, children, text: `${note}\n\n## Contents\n{{children}}\n` }
  }
  const headings = (body.match(/^#{2,4} /gm) ?? []).length
  return { title, children: [], text: `${note}\n\n${headings >= TOC_HEADINGS ? '{{toc}}\n\n' : ''}${body || '_Nothing could be read from this file._'}\n` }
}
