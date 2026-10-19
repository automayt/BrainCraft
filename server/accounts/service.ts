/**
 * The accounts side of the HTTP API (with BRAINCRAFT_ACCOUNTS=1):
 *
 *   GET  /api/auth/me                 who's signed in, what they may do, how this server signs in
 *   POST /api/auth/setup              the first admin, on a fresh server
 *   POST /api/auth/login | logout     with an email and password
 *   POST /api/auth/password           change your password
 *   POST /api/auth/reset              set a password from a one-time link
 *   GET|POST /api/auth/tokens, DELETE /api/auth/tokens/:id     your API tokens (for scripts, MCP)
 *   GET  /api/people?q=               people and groups to share with
 *   /api/admin/users[/:id[/reset]], /api/admin/groups[/:id]    admins: people and groups
 *   GET  /api/admin/audit[/verify|/download]                    admins: the activity log (audit.ts)
 *
 * Signed-in browsers carry an HttpOnly session cookie; scripts send `Authorization: Bearer bct_…`.
 * Requests that change anything from a browser must send `X-BrainCraft: 1`, which pages on other
 * sites can't send without asking first (and they're refused), so they can't act for you.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { can, permissionsOf } from './access'
import { type Actor, AUDIT_KINDS, type AuditInput, type AuditKind, AuditLog, type AuditTarget, changesOf, changeText } from './audit'
import { AccountStore, checkPassword, hashPassword, normalEmail, SESSION_MS, validEmail, weakPassword } from './store'
import { type AccountRole, type Group, PERMISSIONS, type Permission, publicUser, type User } from './types'

export const COOKIE = 'braincraft_session'

/** What a single sign-on provider adds to the service (see oidc.ts). */
export interface SsoProvider {
  /** The button's words, e.g. "Sign in with Okta". */
  label: string
  /** Where the provider sends people back to (to register with it). */
  redirectUri: string
  /** Starts a sign-in: the provider's address to send the browser to, and a cookie to remember it by. */
  start(returnTo: string): Promise<{ url: string; cookie: string }>
  /** Finishes one: who signed in, from the callback's query and the remembered cookie. */
  finish(query: URLSearchParams, cookie: string | undefined): Promise<SsoIdentity>
}

export interface SsoIdentity {
  issuer: string
  subject: string
  email?: string
  emailVerified: boolean
  name?: string
  groups: string[]
  returnTo: string
}

export interface AccountsOptions {
  dir: string
  /** Emails that are always admins (BRAINCRAFT_ADMINS). */
  admins?: string[]
  /** The server's public address (BRAINCRAFT_PUBLIC_URL), for links and cookies. */
  publicUrl?: string
  trustProxy?: boolean
  visitor?: (req: IncomingMessage) => string
  now?: () => number
  sso?: SsoProvider | null
  /** Sign-ins from these email domains only, when set. */
  allowedDomains?: string[]
}

export const parseCookies = (header: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((p) => p.trim().split('='))
      .filter((p) => p.length >= 2 && p[0])
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  )

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

/** At most `limit` tries per key per window. */
function limiter(limit: number, windowMs: number, now: () => number) {
  const use = new Map<string, { start: number; count: number }>()
  return (key: string): boolean => {
    const t = now()
    const u = use.get(key)
    if (!u || t - u.start > windowMs) {
      if (use.size > 10_000) for (const [k, x] of use) if (t - x.start > windowMs) use.delete(k)
      use.set(key, { start: t, count: 1 })
      return true
    }
    return ++u.count <= limit
  }
}

export class Accounts {
  store: AccountStore
  /** What admins changed, sign-ins and the like (see audit.ts). */
  audit: AuditLog
  sso: SsoProvider | null
  private o: Required<Omit<AccountsOptions, 'sso' | 'publicUrl'>> & { publicUrl?: string }
  private loginByVisitor: (k: string) => boolean
  private loginByEmail: (k: string) => boolean

  constructor(o: AccountsOptions) {
    this.o = { admins: [], trustProxy: false, visitor: (req) => req.socket.remoteAddress ?? '', now: Date.now, allowedDomains: [], ...o }
    this.o.admins = this.o.admins.map(normalEmail).filter(Boolean)
    this.store = new AccountStore(o.dir, this.o.now)
    this.audit = new AuditLog(o.dir, this.o.now)
    this.sso = o.sso ?? null
    this.loginByVisitor = limiter(30, 10 * 60_000, this.o.now)
    this.loginByEmail = limiter(10, 10 * 60_000, this.o.now)
  }

  // ----- who is asking ----------------------------------------------------------------------------------

  /** The signed-in user behind a request: their session cookie, or an API token. */
  userOf(req: IncomingMessage): User | null {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer bct_')) return this.store.check(auth.slice(7).trim(), 'api') ?? null
    const u = this.store.check(parseCookies(req.headers.cookie)[COOKIE], 'session')
    if (u) this.store.seen(u)
    return u ?? null
  }

  /** A browser request that changes something must say it comes from the app (scripts with a token needn't). */
  fromApp(req: IncomingMessage): boolean {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true
    if (req.headers.authorization?.startsWith('Bearer bct_')) return true
    return req.headers['x-braincraft'] === '1'
  }

  permissions = (u: User | null) => permissionsOf(u, this.store.groups)
  can = (u: User | null, p: Permission) => can(u, this.store.groups, p)

  // ----- the activity log ------------------------------------------------------------------------------

  /** Who someone is, as the log remembers them. */
  actor = (u: User): Actor => ({ id: u.id, name: u.name, email: u.email, ...(u.role === 'admin' ? { admin: true as const } : {}) })

  /** Notes something in the activity log, with who did it and from where. */
  log(req: IncomingMessage | null, by: User | null, entry: Omit<AuditInput, 'by' | 'ip'>) {
    this.audit.record({ ...entry, by: by ? this.actor(by) : null, ...(req ? { ip: this.o.visitor(req) } : {}) })
  }

  userTarget = (u: User): AuditTarget => ({ kind: 'user', id: u.id, name: `${u.name} (${u.email})` })

  private groupName = (id: string) => this.store.groups.find((g) => g.id === id)?.name ?? id

  /** A person as the log compares them before and after a change. */
  private userView = (u: User) => ({ name: u.name, role: u.role, groups: u.groups.map(this.groupName), 'turned off': !!u.disabled })

  private groupView = (g: Group) => ({
    name: g.name,
    description: g.description ?? '',
    permissions: g.permissions.map((p) => PERMISSIONS.find((x) => x.id === p)?.label ?? p),
    'provider groups': g.ssoGroups ?? [],
    members: this.store.users.filter((u) => u.groups.includes(g.id)).map((u) => u.name),
  })

  /** The server's address as people reach it. */
  origin(req: IncomingMessage): string {
    if (this.o.publicUrl) return this.o.publicUrl.replace(/\/+$/, '')
    const proto = this.o.trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
    const host = (this.o.trustProxy ? String(req.headers['x-forwarded-host'] ?? '') : '') || req.headers.host || 'localhost'
    return `${proto}://${host}`
  }

  private secure = (req: IncomingMessage) => this.origin(req).startsWith('https:')

  sessionCookie(req: IncomingMessage, secret: string | null): string {
    const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', ...(this.secure(req) ? ['Secure'] : [])]
    return secret ? `${COOKIE}=${secret}; Max-Age=${Math.floor(SESSION_MS / 1000)}; ${attrs.join('; ')}` : `${COOKIE}=; Max-Age=0; ${attrs.join('; ')}`
  }

  /** Whether the server still needs its first admin. */
  get needsSetup() {
    return !this.store.users.some((u) => u.role === 'admin' && !u.disabled)
  }

  private isEnvAdmin = (email: string) => this.o.admins.includes(normalEmail(email))

  /** Anyone listed in BRAINCRAFT_ADMINS is an admin, whichever way they signed in. */
  private promote(u: User) {
    if (!this.isEnvAdmin(u.email) || u.role === 'admin') return
    this.store.updateUser(u.id, { role: 'admin' })
    this.log(null, null, { action: 'user.promote', target: this.userTarget(u), text: `${u.name} was made an admin (listed in BRAINCRAFT_ADMINS)` })
  }

  private allowedEmail(email: string) {
    if (!this.o.allowedDomains.length) return true
    const domain = email.split('@')[1]?.toLowerCase()
    return this.o.allowedDomains.some((d) => d.toLowerCase() === domain)
  }

  /** What the app needs to know about the person and the server. */
  me(req: IncomingMessage) {
    const u = this.userOf(req)
    return {
      accounts: true,
      setup: this.needsSetup,
      ...(this.sso ? { sso: { label: this.sso.label } } : {}),
      user: u ? publicUser(u) : null,
      permissions: [...this.permissions(u)],
    }
  }

  /** Signs someone in on this response. */
  private signIn(req: IncomingMessage, res: ServerResponse, u: User, extra: Record<string, unknown> = {}) {
    const secret = this.store.issue(u.id, 'session')
    this.store.seen(u)
    json(res, 200, { ...this.meFor(u), ...extra }, { 'set-cookie': this.sessionCookie(req, secret) })
  }

  private meFor(u: User) {
    return { accounts: true, setup: this.needsSetup, ...(this.sso ? { sso: { label: this.sso.label } } : {}), user: publicUser(u), permissions: [...this.permissions(u)] }
  }

  // ----- single sign-on --------------------------------------------------------------------------------

  /** Finds or makes the account for someone their provider vouches for. */
  ssoUser(id: SsoIdentity, req: IncomingMessage | null = null): User | string {
    const email = id.email && id.emailVerified ? normalEmail(id.email) : undefined
    let u = this.store.bySso(id.issuer, id.subject)
    // A verified email links an account made by an admin (or a password one) the first time.
    if (!u && email) {
      const byEmail = this.store.byEmail(email)
      if (byEmail && !byEmail.sso) {
        u = this.store.updateUser(byEmail.id, { sso: { issuer: id.issuer, subject: id.subject } })
        if (u) this.log(req, u, { action: 'sso.linked', target: this.userTarget(u), text: `${u.name}’s account was linked to single sign-on by their verified email` })
      } else if (byEmail) return 'That email belongs to an account linked to another sign-in'
    }
    if (u?.disabled) return 'This account is turned off. Ask an admin.'
    if (!u) {
      if (!email) return 'Your sign-in provider didn’t share a verified email, so no account could be made'
      if (!this.allowedEmail(email)) return 'Accounts from that email domain aren’t allowed here'
      u = this.store.addUser({ email, name: id.name?.trim().slice(0, 80) || email.split('@')[0], role: 'user', sso: { issuer: id.issuer, subject: id.subject } })
      this.log(req, u, { action: 'sso.new-account', target: this.userTarget(u), text: `${u.name} (${u.email}) got an account by signing in with single sign-on` })
    }
    this.store.updateUser(u.id, { ssoGroups: id.groups.slice(0, 200), ...(id.name ? { name: id.name.trim().slice(0, 80) } : {}) })
    this.promote(u)
    return u
  }

  // ----- routes ----------------------------------------------------------------------------------------

  /** Handles an accounts route; false when the path isn't one of them. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, body: () => Promise<string>): Promise<boolean> {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[1] !== 'auth' && parts[1] !== 'admin' && parts[1] !== 'people') return false
    if (!this.fromApp(req)) return json(res, 403, { error: 'Missing the X-BrainCraft header' }), true
    const read = async (): Promise<Record<string, unknown>> => {
      try {
        const v = JSON.parse((await body()) || '{}') as unknown
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    }
    const me = this.userOf(req)
    const path = parts.slice(1).join('/')
    const m = req.method ?? 'GET'

    if (path === 'auth/me' && m === 'GET') return json(res, 200, this.me(req)), true

    if (path === 'auth/setup' && m === 'POST') {
      if (!this.needsSetup) return json(res, 409, { error: 'This server already has an admin' }), true
      const b = await read()
      if (!validEmail(b.email)) return json(res, 400, { error: 'Enter an email address' }), true
      if (this.o.admins.length && !this.isEnvAdmin(b.email)) return json(res, 403, { error: 'This server’s admins are set by its owner (BRAINCRAFT_ADMINS); use one of those emails' }), true
      const weak = weakPassword(b.password)
      if (weak) return json(res, 400, { error: weak }), true
      const existing = this.store.byEmail(b.email)
      const u = existing
        ? this.store.updateUser(existing.id, { role: 'admin', password: await hashPassword(String(b.password)), disabled: undefined })!
        : this.store.addUser({ email: b.email, name: String(b.name ?? '').trim().slice(0, 80) || b.email.split('@')[0], role: 'admin', password: await hashPassword(String(b.password)) })
      this.log(req, u, { action: 'server.setup', target: { kind: 'server', id: 'server' }, text: `${u.name} (${u.email}) set up the server as its first admin` })
      return this.signIn(req, res, u), true
    }

    if (path === 'auth/login' && m === 'POST') {
      const b = await read()
      const email = typeof b.email === 'string' ? normalEmail(b.email) : ''
      if (!this.loginByVisitor(this.o.visitor(req)) || !this.loginByEmail(email)) return json(res, 429, { error: 'Too many tries. Wait a few minutes and try again.' }), true
      const u = email ? this.store.byEmail(email) : undefined
      // The same answer for an unknown email and a wrong password.
      const ok = typeof b.password === 'string' && (await checkPassword(b.password, u?.password))
      if (!u || !ok) {
        // An email typed in full is noted; anything else might be a password typed in the wrong box.
        const text = u ? `Wrong password for ${u.email}` : `Sign-in with an unknown email${validEmail(email) ? ` (${email})` : ''}`
        this.log(req, null, { action: 'signin.failed', ...(u ? { target: this.userTarget(u) } : {}), text })
        return json(res, 401, { error: 'That email and password don’t match' }), true
      }
      if (u.disabled) {
        this.log(req, null, { action: 'signin.failed', target: this.userTarget(u), text: `${u.name} tried to sign in, but their account is turned off` })
        return json(res, 403, { error: 'This account is turned off. Ask an admin.' }), true
      }
      this.promote(u)
      this.log(req, u, { action: 'signin', target: this.userTarget(u), text: `${u.name} signed in with a password` })
      return this.signIn(req, res, u), true
    }

    if (path === 'auth/logout' && m === 'POST') {
      const secret = parseCookies(req.headers.cookie)[COOKIE]
      const who = this.store.check(secret, 'session')
      if (who) this.log(req, who, { action: 'signout', target: this.userTarget(who), text: `${who.name} signed out` })
      if (secret) this.store.revoke(secret)
      return json(res, 200, { ok: true }, { 'set-cookie': this.sessionCookie(req, null) }), true
    }

    if (path === 'auth/reset' && m === 'POST') {
      const b = await read()
      const weak = weakPassword(b.password)
      if (weak) return json(res, 400, { error: weak }), true
      const u = typeof b.token === 'string' ? this.store.spend(b.token, 'reset') : undefined
      if (!u) return json(res, 400, { error: 'That link has expired or was already used. Ask an admin for a new one.' }), true
      this.store.updateUser(u.id, { password: await hashPassword(String(b.password)) })
      this.store.revokeAll(u.id, ['session'])
      this.log(req, u, { action: 'password.reset', target: this.userTarget(u), text: `${u.name} chose a new password from a set-your-password link` })
      return this.signIn(req, res, u), true
    }

    if (path === 'auth/sso/start' && m === 'GET') {
      if (!this.sso) return json(res, 404, { error: 'Single sign-on isn’t set up on this server' }), true
      const back = url.searchParams.get('return') ?? '/'
      const { url: to, cookie } = await this.sso.start(back.startsWith('/') && !back.startsWith('//') ? back : '/')
      res.writeHead(302, { location: to, 'set-cookie': cookie, 'cache-control': 'no-store' })
      return res.end(), true
    }

    if (path === 'auth/sso/callback' && m === 'GET') {
      if (!this.sso) return json(res, 404, { error: 'Single sign-on isn’t set up on this server' }), true
      const fail = (msg: string) => {
        this.log(req, null, { action: 'signin.failed', text: `Single sign-on failed: ${msg}` })
        res.writeHead(302, { location: `/#signin-error=${encodeURIComponent(msg)}`, 'cache-control': 'no-store' })
        res.end()
      }
      let id: SsoIdentity
      try {
        id = await this.sso.finish(url.searchParams, parseCookies(req.headers.cookie)['braincraft_sso'])
      } catch (err) {
        return fail(`Sign-in failed: ${(err as Error).message}`), true
      }
      const u = this.ssoUser(id, req)
      if (typeof u === 'string') return fail(u), true
      this.log(req, u, { action: 'signin', target: this.userTarget(u), text: `${u.name} signed in with single sign-on` })
      const secret = this.store.issue(u.id, 'session')
      res.writeHead(302, {
        location: id.returnTo,
        'set-cookie': [this.sessionCookie(req, secret), 'braincraft_sso=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax'],
        'cache-control': 'no-store',
      })
      return res.end(), true
    }

    // Everything below needs someone signed in.
    if (!me) return json(res, 401, { error: 'Sign in first' }), true

    if (path === 'auth/password' && m === 'POST') {
      const b = await read()
      if (me.password && !(typeof b.current === 'string' && (await checkPassword(b.current, me.password)))) return json(res, 403, { error: 'Your current password isn’t right' }), true
      const weak = weakPassword(b.password)
      if (weak) return json(res, 400, { error: weak }), true
      this.store.updateUser(me.id, { password: await hashPassword(String(b.password)) })
      this.log(req, me, { action: 'password.change', target: this.userTarget(me), text: `${me.name} changed their password` })
      return json(res, 200, { ok: true }), true
    }

    if (path === 'auth/tokens') {
      if (m === 'GET') return json(res, 200, { tokens: this.store.apiTokens(me.id) }), true
      if (m === 'POST') {
        const b = await read()
        const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : 'API token'
        const token = this.store.issue(me.id, 'api', name)
        this.log(req, me, { action: 'token.create', target: { kind: 'token', id: this.store.apiTokens(me.id).at(-1)?.id ?? '', name }, text: `${me.name} made an API token “${name}”` })
        return json(res, 201, { token, tokens: this.store.apiTokens(me.id) }), true
      }
    }
    if (parts[1] === 'auth' && parts[2] === 'tokens' && parts[3] && m === 'DELETE') {
      const t = this.store.apiTokens(me.id).find((x) => x.id === parts[3])
      if (t && this.store.revokeApiToken(me.id, t.id)) this.log(req, me, { action: 'token.revoke', target: { kind: 'token', id: t.id, name: t.name }, text: `${me.name} revoked their API token “${t.name}”` })
      return json(res, t ? 200 : 404, { tokens: this.store.apiTokens(me.id) }), true
    }

    if (path === 'people' && m === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      // Without "see everyone", only an exact email finds someone (so sharing still works).
      if (!this.can(me, 'people.see')) {
        const u = validEmail(q) ? this.store.byEmail(q) : undefined
        return json(res, 200, { people: u && !u.disabled ? [{ id: u.id, name: u.name, email: u.email }] : [], groups: [] }), true
      }
      const match = (s: string) => !q || s.toLowerCase().includes(q)
      return (
        json(res, 200, {
          people: this.store.users
            .filter((u) => !u.disabled && (match(u.name) || match(u.email)))
            .slice(0, 50)
            .map((u) => ({ id: u.id, name: u.name, email: u.email })),
          groups: this.store.groups.filter((g) => match(g.name)).map((g) => ({ id: g.id, name: g.name })),
        }),
        true
      )
    }

    if (parts[1] === 'admin') {
      if (me.role !== 'admin') return json(res, 403, { error: 'Only admins can do that' }), true
      return this.admin(req, res, url, parts.slice(2), m, me, read), true
    }
    return json(res, 404, { error: 'Not found' }), true
  }

  private async admin(req: IncomingMessage, res: ServerResponse, url: URL, p: string[], m: string, me: User, read: () => Promise<Record<string, unknown>>) {
    const s = this.store
    const all = () => ({ users: s.users.map(publicUser), groups: s.groups, permissions: PERMISSIONS, envAdmins: this.o.admins })
    const link = (u: User) => `${this.origin(req)}/#reset=${s.issue(u.id, 'reset')}`
    const admins = () => s.users.filter((u) => u.role === 'admin' && !u.disabled)

    if (p[0] === 'users') {
      if (!p[1] && m === 'GET') return json(res, 200, all())
      if (!p[1] && m === 'POST') {
        const b = await read()
        if (!validEmail(b.email)) return json(res, 400, { error: 'Enter an email address' })
        if (s.byEmail(b.email)) return json(res, 409, { error: 'Someone already has that email' })
        const role: AccountRole = b.role === 'admin' ? 'admin' : 'user'
        const weak = b.password !== undefined && b.password !== '' ? weakPassword(b.password) : null
        if (weak) return json(res, 400, { error: weak })
        const u = s.addUser({
          email: b.email,
          name: String(b.name ?? '').trim().slice(0, 80) || b.email.split('@')[0],
          role,
          groups: Array.isArray(b.groups) ? b.groups.filter((g): g is string => typeof g === 'string') : [],
          ...(typeof b.password === 'string' && b.password ? { password: await hashPassword(b.password) } : {}),
        })
        const groups = u.groups.map(this.groupName)
        this.log(req, me, {
          action: 'user.add',
          target: this.userTarget(u),
          text: `${me.name} added ${u.name} (${u.email}) as ${u.role === 'admin' ? 'an admin' : 'a user'}${groups.length ? `, in ${groups.join(', ')}` : ''}`,
        })
        this.promote(u)
        // Without a password (and without single sign-on), a link for them to choose one.
        return json(res, 201, { user: publicUser(u), ...(u.password ? {} : { link: link(u) }), ...all() })
      }
      const u = s.user(p[1])
      if (!u) return json(res, 404, { error: 'No such person' })
      if (p[2] === 'reset' && m === 'POST') {
        this.log(req, me, { action: 'user.reset-link', target: this.userTarget(u), text: `${me.name} made a set-your-password link for ${u.name}` })
        return json(res, 200, { link: link(u) })
      }
      if (m === 'PATCH') {
        const b = await read()
        const patch: Partial<User> = {}
        if (typeof b.name === 'string') patch.name = b.name.trim().slice(0, 80) || u.name
        if (b.role === 'admin' || b.role === 'user') patch.role = b.role
        if (Array.isArray(b.groups)) patch.groups = b.groups.filter((g): g is string => typeof g === 'string')
        if (typeof b.disabled === 'boolean') patch.disabled = b.disabled || undefined
        const losing = (patch.role === 'user' || patch.disabled) && u.role === 'admin'
        if (losing && this.isEnvAdmin(u.email)) return json(res, 409, { error: 'This person is an admin because the server’s owner said so (BRAINCRAFT_ADMINS)' })
        if (losing && admins().length <= 1) return json(res, 409, { error: 'The server needs at least one admin' })
        const before = this.userView(u)
        s.updateUser(u.id, patch)
        if (patch.disabled) s.revokeAll(u.id)
        const changes = changesOf(before, this.userView(u))
        if (Object.keys(changes).length) this.log(req, me, { action: 'user.change', target: this.userTarget(u), changes, text: `${me.name} changed ${u.name}: ${changeText(changes)}` })
        return json(res, 200, all())
      }
      if (m === 'DELETE') {
        if (u.id === me.id) return json(res, 409, { error: 'You can’t remove yourself' })
        if (u.role === 'admin' && admins().length <= 1) return json(res, 409, { error: 'The server needs at least one admin' })
        s.removeUser(u.id)
        this.log(req, me, { action: 'user.remove', target: this.userTarget(u), text: `${me.name} removed ${u.name} (${u.email})` })
        return json(res, 200, all())
      }
    }

    if (p[0] === 'groups') {
      if (!p[1] && m === 'GET') return json(res, 200, all())
      const fields = (b: Record<string, unknown>): Partial<Group> => ({
        ...(typeof b.name === 'string' ? { name: b.name } : {}),
        ...(typeof b.description === 'string' ? { description: b.description } : {}),
        ...(Array.isArray(b.permissions) ? { permissions: b.permissions as Permission[] } : {}),
        ...(Array.isArray(b.ssoGroups) ? { ssoGroups: b.ssoGroups.filter((x): x is string => typeof x === 'string') } : {}),
      })
      if (!p[1] && m === 'POST') {
        const b = await read()
        const g = s.addGroup({ name: '', permissions: [], ...fields(b) } as Omit<Group, 'id'>)
        // Members can be given with the group.
        if (Array.isArray(b.members)) for (const uid of b.members) if (typeof uid === 'string' && s.user(uid)) s.updateUser(uid, { groups: [...s.user(uid)!.groups, g.id] })
        const view = this.groupView(g)
        this.log(req, me, {
          action: 'group.add',
          target: { kind: 'group', id: g.id, name: g.name },
          changes: changesOf({}, view),
          text: `${me.name} made the group ${g.name}: may ${view.permissions.join(', ') || 'do nothing extra'}${view.members.length ? `; members ${view.members.join(', ')}` : ''}`,
        })
        return json(res, 201, { group: g, ...all() })
      }
      const g = s.groups.find((x) => x.id === p[1])
      if (!g) return json(res, 404, { error: 'No such group' })
      if (m === 'PATCH') {
        const b = await read()
        const before = this.groupView(g)
        s.updateGroup(g.id, fields(b))
        if (Array.isArray(b.members) && !g.everyone) {
          const want = new Set(b.members.filter((x): x is string => typeof x === 'string'))
          for (const u of s.users) {
            const has = u.groups.includes(g.id)
            if (want.has(u.id) && !has) s.updateUser(u.id, { groups: [...u.groups, g.id] })
            if (!want.has(u.id) && has) s.updateUser(u.id, { groups: u.groups.filter((x) => x !== g.id) })
          }
        }
        const changes = changesOf(before, this.groupView(g))
        if (Object.keys(changes).length) this.log(req, me, { action: 'group.change', target: { kind: 'group', id: g.id, name: g.name }, changes, text: `${me.name} changed the group ${before.name}: ${changeText(changes)}` })
        return json(res, 200, all())
      }
      if (m === 'DELETE') {
        const view = this.groupView(g)
        if (!s.removeGroup(g.id)) return json(res, 409, { error: 'Everyone can’t be removed' })
        this.log(req, me, { action: 'group.remove', target: { kind: 'group', id: g.id, name: g.name }, text: `${me.name} removed the group ${g.name}${view.members.length ? ` (members: ${view.members.join(', ')})` : ''}` })
        return json(res, 200, all())
      }
    }

    if (p[0] === 'audit' && m === 'GET') {
      if (!p[1]) {
        const q = url.searchParams
        const before = Number(q.get('before'))
        const kind = q.get('kind') as AuditKind | null
        return json(
          res,
          200,
          this.audit.query({
            ...(before > 0 ? { before } : {}),
            limit: Math.min(200, Number(q.get('limit')) || 100),
            ...(kind && AUDIT_KINDS.includes(kind) ? { kind } : {}),
            admins: q.get('admins') === '1',
            q: (q.get('q') ?? '').slice(0, 200),
          }),
        )
      }
      if (p[1] === 'verify') return json(res, 200, this.audit.verify())
      if (p[1] === 'download') {
        this.log(req, me, { action: 'audit.download', text: `${me.name} downloaded the activity log` })
        const day = new Date(this.o.now()).toISOString().slice(0, 10)
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': `attachment; filename="braincraft-activity-${day}.jsonl"`, 'cache-control': 'no-store' })
        return res.end(this.audit.all())
      }
    }
    return json(res, 404, { error: 'Not found' })
  }
}
