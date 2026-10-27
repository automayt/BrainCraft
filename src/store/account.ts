/**
 * Talking to a BrainCraft server that has accounts (BRAINCRAFT_ACCOUNTS=1): who's signed in, what
 * they may do, and the calls behind the sign-in screen, the Access dialog and the admin screen.
 * The session is an HttpOnly cookie the browser carries; every call that changes something sends
 * `X-BrainCraft: 1`, which the server asks for so other sites can't act for you.
 */

export type Permission = 'boards.create' | 'boards.share' | 'ai.use' | 'people.see'
export type Level = 'view' | 'edit' | 'manage'

export interface AccountUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  groups: string[]
  sso: boolean
  password: boolean
  disabled?: boolean
  created: number
  lastSeen?: number
}

export interface AccountInfo {
  accounts: true
  /** The server has no admin yet: the first visitor creates one. */
  setup: boolean
  /** Single sign-on: the button's words. */
  sso?: { label: string }
  user: AccountUser | null
  permissions: Permission[]
  /** An admin's announcement for everyone signed in. */
  notice?: string
  /** The server keeps backups, so deleted boards can be put back (from /api/health). */
  backups?: boolean
}

export interface ServerBoard {
  id: string
  title: string
  kind?: 'wiki'
  updated: number
  level: Level
  owner: { id: string; name: string } | null
}

/** Where someone was @mentioned: a comment or description on an object, or a wiki page. */
export interface ServerMention {
  board: string
  title: string
  kind?: 'wiki'
  /** When it was written (none for a description). */
  at?: number
  by?: string
  excerpt: string
  item?: number
  /** The object's name. */
  label?: string
  /** The comment's id, when it's in one. */
  note?: string
  page?: string
  pageTitle?: string
}

export interface Grant {
  who: 'user' | 'group'
  id: string
  level: Level
  name?: string
  email?: string
}

export interface BoardAccessInfo {
  level: Level | null
  owner: { id: string; name: string; email: string } | null
  access: Grant[]
}

export interface Group {
  id: string
  name: string
  description?: string
  permissions: Permission[]
  ssoGroups?: string[]
  everyone?: true
}

export interface AdminData {
  users: AccountUser[]
  groups: Group[]
  permissions: { id: Permission; label: string; hint: string }[]
  envAdmins: string[]
  link?: string
}

/** One entry in the server's activity log. */
export interface AuditEntry {
  n: number
  at: number
  action: string
  by: { id: string; name: string; email: string; admin?: true } | null
  ip?: string
  target?: { kind: string; id: string; name?: string }
  text: string
  changes?: Record<string, [string, string]>
}

export type AuditKind = 'people' | 'signin' | 'boards' | 'security' | 'settings'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const join = (server: string, path: string) => new URL(path, server.endsWith('/') ? server : `${server}/`).href

/**
 * A call to the server's API as the signed-in person; the reply's JSON, or an ApiError with its
 * words. The session cookie goes along to the server this app came from; to another server only for
 * account calls (`withCookie`), since a server without accounts doesn't accept them from elsewhere.
 */
export async function call<T = Record<string, unknown>>(server: string, path: string, method = 'GET', body?: unknown, withCookie = true): Promise<T> {
  let res: Response
  try {
    res = await fetch(join(server, path), {
      method,
      credentials: withCookie ? 'include' : 'same-origin',
      headers: { 'x-braincraft': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch (err) {
    throw new ApiError(`Couldn’t reach the server (${(err as Error).message})`, 0)
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ApiError(data.error ?? `The server said ${res.status}`, res.status)
  return data
}

/** Who's signed in on a server with accounts; null when the server has none (or can't be reached). */
export async function fetchAccount(server: string | null): Promise<AccountInfo | null> {
  if (!server) return null
  try {
    const health = await fetch(join(server, 'api/health')).then((r) => r.json() as Promise<{ accounts?: boolean; backups?: boolean }>)
    if (!health.accounts) return null
    return { ...(await call<AccountInfo>(server, 'api/auth/me')), backups: !!health.backups }
  } catch {
    return null
  }
}

export const can = (a: AccountInfo | null, p: Permission) => !!a?.permissions.includes(p)

export const LEVEL_LABEL: Record<Level, string> = { view: 'Can view', edit: 'Can edit', manage: 'Can manage' }
