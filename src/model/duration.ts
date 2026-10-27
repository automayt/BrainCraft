/** Durations as people type and read them. Pure functions. */

/**
 * Minutes from what people type: "90", "90m", "1h 30m", "1.5h", "1:30", "2 hours", "45 min".
 * A bare number is minutes. Null when it isn't a duration.
 */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/,/g, '.')
  if (!t) return null
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(t)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t) > 0 ? Number(t) : null
  let total = 0
  let any = false
  const rest = t.replace(/(\d+(?:\.\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)\b/g, (_, n: string, u: string) => {
    any = true
    total += Number(n) * (u.startsWith('d') ? 1440 : u.startsWith('h') ? 60 : 1)
    return ' '
  })
  if (!any || rest.replace(/\band\b/g, '').trim()) return null
  return total > 0 ? Math.round(total * 100) / 100 : null
}

/** "1h 30m", "45m", "0m" (minutes are rounded down; under a minute is "<1m" unless exact). */
export function formatDuration(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (ms > 0 && m === 0) return '<1m'
  const h = Math.floor(m / 60)
  return h ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`
}

/** A running clock: "4:05" or "1:02:03". */
export function formatClock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/** Hours as a number with two decimals, as timesheets and spreadsheets take them. */
export const hours = (ms: number) => Math.round((ms / 3_600_000) * 100) / 100

