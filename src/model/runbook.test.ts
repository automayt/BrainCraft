import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { emptyBoard, getItem } from './board'
import { component, formatDuration, newRun, options, recordRun, runStart, runStats, runToMarkdown, RUNS_KEPT } from './runbook'
import { fakeMeasure } from './test-helpers'

function flow(mermaid: string) {
  const { board, results } = applyOps(emptyBoard(), [{ op: 'createFlowchart', mermaid }], { measure: fakeMeasure })
  const ids = results[0].ids!
  const byText = (t: string) => board.items.find((i) => i.text === t)!.id
  return { b: board, ids, byText }
}

const SUPPORT = 'flowchart TD\n  A([Ticket in]) --> B[Triage]\n  B --> C{Urgent?}\n  C -->|Yes| D[Page on-call]\n  C -->|No| E[Queue it]\n  D --> F([Closed])\n  E --> F'

describe('runbook', () => {
  it('finds the start from any shape in the flowchart', () => {
    const { b, byText } = flow(SUPPORT)
    expect(runStart(b, byText('Queue it'))).toBe(byText('Ticket in'))
    expect(component(b, byText('Closed')).size).toBe(6)
  })

  it('offers labelled choices at decisions and the next step elsewhere', () => {
    const { b, byText } = flow(SUPPORT)
    expect(options(b, byText('Urgent?')).map((o) => [o.label, o.labelled])).toEqual([
      ['Yes', true],
      ['No', true],
    ])
    expect(options(b, byText('Triage')).map((o) => o.label)).toEqual(['Urgent?'])
    expect(options(b, byText('Closed'))).toEqual([])
  })

  it('starts loops at the top-left shape', () => {
    const { b, byText } = flow('flowchart LR\n  A[Plan] --> B[Do]\n  B --> C[Check]\n  C --> A')
    expect(runStart(b, byText('Check'))).toBe(byText('Plan'))
  })

  it('records runs on the start shape, keeping the newest', () => {
    const { b, byText } = flow(SUPPORT)
    const start = byText('Ticket in')
    let board = b
    for (let k = 0; k < RUNS_KEPT + 3; k++) board = recordRun(board, start, newRun([{ node: start, text: 'Ticket in', at: k }], 'done', k, k + 1000))
    expect(getItem(board, start)!.runs).toHaveLength(RUNS_KEPT)
    expect(getItem(board, start)!.runs![0].startedAt).toBe(3)
  })

  it('summarises runs: typical time and the usual route', () => {
    const step = (text: string) => ({ node: 1, text, at: 0 })
    const runs = [
      newRun([step('A'), step('B')], 'done', 0, 60_000),
      newRun([step('A'), step('B')], 'done', 0, 120_000),
      newRun([step('A'), step('C')], 'done', 0, 30_000),
      newRun([step('A')], 'stopped', 0, 5_000),
    ]
    const s = runStats(runs)
    expect(s).toMatchObject({ total: 4, finished: 3, typical: 60_000, commonPath: ['A', 'B'] })
    expect(s.commonPathShare).toBeCloseTo(2 / 3)
  })

  it('writes a run as a Markdown checklist', () => {
    const md = runToMarkdown('Support', newRun([{ node: 1, text: 'Urgent?', at: 0, choice: 'Yes', note: 'Customer is down' }, { node: 2, text: 'Page on-call', at: 1 }], 'done', 0, 90_000, 'Sam'))
    expect(md).toContain('## Support — completed')
    expect(md).toContain('by Sam · took 1m 30s')
    expect(md).toContain('- [x] Urgent? → **Yes**')
    expect(md).toContain('  - Customer is down')
  })

  it('formats durations', () => {
    expect(formatDuration(4_000)).toBe('4s')
    expect(formatDuration(125_000)).toBe('2m 05s')
    expect(formatDuration(3_900_000)).toBe('1h 05m')
  })
})
