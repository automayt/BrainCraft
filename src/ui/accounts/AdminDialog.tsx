import { type FormEvent, useEffect, useState } from 'react'
import { type AccountUser, type AdminData, type AuditEntry, type AuditKind, call, type Group, type Permission, type ServerBoard } from '../../store/account'
import { Dialog, timeAgo } from '../Boards'
import { copyText } from '../copyText'
import { useWorkspace } from '../useWorkspace'
import { appName } from '../../store/brand'
import { UsagePanel } from './UsagePanel'
import { type BackupStatus, backupNow, backupStatus, sizeLabel } from '../../store/serverBackups'

type Tab = 'people' | 'groups' | 'boards' | 'usage' | 'activity' | 'backups' | 'notice' | 'signin' | 'branding'

/**
 * Admins: people (add, role, groups, turn off, password links), groups (what their members may
 * do, who's in them, which sign-in provider groups map to them), boards waiting for an owner, the
 * activity log, backups, how this server signs people in, and what the app is called here.
 */
export function AdminDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const [data, setData] = useState<AdminData | null>(null)
  const [tab, setTab] = useState<Tab>('people')
  const [msg, setMsg] = useState<string | null>(null)
  const [link, setLink] = useState<{ who: string; url: string } | null>(null)

  const run = async (f: () => Promise<AdminData | null | void>) => {
    setMsg(null)
    try {
      const r = await f()
      if (r) setData(r)
    } catch (err) {
      setMsg((err as Error).message)
    }
  }
  const api = (path: string, method = 'GET', body?: unknown) => call<AdminData>(ws.server!, path, method, body)
  useEffect(() => void run(() => api('api/admin/users')), [])

  const tabs: [Tab, string][] = [
    ['people', 'People'],
    ['groups', 'Groups'],
    ['boards', 'Boards without an owner'],
    ['usage', 'Usage'],
    ['activity', 'Activity'],
    ['backups', 'Backups'],
    ['notice', 'Announcement'],
    ['signin', 'Sign-in'],
    ['branding', 'Branding'],
  ]
  return (
    <Dialog label="Admin" onClose={onClose} className="admin">
      <header>
        <h2>Admin</h2>
        <button className="icon-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="admin-tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      {msg && (
        <p className="signin-error" role="alert">
          {msg}
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
        ) : tab === 'people' ? (
          <People data={data} run={run} api={api} onLink={setLink} />
        ) : tab === 'groups' ? (
          <Groups data={data} run={run} api={api} />
        ) : tab === 'boards' ? (
          <Unowned data={data} />
        ) : tab === 'usage' ? (
          <UsagePanel />
        ) : tab === 'activity' ? (
          <Activity />
        ) : tab === 'backups' ? (
          <Backups />
        ) : tab === 'notice' ? (
          <Announcement />
        ) : tab === 'branding' ? (
          <Branding />
        ) : (
          <SignInInfo />
        )}
      </div>
    </Dialog>
  )
}

/** Where the backups are, how they stand, backing up now, and the whole server as one download. */
function Backups() {
  const ws = useWorkspace()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => void backupStatus(ws.server!).then(setStatus, (e: Error) => setError(e.message)), [ws.server])
  if (error) return <p className="signin-error">{error}</p>
  if (!status) return <p className="muted">Loading…</p>
  const download = new URL('api/admin/backup', ws.server ?? location.href).href
  const hours = Math.round(status.every / 60_000)
  return (
    <div className="admin-backups">
      <p>
        Every board and wiki that changes gets a saved version at most every {hours >= 60 && hours % 60 === 0 ? (hours === 60 ? 'hour' : `${hours / 60} hours`) : `${hours} minutes`}, and
        always just before it’s deleted or put back to an earlier version. The newest two days are all kept, then one a day for a month, one a week for six
        months and one a month for a year. People, groups and settings are copied once a day.
      </p>
      <dl className="backup-facts">
        <dt>Kept in</dt>
        <dd>
          <code>{status.dir}</code>
        </dd>
        <dt>Boards and wikis</dt>
        <dd>
          {status.boards} with {status.versions} version{status.versions === 1 ? '' : 's'}
          {status.deleted ? `, and ${status.deleted} deleted that can be put back` : ''}
        </dd>
        <dt>Daily copies of people and settings</dt>
        <dd>{status.serverCopies}</dd>
        <dt>Space used</dt>
        <dd>{sizeLabel(status.bytes)}</dd>
        <dt>Last checked</dt>
        <dd>{status.lastPass ? timeAgo(status.lastPass) : 'not yet (the first round runs half a minute after the server starts)'}</dd>
        {status.lastError && (
          <>
            <dt>Last problem</dt>
            <dd className="signin-error">{status.lastError}</dd>
          </>
        )}
      </dl>
      {status.insideData && (
        <p className="backup-warning" role="note">
          These backups are in the same folder as the boards, so a failed disk would lose both. Set <code>BRAINCRAFT_BACKUP_DIR</code> to a folder on
          another disk, or download everything regularly and keep it somewhere else.
        </p>
      )}
      <div className="account-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await backupNow(ws.server!)
              setStatus(r)
              setSaid(r.saved ? `Saved a version of ${r.saved} board${r.saved === 1 ? '' : 's'}.` : 'Every board was already backed up as it is.')
            } catch (err) {
              setError((err as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Backing up…' : 'Back up every board now'}
        </button>
        <a className="button" href={download} download>
          Download everything (.tar.gz)
        </a>
        {said && <span className="muted">{said}</span>}
      </div>
      <h3>Putting things back</h3>
      <ul className="backup-help">
        <li>One board or wiki: open it, then Version history (Ctrl+K “version”) → On the server.</li>
        <li>A deleted board: Your boards → Recently deleted, for 90 days. Its owner can do this too.</li>
        <li>
          The whole server, on this machine or a new one: stop it, unpack the download into its data folder (<code>tar -xzf braincraft-backup-….tar.gz -C braincraft-data</code>),
          and start it again.
        </li>
      </ul>
    </div>
  )
}

/** A line every signed-in person sees at the top of the app, until they close it. */
function Announcement() {
  const ws = useWorkspace()
  const [saved, setSaved] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void call<{ notice: string }>(ws.server!, 'api/admin/settings').then(
      (r) => {
        setSaved(r.notice)
        setText(r.notice)
      },
      (e: Error) => setMsg(e.message),
    )
  }, [ws.server])
  const save = async (e?: FormEvent, value = text) => {
    e?.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const r = await call<{ notice: string }>(ws.server!, 'api/admin/settings', 'PUT', { notice: value })
      setSaved(r.notice)
      setText(r.notice)
      ws.setNotice(r.notice)
      ws.editor.setStatus(r.notice ? 'Announcement shown to everyone' : 'Announcement taken down')
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (saved === null) return msg ? <p className="signin-error">{msg}</p> : <p className="muted">Loading…</p>
  return (
    <form className="admin-branding" onSubmit={save}>
      <p className="muted">One line at the top of the app for everyone signed in: planned maintenance, a new feature, a deadline. Each person sees it until they close it; a changed announcement shows again.</p>
      <label>
        Announcement
        <textarea rows={2} maxLength={300} value={text} placeholder="The server restarts at 6pm on Friday for an update." onChange={(e) => setText(e.target.value)} />
      </label>
      {msg && <p className="signin-error">{msg}</p>}
      <div className="account-actions">
        {saved && (
          <button type="button" disabled={busy} onClick={() => void save(undefined, '')}>
            Take it down
          </button>
        )}
        <span className="spacer" />
        <button className="primary" disabled={busy || text.trim() === saved}>
          {busy ? 'Saving…' : saved ? 'Change it' : 'Show it'}
        </button>
      </div>
    </form>
  )
}

/** What the app is called on this server: the tab, the top of the app, the sign-in screen. */
function Branding() {
  const ws = useWorkspace()
  const [saved, setSaved] = useState<{ appName: string; defaultName: string } | null>(null)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void call<{ appName: string; defaultName: string }>(ws.server!, 'api/admin/settings').then(
      (r) => {
        setSaved(r)
        setName(r.appName)
      },
      (e: Error) => setMsg(e.message),
    )
  }, [ws.server])
  const save = async (e?: FormEvent, value = name) => {
    e?.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const r = await call<{ appName: string; defaultName: string }>(ws.server!, 'api/admin/settings', 'PUT', { appName: value })
      setSaved(r)
      setName(r.appName)
      // This browser shows it at once; everyone else on their next visit.
      ws.setAppName(r.appName || r.defaultName)
      ws.editor.setStatus(`The app is called ${r.appName || r.defaultName} now`)
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!saved) return msg ? <p className="signin-error">{msg}</p> : <p className="muted">Loading…</p>
  const shown = name.trim() || saved.defaultName
  const changed = name.trim() !== saved.appName
  return (
    <form className="admin-branding" onSubmit={save}>
      <p className="muted">What the app is called on this server: in the browser tab, at the top of the app, on the sign-in screen, and wherever it talks about itself. Everyone sees it the next time they open the app.</p>
      <label>
        App name
        <input value={name} maxLength={40} placeholder={saved.defaultName} onChange={(e) => setName(e.target.value)} aria-describedby="brand-preview" />
      </label>
      <div className="brand-preview" id="brand-preview" aria-label="How it looks">
        <span className="brand-preview-tab">
          <span aria-hidden="true">📋</span> Trip plan · {shown}
        </span>
        <span className="brand-preview-word">{shown}</span>
      </div>
      {msg && <p className="signin-error">{msg}</p>}
      <div className="account-actions">
        {saved.appName && (
          <button type="button" disabled={busy} onClick={() => void save(undefined, '')}>
            Use “{saved.defaultName}” again
          </button>
        )}
        <span className="spacer" />
        <button className="primary" disabled={busy || !changed}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="muted small">Now: {appName()}. Without a name here, it’s {saved.defaultName}{saved.defaultName === 'BrainCraft' ? '' : ' (from BRAINCRAFT_APP_NAME)'}.</p>
    </form>
  )
}

interface Props {
  data: AdminData
  run: (f: () => Promise<AdminData | null | void>) => Promise<void>
  api: (path: string, method?: string, body?: unknown) => Promise<AdminData>
}

function People({ data, run, api, onLink }: Props & { onLink: (l: { who: string; url: string } | null) => void }) {
  const ws = useWorkspace()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [groups, setGroups] = useState<string[]>([])
  const [admin, setAdmin] = useState(false)
  const chosen = data.groups.filter((g) => !g.everyone)
  const add = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api('api/admin/users', 'POST', { email, name, groups, role: admin ? 'admin' : 'user' })
      if (r.link) onLink({ who: name || email, url: r.link })
      setEmail('')
      setName('')
      setGroups([])
      setAdmin(false)
      return r
    })
  }
  const me = ws.account?.user?.id
  return (
    <>
      <form className="admin-add" onSubmit={add}>
        <input type="email" required aria-label="Email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <GroupPicker groups={chosen} value={groups} onChange={setGroups} />
        <label className="ai-check">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Admin
        </label>
        <button className="primary">Add</button>
      </form>
      <p className="muted admin-hint">New people get a link to choose a password. With single sign-on they can just sign in: their account is made then, and joins the groups their provider says.</p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Groups</th>
            <th>Role</th>
            <th>Signs in with</th>
            <th>Last here</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {data.users.map((u: AccountUser) => (
            <tr key={u.id} className={u.disabled ? 'off' : ''}>
              <td>
                <strong>{u.name}</strong>
                <br />
                <small className="muted">{u.email}</small>
              </td>
              <td>
                <GroupPicker groups={chosen} value={u.groups} onChange={(gs) => void run(() => api(`api/admin/users/${u.id}`, 'PATCH', { groups: gs }))} />
              </td>
              <td>
                <select
                  aria-label={`${u.name}’s role`}
                  value={u.role}
                  disabled={data.envAdmins.includes(u.email)}
                  title={data.envAdmins.includes(u.email) ? 'An admin because of BRAINCRAFT_ADMINS' : undefined}
                  onChange={(e) => void run(() => api(`api/admin/users/${u.id}`, 'PATCH', { role: e.target.value }))}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td>
                <small>{[u.password && 'Password', u.sso && 'Single sign-on'].filter(Boolean).join(', ') || 'Not yet'}</small>
              </td>
              <td>
                <small className="muted">{u.disabled ? 'Turned off' : u.lastSeen ? timeAgo(u.lastSeen) : 'Never'}</small>
              </td>
              <td className="admin-row-actions">
                <button
                  className="link"
                  onClick={() =>
                    void run(async () => {
                      const r = (await call<{ link: string }>(ws.server!, `api/admin/users/${u.id}/reset`, 'POST')) as unknown as { link: string }
                      onLink({ who: u.name, url: r.link })
                    })
                  }
                >
                  Password link
                </button>
                {u.id !== me && (
                  <button className="link" onClick={() => void run(() => api(`api/admin/users/${u.id}`, 'PATCH', { disabled: !u.disabled }))}>
                    {u.disabled ? 'Turn on' : 'Turn off'}
                  </button>
                )}
                {u.id !== me && (
                  <button
                    className="link danger-quiet"
                    onClick={() => window.confirm(`Remove ${u.name}? Boards they own go to admins.`) && void run(() => api(`api/admin/users/${u.id}`, 'DELETE'))}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** Choosing groups: each as a toggle chip. */
function GroupPicker({ groups, value, onChange }: { groups: Group[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!groups.length) return <small className="muted">No groups yet</small>
  return (
    <span className="group-chips" role="group" aria-label="Groups">
      {groups.map((g) => {
        const on = value.includes(g.id)
        return (
          <button type="button" key={g.id} className={on ? 'on' : ''} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== g.id) : [...value, g.id])}>
            {g.name}
          </button>
        )
      })}
    </span>
  )
}

function Groups({ data, run, api }: Props) {
  const [name, setName] = useState('')
  const add = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api('api/admin/groups', 'POST', { name, permissions: [] })
      setName('')
      return r
    })
  }
  return (
    <>
      <form className="admin-add" onSubmit={add}>
        <input required aria-label="New group’s name" placeholder="New group (e.g. Planners)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary">Add group</button>
      </form>
      <p className="muted admin-hint">A group says what its members may do; put people in groups and they get it. Everyone is in “Everyone”. Admins may do everything.</p>
      <ul className="group-list">
        {data.groups.map((g) => (
          <GroupRow key={g.id} group={g} data={data} run={run} api={api} />
        ))}
      </ul>
    </>
  )
}

function GroupRow({ group: g, data, run, api }: Props & { group: Group }) {
  const [sso, setSso] = useState((g.ssoGroups ?? []).join(', '))
  const members = data.users.filter((u) => u.groups.includes(g.id))
  const patch = (body: object) => void run(() => api(`api/admin/groups/${g.id}`, 'PATCH', body))
  const toggle = (p: Permission) => patch({ permissions: g.permissions.includes(p) ? g.permissions.filter((x) => x !== p) : [...g.permissions, p] })
  return (
    <li className="group-card">
      <div className="group-head">
        <strong>{g.name}</strong>
        {g.everyone ? (
          <small className="muted">every signed-in person</small>
        ) : (
          <button className="link danger-quiet" onClick={() => window.confirm(`Remove the group “${g.name}”? Its members keep their accounts.`) && void run(() => api(`api/admin/groups/${g.id}`, 'DELETE'))}>
            Remove
          </button>
        )}
      </div>
      <div className="group-perms" role="group" aria-label={`What ${g.name} may do`}>
        {data.permissions.map((p) => (
          <label key={p.id} className="ai-check" title={p.hint}>
            <input type="checkbox" checked={g.permissions.includes(p.id)} onChange={() => toggle(p.id)} /> {p.label}
          </label>
        ))}
      </div>
      {!g.everyone && (
        <>
          <div className="group-members">
            <small className="muted">Members:</small>{' '}
            {data.users.map((u) => {
              const on = u.groups.includes(g.id)
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`chip${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => patch({ members: on ? members.filter((m) => m.id !== u.id).map((m) => m.id) : [...members.map((m) => m.id), u.id] })}
                >
                  {u.name}
                </button>
              )
            })}
          </div>
          <label className="group-sso">
            <small className="muted">Sign-in provider groups that join people to it (comma-separated):</small>
            <input value={sso} onChange={(e) => setSso(e.target.value)} onBlur={() => sso !== (g.ssoGroups ?? []).join(', ') && patch({ ssoGroups: sso.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </label>
        </>
      )}
    </li>
  )
}

/** Boards from before accounts (or whose owner was removed): admins give them an owner. */
function Unowned({ data }: { data: AdminData }) {
  const ws = useWorkspace()
  const [boards, setBoards] = useState<ServerBoard[] | null>(null)
  const load = () => void call<{ boards: ServerBoard[] }>(ws.server!, 'api/boards').then((r) => setBoards(r.boards.filter((b) => !b.owner)))
  useEffect(load, [ws.server])
  if (!boards) return <p className="muted">Loading…</p>
  if (!boards.length) return <p className="muted">Every board has an owner.</p>
  return (
    <ul className="access-list">
      {boards.map((b) => (
        <li key={b.id}>
          <span>
            <strong>{b.title || 'Untitled'}</strong>
            <small className="muted"> {b.kind === 'wiki' ? 'wiki · ' : ''}changed {timeAgo(b.updated)}</small>
          </span>
          <select
            aria-label={`Give “${b.title}” to`}
            defaultValue=""
            onChange={async (e) => {
              if (!e.target.value) return
              await call(ws.server!, `api/boards/${b.id}/access`, 'PUT', { owner: e.target.value })
              load()
            }}
          >
            <option value="">Give it to…</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  )
}

const KINDS: [AuditKind | '', string][] = [
  ['', 'All activity'],
  ['people', 'People and groups'],
  ['signin', 'Sign-ins'],
  ['boards', 'Board access'],
  ['security', 'Passwords and API tokens'],
  ['settings', 'Settings'],
]

/** Actions worth a second look: failed sign-ins, admins opening boards nobody shared with them. */
const NOTABLE = new Set(['signin.failed', 'board.open-as-admin', 'user.remove', 'group.remove', 'board.delete'])

/** The activity log: who changed what, newest first, with a check that nobody edited it by hand. */
function Activity() {
  const ws = useWorkspace()
  const [kind, setKind] = useState<AuditKind | ''>('')
  const [admins, setAdmins] = useState(false)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; count: number; brokenAt?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Typing settles for a moment before asking the server.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const load = async (before?: number) => {
    setError(null)
    const params = new URLSearchParams({ limit: '100', ...(kind ? { kind } : {}), ...(admins ? { admins: '1' } : {}), ...(query ? { q: query } : {}), ...(before ? { before: String(before) } : {}) })
    try {
      const r = await call<{ entries: AuditEntry[]; more: boolean }>(ws.server!, `api/admin/audit?${params}`)
      setEntries((old) => (before && old ? [...old, ...r.entries] : r.entries))
      setMore(r.more)
    } catch (err) {
      setError((err as Error).message)
    }
  }
  useEffect(() => void load(), [kind, admins, query, ws.server])
  useEffect(() => void call<{ ok: boolean; count: number; brokenAt?: number }>(ws.server!, 'api/admin/audit/verify').then(setCheck, () => setCheck(null)), [ws.server])

  const download = new URL('api/admin/audit/download', ws.server ?? location.href).href
  return (
    <div className="audit">
      <div className="audit-filters">
        <input type="search" aria-label="Find in the activity" placeholder="Find a person, board or word" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Kind of activity" value={kind} onChange={(e) => setKind(e.target.value as AuditKind | '')}>
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <label className="ai-check">
          <input type="checkbox" checked={admins} onChange={(e) => setAdmins(e.target.checked)} /> Only what admins did
        </label>
        <a className="link" href={download} download>
          Download all
        </a>
      </div>
      {check &&
        (check.ok ? (
          <p className="muted admin-hint">
            {check.count} {check.count === 1 ? 'entry' : 'entries'}, each checked against the one before: nothing has been changed or removed.
          </p>
        ) : (
          <p className="signin-error" role="alert">
            The log doesn’t match what was written from entry {check.brokenAt} on: its file was changed or cut by hand. Entries before that are intact.
          </p>
        ))}
      {error && (
        <p className="signin-error" role="alert">
          {error}
        </p>
      )}
      {!entries ? (
        <p className="muted">Loading…</p>
      ) : !entries.length ? (
        <p className="muted">{query || kind || admins ? 'Nothing matches.' : 'Nothing has happened yet.'}</p>
      ) : (
        <ol className="audit-list">
          {entries.map((e) => (
            <li key={e.n} className={NOTABLE.has(e.action) ? 'notable' : ''}>
              <time dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString()}>
                {new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
              <div>
                <span>{e.text}</span>
                <small className="muted">
                  {[e.by ? `${e.by.email}${e.by.admin ? ' (admin)' : ''}` : null, e.ip ? `from ${e.ip}` : null, `#${e.n}`].filter(Boolean).join(' · ')}
                </small>
                {e.changes && (
                  <details>
                    <summary>What changed</summary>
                    <table className="audit-changes">
                      <tbody>
                        {Object.entries(e.changes).map(([field, [before, after]]) => (
                          <tr key={field}>
                            <th scope="row">{field}</th>
                            <td>{before}</td>
                            <td aria-hidden="true">→</td>
                            <td>{after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {more && entries && (
        <button className="link" onClick={() => void load(entries[entries.length - 1].n)}>
          Show older
        </button>
      )}
    </div>
  )
}

function SignInInfo() {
  const ws = useWorkspace()
  const sso = ws.account?.sso
  const callback = new URL('api/auth/sso/callback', ws.server ?? location.href).href
  return (
    <div className="admin-signin">
      <p>
        People sign in with <strong>a password</strong>
        {sso ? (
          <>
            {' '}
            or <strong>single sign-on</strong> (“{sso.label}”)
          </>
        ) : null}
        . These settings come from the server’s environment; see docs/ACCOUNTS.md.
      </p>
      {sso ? (
        <p>
          The address to give your sign-in provider as the redirect URI: <code>{callback}</code>
        </p>
      ) : (
        <p className="muted">
          Single sign-on is off. To turn it on, set <code>BRAINCRAFT_OIDC_ISSUER</code>, <code>BRAINCRAFT_OIDC_CLIENT_ID</code> and <code>BRAINCRAFT_OIDC_CLIENT_SECRET</code> (and{' '}
          <code>BRAINCRAFT_PUBLIC_URL</code>) and restart the server. The redirect URI to register: <code>{callback}</code>
        </p>
      )}
    </div>
  )
}
