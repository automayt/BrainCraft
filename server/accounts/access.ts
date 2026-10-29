/** Who may do what: the rules, as plain functions. */

import type { Role } from '../../src/collab/protocol'
import { type BoardAccess, type Group, type Level, PERMISSIONS, type Permission, type User } from './types'

const RANK: Record<Level, number> = { view: 1, edit: 2, manage: 3 }

export const atLeast = (have: Level | null, need: Level) => !!have && RANK[have] >= RANK[need]

/** The groups someone is in: Everyone, the ones an admin chose, and the ones their sign-in provider maps to. */
export function groupsOf(user: User, groups: readonly Group[]): Group[] {
  const sso = new Set((user.ssoGroups ?? []).map((g) => g.toLowerCase()))
  return groups.filter((g) => g.everyone || user.groups.includes(g.id) || (g.ssoGroups ?? []).some((s) => sso.has(s.toLowerCase())))
}

/** The groups someone is a group admin of (never Everyone; none while their account is off). */
export function groupsAdminOf(user: User | null, groups: readonly Group[]): Group[] {
  if (!user || user.disabled) return []
  return groups.filter((g) => !g.everyone && g.admins?.includes(user.id))
}

/**
 * Whether a group admin looks after `person` wholly: someone else (not an admin, not a group admin
 * themselves) who is only in groups they run. Only then may they turn the account off or make
 * a set-your-password link for it, so nobody on another team can be taken over that way.
 */
export function looksAfter(admin: User, person: User, groups: readonly Group[]): boolean {
  if (person.id === admin.id || person.role === 'admin') return false
  const mine = new Set(groupsAdminOf(admin, groups).map((g) => g.id))
  const theirs = groupsOf(person, groups).filter((g) => !g.everyone)
  if (!theirs.length || !theirs.every((g) => mine.has(g.id))) return false
  // Another group admin (even of the same group) is looked after by an admin.
  return !groups.some((g) => g.admins?.includes(person.id))
}

/** What someone may do: everything for an admin, nothing when disabled, else their groups' permissions together. */
export function permissionsOf(user: User | null, groups: readonly Group[]): Set<Permission> {
  if (!user || user.disabled) return new Set()
  if (user.role === 'admin') return new Set(PERMISSIONS.map((p) => p.id))
  return new Set(groupsOf(user, groups).flatMap((g) => g.permissions))
}

export const can = (user: User | null, groups: readonly Group[], p: Permission) => permissionsOf(user, groups).has(p)

/**
 * How much someone may do with a board: admins and the owner manage it; otherwise the best of what
 * it grants them and their groups. A board without an owner (made before accounts) is for admins only.
 */
export function levelFor(user: User | null, groups: readonly Group[], board: BoardAccess): Level | null {
  if (!user || user.disabled) return null
  if (user.role === 'admin' || (board.owner && board.owner === user.id)) return 'manage'
  if (!board.owner) return null
  const mine = new Set(groupsOf(user, groups).map((g) => g.id))
  let best: Level | null = null
  for (const g of board.access ?? []) {
    const applies = g.who === 'user' ? g.id === user.id : mine.has(g.id)
    if (applies && (!best || RANK[g.level] > RANK[best])) best = g.level
  }
  return best
}

/** The live-session role a level gives. */
export const roleOf = (level: Level | null): Role | null => (level === 'view' ? 'view' : level ? 'edit' : null)
