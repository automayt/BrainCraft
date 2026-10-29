import { type FormEvent, useEffect, useRef, useState } from 'react'
import { call, type ServerMention } from '../../store/account'
import { Dialog } from '../Boards'
import { copyText } from '../copyText'
import { timeAgo } from '../Boards'
import { useWorkspace } from '../useWorkspace'
import { useClickAway } from '../useClickAway'
import { GroupAdminDialog } from './GroupAdminDialog'

/** The signed-in person's button: who they are, the admin screen, password, API tokens, sign out. */
export function AccountMenu({ onAdmin }: { onAdmin: () => void }) {
  const ws = useWorkspace()
  const user = ws.account?.user
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'password' | 'tokens' | 'mentions' | 'groups' | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // A press anywhere else closes it (the dialogs it opens are inside it, so they don't).
  useClickAway(box, () => setOpen(false), undefined, open)
  if (!user) return null
  const unread = ws.unreadMentions
  const pick = (f: () => void) => () => {
    setOpen(false)
    f()
  }
  return (
    <div className="account-menu" ref={box}>
      <button
        className="account-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${user.name} (${user.email})${unread ? ` · ${unread} new ${unread === 1 ? 'mention' : 'mentions'}` : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
        <span className="sr-only">Your account{unread ? `, ${unread} new ${unread === 1 ? 'mention' : 'mentions'}` : ''}</span>
        {unread > 0 && (
          <span className="account-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <ul role="menu" aria-label="Your account" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <li role="none" className="account-who">
            <strong>{user.name}</strong>
            <small className="muted">
              {user.email}
              {user.role === 'admin' ? ' · admin' : ws.account?.groupAdmin?.length ? ` · group admin of ${ws.account.groupAdmin.map((g) => g.name).join(', ')}` : ''}
            </small>
          </li>
          <li role="none">
            <button role="menuitem" onClick={pick(() => setDialog('mentions'))}>
              Mentions of you…{unread > 0 && <span className="menu-count">{unread} new</span>}
            </button>
          </li>
          {user.role === 'admin' && (
            <li role="none">
              <button role="menuitem" onClick={pick(onAdmin)}>
                Admin…
              </button>
            </li>
          )}
          {!!ws.account?.groupAdmin?.length && (
            <li role="none">
              <button role="menuitem" onClick={pick(() => setDialog('groups'))}>
                Group admin…
              </button>
            </li>
          )}
          {user.password && (
            <li role="none">
              <button role="menuitem" onClick={pick(() => setDialog('password'))}>
                Change password…
              </button>
            </li>
          )}
          <li role="none">
            <button role="menuitem" onClick={pick(() => setDialog('tokens'))}>
              API tokens…
            </button>
          </li>
          <li role="none">
            <button role="menuitem" onClick={pick(() => void ws.signOut())}>
              Sign out
            </button>
          </li>
        </ul>
      )}
      {dialog === 'password' && <PasswordDialog onClose={() => setDialog(null)} />}
      {dialog === 'tokens' && <TokensDialog onClose={() => setDialog(null)} />}
      {dialog === 'mentions' && <MentionsDialog onClose={() => setDialog(null)} />}
      {dialog === 'groups' && <GroupAdminDialog onClose={() => setDialog(null)} />}
    </div>
  )
}

/** Where you're @mentioned, across the boards and wikis you can open; new ones marked. */
function MentionsDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  // What counted as new when it opened (looking marks them all seen).
  const [seenBefore] = useState(ws.mentionsSeen)
  useEffect(() => {
    void ws.loadMentions().then(() => ws.markMentionsSeen())
  }, [ws])
  const me = ws.account?.user?.name
  const where = (m: ServerMention) => (m.page !== undefined ? `📄 ${m.pageTitle || 'Untitled'}` : m.label ? (m.note ? `a comment on ${m.label}` : `the description of ${m.label}`) : '')
  return (
    <Dialog label="Mentions of you" onClose={onClose} className="account-dialog mentions-dialog">
      <header>
        <h2>Mentions of you</h2>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="muted">Comments, descriptions and wiki pages that @mention you, on the boards and wikis you can open.</p>
      <ul className="mention-list">
        {ws.mentions.map((m) => (
          <li key={`${m.board}/${m.item ?? ''}/${m.note ?? ''}/${m.page ?? ''}`} className={(m.at ?? 0) > seenBefore && m.by !== me ? 'new' : undefined}>
            <button
              onClick={() => {
                onClose()
                void ws.openMention(m)
              }}
            >
              <span className="mention-where">
                <strong>
                  {m.kind === 'wiki' ? '📘 ' : ''}
                  {m.title || 'Untitled'}
                </strong>
                {where(m) && <span className="muted"> › {where(m)}</span>}
              </span>
              <span className="mention-excerpt">{m.excerpt}</span>
              <small className="muted">
                {m.by ?? 'Someone'}
                {m.at ? ` · ${timeAgo(m.at)}` : ''}
              </small>
            </button>
          </li>
        ))}
        {!ws.mentions.length && <li className="muted">Nobody has mentioned you yet. When someone types @ and picks you in a comment or a page, it shows up here.</li>}
      </ul>
    </Dialog>
  )
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await call(ws.server!, 'api/auth/password', 'POST', { current, password })
      ws.editor.setStatus('Password changed')
      onClose()
    } catch (err) {
      setMsg((err as Error).message)
    }
  }
  return (
    <Dialog label="Change password" onClose={onClose} className="account-dialog">
      <form onSubmit={submit}>
        <header>
          <h2>Change password</h2>
        </header>
        {msg && <p className="signin-error">{msg}</p>}
        <label>
          Current password
          <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </label>
        <label>
          New password <small className="muted">(at least 10 characters)</small>
          <input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="account-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Change it</button>
        </div>
      </form>
    </Dialog>
  )
}

interface TokenRow {
  id: string
  name: string
  created: number
  lastUsed?: number
}

/** Tokens for scripts and AI assistants (MCP) to reach the server as you. */
function TokensDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    void call<{ tokens: TokenRow[] }>(ws.server!, 'api/auth/tokens').then((r) => setTokens(r.tokens), (e: Error) => setMsg(e.message))
  }, [ws.server])
  const make = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const r = await call<{ token: string; tokens: TokenRow[] }>(ws.server!, 'api/auth/tokens', 'POST', { name: name || 'API token' })
      setFresh(r.token)
      setTokens(r.tokens)
      setName('')
    } catch (err) {
      setMsg((err as Error).message)
    }
  }
  return (
    <Dialog label="API tokens" onClose={onClose} className="account-dialog">
      <header>
        <h2>API tokens</h2>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="muted">For scripts and AI assistants that reach this server as you: send it as <code>Authorization: Bearer …</code>. A token can do what you can, so keep it secret.</p>
      {msg && <p className="signin-error">{msg}</p>}
      {fresh && (
        <div className="token-fresh">
          <p>Copy it now; it won’t be shown again.</p>
          <code>{fresh}</code>
          <button onClick={() => void copyText(fresh).then(() => ws.editor.setStatus('Token copied'))}>Copy</button>
        </div>
      )}
      <form className="account-inline" onSubmit={make}>
        <input aria-label="What it’s for" placeholder="What it’s for (e.g. “My laptop’s MCP”)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary">Make a token</button>
      </form>
      <ul className="token-list">
        {tokens.map((t) => (
          <li key={t.id}>
            <span>
              <strong>{t.name}</strong>
              <small className="muted">
                {' '}
                made {timeAgo(t.created)}
                {t.lastUsed ? ` · last used ${timeAgo(t.lastUsed)}` : ' · not used yet'}
              </small>
            </span>
            <button
              className="danger-quiet"
              onClick={async () => setTokens((await call<{ tokens: TokenRow[] }>(ws.server!, `api/auth/tokens/${t.id}`, 'DELETE')).tokens)}
            >
              Revoke
            </button>
          </li>
        ))}
        {!tokens.length && <li className="muted">No tokens yet.</li>}
      </ul>
    </Dialog>
  )
}
