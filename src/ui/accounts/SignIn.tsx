import { type FormEvent, useState } from 'react'
import { type AccountInfo, call } from '../../store/account'
import { useWorkspace } from '../useWorkspace'
import { appName } from '../../store/brand'

/** A one-time link to choose a password (`#reset=…`), as an admin hands out. */
export const resetTokenOf = (hash: string) => /(?:^#|&)reset=([\w-]{20,})/.exec(hash)?.[1] ?? null
/** Why a single sign-on came back without signing in (`#signin-error=…`). */
const signInErrorOf = (hash: string) => {
  const m = /(?:^#|&)signin-error=([^&]*)/.exec(hash)
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * The door to a server with accounts: create the first admin on a fresh server, sign in with a
 * password or single sign-on, or choose a password from a link an admin sent.
 */
export function SignIn() {
  const ws = useWorkspace()
  const account = ws.account!
  const reset = typeof location === 'undefined' ? null : resetTokenOf(location.hash)
  const [error, setError] = useState<string | null>(() => (typeof location === 'undefined' ? null : signInErrorOf(location.hash)))
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const mode = reset ? 'reset' : account.setup ? 'setup' : 'login'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ws.server || busy) return
    setBusy(true)
    setError(null)
    try {
      const info =
        mode === 'reset'
          ? await call<AccountInfo>(ws.server, 'api/auth/reset', 'POST', { token: reset, password })
          : mode === 'setup'
            ? await call<AccountInfo>(ws.server, 'api/auth/setup', 'POST', { email, name, password })
            : await call<AccountInfo>(ws.server, 'api/auth/login', 'POST', { email, password })
      if (typeof location !== 'undefined' && location.hash) history.replaceState(null, '', location.pathname + location.search)
      await ws.signedIn(info)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sso = account.sso && mode === 'login'
  return (
    <div className="signin no-canvas">
      <form className="signin-card" onSubmit={submit} aria-labelledby="signin-title">
        <div className="signin-brand" aria-hidden="true">
          ✦ {appName()}
        </div>
        <h1 id="signin-title">{mode === 'setup' ? 'Set up this server' : mode === 'reset' ? 'Choose a password' : 'Sign in'}</h1>
        {mode === 'setup' && <p className="muted">This server is new. Create the first admin account: you’ll add everyone else, and their groups, from the admin screen.</p>}
        {mode === 'reset' && <p className="muted">Pick a password for your account. The link works once.</p>}
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
        {sso && (
          <>
            <a className="signin-sso primary" href={new URL('api/auth/sso/start?return=/', ws.server!).href}>
              {account.sso!.label}
            </a>
            <div className="signin-or">
              <span>or with a password</span>
            </div>
          </>
        )}
        {mode !== 'reset' && (
          <label>
            Email
            <input type="email" autoComplete="email" required autoFocus={!sso} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {mode === 'setup' && (
          <label>
            Your name
            <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'login' ? undefined : 10}
            autoFocus={mode === 'reset'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode !== 'login' && <small className="muted">At least 10 characters.</small>}
        </label>
        <button className={sso ? '' : 'primary'} disabled={busy}>
          {busy ? 'One moment…' : mode === 'setup' ? 'Create the admin account' : mode === 'reset' ? 'Save and sign in' : 'Sign in'}
        </button>
        {mode === 'login' && <p className="muted signin-note">No account? Ask whoever runs this server to add you.</p>}
      </form>
    </div>
  )
}
