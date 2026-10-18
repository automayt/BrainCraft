/**
 * Wiki pages as ordinary Markdown files, and back: one page as a .md file, a whole wiki as a zip
 * of .md files in folders (sub-pages in a folder named after their page), and .md files dropped
 * into a wiki as new pages. Links between pages become `[[Title]]`, which BrainCraft reads by name
 * when the files come back; links to boards become web links.
 */

import { type LinkTarget, parseNote } from './notes'
import type { Board } from './types'
import { BODY_MAX, getPage, pageText, pageTree, type PageNode } from './wiki'
import { type ZipEntry, zip } from './zip'

/** Turns a BrainCraft link into a web address, when it has one (another board or wiki). */
export type WebLink = (to: LinkTarget) => string | null

/** One page's words as plain Markdown, with its title as the first heading. */
export function pageMarkdown(b: Board, id: string, webLink: WebLink): string {
  const page = getPage(b, id)
  const text = pageText(b, id)
  let out = ''
  for (const part of parseNote(text)) {
    if ('text' in part) out += part.text
    else if ('mention' in part) out += part.label
    else if (!part.link) out += `[[${part.label}]]`
    else if (part.link.page !== undefined && part.link.board === undefined) out += `[[${getPage(b, part.link.page)?.title || part.label}]]`
    else {
      // An embed line (`![[…]](board:…)`) keeps its place as a plain link.
      if (out.endsWith('!')) out = out.slice(0, -1)
      const url = webLink(part.link)
      out += url ? `[${part.label}](${url})` : part.label
    }
  }
  const title = page?.title || 'Untitled'
  // Most pages start with their own title as a heading already (templates, new wikis).
  return new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(\\n|$)`).test(out) ? out : `# ${title}\n\n${out}`
}

/** A file or folder name from a title: no characters file systems refuse, not too long. */
export function fileNameFor(title: string): string {
  // By characters, not code units, so an emoji is never cut in half.
  const safe = [
    ...[...title]
      .map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch))
      .join('')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, ''),
  ]
    .slice(0, 80)
    .join('')
    .trim()
  // Names Windows keeps for itself can't be files there.
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safe) ? `${safe}_` : safe || 'Untitled'
}

/** The whole wiki as .md files: each page, and its sub-pages in a folder of the same name. */
export function wikiFiles(b: Board, webLink: WebLink): ZipEntry[] {
  const enc = new TextEncoder()
  const out: ZipEntry[] = []
  const walk = (nodes: PageNode[], folder: string) => {
    const used = new Set<string>()
    for (const n of nodes) {
      const base = fileNameFor(n.page.title)
      let name = base
      for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base} (${k})`
      used.add(name.toLowerCase())
      out.push({ name: `${folder}${name}.md`, data: enc.encode(pageMarkdown(b, n.page.id, webLink)) })
      if (n.children.length) walk(n.children, `${folder}${name}/`)
    }
  }
  walk(pageTree(b), '')
  return out
}

export const wikiZip = (b: Board, webLink: WebLink, when?: Date) => zip(wikiFiles(b, webLink), when)

export interface ImportedPage {
  title: string
  text: string
}

/** Markdown files as pages: the title from the first `# heading` (or the file's name), the rest as words. */
export function pagesFromFiles(files: { name: string; text: string }[]): ImportedPage[] {
  return files.map((f) => {
    const text = f.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    // The title from a first line like "# Packing list": read by hand, the first line only (a
    // pattern over the whole file took seconds on a long line of #s).
    const start = text.length - text.trimStart().length
    const lineEnd = text.indexOf('\n', start)
    const first = text.slice(start, lineEnd < 0 ? text.length : lineEnd)
    const heading = first.length <= 600 && /^#[ \t]/.test(first) ? first.slice(1).replace(/[ \t#]+$/, '').trim() : ''
    const fromName = f.name.replace(/^.*[\\/]/, '').replace(/\.(md|markdown|mdown|txt)$/i, '')
    const title = (heading || fromName).slice(0, 500) || 'Untitled'
    const rest = (heading ? text.slice(lineEnd < 0 ? text.length : lineEnd + 1) : text).replace(/^\n+/, '')
    return { title, text: rest.slice(0, BODY_MAX) }
  })
}
