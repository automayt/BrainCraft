import { type FormEvent, useEffect, useState } from 'react'
import { call, type TeamData, type TeamPerson } from '../../store/account'
import { Dialog, timeAgo } from '../Boards'
import { copyText } from '../copyText'
import { useWorkspace } from '../useWorkspace'
import { GroupPicker } from './AdminDialog'

/**
 * A group admin's screen: the groups they run and who's in them. They add people (a new account,
 * or someone who has one, by email), move them between their groups or take them out, and for
 * people only in their groups, make password links and turn accounts off. Nothing else on the
 * server shows here.
 */
export function GroupAdminDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const [data, setData] = useState<TeamData | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [link, setLink] = useState<{ who: string; url: string } | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [groups, setGroups] = useState<string[]>([])

  const api = (path: string, method = 'GET', body?: unknown) => call<TeamData>(ws.server!, path, method, body)
  const run = async (f: () => Promise<TeamData | void>) => {
    setMsg(null)
    setSaid(null)
    try {
      const r = await f()
      if (r) setData(r)
    } catch (err) {
      setMsg((err as Error).message)
    }
  }
  useEffect(() => {
    void run(async () => {
      const r = await api('api/team')
      // With one group, new people go in it.
      if (r.groups.length === 1) setGroups([r.groups[0].id])
      return r
    })
  }, [])

  const add = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api('api/team/people', 'POST', { email, name, groups })
      setLink(r.link ? { who: r.added ?? email, url: r.link } : null)
      if (r.existing) setSaid(`${r.added} already had an account, and is in your group now.`)
      setEmail('')
      setName('')
      return r
    })
  }
  const person = (p: TeamPerson, body: object) => void run(() => api(`api/team/people/${p.id}`, 'PATCH', body))
  const groupName = (id: string) => data?.groups.find((g) => g.id === id)?.name ?? ''

  return (
    <Dialog label="Group admin" onClose={onClose} className="admin">
      <header>
        <h2>Group admin</h2>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {msg && (
        <p className="signin-error" role="alert">
          {msg}
        </p>
      )}
      {said && (
        <p className="muted admin-hint" role="status">
          {said}
        </p>
      )}
      {link && (
        <div className="token-fresh">
          <p>Send {link.who} this link to choose a password (it works once, for a week):</p>
          <code>{link.url}</code>
          <button onClick={() => void copyText(link.url).then(() => ws.editor.setStatus('Link copied'))}>Copy</button>
        </div>
      )}
      <div className="admin-body">
        {!data ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <ul className="team-groups">
              {data.groups.map((g) => (
                <li key={g.id}>
                  <strong>{g.name}</strong> <small className="muted">{g.permissions.length ? `may ${g.permissions.join(', ').toLowerCase()}` : 'nothing beyond what everyone may do'}</small>
                </li>
              ))}
            </ul>
            <form className="admin-add" onSubmit={add}>
              <input type="email" required aria-label="Email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              {data.groups.length > 1 && <GroupPicker groups={data.groups} value={groups} onChange={setGroups} />}
              <button className="primary" disabled={!groups.length}>
                Add
              </button>
            </form>
            <p className="muted admin-hint">
              New people get a link to choose a password{ws.account?.sso ? ', or can sign in with single sign-on' : ''}. Someone who already has an account just joins. An admin
              decides what each group may do.
            </p>
            {data.people.length ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>In</th>
                    <th>Last here</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => (
                    <tr key={p.id} className={p.disabled ? 'off' : ''}>
                      <td>
                        <strong>{p.name}</strong>
                        {p.admin && <small className="muted"> · admin</small>}
                        <br />
                        <small className="muted">{p.email}</small>
                      </td>
                      <td>
                        {data.groups.length > 1 ? (
                          <GroupPicker groups={data.groups.filter((g) => !p.fromSignIn?.includes(g.id))} value={p.groups} onChange={(gs) => person(p, { groups: gs })} />
                        ) : (
                          <small>{p.groups.map(groupName).join(', ')}</small>
                        )}
                        {p.fromSignIn?.length ? <small className="muted">{p.fromSignIn.map(groupName).join(', ')} (from single sign-on)</small> : null}
                      </td>
                      <td>
                        <small className="muted">{p.disabled ? 'Turned off' : p.lastSeen ? timeAgo(p.lastSeen) : 'Never'}</small>
                      </td>
                      <td className="admin-row-actions">
                        {p.yours && !p.sso && (
                          <button
                            className="link"
                            onClick={() =>
                              void run(async () => {
                                const r = (await call<{ link: string }>(ws.server!, `api/team/people/${p.id}/reset`, 'POST')) as unknown as { link: string }
                                setLink({ who: p.name, url: r.link })
                              })
                            }
                          >
                            Password link
                          </button>
                        )}
                        {p.yours && (
                          <button className="link" onClick={() => person(p, { disabled: !p.disabled })}>
                            {p.disabled ? 'Turn on' : 'Turn off'}
                          </button>
                        )}
                        {p.groups.length > 0 && p.id !== ws.account?.user?.id && (
                          <button
                            className="link danger-quiet"
                            onClick={() =>
                              window.confirm(`Take ${p.name} out of ${p.groups.map(groupName).join(' and ')}? Their account stays; an admin can remove it.`) && person(p, { groups: [] })
                            }
                          >
                            Take out
                          </button>
                        )}
                        {p.id === ws.account?.user?.id ? (
                          <small className="muted">You</small>
                        ) : (
                          !p.yours && (
                            <small className="muted" title="They’re in other groups too, an admin, or a group admin themselves, so an admin looks after their account">
                              Shared
                            </small>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Nobody’s in your {data.groups.length === 1 ? 'group' : 'groups'} yet. Add someone above.</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
