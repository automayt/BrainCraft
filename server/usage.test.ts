import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyOps } from '../src/api/ops'
import { emptyBoard } from '../src/model/board'
import { fromJson } from '../src/model/serialize'
import { fakeMeasure } from '../src/model/test-helpers'
import { boardStats, eventOf, Usage, usageCsv } from './usage'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 9, 25, 12)

describe('usage counts', () => {
  it('counts by day, people once a day, and keeps them through a restart', () => {
    let now = T0 - 8 * DAY
    const file = join(mkdtempSync(join(tmpdir(), 'usage-')), 'usage.json')
    const u = new Usage(file, () => now)
    u.count('edit', 3)
    u.seen('ada')
    now = T0
    u.edited('b1')
    u.edited('b2')
    u.edited('b2')
    u.count('ai.claude')
    u.seen('ada')
    u.seen('ada')
    u.seen('bo')
    const r = u.report(30)
    expect(r.days).toHaveLength(30)
    expect(r.days.at(-1)).toEqual({ day: '2026-10-25', counts: { edit: 3, 'ai.claude': 1 }, people: 2 })
    expect(r.totals).toEqual({ edit: 6, 'ai.claude': 1 })
    expect(r.busiest).toEqual([
      { id: 'b2', changes: 2 },
      { id: 'b1', changes: 1 },
    ])
    expect(r.active).toEqual({ d1: 2, d7: 2, d30: 2 })
    u.save()
    const back = new Usage(file, () => now).report(7)
    // The day eight days ago is outside a week.
    expect(back.totals).toEqual({ edit: 3, 'ai.claude': 1 })
    expect(back.busiest[0]).toEqual({ id: 'b2', changes: 2 })
    expect(usageCsv(back).split('\n')[0]).toContain('Day,People active,Boards opened')
    expect(usageCsv(back).split('\n').at(-2)).toMatch(/^2026-10-25,2,0,0,3,/)
  })

  it('counts only requests that worked, by route', () => {
    expect(eventOf('POST', ['api', 'boards'], 201)).toBe('board.create')
    expect(eventOf('POST', ['api', 'boards', 'x', 'ops'], 200)).toBe('api')
    expect(eventOf('POST', ['api', 'boards', 'x', 'ops'], 422)).toBeNull()
    expect(eventOf('GET', ['api', 'boards', 'x', 'pages', 'p', 'export'], 200)).toBe('export')
    expect(eventOf('POST', ['api', 'forms', 'x', '2'], 201)).toBe('form.answer')
    expect(eventOf('POST', ['api', 'ai', 'v1', 'messages'], 200)).toBe('ai.claude')
    expect(eventOf('POST', ['api', 'ai', 'transcribe'], 200)).toBe('transcribe')
    expect(eventOf('POST', ['api', 'auth', 'login'], 200)).toBe('signin')
    expect(eventOf('POST', ['api', 'auth', 'login'], 401)).toBeNull()
    expect(eventOf('GET', ['api', 'auth', 'sso', 'callback'], 302, '/')).toBe('signin')
    expect(eventOf('GET', ['api', 'auth', 'sso', 'callback'], 302, '/#signin-error=nope')).toBeNull()
    expect(eventOf('GET', ['api', 'boards', 'x'], 200)).toBeNull()
  })

  it('tallies features and storage across stored boards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stats-'))
    mkdirSync(join(dir, 'boards'))
    mkdirSync(join(dir, 'files', 'b1'), { recursive: true })
    writeFileSync(join(dir, 'files', 'b1', 'a.pdf'), 'x'.repeat(100))
    const b = applyOps(emptyBoard(), [{ op: 'createDatabase', title: 'Tasks', views: ['table', 'form'], fields: ['Task'], records: [{ Task: 'A' }, { Task: 'B' }] }, { op: 'createNote', text: 'Hi' }], { measure: fakeMeasure }).board
    writeFileSync(join(dir, 'boards', 'b1.json'), JSON.stringify({ id: 'b1', board: b }))
    writeFileSync(join(dir, 'boards', 'b2.json'), JSON.stringify({ id: 'b2', board: emptyBoard() }))
    writeFileSync(join(dir, 'boards', 'bad.json'), '{oops')
    const s = boardStats({ boardsDir: join(dir, 'boards'), filesDir: join(dir, 'files'), loaded: () => null, read: fromJson })
    expect(s.features.boards).toBe(2)
    const row = (f: string) => s.features.rows.find((r) => r.feature === f)!
    expect(row('database')).toMatchObject({ boards: 1, total: 1 })
    expect(row('record')).toMatchObject({ boards: 1, total: 2 })
    expect(row('form')).toMatchObject({ boards: 1, total: 1 })
    expect(row('sticky')).toMatchObject({ boards: 1, total: 1 })
    expect(row('synced')).toMatchObject({ boards: 0, total: 0 })
    expect(s.storage.files).toBe(100)
    // A board that can't be read still takes up room, but isn't listed.
    expect(s.storage.biggest.map((x) => x.id)).toEqual(['b1', 'b2'])
    expect(s.storage.total).toBeGreaterThan(100)
  })
})
