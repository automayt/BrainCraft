import type { ReactNode } from 'react'
import { guessLang, isLang, tokenize } from '../../model/code'
import { type Block, type Heading, type Inline, type ListItem, inlineText, macroText } from '../../model/markdown'
import { type MacroArgs, argText, countdown, macroInfo, parseDay, statusLook } from '../../model/macros'
import type { LinkTarget } from '../../model/notes'
import type { Id } from '../../model/types'

/** What a page's links and boxes do; the wiki screen supplies these. */
export interface MarkdownActions {
  /** Draws a BrainCraft link (`[[…]]`); `to` is null for one typed by hand. */
  link: (to: LinkTarget | null, label: string, key: number) => ReactNode
  mention: (id: Id, label: string, key: number) => ReactNode
  /** Ticks a checklist item; missing when the page can't be changed. */
  toggle?: (line: number) => void
  /** `{{children}}`: the page's sub-pages. */
  children: () => ReactNode
  headings: Heading[]
  /** Copies a link to a heading; missing hides the # button. */
  copyHeading?: (slug: string, text: string) => void
  /** Draws an embedded canvas object; missing shows it as a link. */
  embed?: (block: Extract<Block, { t: 'embed' }>) => ReactNode
  /** Draws a macro that needs the wiki (a page tree, open tasks, another page…); missing shows a note. */
  macro?: (block: MacroBlock) => ReactNode
}

export type MacroBlock = Extract<Block, { t: 'macro' }>

/** A macro inside a sentence. */
function InlineMacro({ name, args }: { name: string; args: MacroArgs }) {
  if (name === 'status') {
    const { label, color } = statusLook(args)
    return <span className={`md-status md-status-${color}`}>{label}</span>
  }
  if (name === 'countdown') {
    const day = parseDay(args.pos[0])
    return day ? (
      <span className="md-countdown" title={day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
        {countdown(day)}
      </span>
    ) : (
      <span className="md-macro-bad" title="Write the date like 2026-12-20">
        {`{{countdown ${argText(args)}}}`}
      </span>
    )
  }
  return <>{macroText(name, args)}</>
}

/** A macro on its own line, or around other lines. */
function MacroView({ b, a }: { b: MacroBlock; a: MarkdownActions }) {
  const info = macroInfo(b.name)
  if (!info) {
    return (
      <p>
        <span className="md-macro-bad" title={`BrainCraft has no macro called “${b.name}”. Type / at the start of a line to see the ones it has.`}>
          {`{{${b.name}${b.args.pos.length || Object.keys(b.args.named).length ? ' …' : ''}}}`}
        </span>
      </p>
    )
  }
  const blocks = (list: Block[] | undefined) => (list ?? []).map((c, k) => <BlockView key={k} b={c} a={a} />)
  switch (b.name) {
    case 'expand':
      return (
        <details className="md-expand">
          <summary>{argText(b.args) || 'Show more'}</summary>
          <div className="md-expand-body">{b.children ? blocks(b.children) : <p className="muted">Close it with {'{{/expand}}'} on a line of its own.</p>}</div>
        </details>
      )
    case 'columns':
      return b.columns ? (
        <div className="md-columns" style={{ ['--cols' as string]: b.columns.length }}>
          {b.columns.map((c, k) => (
            <div key={k} className="md-column">
              {blocks(c)}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Columns: put {'{{column}}'} between them and {'{{/columns}}'} at the end.</p>
      )
    case 'children':
      return a.children()
    case 'toc':
      return <BlockView b={{ t: 'toc', line: b.line }} a={a} />
    default:
      return a.macro ? a.macro(b) : <p className="md-macro-note muted">{info.label} shows here in the wiki.</p>
  }
}

function inline(c: Inline[], a: MarkdownActions): ReactNode[] {
  return c.map((x, k) => {
    switch (x.t) {
      case 'text':
        return x.s
      case 'br':
        return <br key={k} />
      case 'code':
        return <code key={k}>{x.s}</code>
      case 'b':
        return <strong key={k}>{inline(x.c, a)}</strong>
      case 'i':
        return <em key={k}>{inline(x.c, a)}</em>
      case 's':
        return <s key={k}>{inline(x.c, a)}</s>
      case 'a':
        return (
          <a key={k} href={x.href} target="_blank" rel="noreferrer noopener">
            {inline(x.c, a)}
          </a>
        )
      case 'link':
        return a.link(x.to, x.label, k)
      case 'mention':
        return a.mention(x.id, x.label, k)
      case 'macro':
        return <InlineMacro key={k} name={x.name} args={x.args} />
    }
  })
}

function List({ list, a }: { list: Extract<Block, { t: 'list' }>; a: MarkdownActions }) {
  const items = list.items.map((it: ListItem, k) => (
    <li key={k} className={it.task !== undefined ? `task${it.task ? ' done' : ''}` : undefined}>
      {it.task !== undefined ? (
        // The item's own words name its box (links inside still work on their own).
        <label className="task-label">
          <input type="checkbox" checked={it.task} disabled={!a.toggle} onChange={() => a.toggle?.(it.line)} />
          <span>{inline(it.c, a)}</span>
        </label>
      ) : (
        <span>{inline(it.c, a)}</span>
      )}
      {it.sub && <BlockView b={it.sub} a={a} />}
    </li>
  ))
  return list.ordered ? (
    <ol start={list.start !== 1 ? list.start : undefined}>{items}</ol>
  ) : (
    <ul className={list.items.some((i) => i.task !== undefined) ? 'checklist' : undefined}>{items}</ul>
  )
}

const CALLOUT_ICON = { note: 'ℹ️', tip: '💡', warning: '⚠️', danger: '⛔' } as const

function BlockView({ b, a }: { b: Block; a: MarkdownActions }): ReactNode {
  switch (b.t) {
    case 'h': {
      const Tag = `h${Math.min(6, b.level + 1)}` as 'h2'
      return (
        <Tag id={`h-${b.slug}`} className="md-heading">
          {inline(b.c, a)}
          {a.copyHeading && (
            <button className="md-anchor" title="Copy a link to this heading" aria-label="Copy a link to this heading" onClick={() => a.copyHeading!(b.slug, inlineText(b.c))}>
              #
            </button>
          )}
        </Tag>
      )
    }
    case 'p':
      return <p>{inline(b.c, a)}</p>
    case 'hr':
      return <hr />
    case 'list':
      return <List list={b} a={a} />
    case 'quote':
      return (
        <blockquote>
          {b.children.map((c, k) => (
            <BlockView key={k} b={c} a={a} />
          ))}
        </blockquote>
      )
    case 'callout':
      return (
        <aside className={`md-callout md-callout-${b.kind}`} role="note">
          <div className="md-callout-title">
            <span aria-hidden="true">{CALLOUT_ICON[b.kind]}</span>
            {b.title.length ? inline(b.title, a) : b.kind[0].toUpperCase() + b.kind.slice(1)}
          </div>
          {b.children.map((c, k) => (
            <BlockView key={k} b={c} a={a} />
          ))}
        </aside>
      )
    case 'code': {
      const lang = isLang(b.lang) ? b.lang : guessLang(b.code)
      return (
        <pre className="md-code" data-lang={b.lang || undefined}>
          <code>
            {tokenize(b.code, lang).map((t, k) =>
              t.t === 'plain' ? (
                t.s
              ) : (
                <span key={k} className={`tok-${t.t}`}>
                  {t.s}
                </span>
              ),
            )}
          </code>
        </pre>
      )
    }
    case 'table':
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, k) => (
                  <th key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>
                    {inline(c, a)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, k) => (
                    <td key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>
                      {inline(c, a)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'children':
      return a.children()
    case 'macro':
      return <MacroView b={b} a={a} />
    case 'embed':
      return a.embed ? a.embed(b) : <p>{a.link({ board: b.board, ...(b.item !== undefined ? { item: b.item } : {}) }, b.label || 'Embedded board', 0)}</p>
    case 'toc':
      return a.headings.length ? (
        <nav className="md-toc" aria-label="On this page">
          {a.headings.map((h) => (
            <a key={h.slug} href={`#h-${h.slug}`} style={{ paddingLeft: (h.level - 1) * 14 }} onClick={(e) => {
                e.preventDefault()
                document.getElementById(`h-${h.slug}`)?.scrollIntoView({ behavior: smoothScroll(), block: 'start' })
              }}>
              {h.text}
            </a>
          ))}
        </nav>
      ) : null
  }
}

/** A page's Markdown, drawn as plain React elements (never HTML strings). */
export function Markdown({ blocks, actions }: { blocks: Block[]; actions: MarkdownActions }) {
  return (
    <div className="md">
      {blocks.map((b, k) => (
        <BlockView key={k} b={b} a={actions} />
      ))}
    </div>
  )
}

/** Smooth scrolling, unless the person asked for less motion. */
export const smoothScroll = (): ScrollBehavior => (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')
