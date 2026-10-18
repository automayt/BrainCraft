/**
 * Macros in wiki pages: `{{name options}}` on a line of its own (a block, like a page tree or a
 * list of open tasks), around some lines (`{{expand Title}}` … `{{/expand}}`), or inside a sentence
 * (`{{status Done}}`, `{{countdown 2026-12-20}}`). Options are words, "quoted words" or key=value.
 * A name BrainCraft doesn't know shows as itself, marked, so a typo is easy to spot.
 */

export interface MacroArgs {
  /** Words and "quoted words", in order. */
  pos: string[]
  /** key=value and key="quoted value". */
  named: Record<string, string>
}

export type MacroKind = 'block' | 'container' | 'inline'

export interface MacroInfo {
  name: string
  kind: MacroKind
  /** For the / menu and Help. */
  label: string
  hint: string
  /** What the / menu puts in the page; the caret goes to `caret` (its end when missing). */
  insert: string
  caret?: number
}

export const MACROS: readonly MacroInfo[] = [
  { name: 'children', kind: 'block', label: 'Sub-page list', hint: '{{children}}: the pages under this one', insert: '{{children}}\n' },
  { name: 'toc', kind: 'block', label: 'Contents', hint: '{{toc}}: this page’s headings', insert: '{{toc}}\n' },
  { name: 'pagetree', kind: 'block', label: 'Page tree', hint: '{{pagetree}}: every page (or {{pagetree here}}: those under this one)', insert: '{{pagetree}}\n' },
  { name: 'tasks', kind: 'block', label: 'Open tasks', hint: '{{tasks}}: unticked checklist items from every page ({{tasks here}}: this page and under)', insert: '{{tasks}}\n' },
  { name: 'recent', kind: 'block', label: 'Recent changes', hint: '{{recent 5}}: the latest saved versions across the wiki', insert: '{{recent 5}}\n' },
  { name: 'include', kind: 'block', label: 'Show another page', hint: '{{include "Page title"}}: that page’s words, here', insert: '{{include ""}}\n', caret: 11 },
  { name: 'expand', kind: 'container', label: 'Expandable section', hint: '{{expand Title}} … {{/expand}}: hidden until opened', insert: '{{expand Details}}\n\n{{/expand}}\n', caret: 19 },
  { name: 'columns', kind: 'container', label: 'Columns', hint: '{{columns}} … {{column}} … {{/columns}}: side by side', insert: '{{columns}}\nLeft\n{{column}}\nRight\n{{/columns}}\n', caret: 12 },
  { name: 'status', kind: 'inline', label: 'Status label', hint: '{{status Done green}}: a coloured label in a sentence', insert: '{{status To do}}', caret: 9 },
  { name: 'countdown', kind: 'inline', label: 'Countdown', hint: '{{countdown 2026-12-20}}: “63 days to go”', insert: '{{countdown YYYY-MM-DD}}', caret: 12 },
  { name: 'today', kind: 'inline', label: 'Today’s date', hint: '{{today}}: the date, whenever the page is read', insert: '{{today}}' },
]

const BY_NAME = new Map(MACROS.map((m) => [m.name, m]))
export const macroInfo = (name: string) => BY_NAME.get(name.toLowerCase())

/** Reads a macro's options: words, "quoted words" and key=value pairs. */
export function parseArgs(s: string | undefined): MacroArgs {
  const out: MacroArgs = { pos: [], named: {} }
  if (!s) return out
  const re = /([a-zA-Z][\w-]*)=(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g
  for (const m of s.matchAll(re)) {
    if (m[1]) out.named[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
    else out.pos.push(m[4] ?? m[5] ?? '')
  }
  return out
}

/** The words of a macro's options, joined (a title, a page name, a label). */
export const argText = (a: MacroArgs) => a.pos.join(' ').trim()

/** A plain date (2026-12-20) in the reader's time zone, or null. */
export function parseDay(s: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s?.trim() ?? '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getMonth() === Number(m[2]) - 1 ? d : null
}

/** "63 days to go", "Tomorrow", "Today", "3 days ago". */
export function countdown(day: Date, today = new Date()): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((day.getTime() - start.getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `${days} days to go` : `${-days} days ago`
}

export const STATUS_COLORS = ['grey', 'blue', 'green', 'yellow', 'red', 'purple'] as const
export type StatusColor = (typeof STATUS_COLORS)[number]

/** A status label's colour: the one asked for, or one that suits the words. */
export function statusLook(a: MacroArgs): { label: string; color: StatusColor } {
  const words = [...a.pos]
  let color = (a.named.color ?? a.named.colour)?.toLowerCase() as StatusColor | undefined
  if (!color && words.length > 1 && STATUS_COLORS.includes(words.at(-1)!.toLowerCase() as StatusColor)) color = words.pop()!.toLowerCase() as StatusColor
  const label = words.join(' ').trim() || 'Status'
  if (!color || !STATUS_COLORS.includes(color)) {
    const l = label.toLowerCase()
    color = /done|finished|booked|paid|yes|ready|complete/.test(l)
      ? 'green'
      : /doing|progress|started|working/.test(l)
        ? 'blue'
        : /blocked|stuck|no\b|cancel|late|overdue/.test(l)
          ? 'red'
          : /wait|maybe|pending|hold|later/.test(l)
            ? 'yellow'
            : 'grey'
  }
  return { label, color }
}
