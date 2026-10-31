/**
 * Time tracking on screen: the clock in the top bar (my timer, and starting one), the timesheet
 * (every entry, totals by person, by what it was on and by day; logging and fixing time), the
 * badges on objects (who it's assigned to, time spent against its estimate, who's timing it now),
 * and the selection toolbar's Assign and Time menus.
 */

import { type FormEvent, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '../editor/Editor'
import { getItem } from '../model/board'
import * as D from '../model/dataset'
import { rootOf as mapRoot } from '../model/outlineSync'
import { objectLabel } from '../model/notes'
import { canHaveStatus } from '../model/status'
import * as TT from '../model/timeTracking'
import type { Board, TimeEntry, TimeTarget } from '../model/types'
import { isWiki, pageOrder } from '../model/wiki'
import { Dialog } from './Boards'
import { copyText } from './copyText'
import { type MenuOpener, useButtonMenu } from './menuKeys'
import { useClickAway } from './useClickAway'
import { useEditor } from './useEditor'
import { useEscape } from './useEscape'
import { WorkspaceContext } from './useWorkspace'

const MIN = 60_000
const HOUR = 3_600_000

/** Re-renders every `ms` while `on`, for running clocks. */
function useTick(on: boolean, ms = 1000) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [on, ms])
}

/** A colour for a person, the same everywhere they appear. */
export function personColor(name: string) {
  let h = 0
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 55% 45%)`
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

/** Everyone to pick from: people who can open the board (with accounts), people here, names on it, and me. */
function usePeople(): TT.Person[] {
  const editor = useEditor()
  const ws = useContext(WorkspaceContext)
  useEffect(() => void ws?.loadBoardPeople(), [ws])
  const me = editor.person
  const out = new Map<string, TT.Person>()
  const add = (p: TT.Person) => {
    const k = p.name.trim().toLowerCase()
    if (k && !out.has(k)) out.set(k, p)
  }
  add(me)
  for (const p of ws?.peopleToMention ?? []) add({ name: p.name, ...(p.id ? { user: p.id } : {}) })
  for (const n of TT.peopleOn(editor.board)) add({ name: n })
  return [...out.values()]
}

// ----- times as inputs show them ---------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')
const toLocalInput = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (s: string) => (s ? new Date(s).getTime() : NaN)
const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const dayWords = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** Where a target is, as a short line: "Sticky note: Design the logo". */
function targetWords(b: Board, on: TimeTarget | undefined, saved?: string) {
  const t = TT.describeTarget(b, on, saved)
  return `${t.label}${t.gone ? ' (deleted)' : ''}`
}

/** The same, inside a sentence ("Start a timer on the board"). */
const inSentence = (b: Board, on: TimeTarget | undefined) => (on ? targetWords(b, on) : targetWords(b, on).toLowerCase())

/** Goes to what time was spent on: the object, the record's page or the wiki page. */
function goTo(editor: Editor, on: TimeTarget | undefined) {
  if (!on) return
  if ('item' in on) {
    if (getItem(editor.board, on.item)) {
      editor.select([on.item])
      editor.focusObject(on.item)
    }
  } else if ('page' in on) editor.openPage(on.page)
  else {
    const view = editor.board.items.find((i) => i.view?.dataset === on.dataset)
    if (view) {
      editor.select([view.id])
      editor.focusObject(view.id)
    }
  }
}

/** Everything time can go on, for the "On" pickers: the board, objects, records and pages. */
function targetsOf(b: Board): { group: string; options: { key: string; on?: TimeTarget; label: string }[] }[] {
  const objects = b.items
    .filter((i) => canHaveStatus(i.kind) && !i.hiddenBy && (i.text.trim() || i.assignees || i.estimate))
    .slice(0, 300)
    .map((i) => ({ key: `i:${i.id}`, on: { item: i.id } as TimeTarget, label: objectLabel(i) }))
  const records = (b.datasets ?? []).flatMap((ds) =>
    ds.records.slice(0, 300).map((r) => ({ key: `r:${ds.id}:${r.id}`, on: { dataset: ds.id, record: r.id } as TimeTarget, label: `${D.recordTitle(ds, r)} (${ds.name})` })),
  )
  const pages = isWiki(b) ? pageOrder(b).map((p) => ({ key: `p:${p.id}`, on: { page: p.id } as TimeTarget, label: p.title || 'Untitled' })) : []
  return [
    { group: '', options: [{ key: 'board', label: isWiki(b) ? 'The wiki as a whole' : 'The board as a whole' }] },
    ...(pages.length ? [{ group: 'Pages', options: pages }] : []),
    ...(objects.length ? [{ group: 'Objects', options: objects }] : []),
    ...(records.length ? [{ group: 'Records', options: records }] : []),
  ]
}

/** Picks what time is on; as a filter (`filter`), its first choice is everything rather than the board. */
function TargetSelect({ value, onChange, label = 'On', filter = false }: { value: TimeTarget | undefined; onChange: (on: TimeTarget | undefined) => void; label?: string; filter?: boolean }) {
  const editor = useEditor()
  const groups = useMemo(() => {
    const g = targetsOf(editor.board)
    return filter ? [{ group: '', options: [{ key: 'board', label: 'Everything' }] }, ...g.slice(1)] : g
  }, [editor.board, filter])
  const key = TT.targetKey(value)
  const all = groups.flatMap((g) => g.options)
  return (
    <select
      aria-label={label}
      value={key}
      onChange={(e) => {
        const o = all.find((x) => x.key === e.target.value)
        onChange(o?.on)
      }}
    >
      {/* Something deleted since keeps its name here. */}
      {!all.some((o) => o.key === key) && <option value={key}>{targetWords(editor.board, value)}</option>}
      {groups.map((g) =>
        g.group ? (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          g.options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))
        ),
      )}
    </select>
  )
}

function PersonSelect({ value, onChange, people, label = 'Who' }: { value: TT.Person; onChange: (p: TT.Person) => void; people: TT.Person[]; label?: string }) {
  const [other, setOther] = useState(false)
  const known = people.some((p) => p.name.toLowerCase() === value.name.toLowerCase())
  if (other || !known)
    return (
      <input
        aria-label={label}
        value={value.name}
        maxLength={60}
        placeholder="Their name"
        autoFocus={other}
        onChange={(e) => onChange({ name: e.target.value })}
        onBlur={() => !value.name.trim() && setOther(false)}
      />
    )
  return (
    <select
      aria-label={label}
      value={value.name.toLowerCase()}
      onChange={(e) => {
        if (e.target.value === '\u0000other') return setOther(true)
        const p = people.find((x) => x.name.toLowerCase() === e.target.value)
        if (p) onChange(p)
      }}
    >
      {people.map((p) => (
        <option key={p.name.toLowerCase()} value={p.name.toLowerCase()}>
          {p.name}
        </option>
      ))}
      <option value={'\u0000other'}>Someone else…</option>
    </select>
  )
}

// ----- the clock in the top bar -----------------------------------------------------------------

/** My running timer (or a way to start one), and the timesheet, from the top bar. */
export function TimeChip() {
  const editor = useEditor()
  const mine = editor.myTimer
  const [open, setOpen] = useState(false)
  useTick(!!mine)
  const ref = useRef<HTMLDivElement>(null)
  useClickAway(ref, () => setOpen(false), () => ref.current?.previousElementSibling, open)
  useEscape(() => setOpen(false), open)
  const now = Date.now()
  const ms = mine ? TT.durationOf(mine, now) : 0
  const long = ms > TT.LONG_RUN
  const what = mine ? targetWords(editor.board, mine.on, mine.label) : ''
  return (
    <div className="anchor">
      <button
        className={`icon-btn has-tip time-chip${mine ? ' running' : ''}${long ? ' long' : ''}`}
        aria-label={mine ? `Timer running: ${TT.formatClock(ms)} on ${what}` : 'Time tracking'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 9v4l2.5 2.5M9 2h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {mine && <span className="time-chip-clock">{TT.formatClock(ms)}</span>}
        {!open && <span className="tip">{mine ? `Timing ${what}` : 'Time tracking'} <kbd>Alt T</kbd></span>}
      </button>
      {open && (
        <div ref={ref} className="popover time-pop" role="dialog" aria-label="Time tracking">
          <TimePopover onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

function TimePopover({ onDone }: { onDone: () => void }) {
  const editor = useEditor()
  const mine = editor.myTimer
  const now = Date.now()
  const target = editor.timeTarget
  const [note, setNote] = useState(mine?.note ?? '')
  const [endAt, setEndAt] = useState<string | null>(null)
  const others = TT.running(editor.board).filter((e) => e !== mine)
  const ms = mine ? TT.durationOf(mine, now) : 0
  const saveNote = () => mine && note !== (mine.note ?? '') && editor.updateTime(mine.id, { note })
  return (
    <div className="time-pop-body">
      {mine ? (
        <>
          <p>
            Timing <button className="link" onClick={() => goTo(editor, mine.on)}>{targetWords(editor.board, mine.on, mine.label)}</button> since {clock(mine.start)}
            {now - mine.start > 20 * HOUR ? ` on ${dayWords(mine.start)}` : ''}.
          </p>
          {ms > TT.LONG_RUN && <p className="time-warn">It’s been running {TT.formatDuration(ms)}. If you stopped working earlier, stop it at that time.</p>}
          <input aria-label="What you’re doing" placeholder="What you’re doing (optional)" value={note} maxLength={TT.NOTE_MAX} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} onKeyDown={(e) => e.key === 'Enter' && saveNote()} />
          <div className="time-pop-actions">
            <button
              className="primary"
              disabled={editor.readOnly}
              onClick={() => {
                saveNote()
                editor.stopTracking()
                onDone()
              }}
            >
              Stop
            </button>
            {endAt === null ? (
              <button onClick={() => setEndAt(toLocalInput(Math.min(now, mine.start + HOUR)))}>Stop at an earlier time…</button>
            ) : (
              <span className="time-endat">
                <input type="datetime-local" aria-label="Stopped working at" value={endAt} min={toLocalInput(mine.start)} max={toLocalInput(now)} onChange={(e) => setEndAt(e.target.value)} />
                <button
                  onClick={() => {
                    const end = fromLocalInput(endAt)
                    if (!Number.isFinite(end) || end <= mine.start) return editor.setStatus('Pick a time after it started')
                    saveNote()
                    editor.stopTracking(Math.min(end, now))
                    onDone()
                  }}
                >
                  Stop then
                </button>
              </span>
            )}
          </div>
          {!TT.sameTarget(mine.on, target) && !editor.readOnly && (
            <button className="link" onClick={() => editor.startTracking(target)}>
              Switch to {inSentence(editor.board, target)}
            </button>
          )}
        </>
      ) : editor.readOnly ? (
        <p className="muted">This board is view-only: you can see the time here, not track it.</p>
      ) : (
        <>
          <p className="muted">Track the time you spend on {target ? 'what’s selected' : isWiki(editor.board) ? 'the wiki' : 'the board'}. It keeps running if you close the tab.</p>
          <button
            className="primary"
            onClick={() => {
              editor.startTracking(target)
              onDone()
            }}
          >
            Start a timer on {inSentence(editor.board, target)}
          </button>
        </>
      )}
      {others.length > 0 && (
        <ul className="time-others">
          {others.slice(0, 6).map((e) => (
            <li key={e.id}>
              <span className="time-dot" aria-hidden="true" /> {e.who}: {targetWords(editor.board, e.on, e.label)}, {TT.formatDuration(TT.durationOf(e, now))}
            </li>
          ))}
        </ul>
      )}
      <div className="time-pop-foot">
        {!editor.readOnly && (
          <button
            className="link"
            onClick={() => {
              editor.openTimesheet({ on: target, log: true })
              onDone()
            }}
          >
            Log time by hand…
          </button>
        )}
        <button
          className="link"
          onClick={() => {
            editor.openTimesheet({})
            onDone()
          }}
        >
          Timesheet
        </button>
      </div>
    </div>
  )
}

// ----- the timesheet ---------------------------------------------------------------------------

type Span = 'today' | 'week' | 'lastweek' | 'month' | 'all'
const SPANS: [Span, string][] = [
  ['today', 'Today'],
  ['week', 'This week'],
  ['lastweek', 'Last week'],
  ['month', 'This month'],
  ['all', 'All time'],
]

function spanOf(s: Span, now: number): { from?: number; to?: number } {
  const d = new Date(now)
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  // Weeks start on Monday.
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime()
  switch (s) {
    case 'today':
      return { from: today }
    case 'week':
      return { from: monday }
    case 'lastweek':
      return { from: new Date(monday).setDate(new Date(monday).getDate() - 7), to: monday }
    case 'month':
      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime() }
    case 'all':
      return {}
  }
}

export function TimesheetDialog() {
  const editor = useEditor()
  const open = editor.timesheet
  const people = usePeople()
  const [span, setSpan] = useState<Span>('week')
  const [who, setWho] = useState<string>('')
  const [on, setOn] = useState<TimeTarget | undefined>(open?.on)
  const [tab, setTab] = useState<'entries' | 'targets' | 'days'>('entries')
  const [logging, setLogging] = useState(!!open?.log)
  const anyRunning = TT.running(editor.board).length > 0
  useTick(anyRunning, 15_000)
  const now = Date.now()
  const whoPerson = who ? (people.find((p) => p.name.toLowerCase() === who) ?? { name: who }) : undefined
  const sum = TT.summarize(editor.board, { ...spanOf(span, now), ...(whoPerson ? { who: whoPerson } : {}), ...(on ? { on } : {}) }, now)
  const overlaps = useMemo(() => TT.overlapping(editor.board, now), [editor.board])
  const everyone = useMemo(() => [...new Map((editor.board.time ?? []).map((e) => [e.who.toLowerCase(), e.who])).values()].sort(), [editor.board])
  const close = () => editor.openTimesheet(null)
  const title = on ? `Time on ${targetWords(editor.board, on)}` : 'Timesheet'
  const ws = useContext(WorkspaceContext)

  const save = (text: string, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
    a.download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const csv = () => save(TT.timeCsv(editor.board, sum), `${editor.board.title || 'board'} time`)
  /** With accounts: my time on every board I can open, in the same span. */
  const everywhere = async () => {
    const { from, to } = spanOf(span, now)
    const q = new URLSearchParams({ format: 'csv', ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(to).toISOString() } : {}) })
    try {
      const r = await fetch(new URL(`api/time?${q}`, ws!.server!.endsWith('/') ? ws!.server! : `${ws!.server}/`), { credentials: 'include', headers: { 'x-braincraft': '1' } })
      if (!r.ok) throw new Error(`The server said ${r.status}`)
      save(await r.text(), `My time, ${SPANS.find(([s]) => s === span)![1].toLowerCase()}`)
    } catch (err) {
      editor.setStatus(`Couldn’t get your time: ${(err as Error).message}`)
    }
  }
  const markdown = () => {
    const rows = sum.byTarget.map((t) => `| ${t.label.replace(/\|/g, '\\|')} | ${TT.formatDuration(t.ms)} |`)
    const text = [`**${title}** (${SPANS.find(([s]) => s === span)![1].toLowerCase()}): ${TT.formatDuration(sum.total)}`, '', '| On | Time |', '| --- | --- |', ...rows, ''].join('\n')
    void copyText(text).then(() => editor.setStatus('Copied the totals as a Markdown table'))
  }

  return (
    <Dialog label={title} onClose={close} className="timesheet">
      <header>
        <h2>{title}</h2>
        <button className="icon-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </header>
      <div className="timesheet-body">
        <div className="timesheet-filters">
          <div className="usage-span" role="radiogroup" aria-label="When">
            {SPANS.map(([s, label]) => (
              <button key={s} role="radio" aria-checked={span === s} className={span === s ? 'on' : ''} onClick={() => setSpan(s)}>
                {label}
              </button>
            ))}
          </div>
          <select aria-label="Whose time" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {everyone.map((n) => (
              <option key={n} value={n.toLowerCase()}>
                {n}
              </option>
            ))}
          </select>
          <TargetSelect value={on} onChange={setOn} label="On what" filter />
          <span className="spacer" />
          {!editor.readOnly && (
            <button className={logging ? 'on' : ''} onClick={() => setLogging((l) => !l)} aria-expanded={logging}>
              Log time
            </button>
          )}
        </div>
        {logging && <LogForm people={people} initialOn={on ?? open?.on} onDone={() => setLogging(false)} />}
        <div className="timesheet-summary">
          <div className="timesheet-total">
            <strong>{TT.formatDuration(sum.total)}</strong>
            <span className="muted">{sum.entries.length === 1 ? '1 entry' : `${sum.entries.length} entries`}</span>
          </div>
          <ul className="timesheet-people">
            {sum.byPerson.map((p) => (
              <li key={p.who}>
                <span className="time-avatar" style={{ background: personColor(p.who) }} aria-hidden="true">
                  {initials(p.who)}
                </span>
                {p.who}
                <span className="usage-meter" aria-hidden="true">
                  <span style={{ width: `${sum.total ? (100 * p.ms) / sum.total : 0}%` }} />
                </span>
                <span className="usage-num">{TT.formatDuration(p.ms)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="admin-tabs timesheet-tabs" role="tablist">
          {(
            [
              ['entries', 'Entries'],
              ['targets', 'By what it was on'],
              ['days', 'By day'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
          <span className="spacer" />
          <button className="link" onClick={csv} disabled={!sum.entries.length}>
            Download CSV
          </button>
          <button className="link" onClick={markdown} disabled={!sum.entries.length}>
            Copy totals
          </button>
          {ws?.account?.user && ws.server && (
            <button className="link" title="Your time on every board you can open, in this span" onClick={() => void everywhere()}>
              My time on all boards (CSV)
            </button>
          )}
        </div>
        {!sum.entries.length ? (
          <p className="muted timesheet-empty">
            No time {span === 'all' ? 'yet' : 'in this span'}
            {whoPerson ? ` for ${whoPerson.name}` : ''}. Select something and press <kbd>Alt T</kbd> to start a timer on it, or log time by hand.
          </p>
        ) : tab === 'entries' ? (
          <ul className="timesheet-entries">
            {sum.entries.map(({ entry }) => (
              <EntryRow key={entry.id} e={entry} people={people} overlap={overlaps.has(entry.id)} now={now} />
            ))}
          </ul>
        ) : tab === 'targets' ? (
          <table className="admin-table usage-table">
            <thead>
              <tr>
                <th scope="col">On</th>
                <th scope="col">Assigned</th>
                <th scope="col" className="usage-num">
                  Time
                </th>
                <th scope="col">Against the estimate</th>
              </tr>
            </thead>
            <tbody>
              {sum.byTarget.map((t) => {
                const it = t.on && 'item' in t.on ? getItem(editor.board, t.on.item) : undefined
                const est = it?.estimate ? it.estimate * MIN : 0
                return (
                  <tr key={t.key}>
                    <td>
                      {t.on && !t.gone ? (
                        <button className="link" onClick={() => goTo(editor, t.on)}>
                          {t.label}
                        </button>
                      ) : (
                        `${t.label}${t.gone ? ' (deleted)' : ''}`
                      )}
                    </td>
                    <td className="muted">{it?.assignees?.join(', ')}</td>
                    <td className="usage-num">{TT.formatDuration(t.ms)}</td>
                    <td>{est ? <EstimateMeter spent={TT.summarize(editor.board, { on: t.on }, now).total} estimate={est} /> : <span className="muted">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <ul className="timesheet-days">
            {sum.byDay
              .slice()
              .reverse()
              .map((d) => (
                <li key={d.day}>
                  <span>{dayWords(new Date(`${d.day}T12:00`).getTime())}</span>
                  <span className="usage-meter wide" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, (100 * d.ms) / Math.max(...sum.byDay.map((x) => x.ms)))}%` }} />
                  </span>
                  <span className="usage-num">{TT.formatDuration(d.ms)}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}

function EstimateMeter({ spent, estimate }: { spent: number; estimate: number }) {
  const over = spent > estimate
  return (
    <span className={`time-estimate${over ? ' over' : ''}`}>
      <span className="usage-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (100 * spent) / estimate)}%` }} />
      </span>
      {TT.formatDuration(spent)} of {TT.formatDuration(estimate)}
      {over && ` (${TT.formatDuration(spent - estimate)} over)`}
    </span>
  )
}

/** Logging time by hand: whose, on what, how long and when it ended, and a note. */
function LogForm({ people, initialOn, onDone }: { people: TT.Person[]; initialOn?: TimeTarget; onDone: () => void }) {
  const editor = useEditor()
  const [who, setWho] = useState<TT.Person>(editor.person)
  const [on, setOn] = useState<TimeTarget | undefined>(initialOn)
  const [length, setLength] = useState('')
  const [end, setEnd] = useState(toLocalInput(Date.now()))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const minutes = TT.parseDuration(length)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!who.name.trim()) return setError('Whose time is it?')
    if (minutes === null) return setError('How long? For example 45m, 1h 30m or 1.5h')
    const endAt = fromLocalInput(end)
    if (!Number.isFinite(endAt)) return setError('When did it end?')
    const problem = editor.logTime({ who, on, start: endAt - minutes * MIN, end: endAt, note })
    if (problem) return setError(problem)
    setLength('')
    setNote('')
    setError(null)
    onDone()
  }
  return (
    <form className="timesheet-log" onSubmit={submit}>
      <label>
        Who
        <PersonSelect value={who} onChange={setWho} people={people} />
      </label>
      <label>
        On
        <TargetSelect value={on} onChange={setOn} />
      </label>
      <label>
        How long
        <input value={length} placeholder="1h 30m" autoFocus onChange={(e) => setLength(e.target.value)} aria-describedby="log-length" />
        <small id="log-length" className="muted">
          {minutes !== null ? TT.formatDuration(minutes * MIN) : '45m, 1h 30m, 1.5h or 1:30'}
        </small>
      </label>
      <label>
        Ending
        <input type="datetime-local" value={end} max={toLocalInput(Date.now() + 24 * HOUR)} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <label className="timesheet-log-note">
        Note
        <input value={note} maxLength={TT.NOTE_MAX} placeholder="What it was (optional)" onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="timesheet-log-actions">
        <button type="submit" className="primary">
          Log {minutes !== null ? TT.formatDuration(minutes * MIN) : 'time'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function EntryRow({ e, people, overlap, now }: { e: TimeEntry; people: TT.Person[]; overlap: boolean; now: number }) {
  const editor = useEditor()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ who: { name: e.who, ...(e.user ? { user: e.user } : {}) } as TT.Person, on: e.on, start: toLocalInput(e.start), end: e.end ? toLocalInput(e.end) : '', note: e.note ?? '' })
  const [error, setError] = useState<string | null>(null)
  const ms = TT.durationOf(e, now)
  const runningNow = e.end === undefined
  const sameDay = e.end && new Date(e.end).toDateString() === new Date(e.start).toDateString()
  const save = () => {
    const start = fromLocalInput(draft.start)
    const end = draft.end ? fromLocalInput(draft.end) : null
    const problem = editor.updateTime(e.id, { start, ...(runningNow && end === null ? {} : { end }), note: draft.note, on: draft.on ?? null, who: draft.who })
    if (problem) return setError(problem)
    setEditing(false)
    setError(null)
  }
  if (editing)
    return (
      <li className="timesheet-entry editing">
        <div className="timesheet-edit">
          <PersonSelect value={draft.who} onChange={(who) => setDraft((d) => ({ ...d, who }))} people={people} />
          <TargetSelect value={draft.on} onChange={(on) => setDraft((d) => ({ ...d, on }))} />
          <label>
            From
            <input type="datetime-local" value={draft.start} onChange={(x) => setDraft((d) => ({ ...d, start: x.target.value }))} />
          </label>
          <label>
            To
            <input type="datetime-local" value={draft.end} placeholder="running" onChange={(x) => setDraft((d) => ({ ...d, end: x.target.value }))} />
          </label>
          <input aria-label="Note" value={draft.note} maxLength={TT.NOTE_MAX} placeholder="Note" onChange={(x) => setDraft((d) => ({ ...d, note: x.target.value }))} />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="timesheet-log-actions">
            <button className="primary" onClick={save}>
              Save
            </button>
            <button onClick={() => setEditing(false)}>Cancel</button>
            <span className="spacer" />
            <button className="danger" onClick={() => editor.deleteTime(e.id)}>
              Delete
            </button>
          </div>
        </div>
      </li>
    )
  return (
    <li className={`timesheet-entry${runningNow ? ' running' : ''}`}>
      <span className="time-avatar" style={{ background: personColor(e.who) }} title={e.who} aria-hidden="true">
        {initials(e.who)}
      </span>
      <span className="timesheet-what">
        <span>
          <strong>{e.who}</strong>
          {' · '}
          {e.on && !TT.describeTarget(editor.board, e.on).gone ? (
            <button className="link" onClick={() => goTo(editor, e.on)}>
              {targetWords(editor.board, e.on, e.label)}
            </button>
          ) : (
            targetWords(editor.board, e.on, e.label)
          )}
        </span>
        <small className="muted">
          {dayWords(e.start)}, {clock(e.start)}–{e.end ? `${sameDay ? '' : `${dayWords(e.end)}, `}${clock(e.end)}` : 'now'}
          {e.by ? ` · logged by ${e.by}` : ''}
          {e.note ? ` · ${e.note}` : ''}
        </small>
        {overlap && <small className="time-warn">Overlaps another entry of {e.who}’s</small>}
        {runningNow && ms > TT.LONG_RUN && <small className="time-warn">Running for {TT.formatDuration(ms)}: forgotten?</small>}
      </span>
      <span className="usage-num timesheet-ms">{runningNow ? TT.formatClock(ms) : TT.formatDuration(ms)}</span>
      {!editor.readOnly && (
        <span className="timesheet-row-actions">
          {runningNow && <button onClick={() => editor.updateTime(e.id, { end: Date.now() })}>Stop</button>}
          <button className="link" onClick={() => setEditing(true)}>
            Edit
          </button>
        </span>
      )}
    </li>
  )
}

// ----- badges on the board ----------------------------------------------------------------------

/** Readable when zoomed out (up to 3x), without growing when zoomed in. */
const scaleFor = (zoom: number) => Math.min(3, Math.max(1, 1 / zoom))

/** Under each object with any: who it's assigned to, the time on it (against its estimate), and who's timing it now. */
export function TimeMarks({ editor, board = editor.board, zoom = editor.camera.zoom }: { editor: Editor; board?: Board; zoom?: number }) {
  const anyRunning = (board.time ?? []).some((e) => e.end === undefined)
  useTick(anyRunning, 30_000)
  const now = Date.now()
  const totals = useMemo(() => TT.itemTime(board, now), [board, anyRunning ? Math.floor(now / 30_000) : 0])
  if (zoom < 0.2) return null
  const k = scaleFor(zoom)
  const marks = board.items.filter((i) => !editor.hidden.has(i.id) && canHaveStatus(i.kind) && !i.hiddenBy && (i.assignees || i.estimate || totals.has(i.id) || (i.kind === 'mind' && i.parent === undefined)))
  return (
    <g className="time-marks">
      {marks.map((i) => {
        // A mind map's ideas count the ideas under them.
        const ms = i.kind === 'mind' ? TT.branchTime(board, i.id, now, totals) : (totals.get(i.id)?.ms ?? 0)
        const who = totals.get(i.id)?.running ?? []
        if (!i.assignees && !i.estimate && !ms && !who.length) return null
        const over = !!i.estimate && ms > i.estimate * MIN
        return (
          <foreignObject key={i.id} x={i.x} y={i.y + i.h + 4 * k} width={Math.max(i.w, 220) * k} height={26 * k} style={{ overflow: 'visible' }}>
            <div className="time-mark" style={{ transform: `scale(${k})` }}>
              {i.assignees?.slice(0, 4).map((n) => (
                <span key={n} className="time-avatar" title={`Assigned to ${n}`} style={{ background: personColor(n) }}>
                  {initials(n)}
                </span>
              ))}
              {(i.assignees?.length ?? 0) > 4 && <span className="time-avatar more">+{i.assignees!.length - 4}</span>}
              {(ms > 0 || i.estimate) && (
                <span className={`time-spent${over ? ' over' : ''}`} title={i.estimate ? `${TT.formatDuration(ms)} of ${TT.formatDuration(i.estimate * MIN)} estimated` : `${TT.formatDuration(ms)} tracked`}>
                  ⏱ {TT.formatDuration(ms)}
                  {i.estimate ? ` / ${TT.formatDuration(i.estimate * MIN)}` : ''}
                </span>
              )}
              {who.length > 0 && (
                <span className="time-live" title={`Timing now: ${who.join(', ')}`}>
                  <span className="time-dot" aria-hidden="true" />
                  {who.length === 1 ? who[0] : `${who.length} people`}
                </span>
              )}
            </div>
          </foreignObject>
        )
      })}
    </g>
  )
}

// ----- the selection toolbar -------------------------------------------------------------------

/** Who the selection is assigned to: tick people, or add a name. */
export function AssignMenu({ hidden, opener }: { hidden?: boolean; opener?: MenuOpener } = {}) {
  const editor = useEditor()
  const people = usePeople()
  const { at, close, toggle, openFrom, menuProps } = useButtonMenu()
  useEffect(() => {
    if (opener) opener.current = openFrom
  }, [opener, openFrom])
  const [name, setName] = useState('')
  const items = editor.selectedItems.filter((i) => canHaveStatus(i.kind))
  const has = (n: string) => items.length > 0 && items.every((i) => i.assignees?.some((a) => a.toLowerCase() === n.toLowerCase()))
  const some = (n: string) => items.some((i) => i.assignees?.some((a) => a.toLowerCase() === n.toLowerCase()))
  const assigned = [...new Set(items.flatMap((i) => i.assignees ?? []))]
  const names = [...new Map([...assigned, ...people.map((p) => p.name)].map((n) => [n.toLowerCase(), n])).values()]
  return (
    <span className="align-anchor">
      {!hidden && <button title="Who it's assigned to" aria-label="Assign" aria-expanded={!!at} aria-haspopup="menu" className={`assign-button${at ? ' on' : ''}`} onClick={toggle}>
        {assigned.length ? (
          <span className="time-avatars">
            {assigned.slice(0, 3).map((n) => (
              <span key={n} className="time-avatar" style={{ background: personColor(n) }}>
                {initials(n)}
              </span>
            ))}
          </span>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M3 20c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
        Assign
      </button>}
      {at &&
        createPortal(
          <div className="align-menu assign-menu no-canvas" role="menu" {...menuProps} style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
            {names.map((n) => (
              <button
                key={n.toLowerCase()}
                role="menuitemcheckbox"
                aria-checked={has(n) ? true : some(n) ? 'mixed' : false}
                className={has(n) ? 'on' : ''}
                onClick={() => editor.assign([n], has(n) ? 'remove' : 'add')}
              >
                <span className="time-avatar" style={{ background: personColor(n) }} aria-hidden="true">
                  {initials(n)}
                </span>
                {n}
                {n.toLowerCase() === editor.me.toLowerCase() && <span className="muted"> (me)</span>}
                <span className="assign-check" aria-hidden="true">
                  {has(n) ? '✓' : some(n) ? '–' : ''}
                </span>
              </button>
            ))}
            <form
              className="assign-new"
              onSubmit={(e) => {
                e.preventDefault()
                if (!name.trim()) return
                editor.assign([name.trim()], 'add')
                setName('')
              }}
            >
              <input aria-label="Someone else" placeholder="Someone else’s name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </form>
            {assigned.length > 0 && (
              <button
                role="menuitem"
                onClick={() => {
                  editor.assign([], 'set')
                  close()
                }}
              >
                Nobody (clear)
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                const n = assigned[0]
                if (n) editor.setPersonFilter(n)
                close()
              }}
              disabled={!assigned.length}
            >
              Show only what’s assigned to {assigned[0] ?? '…'}
            </button>
          </div>,
          document.body,
        )}
    </span>
  )
}

/** The selection's timer, estimate and time so far. */
export function TrackMenu({ hidden, opener }: { hidden?: boolean; opener?: MenuOpener } = {}) {
  const editor = useEditor()
  const { at, close, toggle, openFrom, menuProps } = useButtonMenu()
  useEffect(() => {
    if (opener) opener.current = openFrom
  }, [opener, openFrom])
  const one = editor.single
  const items = editor.selectedItems.filter((i) => canHaveStatus(i.kind))
  const mine = editor.myTimer
  const here = !!one && !!mine?.on && 'item' in mine.on && mine.on.item === one.id
  useTick(here)
  const now = Date.now()
  const spent = one ? (one.kind === 'mind' ? TT.branchTime(editor.board, one.id, now) : (TT.itemTime(editor.board, now).get(one.id)?.ms ?? 0)) : 0
  const [estimate, setEstimate] = useState('')
  useEffect(() => setEstimate(items.length === 1 && items[0].estimate ? TT.formatDuration(items[0].estimate * MIN) : ''), [at])
  const saveEstimate = () => {
    const m = estimate.trim() ? TT.parseDuration(estimate) : null
    if (estimate.trim() && m === null) return editor.setStatus('An estimate like 2h, 90m or 1.5h')
    editor.setEstimate(m)
  }
  return (
    <span className="align-anchor">
      {!hidden && <button
        title={here ? 'Timing this now' : 'Time on this'}
        aria-label="Time"
        aria-expanded={!!at}
        aria-haspopup="menu"
        className={`track-button${at ? ' on' : ''}${here ? ' running' : ''}`}
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 9v4l2.5 2.5M9 2h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {here ? TT.formatClock(TT.durationOf(mine!, now)) : spent ? TT.formatDuration(spent) : 'Time'}
      </button>}
      {at &&
        createPortal(
          <div className="align-menu track-menu no-canvas" role="menu" {...menuProps} style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
            {one &&
              (here ? (
                <button
                  role="menuitem"
                  onClick={() => {
                    editor.stopTracking()
                    close()
                  }}
                >
                  ■ Stop the timer <kbd>Alt T</kbd>
                </button>
              ) : (
                <button
                  role="menuitem"
                  onClick={() => {
                    editor.startTracking({ item: one.id })
                    close()
                  }}
                >
                  ▶ Start a timer on this <kbd>Alt T</kbd>
                </button>
              ))}
            {one && (
              <button
                role="menuitem"
                onClick={() => {
                  editor.openTimesheet({ on: { item: one.id }, log: true })
                  close()
                }}
              >
                Log time on this…
              </button>
            )}
            {one && spent > 0 && (
              <button
                role="menuitem"
                onClick={() => {
                  editor.openTimesheet({ on: { item: one.id } })
                  close()
                }}
              >
                {TT.formatDuration(spent)} so far{one.kind === 'mind' && one.parent === undefined ? ' (the whole map)' : ''}: see the entries
              </button>
            )}
            <label className="track-estimate">
              Estimate
              <input
                value={estimate}
                placeholder="2h"
                onChange={(e) => setEstimate(e.target.value)}
                onBlur={saveEstimate}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    saveEstimate()
                    close()
                  }
                }}
              />
            </label>
            {one?.estimate ? (
              <div className="track-progress">
                <EstimateMeter spent={spent} estimate={one.estimate * MIN} />
              </div>
            ) : null}
            {one?.kind === 'mind' && one.parent !== undefined && (
              <button
                role="menuitem"
                onClick={() => {
                  const root = mapRoot(editor.board, one.id)
                  if (root) editor.openTimesheet({ on: { item: root.id } })
                  close()
                }}
              >
                Time on the whole map
              </button>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}

/** The time on a database record, and its timer, for the record's page. */
export function RecordTime({ dataset, record }: { dataset: string; record: string }) {
  const editor = useEditor()
  const mine = editor.myTimer
  const on: TimeTarget = { dataset, record }
  const here = !!mine && TT.sameTarget(mine.on, on)
  const anyRunning = (editor.board.time ?? []).some((e) => e.end === undefined && TT.sameTarget(e.on, on))
  useTick(anyRunning)
  const now = Date.now()
  const spent = TT.recordTime(editor.board, dataset, record, now)
  return (
    <div className="record-time">
      <span className="muted">⏱ {spent ? TT.formatDuration(spent) : 'No time yet'}</span>
      {!editor.readOnly &&
        (here ? (
          <button onClick={() => editor.stopTracking()}>■ Stop {TT.formatClock(TT.durationOf(mine!, now))}</button>
        ) : (
          <button onClick={() => editor.startTracking(on)}>▶ Start a timer</button>
        ))}
      {!editor.readOnly && (
        <button className="link" onClick={() => editor.openTimesheet({ on, log: true })}>
          Log time
        </button>
      )}
      {spent > 0 && (
        <button className="link" onClick={() => editor.openTimesheet({ on })}>
          Entries
        </button>
      )}
    </div>
  )
}

