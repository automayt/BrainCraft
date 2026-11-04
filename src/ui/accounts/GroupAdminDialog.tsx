import { type FormEvent, useEffect, useState } from 'react'
import { call, type Permission, type TeamData, type TeamGroup, type TeamPerson } from '../../store/account'
import { Dialog, timeAgo } from '../Boards'
import { copyText } from '../copyText'
import { useWorkspace } from '../useWorkspace'
import { GroupPicker } from './AdminDialog'

/**
 * A group admin's screen: the groups they run and who's in them. They add people (a new account,
 * or someone who has one, by email), move them between their groups or take them out, and for
 * people only in their groups, make password links and turn accounts off. Nothing else on the
 * server shows here. With "Make groups" they also start groups here, and rename, remove and set
 * what their own groups may do.
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
  const [newGroup, setNewGroup] = useState('')

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
  const make = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api('api/team/groups', 'POST', { name: newGroup, permissions: [] })
      setNewGroup('')
      // New people go in the group just made.
      if (r.made) setGroups([r.made])
      setSaid('Made the group. Tick what it may do, and add people to it below.')
      return r
    })
  }
  const person = (p: TeamPerson, body: object) => void run(() => api(`api/team/people/${p.id}`, 'PATCH', body))
  const groupName = (id: string) => data?.groups.find((g) => g.id === id)?.name ?? ''

  return (
    <Dialog label="Your groups" onClose={onClose} className="admin">
      <header>
        <h2>Your groups</h2>
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
            {data.canMake && (
              <form className="admin-add" onSubmit={make}>
                <input required maxLength={80} aria-label="New group’s name" placeholder="New group (e.g. Hikers)" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
                <button className="primary">Make group</button>
              </form>
            )}
            <ul className="team-groups">
              {data.groups.map((g) =>
                g.made ? (
                  <MadeGroup key={g.id} group={g} grantable={data.grantable ?? []} run={run} api={api} />
                ) : (
                  <li key={g.id}>
                    <strong>{g.name}</strong> <small className="muted">{g.permissions.length ? `may ${g.permissions.join(', ').toLowerCase()}` : 'nothing beyond what everyone may do'}</small>
                  </li>
                ),
              )}
            </ul>
            {!data.groups.length ? (
              <p className="muted">You don’t run any groups yet. Make one above, then add people to it.</p>
            ) : (
              <>
              <form className="admin-add" onSubmit={add}>
                <input type="email" required aria-label="Email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                {data.groups.length > 1 && <GroupPicker groups={data.groups} value={groups} onChange={setGroups} />}
                <button className="primary" disabled={!groups.length}>
                  Add
                </button>
              </form>
              <p className="muted admin-hint">
                New people get a link to choose a password{ws.account?.sso ? ', or can sign in with single sign-on' : ''}. Someone who already has an account just joins, and an admin
                still looks after their account.{' '}
                {data.groups.some((g) => !g.made) ? 'An admin decides what the groups an admin made may do.' : 'A group you make may do what you may do, and no more.'}
                {!groups.length ? ' Tick a group to add someone to.' : ''}
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
                              aria-label={`Password link for ${p.name}`}
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
                            <button
                              className="link"
                              aria-label={`${p.disabled ? 'Turn on' : 'Turn off'} ${p.name}’s account`}
                              onClick={() => (p.disabled || window.confirm(`Turn off ${p.name}’s account? They’re signed out everywhere and can’t sign in until it’s turned on again.`)) && person(p, { disabled: !p.disabled })}
                            >
                              {p.disabled ? 'Turn on' : 'Turn off'}
                            </button>
                          )}
                          {p.groups.length > 0 && p.id !== ws.account?.user?.id && (
                            <button
                              className="link danger-quiet"
                              aria-label={`Take ${p.name} out of your groups`}
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
                              <small className="muted" title="You didn’t add their account, or they’re in other groups too, an admin, or a group admin themselves: an admin looks after their account">
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
          </>
        )}
      </div>
    </Dialog>
  )
}

/** A group they made: its name, what it may do (out of what they may do themselves), and removing it. */
function MadeGroup({
  group: g,
  grantable,
  run,
  api,
}: {
  group: TeamGroup
  grantable: NonNullable<TeamData['grantable']>
  run: (f: () => Promise<TeamData | void>) => Promise<void>
  api: (path: string, method?: string, body?: unknown) => Promise<TeamData>
}) {
  const [name, setName] = useState(g.name)
  useEffect(() => setName(g.name), [g.name])
  const may = g.may ?? []
  const patch = (body: object) => void run(() => api(`api/team/groups/${g.id}`, 'PATCH', body))
  const rename = () => {
    if (name.trim() && name.trim() !== g.name) patch({ name })
    else setName(g.name)
  }
  const toggle = (p: Permission) => patch({ permissions: may.includes(p) ? may.filter((x) => x !== p) : [...may, p] })
  // What an admin let it do that its maker can't: shown, but not theirs to change.
  const extra = g.permissions.filter((label) => !grantable.some((x) => x.label === label))
  const remove = () =>
    window.confirm(`Remove the group “${g.name}”? Its members keep their accounts, and boards shared with the group aren’t shared with them any more.`) &&
    void run(() => api(`api/team/groups/${g.id}`, 'DELETE'))
  return (
    <li className="group-card">
      <div className="group-head">
        <input
          className="group-name"
          aria-label={`Name of ${g.name}`}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape' && name !== g.name) {
              e.stopPropagation()
              setName(g.name)
            }
          }}
        />
        <button className="link danger-quiet" onClick={remove}>
          Remove
        </button>
      </div>
      <div className="group-perms" role="group" aria-label={`What ${g.name} may do`}>
        {grantable.map((p) => (
          <label key={p.id} className="ai-check" title={p.hint}>
            <input type="checkbox" checked={may.includes(p.id)} onChange={() => toggle(p.id)} /> {p.label}
          </label>
        ))}
        {extra.length > 0 && <small className="muted">An admin also lets it: {extra.join(', ').toLowerCase()}</small>}
      </div>
    </li>
  )
}
