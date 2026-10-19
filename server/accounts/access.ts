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
