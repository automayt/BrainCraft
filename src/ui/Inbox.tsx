/** What needs you, on a server with accounts: boards shared with you, mentions, replies and requests for access. */

import { useEffect, useState } from 'react'
import { type InboxItem, LEVEL_LABEL } from '../store/account'
import { timeAgo } from './Boards'
import { useWorkspace } from './useWorkspace'

/** What happened, in a line. */
function headline(i: InboxItem): string {
  switch (i.kind) {
    case 'share':
      return `${i.by} shared “${i.title || 'Untitled'}” with you`
    case 'mention':
      return `${i.by ?? 'Someone'} mentioned you on “${i.title || 'Untitled'}”`
    case 'reply':
      return `${i.by ?? 'Someone'} replied on “${i.title || 'Untitled'}”`
    case 'request':
      return `${i.by} asked for access to “${i.title || 'Untitled'}”`
    case 'declined':
      return 'Your request for access wasn’t approved'
  }
}

/** Where on the board it is, and the words. */
function detail(i: InboxItem): { where?: string; words?: string } {
  if (i.kind === 'share') return { where: LEVEL_LABEL[i.level] }
  if (i.kind === 'request') return { where: i.email, words: i.note }
  if (i.kind === 'mention' || i.kind === 'reply') return { where: i.page !== undefined ? i.pageTitle || 'Untitled' : i.label, words: i.excerpt }
  return {}
}

/** Someone asking for a board you manage: answered here. */
function RequestAnswers({ item }: { item: Extract<InboxItem, { kind: 'request' }> }) {
  const ws = useWorkspace()
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const answer = async (a: 'view' | 'edit' | 'no') => {
    setBusy(true)
    setProblem(await ws.answerRequest(item.id, a))
    setBusy(false)
  }
  return (
    <div className="inbox-answers">
      <button className="primary" disabled={busy} onClick={() => void answer('edit')}>
        Can edit
      </button>
      <button disabled={busy} onClick={() => void answer('view')}>
        Can view
      </button>
      <button disabled={busy} onClick={() => void answer('no')}>
        Decline
      </button>
      {problem && <p className="inbox-problem">{problem}</p>}
    </div>
  )
}

export function InboxPanel({ onOpened }: { onOpened: () => void }) {
  const ws = useWorkspace()
  // What counted as new when it opened (looking marks it all seen).
  const [seenBefore] = useState(ws.inboxSeen)
  useEffect(() => {
    void ws.loadInbox().then(() => ws.markInboxSeen())
  }, [ws])
  return (
    <section className="home-inbox" aria-labelledby="home-inbox-title">
      <h3 id="home-inbox-title">Inbox</h3>
      {ws.inbox.length ? (
        <ul className="inbox-list">
          {ws.inbox.map((i) => {
            const { where, words } = detail(i)
            const fresh = i.kind === 'request' || (i.at ?? 0) > seenBefore
            const body = (
              <>
                <span className="inbox-line">{headline(i)}</span>
                {where && <span className="inbox-where muted">{where}</span>}
                {words && <span className="inbox-words">{words}</span>}
                {i.at !== undefined && <small className="muted">{timeAgo(i.at)}</small>}
              </>
            )
            return (
              <li key={i.id} className={fresh ? 'new' : undefined}>
                {i.kind === 'request' ? (
                  <div className="inbox-entry">
                    {body}
                    <RequestAnswers item={i} />
                  </div>
                ) : i.kind === 'declined' ? (
                  <div className="inbox-entry">{body}</div>
                ) : (
                  <button
                    className="inbox-entry"
                    onClick={() => {
                      void ws.openInboxItem(i).then(onOpened)
                    }}
                  >
                    {body}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="muted inbox-none">Nothing here yet. When someone shares a board with you, mentions you, replies to you or asks for access, it shows up here.</p>
      )}
    </section>
  )
}
