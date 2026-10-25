/**
 * Where accounts live: `DATA/accounts/users.json`, `groups.json`, `sessions.json` and
 * `boards.json` (a small index of the server's boards, so they can be listed without reading
 * each one). Each file is rewritten whole, through a temporary file, as boards are.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BoardAccess, type Grant, type Group, LEVELS, type User, isPermission } from './types'

const id = () => randomBytes(9).toString('base64url')

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(path: string, value: unknown) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 1))
  renameSync(tmp, path)
}

export const normalEmail = (e: string) => e.trim().toLowerCase()
export const validEmail = (e: unknown): e is string => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+$/.test(e.trim())

// ----- passwords ----------------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((ok, fail) => scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => (err ? fail(err) : ok(key))))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('base64url')}$${(await scryptAsync(password, salt)).toString('base64url')}`
}

export async function checkPassword(password: string, stored: string | undefined): Promise<boolean> {
  const [kind, salt, hash] = (stored ?? '').split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64url')
  const got = await scryptAsync(password, Buffer.from(salt, 'base64url'))
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Why a password won't do, or null. */
export const weakPassword = (p: unknown): string | null =>
  typeof p !== 'string' || p.length < 10 ? 'Use a password of at least 10 characters' : p.length > 200 ? 'That password is too long' : null

// ----- the store ------------------------------------------------------------------------------------

export interface BoardEntry extends BoardAccess {
  title: string
  kind?: 'wiki'
  updated: number
}

export interface Token {
  /** SHA-256 of the secret; the secret itself is never stored. */
  hash: string
  userId: string
  kind: 'session' | 'reset' | 'api'
  created: number
  expires: number
  /** API tokens: what it's for, shown in the account menu. */
  name?: string
  lastUsed?: number
}

export const hashToken = (secret: string) => createHash('sha256').update(secret).digest('base64url')

/** Sessions last 30 days from the last use. */
export const SESSION_MS = 30 * 86_400_000
export interface ServerSettings {
  /** What the app is called on this server (the tab, the top of the app, the sign-in screen). */
  appName?: string
  /** A line every signed-in person sees at the top of the app (maintenance, a new feature, a deadline). */
  notice?: string
}

/** At most this long. */
export const APP_NAME_MAX = 40
export const NOTICE_MAX = 300

/** An announcement as kept: one line of plain text, or nothing. */
export function cleanNotice(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const text = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTICE_MAX).trim()
  return text || undefined
}
/** The app's name when nobody has chosen another. */
export const DEFAULT_APP_NAME = 'BrainCraft'

/** An app name as typed: one line, no markup characters, not too long; undefined when empty. */
export function cleanAppName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const name = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, APP_NAME_MAX).trim()
  return name || undefined
}

/** A set-your-password link works for a week. */
export const RESET_MS = 7 * 86_400_000
/** API tokens last a year. */
export const API_TOKEN_MS = 365 * 86_400_000

export class AccountStore {
  users: User[]
  groups: Group[]
  boards: Record<string, BoardEntry>
  /** Server-wide settings admins change in the app (the app's name). */
  settings: ServerSettings
  private tokens: Token[]
  private dir: string
  private now: () => number
  private tokenTimer: NodeJS.Timeout | undefined

  constructor(dir: string, now: () => number = Date.now) {
    this.dir = dir
    this.now = now
    mkdirSync(dir, { recursive: true })
    this.users = readJson<User[]>(this.file('users'), []).filter((u) => u && typeof u.id === 'string' && validEmail(u.email))
    this.groups = readJson<Group[]>(this.file('groups'), []).filter((g) => g && typeof g.id === 'string')
    this.boards = readJson<Record<string, BoardEntry>>(this.file('boards'), {})
    const settings = readJson<ServerSettings>(this.file('settings'), {})
    this.settings = { ...(cleanAppName(settings.appName) ? { appName: cleanAppName(settings.appName) } : {}), ...(cleanNotice(settings.notice) ? { notice: cleanNotice(settings.notice) } : {}) }
    this.tokens = readJson<Token[]>(this.file('sessions'), []).filter((t) => t && t.expires > now())
    // Everyone is in this group; out of the box it may make boards and use the AI.
    if (!this.groups.some((g) => g.everyone)) {
      this.groups.unshift({ id: 'everyone', name: 'Everyone', description: 'Every signed-in person', permissions: ['boards.create', 'ai.use'], everyone: true })
      this.saveGroups()
    }
  }

  private file(name: string) {
    return join(this.dir, `${name}.json`)
  }

  private saveUsers() {
    writeJson(this.file('users'), this.users)
  }

  private saveGroups() {
    writeJson(this.file('groups'), this.groups)
  }

  saveBoards() {
    writeJson(this.file('boards'), this.boards)
  }

  saveSettings() {
    writeJson(this.file('settings'), this.settings)
  }

  /** Token changes (every sign-in, every sliding refresh) are written a moment later, together. */
  private saveTokens(now = false) {
    clearTimeout(this.tokenTimer)
    const write = () => writeJson(this.file('sessions'), this.tokens)
    if (now) return write()
    this.tokenTimer = setTimeout(write, 2000)
    this.tokenTimer.unref?.()
  }

  flush() {
    clearTimeout(this.tokenTimer)
    writeJson(this.file('sessions'), this.tokens)
  }

  // ----- users ----------------------------------------------------------------------------------------

  user = (userId: string | undefined) => (userId ? this.users.find((u) => u.id === userId) : undefined)
  byEmail = (email: string) => this.users.find((u) => u.email === normalEmail(email))
  bySso = (issuer: string, subject: string) => this.users.find((u) => u.sso?.issuer === issuer && u.sso.subject === subject)

  addUser(u: Omit<User, 'id' | 'created' | 'groups'> & { groups?: string[] }): User {
    const user: User = { ...u, id: id(), email: normalEmail(u.email), groups: this.knownGroups(u.groups ?? []), created: this.now() }
    this.users.push(user)
    this.saveUsers()
    return user
  }

  updateUser(userId: string, patch: Partial<Omit<User, 'id' | 'created'>>): User | undefined {
    const u = this.user(userId)
    if (!u) return undefined
    Object.assign(u, patch, patch.email ? { email: normalEmail(patch.email) } : {}, patch.groups ? { groups: this.knownGroups(patch.groups) } : {})
    for (const k of Object.keys(u) as (keyof User)[]) if (u[k] === undefined) delete u[k]
    this.saveUsers()
    return u
  }

  removeUser(userId: string) {
    this.users = this.users.filter((u) => u.id !== userId)
    this.revokeAll(userId)
    this.saveUsers()
  }

  /** Notes when someone was last here, at most once an hour (so a busy server isn't always writing). */
  seen(u: User) {
    const now = this.now()
    if (u.lastSeen && now - u.lastSeen < 3_600_000) return
    u.lastSeen = now
    this.saveUsers()
  }

  // ----- groups ---------------------------------------------------------------------------------------

  private knownGroups = (ids: string[]) => [...new Set(ids)].filter((g) => this.groups.some((x) => x.id === g && !x.everyone))

  addGroup(g: Omit<Group, 'id'>): Group {
    const group: Group = { ...cleanGroup(g), id: id() }
    this.groups.push(group)
    this.saveGroups()
    return group
  }

  updateGroup(groupId: string, patch: Partial<Omit<Group, 'id' | 'everyone'>>): Group | undefined {
    const g = this.groups.find((x) => x.id === groupId)
    if (!g) return undefined
    Object.assign(g, cleanGroup({ ...g, ...patch }), { id: g.id }, g.everyone ? { everyone: true } : {})
    this.saveGroups()
    return g
  }

  /** Removes a group, from its members and from every board that grants it something. */
  removeGroup(groupId: string): boolean {
    const g = this.groups.find((x) => x.id === groupId)
    if (!g || g.everyone) return false
    this.groups = this.groups.filter((x) => x.id !== groupId)
    for (const u of this.users) u.groups = u.groups.filter((x) => x !== groupId)
    this.saveGroups()
    this.saveUsers()
    return true
  }

  // ----- tokens: sessions, set-your-password links, API tokens --------------------------------------

  /** A new token for someone; returns the secret (shown once, never stored). */
  issue(userId: string, kind: Token['kind'], name?: string): string {
    const secret = `${kind === 'api' ? 'bct_' : ''}${randomBytes(32).toString('base64url')}`
    const now = this.now()
    const life = kind === 'session' ? SESSION_MS : kind === 'reset' ? RESET_MS : API_TOKEN_MS
    this.tokens.push({ hash: hashToken(secret), userId, kind, created: now, expires: now + life, ...(name ? { name: name.slice(0, 80) } : {}) })
    this.saveTokens(kind !== 'session')
    return secret
  }

  /** The user a token belongs to, if it's live; sessions slide forward as they're used. */
  check(secret: string | undefined, kind: Token['kind']): User | undefined {
    if (!secret || secret.length > 200) return undefined
    const hash = hashToken(secret)
    const now = this.now()
    const t = this.tokens.find((x) => x.hash === hash && x.kind === kind)
    if (!t || t.expires <= now) return undefined
    const u = this.user(t.userId)
    if (!u || u.disabled) return undefined
    if (kind === 'session' && t.expires - now < SESSION_MS - 86_400_000) {
      t.expires = now + SESSION_MS
      this.saveTokens()
    }
    if (kind === 'api' && (!t.lastUsed || now - t.lastUsed > 3_600_000)) {
      t.lastUsed = now
      this.saveTokens()
    }
    return u
  }

  /** Uses up a one-time token (a set-your-password link). */
  spend(secret: string, kind: Token['kind']): User | undefined {
    const u = this.check(secret, kind)
    if (u) this.revoke(secret)
    return u
  }

  revoke(secret: string) {
    const hash = hashToken(secret)
    this.tokens = this.tokens.filter((t) => t.hash !== hash)
    this.saveTokens(true)
  }

  /** Signs someone out everywhere (and drops their links and API tokens too, when asked). */
  revokeAll(userId: string, kinds: Token['kind'][] = ['session', 'reset', 'api']) {
    this.tokens = this.tokens.filter((t) => t.userId !== userId || !kinds.includes(t.kind))
    this.saveTokens(true)
  }

  apiTokens(userId: string) {
    return this.tokens.filter((t) => t.userId === userId && t.kind === 'api').map((t) => ({ id: t.hash.slice(0, 12), name: t.name ?? 'Token', created: t.created, lastUsed: t.lastUsed, expires: t.expires }))
  }

  revokeApiToken(userId: string, shortId: string): boolean {
    const before = this.tokens.length
    this.tokens = this.tokens.filter((t) => !(t.userId === userId && t.kind === 'api' && t.hash.slice(0, 12) === shortId))
    this.saveTokens(true)
    return this.tokens.length < before
  }
}

function cleanGroup(g: Omit<Group, 'id'>): Omit<Group, 'id'> {
  return {
    name: String(g.name ?? '').trim().slice(0, 80) || 'Untitled group',
    ...(g.description ? { description: String(g.description).slice(0, 300) } : {}),
    permissions: [...new Set((g.permissions ?? []).filter(isPermission))],
    ...(g.ssoGroups?.length ? { ssoGroups: [...new Set(g.ssoGroups.map((s) => String(s).trim()).filter(Boolean))].slice(0, 50) } : {}),
    ...(g.everyone ? { everyone: true as const } : {}),
  }
}

/** An access list as sent by the app, checked: known people and groups, real levels, no repeats. */
export function cleanGrants(raw: unknown, store: AccountStore): Grant[] | null {
  if (!Array.isArray(raw) || raw.length > 500) return null
  const out: Grant[] = []
  for (const g of raw) {
    const x = g as Partial<Grant>
    if (!x || (x.who !== 'user' && x.who !== 'group') || typeof x.id !== 'string' || !LEVELS.includes(x.level as never)) return null
    if (x.who === 'user' ? !store.user(x.id) : !store.groups.some((gr) => gr.id === x.id)) return null
    if (!out.some((o) => o.who === x.who && o.id === x.id)) out.push({ who: x.who, id: x.id, level: x.level! })
  }
  return out
}
