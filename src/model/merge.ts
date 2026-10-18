/**
 * Line-by-line three-way merge for page text: two people changed the same page from the same
 * starting point, and both keep their words. Where they changed the same lines differently, both
 * versions are kept (mine first), so nothing is lost and they can tidy it up.
 */

interface Hunk {
  /** Lines [start, end) of the base are replaced by `lines`. */
  start: number
  end: number
  lines: string[]
}

/** The changes that turn `base` into `side`, as hunks against `base`. */
function hunks(base: string[], side: string[]): Hunk[] {
  let pre = 0
  while (pre < base.length && pre < side.length && base[pre] === side[pre]) pre++
  let suf = 0
  while (suf < base.length - pre && suf < side.length - pre && base[base.length - 1 - suf] === side[side.length - 1 - suf]) suf++
  const a = base.slice(pre, base.length - suf)
  const b = side.slice(pre, side.length - suf)
  if (!a.length && !b.length) return []
  // A huge rewrite on both ends: one hunk (the merge then keeps both whole versions).
  if (a.length * b.length > 2_000_000) return [{ start: pre, end: base.length - suf, lines: b }]
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Hunk[] = []
  let cur: Hunk | null = null
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      if (cur) out.push(cur)
      cur = null
      i++
      j++
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      cur ??= { start: pre + i, end: pre + i, lines: [] }
      cur.lines.push(b[j++])
    } else {
      cur ??= { start: pre + i, end: pre + i, lines: [] }
      cur.end = pre + ++i
    }
  }
  if (cur) out.push(cur)
  return out
}

export interface DiffLine {
  t: 'same' | 'add' | 'del'
  s: string
}

/** The lines `after` adds to and removes from `before`, in reading order, for showing a change. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const b = before.split('\n')
  const out: DiffLine[] = []
  let pos = 0
  for (const h of hunks(b, after.split('\n'))) {
    for (const s of b.slice(pos, h.start)) out.push({ t: 'same', s })
    for (const s of b.slice(h.start, h.end)) out.push({ t: 'del', s })
    for (const s of h.lines) out.push({ t: 'add', s })
    pos = h.end
  }
  for (const s of b.slice(pos)) out.push({ t: 'same', s })
  return out
}

/** Counts worked out lately: history lists show the same pairs on every render. */
const counted = new Map<string, { added: number; removed: number }>()

/** How many lines a change adds and removes. */
export function diffCounts(before: string, after: string): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 }
  const key = `${before.length}:${after.length}:${before}\u0000${after}`
  const hit = counted.get(key)
  if (hit) return hit
  const out = countLines(before, after)
  counted.set(key, out)
  if (counted.size > 300) counted.delete(counted.keys().next().value!)
  return out
}

function countLines(before: string, after: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks(before.split('\n'), after.split('\n'))) {
    added += h.lines.length
    removed += h.end - h.start
  }
  return { added, removed }
}

/** One side's version of base lines [start, end), applying its hunks there. */
function region(base: string[], side: Hunk[], start: number, end: number): string[] {
  const out: string[] = []
  let pos = start
  for (const h of side) {
    out.push(...base.slice(pos, h.start), ...h.lines)
    pos = h.end
  }
  out.push(...base.slice(pos, end))
  return out
}

/** `base` changed into `mine` here and into `theirs` elsewhere: both sets of changes. */
export function merge3(base: string, mine: string, theirs: string): string {
  if (mine === theirs || theirs === base) return mine
  if (mine === base) return theirs
  const b = base.split('\n')
  const all = [...hunks(b, mine.split('\n')).map((h) => ({ ...h, who: 'mine' as const })), ...hunks(b, theirs.split('\n')).map((h) => ({ ...h, who: 'theirs' as const }))].sort(
    (x, y) => x.start - y.start || x.end - y.end,
  )
  const out: string[] = []
  let pos = 0
  let k = 0
  while (k < all.length) {
    const group = [all[k]]
    let start = all[k].start
    let end = all[k].end
    k++
    // Changes that touch the same lines (or insert at the same place) are settled together.
    while (k < all.length && (all[k].start < end || (all[k].start === start && start === end) || (all[k].start === end && all[k].end === end && end === start))) {
      group.push(all[k])
      end = Math.max(end, all[k].end)
      start = Math.min(start, all[k].start)
      k++
    }
    out.push(...b.slice(pos, start))
    const mineHunks = group.filter((h) => h.who === 'mine')
    const theirHunks = group.filter((h) => h.who === 'theirs')
    const a = region(b, mineHunks, start, end)
    const t = region(b, theirHunks, start, end)
    if (!theirHunks.length) out.push(...a)
    else if (!mineHunks.length) out.push(...t)
    else if (a.join('\n') === t.join('\n')) out.push(...a)
    else out.push(...a, ...t)
    pos = end
  }
  out.push(...b.slice(pos))
  return out.join('\n')
}
