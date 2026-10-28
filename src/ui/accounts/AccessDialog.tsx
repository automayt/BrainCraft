import { useEffect, useState } from 'react'
import { type BoardAccessInfo, call, can, type Grant, LEVEL_LABEL, type Level } from '../../store/account'
import { Dialog } from '../Boards'
import { useWorkspace } from '../useWorkspace'
import { Copy } from '../Live'

interface Found {
  people: { id: string; name: string; email: string }[]
  groups: { id: string; name: string }[]
}

/**
 * Who has the open board, on a server with accounts: its owner, the people and groups that can
 * view, edit or manage it, and (for managers) adding, changing and removing them.
 */
export function AccessDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const live = ws.liveInfo
  const [info, setInfo] = useState<BoardAccessInfo | null>(null)
  const [grants, setGrants] = useState<Grant[]>([])
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Found>({ people: [], groups: [] })
  const [msg, setMsg] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const path = live ? `api/boards/${live.id}/access` : ''

  useEffect(() => {
    if (!ws.server || !path) return
    void call<BoardAccessInfo>(ws.server, path).then(
      (r) => {
        setInfo(r)
        setGrants(r.access)
      },
      (e: Error) => setMsg(e.message),
    )
  }, [ws.server, path])

  // Finding people and groups to add, as you type.
  useEffect(() => {
    if (!ws.server || !q.trim()) return setFound({ people: [], groups: [] })
    const t = setTimeout(() => void call<Found>(ws.server!, `api/people?q=${encodeURIComponent(q.trim())}`).then(setFound, () => {}), 200)
    return () => clearTimeout(t)
  }, [ws.server, q])

  if (!live) {
    return (
      <Dialog label="Share" onClose={onClose} className="share access">
        <header>
          <h2>Share “{ws.editor.board.title || 'Untitled'}”</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="muted">This board is only in this browser. Put it on the server to share it with people and groups there.</p>
        {msg && <p className="signin-error">{msg}</p>}
        <button
          className="primary"
          disabled={!can(ws.account, 'boards.create')}
          onClick={async () => {
            try {
              await ws.startLive()
              await ws.loadServerBoards()
            } catch (err) {
              setMsg((err as Error).message)
            }
          }}
        >
          Put it on the server
        </button>
        {!can(ws.account, 'boards.create') && <p className="muted">You can’t make boards on this server. Ask an admin.</p>}
      </Dialog>
    )
  }

  const manage = info?.level === 'manage'
  const share = manage && can(ws.account, 'boards.share')
  const add = (who: 'user' | 'group', id: string, name: string, email?: string) => {
    if (!grants.some((g) => g.who === who && g.id === id)) setGrants([...grants, { who, id, name, ...(email ? { email } : {}), level: 'edit' }])
    setQ('')
    setDirty(true)
  }
  const save = async () => {
    try {
      const r = await call<BoardAccessInfo>(ws.server!, path, 'PUT', { access: grants.map(({ who, id, level }) => ({ who, id, level })) })
      setInfo(r)
      setGrants(r.access)
      setDirty(false)
      ws.editor.setStatus('Access saved')
    } catch (err) {
      setMsg((err as Error).message)
    }
  }
  const me = ws.account?.user
  // No secret links with accounts: the board's own address, which opens it for whoever has access.
  const link = ws.webLink()

  return (
    <Dialog label="Access" onClose={onClose} className="share access">
      <header>
        <h2>Who has “{ws.editor.board.title || 'Untitled'}”</h2>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {msg && <p className="signin-error">{msg}</p>}
      {link && (
        <div className="access-link">
          <label className="link-label">
            Link to this board
            <Copy text={link} label="Link to this board" />
          </label>
          <small className="muted">Opens it for the people and groups below, once they’ve signed in. Anyone else is told to ask for access.</small>
        </div>
      )}
      {!info ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <ul className="access-list">
            <li>
              <span>
                <strong>{info.owner ? info.owner.name : 'Nobody yet'}</strong>
                <small className="muted"> {info.owner ? `${info.owner.email} · owner` : 'An admin can give it an owner'}</small>
              </span>
            </li>
            {grants.map((g, k) => (
              <li key={`${g.who}:${g.id}`}>
                <span>
                  <strong>
                    {g.who === 'group' ? '👥 ' : ''}
                    {g.name ?? g.id}
                  </strong>
                  {g.email && <small className="muted"> {g.email}</small>}
                </span>
                {manage ? (
                  <>
                    <select
                      aria-label={`What ${g.name ?? 'they'} can do`}
                      value={g.level}
                      onChange={(e) => {
                        setGrants(grants.map((x, i) => (i === k ? { ...x, level: e.target.value as Level } : x)))
                        setDirty(true)
                      }}
                    >
                      {(['view', 'edit', 'manage'] as Level[]).map((l) => (
                        <option key={l} value={l}>
                          {LEVEL_LABEL[l]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-close"
                      aria-label={`Remove ${g.name ?? 'them'}`}
                      onClick={() => {
                        setGrants(grants.filter((_, i) => i !== k))
                        setDirty(true)
                      }}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <small className="muted">{LEVEL_LABEL[g.level]}</small>
                )}
              </li>
            ))}
          </ul>
          {share && (
            <div className="access-add">
              <input aria-label="Add people or groups" placeholder="Add people or groups (name or email)" value={q} onChange={(e) => setQ(e.target.value)} />
              {(found.people.length > 0 || found.groups.length > 0) && (
                <ul className="access-found">
                  {found.groups.map((g) => (
                    <li key={g.id}>
                      <button onClick={() => add('group', g.id, g.name)}>👥 {g.name}</button>
                    </li>
                  ))}
                  {found.people
                    .filter((p) => p.id !== info.owner?.id)
                    .map((p) => (
                      <li key={p.id}>
                        <button onClick={() => add('user', p.id, p.name, p.email)}>
                          {p.name} <small className="muted">{p.email}</small>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
          {manage && !share && <p className="muted">You can change what people already here can do, but not add anyone: that needs “Share boards”. Ask an admin.</p>}
          <div className="account-actions">
            {manage && (me?.role === 'admin' || info.owner?.id === me?.id) && (
              <button
                className="danger-quiet"
                onClick={async () => {
                  const back = ws.account?.backups ? ' You or an admin can put it back from Your boards → Recently deleted for 90 days.' : ' Copies in browsers stay, but nobody can open it live again.'
                  if (!window.confirm(`Delete this board from the server for everyone?${back}`)) return
                  try {
                    await call(ws.server!, `api/boards/${live.id}`, 'DELETE')
                    await ws.leaveLive()
                    await ws.loadServerBoards()
                    onClose()
                  } catch (err) {
                    setMsg((err as Error).message)
                  }
                }}
              >
                Delete from the server
              </button>
            )}
            <span className="spacer" />
            <button onClick={onClose}>{dirty ? 'Cancel' : 'Close'}</button>
            {manage && (
              <button className="primary" disabled={!dirty} onClick={() => void save()}>
                Save
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  )
}
