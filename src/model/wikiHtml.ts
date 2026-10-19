/**
 * A wiki as one web page: every page (or the chosen ones) with a contents list, links between
 * pages that still work, macros worked out (open tasks, page trees, other pages included…), and a
 * print style that starts each page on a new sheet, so "Print or save as PDF" makes a handbook.
 * Plain data in, a string out: the app and the server both use it. Everything from the wiki is
 * escaped; the page runs no scripts.
 */

import { type Block, type Inline, headings, macroText, parseMarkdown, taskItems } from './markdown'
import { argText, countdown, parseDay, statusLook } from './macros'
import type { LinkTarget } from './notes'
import * as RV from './revisions'
import type { Board } from './types'
import { type PageNode, childrenOf, getBody, getPage, pageByTitle, pageOrder, pagePath, pageTree, withDescendants } from './wiki'
import type { WebLink } from './wikiFiles'

export interface WikiHtmlOptions {
  /** Only these pages (and the contents list shows only them); default every page. */
  pages?: string[]
  /** Turns a link to another board into a web address, when it has one. */
  webLink?: WebLink
  /** Pictures of embedded canvas objects, by embed key (`board` or `board#item`): SVG markup or an image address. */
  pictures?: Map<string, string>
  /** When it was made (for countdowns, "today" and the footer). */
  now?: Date
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const pageAnchor = (id: string) => `p-${id.replace(/[^\w-]/g, '')}`
const headingAnchor = (page: string, slug: string) => `${pageAnchor(page)}-h-${slug.replace(/[^\w-]/g, '')}`
const safeUrl = (u: string) => (/^(https?:|mailto:)/i.test(u) ? u : null)

const CALLOUT_ICON = { note: 'ℹ️', tip: '💡', warning: '⚠️', danger: '⛔' } as const

interface Ctx {
  b: Board
  page: string
  shown: Set<string>
  o: WikiHtmlOptions
  now: Date
  /** Pages being included right now (so a page can't include itself forever). */
  including: string[]
}

function linkHtml(to: LinkTarget | null, label: string, x: Ctx): string {
  const text = esc(label)
  if (!to) {
    const p = pageByTitle(x.b, label)
    return p && x.shown.has(p.id) ? `<a href="#${pageAnchor(p.id)}">${text}</a>` : text
  }
  if (to.page !== undefined && to.board === undefined) {
    if (!x.shown.has(to.page)) return text
    return `<a href="#${to.heading ? headingAnchor(to.page, to.heading) : pageAnchor(to.page)}">${text}</a>`
  }
  const url = x.o.webLink?.(to)
  const safe = url ? safeUrl(url) : null
  return safe ? `<a href="${esc(safe)}">${text}</a>` : text
}

function inline(c: Inline[], x: Ctx): string {
  return c
    .map((i) => {
      switch (i.t) {
        case 'text':
          return esc(i.s)
        case 'br':
          return '<br>'
        case 'code':
          return `<code>${esc(i.s)}</code>`
        case 'b':
          return `<strong>${inline(i.c, x)}</strong>`
        case 'i':
          return `<em>${inline(i.c, x)}</em>`
        case 's':
          return `<s>${inline(i.c, x)}</s>`
        case 'a': {
          const href = safeUrl(i.href)
          return href ? `<a href="${esc(href)}">${inline(i.c, x)}</a>` : inline(i.c, x)
        }
        case 'link':
          return linkHtml(i.to, i.label, x)
        case 'mention':
          return esc(i.label)
        case 'macro': {
          if (i.raw !== undefined) return esc(i.raw)
          if (i.name === 'status') {
            const { label, color } = statusLook(i.args)
            return `<span class="status status-${color}">${esc(label)}</span>`
          }
          if (i.name === 'countdown') {
            const day = parseDay(i.args.pos[0])
            return day ? `<time datetime="${esc(i.args.pos[0])}">${esc(countdown(day, x.now))} (${esc(day.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))})</time>` : esc(`{{countdown ${argText(i.args)}}}`)
          }
          return esc(macroText(i.name, i.args, x.now))
        }
      }
    })
    .join('')
}

const pageLink = (id: string, x: Ctx) => {
  const p = getPage(x.b, id)
  const title = esc(`${p?.icon ? `${p.icon} ` : ''}${p?.title || 'Untitled'}`)
  return x.shown.has(id) ? `<a href="#${pageAnchor(id)}">${title}</a>` : title
}

function treeHtml(nodes: PageNode[], x: Ctx): string {
  return nodes.length ? `<ul>${nodes.map((n) => `<li>${pageLink(n.page.id, x)}${treeHtml(n.children, x)}</li>`).join('')}</ul>` : ''
}

function macroBlock(b: Extract<Block, { t: 'macro' }>, x: Ctx): string {
  const words = b.args.pos.map((w) => w.toLowerCase())
  switch (b.name) {
    case 'expand':
      return `<details><summary>${esc(argText(b.args) || 'Show more')}</summary>${blocks(b.children ?? [], x)}</details>`
    case 'columns':
      return b.columns ? `<div class="columns">${b.columns.map((c) => `<div>${blocks(c, x)}</div>`).join('')}</div>` : ''
    case 'children':
      return childrenHtml(x)
    case 'toc':
      return tocHtml(x)
    case 'pagetree': {
      const all = pageTree(x.b)
      const find = (nodes: PageNode[]): PageNode[] | null => {
        for (const n of nodes) {
          if (n.page.id === x.page) return n.children
          const deeper = find(n.children)
          if (deeper) return deeper
        }
        return null
      }
      return `<nav class="tree">${treeHtml(words[0] === 'here' ? (find(all) ?? []) : all, x)}</nav>`
    }
    case 'tasks': {
      const scope = words.includes('here') ? withDescendants(x.b, x.page) : null
      const withDone = words.includes('all')
      const groups = pageOrder(x.b)
        .filter((p) => !scope || scope.has(p.id))
        .map((p) => {
          const items = taskItems(parseMarkdown(getBody(x.b, p.id)?.text ?? '')).filter((t) => withDone || !t.task)
          return items.length ? `<p class="task-page">${pageLink(p.id, x)}</p><ul class="checklist">${items.map((t) => `<li>${t.task ? '☑' : '☐'} ${inline(t.c, x)}</li>`).join('')}</ul>` : ''
        })
        .join('')
      return groups || '<p class="muted">Nothing left to do.</p>'
    }
    case 'recent': {
      const changes = RV.recentChanges(x.b, Math.max(1, Math.min(50, Number(b.args.pos[0]) || 5)))
      return changes.length
        ? `<ul>${changes.map(({ rev }) => `<li>${pageLink(rev.page, x)} · ${esc(new Date(rev.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}${rev.by ? ` · ${esc(rev.by)}` : ''}${rev.note ? ` · ${esc(rev.note)}` : ''}</li>`).join('')}</ul>`
        : ''
    }
    case 'include': {
      const name = argText(b.args) || b.args.named.page || ''
      const p = pageByTitle(x.b, name) ?? getPage(x.b, name)
      if (!p || x.including.includes(p.id) || x.including.length > 3) return ''
      return `<div class="include"><p class="muted">From ${pageLink(p.id, x)}</p>${blocks(parseMarkdown(getBody(x.b, p.id)?.text ?? ''), { ...x, page: p.id, including: [...x.including, x.page] })}</div>`
    }
    default:
      return ''
  }
}

const childrenHtml = (x: Ctx) => {
  const kids = childrenOf(x.b, x.page)
  return kids.length ? `<ul class="children">${kids.map((k) => `<li>${pageLink(k.id, x)}</li>`).join('')}</ul>` : ''
}

const tocHtml = (x: Ctx) => {
  const hs = headings(parseMarkdown(getBody(x.b, x.page)?.text ?? ''))
  return hs.length ? `<nav class="toc">${hs.map((h) => `<a href="#${headingAnchor(x.page, h.slug)}" style="padding-left:${(h.level - 1) * 14}px">${esc(h.text)}</a>`).join('')}</nav>` : ''
}

function blocks(list: Block[], x: Ctx): string {
  return list
    .map((b): string => {
      switch (b.t) {
        case 'h': {
          const level = Math.min(6, b.level + 1)
          return `<h${level} id="${headingAnchor(x.page, b.slug)}">${inline(b.c, x)}</h${level}>`
        }
        case 'p':
          return `<p>${inline(b.c, x)}</p>`
        case 'hr':
          return '<hr>'
        case 'list': {
          const tasks = b.items.some((i) => i.task !== undefined)
          const items = b.items.map((i) => `<li>${i.task === undefined ? '' : i.task ? '☑ ' : '☐ '}${inline(i.c, x)}${i.sub ? blocks([i.sub], x) : ''}</li>`).join('')
          return b.ordered ? `<ol${b.start !== 1 ? ` start="${b.start}"` : ''}>${items}</ol>` : `<ul${tasks ? ' class="checklist"' : ''}>${items}</ul>`
        }
        case 'quote':
          return `<blockquote>${blocks(b.children, x)}</blockquote>`
        case 'callout':
          return `<aside class="callout callout-${b.kind}"><p class="callout-title">${CALLOUT_ICON[b.kind]} ${b.title.length ? inline(b.title, x) : b.kind[0].toUpperCase() + b.kind.slice(1)}</p>${blocks(b.children, x)}</aside>`
        case 'code':
          return `<pre><code>${esc(b.code)}</code></pre>`
        case 'table':
          return `<div class="table"><table><thead><tr>${b.head.map((c, k) => `<th${b.align[k] ? ` style="text-align:${b.align[k]}"` : ''}>${inline(c, x)}</th>`).join('')}</tr></thead><tbody>${b.rows
            .map((r) => `<tr>${r.map((c, k) => `<td${b.align[k] ? ` style="text-align:${b.align[k]}"` : ''}>${inline(c, x)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table></div>`
        case 'children':
          return childrenHtml(x)
        case 'toc':
          return tocHtml(x)
        case 'macro':
          return macroBlock(b, x)
        case 'embed': {
          const key = b.item === undefined ? b.board : `${b.board}#${b.item}`
          const picture = x.o.pictures?.get(key)
          const label = esc(b.label || 'A board')
          // As an image, never inline markup: a picture can't run anything.
          const src = picture?.trimStart().startsWith('<svg') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture)}` : picture
          const body = src && /^(data:image\/|https?:)/.test(src) ? `<img src="${esc(src)}" alt="${label}">` : `<div class="embed-missing">${label}</div>`
          return `<figure class="embed">${body}<figcaption>${linkHtml({ board: b.board, ...(b.item !== undefined ? { item: b.item } : {}) }, b.label || 'Open on its board', x)}</figcaption></figure>`
        }
      }
    })
    .join('\n')
}

const STYLE = `
:root{color-scheme:light;--text:#1c1d22;--muted:#5d6270;--line:#dfe1e7;--soft:#f4f5f8;--accent:#2556cc;--paper:#ffffff}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--text);font:17px/1.7 Literata,Georgia,'Times New Roman',serif}
.layout{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1180px;margin:0 auto}
nav.contents{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:28px 18px;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;border-right:1px solid var(--line)}
nav.contents h2{font-size:15px;margin:0 0 10px}
nav.contents ul{list-style:none;margin:0;padding-left:14px}nav.contents>ul{padding-left:0}
nav.contents a{color:var(--text);text-decoration:none}nav.contents a:hover{color:var(--accent)}
main{padding:28px 40px 80px;min-width:0}
section.page{padding-bottom:40px;margin-bottom:40px;border-bottom:1px solid var(--line)}
.page-path{font:13px system-ui,sans-serif;color:var(--muted);margin:0}
h1{font-size:38px;line-height:1.15;margin:4px 0 18px}
h2,h3,h4,h5,h6{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.3;margin:1.6em 0 .5em}
h2{font-size:26px}h3{font-size:21px}h4{font-size:17px}
p,ul,ol,blockquote,.callout,h2,h3,h4,h5,h6{max-width:66ch}
a{color:var(--accent)}
code{font:.88em ui-monospace,Consolas,monospace;background:var(--soft);padding:1px 5px;border-radius:4px}
pre{background:var(--soft);padding:12px 14px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}
blockquote{margin:.7em 0;padding:2px 0 2px 14px;color:var(--muted);border-left:3px solid var(--line)}
.callout{margin:.8em 0;padding:8px 14px;border-left:4px solid var(--accent);background:#eef2fc;border-radius:6px}
.callout-tip{border-color:#1a8f6a;background:#e9f6f1}.callout-warning{border-color:#c98400;background:#fdf4e3}.callout-danger{border-color:#c92a40;background:#fbecee}
.callout-title{font:600 15px system-ui,sans-serif;margin:.3em 0}
.table{overflow-x:auto}table{border-collapse:collapse;font:14.5px/1.5 system-ui,sans-serif;margin:.7em 0}th,td{border:1px solid var(--line);padding:6px 12px;text-align:left}th{background:var(--soft)}
ul.checklist{list-style:none;padding-left:.2em}
.status{font:600 .82em system-ui,sans-serif;padding:0 7px;border-radius:4px;background:#e7e9ef}
.status-green{background:#d5f0e2}.status-red{background:#fbdcdf}.status-yellow{background:#fbf0c4}.status-orange{background:#fde3c7}.status-blue{background:#dbe7fd}.status-purple{background:#e9defb}
.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}
details{margin:.7em 0;padding:6px 12px;border:1px solid var(--line);border-radius:8px}summary{font:600 15px system-ui,sans-serif;cursor:pointer}
.toc a{display:block;font:14px/1.7 system-ui,sans-serif}
.include{border-left:3px solid var(--line);padding-left:14px}
figure.embed{margin:1em 0}figure.embed img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px;background:#fff}
.embed-missing{padding:24px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);font:14px system-ui,sans-serif}
figcaption{font:13px system-ui,sans-serif;color:var(--muted);margin-top:4px}
.muted{color:var(--muted)}
footer{font:13px system-ui,sans-serif;color:var(--muted)}
@media (max-width:760px){.layout{display:block}nav.contents{position:static;max-height:none;border-right:none;border-bottom:1px solid var(--line)}main{padding:20px 16px 60px}h1{font-size:30px}}
@media print{nav.contents{display:none}.layout{display:block}main{padding:0}section.page{break-before:page;border:none;margin:0}section.page:first-of-type{break-before:auto}details{border:none}details>summary{list-style:none}a{color:inherit;text-decoration:none}}
`

/** The wiki (or the chosen pages) as one self-contained web page. */
export function wikiHtml(b: Board, o: WikiHtmlOptions = {}): string {
  const now = o.now ?? new Date()
  const order = pageOrder(b)
  const wanted = o.pages ? new Set(o.pages) : null
  const shownPages = order.filter((p) => !wanted || wanted.has(p.id))
  const shown = new Set(shownPages.map((p) => p.id))
  const x = (page: string): Ctx => ({ b, page, shown, o, now, including: [] })
  const contents = treeHtml(
    (function only(nodes: PageNode[]): PageNode[] {
      return nodes.flatMap((n) => (shown.has(n.page.id) ? [{ ...n, children: only(n.children) }] : only(n.children)))
    })(pageTree(b)),
    x(''),
  )
  const sections = shownPages
    .map((p) => {
      const path = pagePath(b, p.id).slice(0, -1)
      return `<section class="page" id="${pageAnchor(p.id)}">
${path.length ? `<p class="page-path">${path.map((q) => pageLink(q.id, x(p.id))).join(' › ')}</p>` : ''}
<h1>${esc(`${p.icon ? `${p.icon} ` : ''}${p.title || 'Untitled'}`)}</h1>
${blocks(dropTitle(parseMarkdown(getBody(b, p.id)?.text ?? ''), p.title), x(p.id))}
</section>`
    })
    .join('\n')
  const title = esc(b.title || 'Wiki')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="layout">
<nav class="contents" aria-label="Pages"><h2>${title}</h2>${contents}</nav>
<main>
${sections}
<footer>Exported from BrainCraft on ${esc(now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}.</footer>
</main>
</div>
</body>
</html>
`
}

/** A page that starts with its own title as a heading doesn't show it twice. */
function dropTitle(list: Block[], title: string): Block[] {
  const first = list[0]
  if (first?.t === 'h' && first.level === 1 && first.c.map((c) => ('s' in c ? c.s : '')).join('').trim() === title.trim()) return list.slice(1)
  return list
}
