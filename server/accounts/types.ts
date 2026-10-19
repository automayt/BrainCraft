/**
 * Accounts on a BrainCraft server (BRAINCRAFT_ACCOUNTS=1): people sign in, admins manage them,
 * groups carry permissions, and each board has an owner and a list of who may view, edit or manage
 * it. Without accounts, a server shares boards by secret link as before.
 */

/** What a group lets its members do. Admins can do everything. */
export type Permission = 'boards.create' | 'boards.share' | 'ai.use' | 'people.see'

export const PERMISSIONS: { id: Permission; label: string; hint: string }[] = [
  { id: 'boards.create', label: 'Make boards', hint: 'Start new boards and wikis on the server' },
  { id: 'boards.share', label: 'Share boards', hint: 'Give other people and groups access to boards they manage' },
  { id: 'ai.use', label: 'Use the AI assistant', hint: 'Through this server’s AI' },
  { id: 'people.see', label: 'See everyone', hint: 'Find people and groups by name when sharing (otherwise type an exact email)' },
]

export const isPermission = (v: unknown): v is Permission => PERMISSIONS.some((p) => p.id === v)

export type AccountRole = 'admin' | 'user'

export interface User {
  id: string
  /** Lower case; how people are found and how sign-in methods are linked. */
  email: string
  name: string
  role: AccountRole
  /** Groups an admin put them in (besides Everyone and any their sign-in provider says). */
  groups: string[]
  /** `scrypt$<salt>$<hash>`, when they sign in with a password. */
  password?: string
  /** Who their single sign-on provider says they are. */
  sso?: { issuer: string; subject: string }
  /** The provider's group names at their last sign-in, matched against groups' `ssoGroups`. */
  ssoGroups?: string[]
  disabled?: boolean
  created: number
  lastSeen?: number
}

export interface Group {
  id: string
  name: string
  description?: string
  permissions: Permission[]
  /** Group names from the sign-in provider that put people in this group automatically. */
  ssoGroups?: string[]
  /** The group every signed-in person is in. */
  everyone?: true
}

/** How much someone may do with a board. */
export type Level = 'view' | 'edit' | 'manage'

export const LEVELS: Level[] = ['view', 'edit', 'manage']

export interface Grant {
  who: 'user' | 'group'
  id: string
  level: Level
}

/** Who a board belongs to and who else may open it (kept with the board on the server). */
export interface BoardAccess {
  owner?: string
  access?: Grant[]
}

/** A user as the app sees them (never the password). */
export interface PublicUser {
  id: string
  email: string
  name: string
  role: AccountRole
  groups: string[]
  sso: boolean
  password: boolean
  disabled?: boolean
  created: number
  lastSeen?: number
}

export const publicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  groups: u.groups,
  sso: !!u.sso,
  password: !!u.password,
  ...(u.disabled ? { disabled: true } : {}),
  created: u.created,
  ...(u.lastSeen ? { lastSeen: u.lastSeen } : {}),
})
