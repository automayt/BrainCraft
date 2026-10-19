import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuditLog, changesOf } from './audit'
import { cookieOf, req, res, tempDir } from './fakes'
import { Accounts } from './service'

const ann = { id: 'u1', name: 'Ann', email: 'ann@x.org', admin: true as const }
const sam = { id: 'u2', name: 'Sam', email: 'sam@x.org' }

describe('the activity log', () => {
  it('numbers entries, chains them, and finds them newest first by kind, admin and words', () => {
    const dir = tempDir()
    let t = 1000
    const log = new AuditLog(dir, () => t++)
    log.record({ action: 'user.add', by: ann, text: 'Ann added Sam' })
    log.record({ action: 'signin', by: sam, text: 'Sam signed in with a password' })
    log.record({ action: 'board.access', by: sam, text: 'Sam changed who has “Trip”: Lee can edit' })
    const all = log.query()
    expect(all.entries.map((e) => e.n)).toEqual([3, 2, 1])
    expect(all.entries[1].prev).toBe(all.entries[2].hash)
    expect(all.entries[2].prev).toBe('')
    expect(log.query({ kind: 'signin' }).entries.map((e) => e.n)).toEqual([2])
    expect(log.query({ admins: true }).entries.map((e) => e.n)).toEqual([1])
    expect(log.query({ q: 'trip lee' }).entries.map((e) => e.n)).toEqual([3])
    expect(log.query({ before: 3, limit: 1 })).toMatchObject({ entries: [{ n: 2 }], more: true })
    expect(log.verify()).toEqual({ ok: true, count: 3 })
    // Opened again, it carries on the numbering and the chain.
    const again = new AuditLog(dir, () => t++)
    expect(again.record({ action: 'signout', by: sam, text: 'Sam signed out' }).n).toBe(4)
    expect(again.verify()).toEqual({ ok: true, count: 4 })
  })

  it('shows an entry edited, removed or garbled by hand', () => {
    const dir = tempDir()
    const log = new AuditLog(dir)
    for (const who of ['Lee', 'Kim', 'Max']) log.record({ action: 'user.add', by: ann, text: `Ann added ${who}` })
    const path = join(dir, 'audit.jsonl')
    const good = readFileSync(path, 'utf8')
    writeFileSync(path, good.replace('Ann added Kim', 'Ann added Bob'))
    expect(log.verify()).toEqual({ ok: false, count: 1, brokenAt: 2 })
    const lines = good.split('\n')
    writeFileSync(path, [lines[0], lines[2], ''].join('\n'))
    expect(log.verify()).toMatchObject({ ok: false, brokenAt: 2 })
    writeFileSync(path, `${good}{"n": oops\n`)
    expect(log.verify()).toMatchObject({ ok: false, brokenAt: 4 })
  })

  it('sets a big file aside and carries the chain on into the next, deleting nothing', () => {
    const dir = tempDir()
    const log = new AuditLog(dir, Date.now, 600)
    for (let i = 1; i <= 12; i++) log.record({ action: 'signin', by: sam, text: `Sign-in ${i}` })
    expect(log.files().length).toBeGreaterThan(2)
    expect(log.verify()).toEqual({ ok: true, count: 12 })
    expect(log.query({ limit: 500 }).entries.map((e) => e.n)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(log.all().trim().split('\n').length).toBe(12)
    expect(new AuditLog(dir, Date.now, 600).record({ action: 'signout', by: sam, text: 'x' }).n).toBe(13)
  })

  it('starts a fresh line after one cut off when the server stopped', () => {
    const dir = tempDir()
    new AuditLog(dir).record({ action: 'signin', by: sam, text: 'one' })
    writeFileSync(join(dir, 'audit.jsonl'), `${readFileSync(join(dir, 'audit.jsonl'), 'utf8')}{"n":2,"at`)
    const log = new AuditLog(dir)
    expect(log.record({ action: 'signin', by: sam, text: 'two' }).n).toBe(2)
    expect(log.query().entries.map((e) => e.text)).toEqual(['two', 'one'])
  })

  it('describes changes field by field', () => {
    expect(changesOf({ role: 'user', groups: [], off: false }, { role: 'admin', groups: ['Team'], off: false })).toEqual({ role: ['user', 'admin'], groups: ['none', 'Team'] })
  })
})

async function call(a: Accounts, method: string, path: string, cookie = '', body?: unknown) {
  const r = res()
  await a.handle(req(method, cookie ? { cookie } : {}, '10.0.0.7'), r, new URL(`http://localhost:8080${path}`), async () => (body === undefined ? '' : JSON.stringify(body)))
  return r.reply
}

describe('what the server notes', () => {
  it('records admins’ changes, sign-ins and failures, shows them only to admins, and never keeps secrets', async () => {
    const a = new Accounts({ dir: tempDir() })
    const admin = cookieOf(await call(a, 'POST', '/api/auth/setup', '', { email: 'ann@x.org', name: 'Ann', password: 'a long password' }))
    const team = (await call(a, 'POST', '/api/admin/groups', admin, { name: 'Team', permissions: ['boards.share'] })).body.group as { id: string }
    const made = await call(a, 'POST', '/api/admin/users', admin, { email: 'sam@x.org', name: 'Sam', groups: [team.id] })
    const uid = (made.body.user as { id: string }).id
    const resetToken = String(made.body.link).split('#reset=')[1]
    const samCookie = cookieOf(await call(a, 'POST', '/api/auth/reset', '', { token: resetToken, password: 'Sam secret password' }))
    await call(a, 'PATCH', `/api/admin/users/${uid}`, admin, { role: 'admin' })
    await call(a, 'PATCH', `/api/admin/users/${uid}`, admin, { role: 'admin' }) // no change, nothing noted
    await call(a, 'POST', '/api/auth/login', '', { email: 'sam@x.org', password: 'not the password' })
    await call(a, 'POST', '/api/auth/login', '', { email: 'nobody@x.org', password: 'whatever it is' })
    await call(a, 'POST', '/api/auth/login', '', { email: 'my password typed here', password: 'x' })
    const token = String((await call(a, 'POST', '/api/auth/tokens', samCookie, { name: 'scripts' })).body.token)
    await call(a, 'PATCH', `/api/admin/groups/${team.id}`, admin, { permissions: ['boards.share', 'people.see'], members: [] })

    const got = await call(a, 'GET', '/api/admin/audit', admin)
    const texts = (got.body.entries as { text: string }[]).map((e) => e.text)
    expect(texts).toEqual([
      'Ann changed the group Team: permissions Share boards → Share boards, See everyone; members Sam → none',
      'Sam made an API token “scripts”',
      'Sign-in with an unknown email',
      'Sign-in with an unknown email (nobody@x.org)',
      'Wrong password for sam@x.org',
      'Ann changed Sam: role user → admin',
      'Sam chose a new password from a set-your-password link',
      'Ann added Sam (sam@x.org) as a user, in Team',
      'Ann made the group Team: may Share boards',
      'Ann (ann@x.org) set up the server as its first admin',
    ])
    const first = (got.body.entries as { by: unknown; ip: string; changes?: unknown }[])[5]
    expect(first).toMatchObject({ by: { name: 'Ann', admin: true }, ip: '10.0.0.7', changes: { role: ['user', 'admin'] } })
    expect((await call(a, 'GET', '/api/admin/audit?kind=signin', admin)).body.entries).toHaveLength(3)
    expect((await call(a, 'GET', '/api/admin/audit/verify', admin)).body).toEqual({ ok: true, count: 10 })

    // Not for anyone but admins (Sam is one now, so a fresh person).
    const lee = await call(a, 'POST', '/api/admin/users', admin, { email: 'lee@x.org', name: 'Lee', password: 'Lee long password' })
    expect(lee.status).toBe(201)
    const leeCookie = cookieOf(await call(a, 'POST', '/api/auth/login', '', { email: 'lee@x.org', password: 'Lee long password' }))
    expect((await call(a, 'GET', '/api/admin/audit', leeCookie)).status).toBe(403)
    expect((await call(a, 'GET', '/api/admin/audit', '')).status).toBe(401)

    // Passwords, links and tokens never reach the log.
    const raw = a.audit.all()
    for (const secret of ['a long password', 'Sam secret password', 'not the password', 'Lee long password', 'my password typed here', resetToken, token, samCookie.split('=')[1]]) expect(raw).not.toContain(secret)
  })

  it('downloads the whole log, noting who did', async () => {
    const a = new Accounts({ dir: tempDir() })
    const admin = cookieOf(await call(a, 'POST', '/api/auth/setup', '', { email: 'ann@x.org', name: 'Ann', password: 'a long password' }))
    const r = res()
    await a.handle(req('GET', { cookie: admin }), r, new URL('http://localhost:8080/api/admin/audit/download'), async () => '')
    const reply = await r.reply
    expect(reply.headers['content-disposition']).toMatch(/^attachment; filename="braincraft-activity-\d{4}-\d{2}-\d{2}\.jsonl"$/)
    const lines = String(reply.body.text).trim().split('\n').map((l) => JSON.parse(l) as { action: string })
    expect(lines.map((l) => l.action)).toEqual(['server.setup', 'audit.download'])
  })
})
