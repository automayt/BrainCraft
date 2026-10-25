import { useEffect, useState } from 'react'
import { call } from '../../store/account'
import { useWorkspace } from '../useWorkspace'

type Counts = Record<string, number>

interface UsageData {
  events: Record<string, string>
  days: { day: string; counts: Counts; people: number }[]
  totals: Counts
  active: { d1: number; d7: number; d30: number }
  people: number
  busiest: { id: string; title: string; kind: 'board' | 'wiki'; changes: number }[]
  features: { boards: number; wikis: number; rows: { feature: string; group: string; label: string; boards: number; total: number }[] }
  storage: { boards: number; files: number; total: number; biggest: { id: string; title: string; kind: 'board' | 'wiki'; bytes: number }[] }
}

const SPANS = [7, 30, 90, 365] as const
const PEOPLE = 'people'

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`)
const num = (n: number) => n.toLocaleString()
/** "1 board", "3 boards". */
const count = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`
const dayLabel = (iso: string, long = false) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })

/** A round number at or above `max` for the top of the chart: 1, 2 or 5 × 10ⁿ. */
function niceTop(max: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, max)))
  return [1, 2, 5, 10].map((k) => k * p).find((v) => v >= max)!
}

/**
 * Admins: how the server is used. Day-by-day counts (people active, changes, the assistant,
 * speech to text, form answers…), which features boards use, and what the boards take up on disk.
 * Only counts; nothing anyone wrote.
 */
export function UsagePanel() {
  const ws = useWorkspace()
  const [span, setSpan] = useState<(typeof SPANS)[number]>(30)
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [metric, setMetric] = useState<string>(PEOPLE)
  useEffect(() => {
    setError(null)
    call<UsageData>(ws.server!, `api/admin/usage?days=${span}`).then(setData, (e: Error) => setError(e.message))
  }, [ws.server, span])

  if (error)
    return (
      <p className="signin-error" role="alert">
        {error}
      </p>
    )
  if (!data) return <p className="muted">Counting…</p>
  const t = data.totals
  const ai = (t['ai.claude'] ?? 0) + (t['ai.model'] ?? 0) + (t['ai.agent'] ?? 0)
  const tiles: [string, string, string][] = [
    [num(data.active.d7), 'people active this week', `${num(data.active.d1)} today, ${num(data.active.d30)} in 30 days, of ${count(data.people, 'account')}`],
    [num(data.features.boards + data.features.wikis), 'boards and wikis', `${count(data.features.boards, 'board')}, ${count(data.features.wikis, 'wiki')}`],
    [num(t.edit ?? 0), `changes in ${span} days`, `Boards opened ${count(t['board.open'] ?? 0, 'time')}`],
    [num(ai), 'assistant requests', count(t.transcribe ?? 0, 'speech-to-text clip')],
    [num(t['form.answer'] ?? 0), 'form answers', count(t.export ?? 0, 'export')],
    [bytes(data.storage.total), 'stored', `${bytes(data.storage.boards)} in boards, ${bytes(data.storage.files)} in files`],
  ]
  const csv = new URL(`api/admin/usage.csv?days=${span}`, ws.server ?? location.href).href
  return (
    <div className="usage">
      <div className="usage-filters">
        <div className="usage-span" role="radiogroup" aria-label="Time span">
          {SPANS.map((s) => (
            <button key={s} role="radio" aria-checked={span === s} className={span === s ? 'on' : ''} onClick={() => setSpan(s)}>
              {s === 365 ? 'Year' : `${s} days`}
            </button>
          ))}
        </div>
        <a className="link" href={csv} download>
          Download as CSV
        </a>
      </div>
      <div className="usage-tiles">
        {tiles.map(([big, label, small]) => (
          <div key={label} className="usage-tile">
            <strong>{big}</strong>
            <span>{label}</span>
            <small className="muted">{small}</small>
          </div>
        ))}
      </div>
      <DayChart data={data} metric={metric} setMetric={setMetric} />
      <section className="usage-section">
        <h3>Busiest boards</h3>
        {data.busiest.length ? (
          <table className="admin-table usage-table">
            <tbody>
              {data.busiest.map((b) => (
                <tr key={b.id}>
                  <td>{b.title}</td>
                  <td className="muted">{b.kind === 'wiki' ? 'Wiki' : 'Board'}</td>
                  <td className="usage-num">{count(b.changes, 'change')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No changes to boards in this time.</p>
        )}
      </section>
      <Features data={data} />
      <section className="usage-section">
        <h3>Biggest boards</h3>
        {data.storage.biggest.length ? (
          <table className="admin-table usage-table">
            <tbody>
              {data.storage.biggest.map((b) => (
                <tr key={b.id}>
                  <td>{b.title}</td>
                  <td className="muted">{b.kind === 'wiki' ? 'Wiki' : 'Board'}</td>
                  <td className="usage-num">{bytes(b.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No boards on this server yet.</p>
        )}
        <p className="muted admin-hint">Files kept with boards (PDFs, documents) take {bytes(data.storage.files)} more.</p>
      </section>
    </div>
  )
}

/** One measure, day by day, as bars; hovering a day says its date and number. */
function DayChart({ data, metric, setMetric }: { data: UsageData; metric: string; setMetric: (m: string) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const values = data.days.map((d) => (metric === PEOPLE ? d.people : (d.counts[metric] ?? 0)))
  const most = Math.max(0, ...values)
  const top = niceTop(most)
  const label = metric === PEOPLE ? 'People active' : data.events[metric]
  const total = values.reduce((s, v) => s + v, 0)
  const H = 140
  const n = values.length
  const W = 600
  const step = W / n
  // A 2px gap between bars, wider ones rounded at the top.
  const bar = Math.max(1, step - 2)
  const r = Math.min(4, bar / 2)
  const h = hover === null ? null : data.days[hover]
  return (
    <section className="usage-section">
      <div className="usage-chart-head">
        <h3>{label}, day by day</h3>
        <select aria-label="What to show" value={metric} onChange={(e) => setMetric(e.target.value)}>
          <option value={PEOPLE}>People active</option>
          {Object.entries(data.events).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="muted">{metric === PEOPLE ? `${count(data.active.d30, 'person', 'different people')} in 30 days` : `${num(total)} in all`}</span>
      </div>
      <div className="usage-chart" onPointerLeave={() => setHover(null)}>
        <div className="usage-scale muted" aria-hidden="true">
          <span>{num(top)}</span>
          <span>{num(top / 2)}</span>
          <span>0</span>
        </div>
        <div className="usage-plot">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label} per day: at most ${num(most)} a day, ${num(total)} in all`}>
            {[0.5, 1].map((f) => (
              <line key={f} className="usage-grid" x1={0} x2={W} y1={H - H * f} y2={H - H * f} vectorEffect="non-scaling-stroke" />
            ))}
            {values.map((v, i) => {
              const bh = v ? Math.max(2, (v / top) * H) : 0
              const x = i * step + 1
              const rr = Math.min(r, bh / 2)
              return (
                <g key={i} onPointerEnter={() => setHover(i)}>
                  {/* The whole column answers the pointer, not just the bar. */}
                  <rect className="usage-hit" x={i * step} y={0} width={step} height={H} />
                  {bh > 0 && <path className={`usage-bar${hover === i ? ' on' : ''}`} d={`M${x},${H}V${H - bh + rr}Q${x},${H - bh} ${x + rr},${H - bh}H${x + bar - rr}Q${x + bar},${H - bh} ${x + bar},${H - bh + rr}V${H}Z`} />}
                </g>
              )
            })}
            <line className="usage-axis" x1={0} x2={W} y1={H} y2={H} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="usage-ticks muted">
            <span>{dayLabel(data.days[0].day)}</span>
            <span>{dayLabel(data.days[n - 1].day)}</span>
          </div>
          {h && hover !== null && (
            <div className={`usage-tip${hover > n / 2 ? ' left' : ''}`} style={{ left: `${((hover + 0.5) / n) * 100}%` }}>
              <strong>{num(values[hover])}</strong> <span>{label.toLowerCase()}</span>
              <small className="muted">{dayLabel(h.day, true)}</small>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** Each feature: how many boards use it, and how much of it there is. */
function Features({ data }: { data: UsageData }) {
  const [all, setAll] = useState(false)
  const count = data.features.boards + data.features.wikis
  const used = data.features.rows.filter((r) => r.boards > 0)
  const unused = data.features.rows.length - used.length
  const rows = all ? data.features.rows : used.slice(0, 15)
  return (
    <section className="usage-section">
      <h3>Features in use</h3>
      <p className="muted admin-hint">Counted from what’s on the boards, so it includes everything made before counting started.</p>
      {used.length ? (
        <table className="admin-table usage-table">
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col">Boards using it</th>
              <th scope="col" className="usage-num">
                How many
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.feature}>
                <td>
                  {r.label} <span className="muted">({r.group})</span>
                </td>
                <td>
                  <span className="usage-meter" aria-hidden="true">
                    <span style={{ width: `${count ? (r.boards / count) * 100 : 0}%` }} />
                  </span>
                  {num(r.boards)} of {num(count)}
                </td>
                <td className="usage-num">{num(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Nothing on the boards yet.</p>
      )}
      {(used.length > 15 || unused > 0) && (
        <button className="link" onClick={() => setAll((a) => !a)}>
          {all ? 'Show the most used' : `Show all ${data.features.rows.length}, including ${unused} nobody uses yet`}
        </button>
      )}
    </section>
  )
}
