import { describe, expect, it } from 'vitest'
import { groupsOf, levelFor, permissionsOf, roleOf } from './access'
import { cookieOf, req, res, tempDir } from './fakes'
import { Accounts } from './service'
import { checkPassword, hashPassword } from './store'
import type { Group, User } from './types'

const user = (over: Partial<User> = {}): User => ({ id: 'u1', email: 'sam@x.org', name: 'Sam', role: 'user', groups: [], created: 0, ...over })
const groups: Group[] = [
  { id: 'everyone', name: 'Everyone', permissions: ['ai.use'], everyone: true },
  { id: 'planners', name: 'Planners', permissions: ['boards.create', 'boards.share'] },
  { id: 'staff', name: 'Staff', permissions: ['people.see'], ssoGroups: ['Staff-All'] },
]

describe('who may do what', () => {
  it('gives groups’ permissions together, everything to admins, nothing when turned off', () => {
    expect([...permissionsOf(user(), groups)]).toEqual(['ai.use'])
    expect([...permissionsOf(user({ groups: ['planners'] }), groups)].sort()).toEqual(['ai.use', 'boards.create', 'boards.share'])
    // A group from the sign-in provider counts, whatever its case.
    expect(groupsOf(user({ ssoGroups: ['staff-all'] }), groups).map((g) => g.id)).toEqual(['everyone', 'staff'])
    expect(permissionsOf(user({ role: 'admin' }), groups).size).toBe(4)
    expect(permissionsOf(user({ role: 'admin', disabled: true }), groups).size).toBe(0)
  })

  it('works out a board level: owner and admins manage, else the best grant; ownerless boards are admins’', () => {
    const board = { owner: 'owner1', access: [{ who: 'group' as const, id: 'planners', level: 'view' as const }, { who: 'user' as const, id: 'u1', level: 'edit' as const }] }
    expect(levelFor(user({ groups: ['planners'] }), groups, board)).toBe('edit')
    expect(levelFor(user({ id: 'u2', groups: ['planners'] }), groups, board)).toBe('view')
    expect(levelFor(user({ id: 'u3' }), groups, board)).toBeNull()
    expect(levelFor(user({ id: 'owner1' }), groups, board)).toBe('manage')
    expect(levelFor(user({ id: 'u9', role: 'admin' }), groups, {})).toBe('manage')
    expect(levelFor(user(), groups, { access: [{ who: 'user', id: 'u1', level: 'edit' }] })).toBeNull()
    expect(levelFor(user({ disabled: true }), groups, board)).toBeNull()
    expect([roleOf('view'), roleOf('edit'), roleOf('manage'), roleOf(null)]).toEqual(['view', 'edit', 'edit', null])
  })

  it('hashes passwords with a salt, and checks them', async () => {
    const h = await hashPassword('correct horse battery')
    expect(h).toMatch(/^scrypt\$/)
    expect(h).not.toBe(await hashPassword('correct horse battery'))
    expect(await checkPassword('correct horse battery', h)).toBe(true)
    expect(await checkPassword('wrong horse battery', h)).toBe(false)
    expect(await checkPassword('x', undefined)).toBe(false)
  })
})

async function call(a: Accounts, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = res()
  const handled = await a.handle(req(method, headers), r, new URL(`http://localhost:8080${path}`), async () => (body === undefined ? '' : JSON.stringify(body)))
  expect(handled).toBe(true)
  return r.reply
}

describe('signing in', () => {
  it('sets up the first admin once, then signs in and out with a password', async () => {
    const a = new Accounts({ dir: tempDir() })
    expect((await call(a, 'GET', '/api/auth/me')).body).toMatchObject({ accounts: true, setup: true, user: null })
    expect((await call(a, 'POST', '/api/auth/setup', { email: 'a@x.org', password: 'short' })).status).toBe(400)
    const setup = await call(a, 'POST', '/api/auth/setup', { email: 'Ann@X.org', name: 'Ann', password: 'a long password' })
    expect(setup.status).toBe(200)
    expect(setup.body).toMatchObject({ user: { email: 'ann@x.org', role: 'admin' }, setup: false })
    const cookie = cookieOf(setup)
    expect(setup.headers['set-cookie']).toMatch(/HttpOnly; SameSite=Lax/)
    expect((await call(a, 'POST', '/api/auth/setup', { email: 'b@x.org', password: 'a long password' })).status).toBe(409)
    expect((await call(a, 'GET', '/api/auth/me', undefined, { cookie })).body).toMatchObject({ user: { name: 'Ann' } })
    expect((await call(a, 'POST', '/api/auth/login', { email: 'ann@x.org', password: 'nope nope nope' })).status).toBe(401)
    const again = await call(a, 'POST', '/api/auth/login', { email: 'ann@x.org', password: 'a long password' })
    expect(again.status).toBe(200)
    await call(a, 'POST', '/api/auth/logout', undefined, { cookie })
    expect((await call(a, 'GET', '/api/auth/me', undefined, { cookie })).body).toMatchObject({ user: null })
  })

  it('refuses changes without the app’s header, and too many wrong passwords', async () => {
    const a = new Accounts({ dir: tempDir() })
    const r = res()
    await a.handle(req('POST', { 'x-braincraft': '' }), r, new URL('http://localhost/api/auth/setup'), async () => '{}')
    expect((await r.reply).status).toBe(403)
    await call(a, 'POST', '/api/auth/setup', { email: 'ann@x.org', password: 'a long password' })
    for (let k = 0; k < 10; k++) await call(a, 'POST', '/api/auth/login', { email: 'ann@x.org', password: 'wrong wrong wrong' })
    expect((await call(a, 'POST', '/api/auth/login', { email: 'ann@x.org', password: 'a long password' })).status).toBe(429)
  })

  it('makes BRAINCRAFT_ADMINS admins, and only they may set the server up', async () => {
    const a = new Accounts({ dir: tempDir(), admins: ['boss@x.org'] })
    expect((await call(a, 'POST', '/api/auth/setup', { email: 'other@x.org', password: 'a long password' })).status).toBe(403)
    expect((await call(a, 'POST', '/api/auth/setup', { email: 'boss@x.org', password: 'a long password' })).body).toMatchObject({ user: { role: 'admin' } })
  })
})

describe('admins', () => {
  async function admin() {
    const a = new Accounts({ dir: tempDir() })
    const cookie = cookieOf(await call(a, 'POST', '/api/auth/setup', { email: 'ann@x.org', name: 'Ann', password: 'a long password' }))
    return { a, cookie }
  }

  it('add people with a set-your-password link, put them in groups, and turn them off', async () => {
    const { a, cookie } = await admin()
    const g = await call(a, 'POST', '/api/admin/groups', { name: 'Planners', permissions: ['boards.create', 'nonsense'] }, { cookie })
    const group = g.body.group as Group
    expect(group.permissions).toEqual(['boards.create'])
    const added = await call(a, 'POST', '/api/admin/users', { email: 'sam@x.org', name: 'Sam', groups: [group.id, 'unknown'] }, { cookie })
    expect(added.status).toBe(201)
    expect(added.body.user).toMatchObject({ email: 'sam@x.org', groups: [group.id], password: false })
    const link = String(added.body.link)
    expect(link).toMatch(/^http:\/\/localhost:8080\/#reset=/)
    // Sam follows the link and chooses a password: signed in.
    const reset = await call(a, 'POST', '/api/auth/reset', { token: link.split('#reset=')[1], password: 'sams long password' })
    expect(reset.body).toMatchObject({ user: { name: 'Sam' }, permissions: expect.arrayContaining(['boards.create']) })
    const sam = cookieOf(reset)
    // The link works once.
    expect((await call(a, 'POST', '/api/auth/reset', { token: link.split('#reset=')[1], password: 'another long one' })).status).toBe(400)
    // Sam isn't an admin.
    expect((await call(a, 'GET', '/api/admin/users', undefined, { cookie: sam })).status).toBe(403)
    // Turned off: signed out everywhere.
    const samId = (added.body.user as { id: string }).id
    await call(a, 'PATCH', `/api/admin/users/${samId}`, { disabled: true }, { cookie })
    expect((await call(a, 'GET', '/api/auth/me', undefined, { cookie: sam })).body).toMatchObject({ user: null })
    expect((await call(a, 'POST', '/api/auth/login', { email: 'sam@x.org', password: 'sams long password' })).status).toBe(403)
  })

  it('keep at least one admin, and can’t remove themselves', async () => {
    const { a, cookie } = await admin()
    const me = (await call(a, 'GET', '/api/auth/me', undefined, { cookie })).body.user as { id: string }
    expect((await call(a, 'PATCH', `/api/admin/users/${me.id}`, { role: 'user' }, { cookie })).status).toBe(409)
    expect((await call(a, 'DELETE', `/api/admin/users/${me.id}`, undefined, { cookie })).status).toBe(409)
    expect((await call(a, 'DELETE', '/api/admin/groups/everyone', undefined, { cookie })).status).toBe(409)
  })

  it('hand out API tokens that scripts sign in with', async () => {
    const { a, cookie } = await admin()
    const made = await call(a, 'POST', '/api/auth/tokens', { name: 'My script' }, { cookie })
    const token = String(made.body.token)
    expect(token).toMatch(/^bct_/)
    const viaToken = await call(a, 'GET', '/api/auth/me', undefined, { authorization: `Bearer ${token}` })
    expect(viaToken.body).toMatchObject({ user: { name: 'Ann' } })
    const id = (made.body.tokens as { id: string }[])[0].id
    await call(a, 'DELETE', `/api/auth/tokens/${id}`, undefined, { cookie })
    expect((await call(a, 'GET', '/api/auth/me', undefined, { authorization: `Bearer ${token}` })).body).toMatchObject({ user: null })
  })

  it('let people find others only by exact email without “See everyone”', async () => {
    const { a, cookie } = await admin()
    const link = String((await call(a, 'POST', '/api/admin/users', { email: 'sam@x.org', name: 'Sam' }, { cookie })).body.link)
    const sam = cookieOf(await call(a, 'POST', '/api/auth/reset', { token: link.split('#reset=')[1], password: 'sams long password' }))
    expect((await call(a, 'GET', '/api/people?q=an', undefined, { cookie: sam })).body).toEqual({ people: [], groups: [] })
    expect(((await call(a, 'GET', '/api/people?q=ann@x.org', undefined, { cookie: sam })).body.people as unknown[]).length).toBe(1)
    expect(((await call(a, 'GET', '/api/people?q=an', undefined, { cookie })).body.people as unknown[]).length).toBe(1)
  })
})
