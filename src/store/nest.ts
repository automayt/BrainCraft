/**
 * Boards in a list with child boards right after the board they came from (and theirs after them),
 * each with how deep it is. A child whose parent isn't in the list stands on its own.
 */
export function nested<T>(list: readonly T[], keysOf: (t: T) => string[], parentOf: (t: T) => string | undefined): { item: T; depth: number }[] {
  const byKey = new Map<string, T>()
  for (const t of list) for (const k of keysOf(t)) byKey.set(k, t)
  const children = new Map<T, T[]>()
  const roots: T[] = []
  for (const t of list) {
    const p = parentOf(t)
    const up = p === undefined ? undefined : byKey.get(p)
    if (up === undefined || up === t) roots.push(t)
    else children.set(up, [...(children.get(up) ?? []), t])
  }
  const out: { item: T; depth: number }[] = []
  const seen = new Set<T>()
  const walk = (t: T, depth: number) => {
    if (seen.has(t)) return
    seen.add(t)
    out.push({ item: t, depth })
    for (const c of children.get(t) ?? []) walk(c, depth + 1)
  }
  for (const t of roots) walk(t, 0)
  // Boards in a loop of parents (never made so, but data can say anything): still listed.
  for (const t of list) walk(t, 0)
  return out
}
