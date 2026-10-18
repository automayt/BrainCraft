/** "Since you were here" in a wiki: which pages are new, rewritten or gone since this person last looked. */

import { useState } from 'react'
import { catchUpPeople, catchUpSummary, catchUpText, listNames } from '../../model/catchup'
import * as W from '../../model/wiki'
import { timeAgo } from '../Boards'
import { useEditor } from '../useEditor'

/** Pages listed before the rest fold away. */
const FOLD = 5

export function WikiCatchUp({ onShowChanges }: { onShowChanges: (page: string) => void }) {
  const editor = useEditor()
  const [all, setAll] = useState(false)
  const c = editor.catchUp
  if (!c?.pages) return null
  // Pages already looked at since drop out of the list.
  const fresh = (id: string) => !editor.catchUpSeen.has(id)
  const added = c.pages.added.filter(fresh)
  const changed = c.pages.changed.filter(fresh)
  const { removed } = c.pages
  const people = catchUpPeople(c, editor.board).filter((n) => n !== editor.me)
  const title = (id: string) => W.getPage(editor.board, id)?.title || 'Untitled'
  const icon = (id: string) => W.getPage(editor.board, id)?.icon ?? '📄'
  const rows = [
    ...added.map((id) => (
      <li key={id}>
        <span className="wiki-news-tag">New</span>
        <button className="link" onClick={() => editor.openPage(id)}>
          {icon(id)} {title(id)}
        </button>
      </li>
    )),
    ...changed.map((id) => (
      <li key={id}>
        <span className="wiki-news-tag">Changed</span>
        <button className="link" onClick={() => editor.openPage(id)}>
          {icon(id)} {title(id)}
        </button>
        <button
          className="link muted"
          aria-label={`What changed on ${title(id)}`}
          onClick={() => onShowChanges(id)}
        >
          what changed
        </button>
      </li>
    )),
    ...removed.map((p) => (
      <li key={p.id} className="muted">
        <span className="wiki-news-tag">Gone</span> {p.title || 'Untitled'}
        {W.getPage(editor.board, p.id)?.trashed ? ' (in the Trash)' : ''}
      </li>
    )),
  ]
  return (
    <section className="wiki-catchup" aria-label="Since you were here">
      <div className="wiki-catchup-head">
        <span className="catchup-spark" aria-hidden="true">
          ✦
        </span>
        <span role="status">
          <strong>Since you were here</strong> <small>({timeAgo(c.since)})</small>: {catchUpSummary(c)}
          {people.length > 0 && <span className="catchup-who"> · by {listNames(people)}</span>}
        </span>
        <span className="wiki-catchup-actions">
          <button
            title="Ask the AI assistant for a short summary"
            onClick={() => editor.askAi(`Summarise in a few bullets what changed in this wiki since I last looked:\n\n${catchUpText(c, editor.board)}`, undefined, 'What changed since I was last here?')}
          >
            Summarise with AI
          </button>
          <button className="icon-close" aria-label="Dismiss" title="Got it" onClick={() => editor.dismissCatchUp()}>
            ×
          </button>
        </span>
      </div>
      <ul className="wiki-catchup-pages">
        {rows.slice(0, all ? rows.length : FOLD).map((r) => r)}
        {rows.length > FOLD && (
          <li>
            <button className="link" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? 'Fewer' : `and ${rows.length - FOLD} more`}
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}
