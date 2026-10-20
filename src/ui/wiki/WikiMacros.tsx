/** The macros that look at the rest of the wiki: a page tree, open tasks, recent changes, another page shown here. */

import { type ReactNode, useMemo, useState } from 'react'
import { type Block, headings, inlineText, parseMarkdown, taskIsFor, taskItems, tasksFor } from '../../model/markdown'
import { argText } from '../../model/macros'
import * as RV from '../../model/revisions'
import type { Board, Page, PageBody } from '../../model/types'
import * as W from '../../model/wiki'
import { formatTime } from '../BoardView'
import { useEditor } from '../useEditor'
import { Markdown, type MacroBlock, type MarkdownActions } from './Markdown'

/** Open tasks listed at most. */
const TASKS_SHOWN = 200

/** Each page's words read once per version of them. */
const parsed = new WeakMap<PageBody, Block[]>()
function blocksOf(body: PageBody | undefined): Block[] {
  if (!body) return []
  let hit = parsed.get(body)
  if (!hit) parsed.set(body, (hit = parseMarkdown(body.text)))
  return hit
}

export function WikiMacro({ block, page, actions, inside = false }: { block: MacroBlock; page: Page; actions: MarkdownActions; inside?: boolean }) {
  switch (block.name) {
    case 'pagetree':
      return <PageTreeMacro under={block.args.pos[0]?.toLowerCase() === 'here' ? page.id : undefined} />
    case 'tasks':
      return (
        <TasksMacro page={page} here={block.args.pos.some((w) => w.toLowerCase() === 'here')} withDone={block.args.pos.some((w) => w.toLowerCase() === 'all')} who={tasksFor(block.args)} />
      )
    case 'recent':
      return <RecentMacro count={Number(block.args.pos[0]) || 5} />
    case 'include':
      return inside ? <p className="md-macro-note muted">(A page shown inside another isn’t shown again here.)</p> : <IncludeMacro name={argText(block.args) || block.args.named.page || ''} page={page} actions={actions} />
    default:
      return null
  }
}

function PageTreeMacro({ under }: { under?: string }) {
  const editor = useEditor()
  const board = editor.board
  const tree = useMemo(() => {
    const all = W.pageTree(board)
    if (under === undefined) return all
    const find = (nodes: W.PageNode[]): W.PageNode[] | null => {
      for (const n of nodes) {
        if (n.page.id === under) return n.children
        const deeper = find(n.children)
        if (deeper) return deeper
      }
      return null
    }
    return find(all) ?? []
  }, [board, under])
  const list = (nodes: W.PageNode[]): ReactNode => (
    <ul>
      {nodes.map((n) => (
        <li key={n.page.id}>
          <button className="link" onClick={() => editor.openPage(n.page.id)}>
            {n.page.icon ?? '📄'} {n.page.title || 'Untitled'}
          </button>
          {n.children.length > 0 && list(n.children)}
        </li>
      ))}
    </ul>
  )
  return <nav className="md-pagetree" aria-label="Page tree on this page">{tree.length ? list(tree) : <p className="muted">No pages under this one yet.</p>}</nav>
}

function TasksMacro({ page, here, withDone, who }: { page: Page; here: boolean; withDone: boolean; who: string | null }) {
  const editor = useEditor()
  const board = editor.board
  const ro = editor.readOnly
  // Ticked here a moment ago: still shown (struck through) until the page is left, so a slip is easy to untick.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const me = editor.mentionMe
  const { groups, more } = useMemo(() => {
    const scope = here ? W.withDescendants(board, page.id) : null
    let left = TASKS_SHOWN
    let more = 0
    const out: { page: Page; items: { line: number; text: string; done: boolean }[] }[] = []
    for (const p of W.pageOrder(board)) {
      if (scope && !scope.has(p.id)) continue
      const all = taskItems(blocksOf(W.getBody(board, p.id)))
        // Empty boxes (a template's blanks) aren't tasks yet.
        .filter((it) => (withDone || !it.task || ticked.has(`${p.id}:${it.line}`)) && inlineText(it.c).trim())
        // {{tasks @me}}: the ones that mention the reader.
        .filter((it) => !who || taskIsFor(it, who, me))
      const items = all.slice(0, Math.max(0, left)).map((it) => ({ line: it.line, text: inlineText(it.c), done: !!it.task }))
      more += all.length - items.length
      left -= items.length
      if (items.length) out.push({ page: p, items })
    }
    return { groups: out, more }
  }, [board, page.id, here, withDone, ticked, who, me.id, me.name])
  if (!groups.length)
    return (
      <p className="md-tasks muted">
        {who === 'me' && !me.name ? 'Sign in or give your name to see the tasks that mention you.' : who ? `Nothing for ${who === 'me' ? 'you' : who} left to do. 🎉` : withDone ? 'No checklists yet.' : 'Nothing left to do. 🎉'}
      </p>
    )
  return (
    <div className="md-tasks">
      {groups.map((g) => (
        <section key={g.page.id}>
          <button className="link md-tasks-page" onClick={() => editor.openPage(g.page.id)}>
            {g.page.icon ?? '📄'} {g.page.title || 'Untitled'}
          </button>
          <ul>
            {g.items.map((it) => (
              <li key={it.line} className={it.done ? 'done' : undefined}>
                <label className="task-label">
                  <input
                    type="checkbox"
                    checked={it.done}
                    disabled={ro}
                    onChange={() => {
                      setTicked(new Set(ticked).add(`${g.page.id}:${it.line}`))
                      editor.tickTask(g.page.id, it.line)
                    }}
                  />
                  <span>{it.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more > 0 && <p className="muted">And {more} more (showing the first {TASKS_SHOWN}).</p>}
    </div>
  )
}

function RecentMacro({ count }: { count: number }) {
  const editor = useEditor()
  const board = editor.board
  const changes = RV.recentChanges(board, Math.max(1, Math.min(50, count)))
  if (!changes.length) return <p className="muted">No saved versions yet.</p>
  return (
    <ul className="md-recent">
      {changes.map(({ rev }) => {
        const p = W.getPage(board, rev.page)
        return (
          <li key={rev.id}>
            <button className="link" onClick={() => editor.openPage(rev.page)}>
              {p?.icon ?? '📄'} {p?.title || rev.title || 'Untitled'}
            </button>
            <span className="muted">
              {' '}
              · {rev.by ? `${rev.by} · ` : ''}
              {formatTime(rev.at)}
            </span>
            {rev.note && <span className="rev-note"> · {rev.note}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/** The page an include names: by title, by id, or by a title it had before a rename (from its history). */
function findShown(board: Board, name: string): Page | undefined {
  const byTitle = W.pageByTitle(board, name)
  if (byTitle) return byTitle
  const byId = W.getPage(board, name)
  if (byId && !byId.trashed) return byId
  const t = name.trim().toLowerCase()
  if (!t) return undefined
  const old = [...(board.revs ?? [])].reverse().find((r) => r.title.trim().toLowerCase() === t)
  const page = old && W.getPage(board, old.page)
  return page && !page.trashed ? page : undefined
}

function IncludeMacro({ name, page, actions }: { name: string; page: Page; actions: MarkdownActions }) {
  const editor = useEditor()
  const board = editor.board
  const shown = findShown(board, name)
  const body = shown ? W.getBody(board, shown.id) : undefined
  const blocks = blocksOf(body)
  if (!name) return <p className="md-macro-bad">{'{{include "Page title"}}'}: which page?</p>
  if (!shown) return <p className="md-macro-bad">No page called “{name}” to show here.</p>
  if (shown.id === page.id) return <p className="md-macro-note muted">(A page can’t show itself.)</p>
  const inner: MarkdownActions = {
    ...actions,
    headings: headings(blocks),
    copyHeading: undefined,
    children: () => <p className="muted">(The pages under “{shown.title || 'Untitled'}”.)</p>,
    toggle: actions.toggle && ((line) => editor.tickTask(shown.id, line)),
    macro: (b) => <WikiMacro block={b} page={shown} actions={actions} inside />,
  }
  return (
    <section className="md-include" aria-label={`From the page ${shown.title || 'Untitled'}`}>
      <button className="link md-include-from" onClick={() => editor.openPage(shown.id)}>
        From {shown.icon ?? '📄'} {shown.title || 'Untitled'}
      </button>
      <Markdown blocks={blocks} actions={inner} />
    </section>
  )
}
