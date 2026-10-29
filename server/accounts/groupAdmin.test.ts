import { describe, expect, it } from 'vitest'
import { groupsAdminOf, looksAfter } from './access'
import { cookieOf, req, res, tempDir } from './fakes'
import { Accounts } from './service'
import type { Group, User } from './types'

async function call(a: Accounts, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = res()
  const handled = await a.handle(req(method, headers), r, new URL(`http://localhost:8080${path}`), async () => (body === undefined ? '' : JSON.stringify(body)))
  expect(handled).toBe(true)
  return r.reply
}

type Person = { id: string; name: string; groups: string[]; yours: boolean; admin?: boolean; fromSignIn?: string[] }

/** Ann (admin); groups Design and Sales; Bob, group admin of Design; Cara in both; Dan in Sales. */
async function setup() {
  const a = new Accounts({ dir: tempDir() })
  const ann = cookieOf(await call(a, 'POST', '/api/auth/setup', { email: 'ann@x.org', name: 'Ann', password: 'a long password' }))
  const group = async (name: string) => ((await call(a, 'POST', '/api/admin/groups', { name, permissions: ['boards.create'] }, { cookie: ann })).body.group as Group).id
  const design = await group('Design')
  const sales = await group('Sales')
  const person = async (email: string, name: string, groups: string[]) => {
    const made = await call(a, 'POST', '/api/admin/users', { email, name, groups }, { cookie: ann })
    const id = (made.body.user as { id: string }).id
    const cookie = cookieOf(await call(a, 'POST', '/api/auth/reset', { token: String(made.body.link).split('#reset=')[1], password: `${name} long password` }))
    return { id, cookie }
  }
  const bob = await person('bob@x.org', 'Bob', [])
  const cara = await person('cara@x.org', 'Cara', [design, sales])
  const dan = await person('dan@x.org', 'Dan', [sales])
  await call(a, 'PATCH', `/api/admin/groups/${design}`, { admins: [bob.id, 'nobody'] }, { cookie: ann })
  return { a, ann, design, sales, bob, cara, dan }
}

const team = async (a: Accounts, cookie: string) => (await call(a, 'GET', '/api/team', undefined, { cookie })).body as { groups: { id: string; name: string }[]; people: Person[] }

describe('group admins', () => {
  it('see only the groups they run and the people in them', async () => {
    const { a, ann, design, bob, cara } = await setup()
    expect((await call(a, 'GET', '/api/auth/me', undefined, { cookie: bob.cookie })).body.groupAdmin).toEqual([{ id: design, name: 'Design' }])
    expect((await call(a, 'GET', '/api/admin/groups', undefined, { cookie: ann })).body.groups).toContainEqual(expect.objectContaining({ id: design, admins: [bob.id] }))
    const t = await team(a, bob.cookie)
    expect(t.groups.map((g) => g.name)).toEqual(['Design'])
    // Cara is in Sales too, which Bob doesn't see; Dan isn't in Design at all.
    expect(t.people).toEqual([expect.objectContaining({ name: 'Cara', groups: [design], yours: false })])
    // None of the admin screen.
    expect((await call(a, 'GET', '/api/admin/users', undefined, { cookie: bob.cookie })).status).toBe(403)
    expect((await call(a, 'PATCH', `/api/admin/groups/${design}`, { permissions: ['people.see'] }, { cookie: bob.cookie })).status).toBe(403)
    // Nor anything for someone who runs no group.
    expect((await call(a, 'GET', '/api/team', undefined, { cookie: cara.cookie })).status).toBe(403)
  })

  it('add new people to their groups only, who get a set-your-password link', async () => {
    const { a, design, sales, bob } = await setup()
    const made = await call(a, 'POST', '/api/team/people', { email: 'eve@x.org', name: 'Eve', groups: [design, sales], role: 'admin' }, { cookie: bob.cookie })
    expect(made.status).toBe(201)
    const eve = (made.body.people as Person[]).find((p) => p.name === 'Eve')!
    expect(eve).toMatchObject({ groups: [design], yours: true })
    expect(eve.admin).toBeUndefined()
    const signedIn = await call(a, 'POST', '/api/auth/reset', { token: String(made.body.link).split('#reset=')[1], password: 'eves long password' })
    expect(signedIn.body).toMatchObject({ user: { name: 'Eve', role: 'user', groups: [design] }, permissions: expect.arrayContaining(['boards.create']) })
    // Somewhere to put them is needed.
    expect((await call(a, 'POST', '/api/team/people', { email: 'fred@x.org', groups: [sales] }, { cookie: bob.cookie })).status).toBe(400)
  })

  it('add someone with an account already by email, and take them out again, leaving their other groups', async () => {
    const { a, design, sales, bob, dan } = await setup()
    const added = await call(a, 'POST', '/api/team/people', { email: 'DAN@x.org', groups: [design] }, { cookie: bob.cookie })
    expect(added.body).toMatchObject({ added: 'Dan', existing: true })
    expect((added.body.people as Person[]).find((p) => p.id === dan.id)).toMatchObject({ groups: [design], yours: false })
    await call(a, 'PATCH', `/api/team/people/${dan.id}`, { groups: [sales] }, { cookie: bob.cookie })
    expect(a.store.user(dan.id)!.groups).toEqual([sales])
    // Out of Bob's groups: no longer his to see.
    expect((await call(a, 'PATCH', `/api/team/people/${dan.id}`, { groups: [design] }, { cookie: bob.cookie })).status).toBe(404)
  })

  it('look after people only in their groups, not anyone on another team, an admin or another group admin', async () => {
    const { a, ann, design, bob, cara } = await setup()
    const made = await call(a, 'POST', '/api/team/people', { email: 'eve@x.org', name: 'Eve', groups: [design] }, { cookie: bob.cookie })
    const eve = (made.body.people as Person[]).find((p) => p.name === 'Eve')!
    const eveCookie = cookieOf(await call(a, 'POST', '/api/auth/reset', { token: String(made.body.link).split('#reset=')[1], password: 'eves long password' }))
    expect((await call(a, 'POST', `/api/team/people/${eve.id}/reset`, undefined, { cookie: bob.cookie })).body.link).toMatch(/#reset=/)
    await call(a, 'PATCH', `/api/team/people/${eve.id}`, { disabled: true }, { cookie: bob.cookie })
    expect((await call(a, 'GET', '/api/auth/me', undefined, { cookie: eveCookie })).body.user).toBeNull()
    // Cara is in Sales too: an admin looks after her.
    expect((await call(a, 'POST', `/api/team/people/${cara.id}/reset`, undefined, { cookie: bob.cookie })).status).toBe(403)
    expect((await call(a, 'PATCH', `/api/team/people/${cara.id}`, { disabled: true }, { cookie: bob.cookie })).status).toBe(403)
    expect(a.store.user(cara.id)!.disabled).toBeUndefined()
    // An admin put in Design, and Eve once she's another group admin of it, are out of reach too.
    await call(a, 'POST', '/api/team/people', { email: 'ann@x.org', groups: [design] }, { cookie: bob.cookie })
    const annId = a.store.byEmail('ann@x.org')!.id
    expect((await call(a, 'POST', `/api/team/people/${annId}/reset`, undefined, { cookie: bob.cookie })).status).toBe(403)
    await call(a, 'PATCH', `/api/team/people/${eve.id}`, { disabled: false }, { cookie: bob.cookie })
    await call(a, 'PATCH', `/api/admin/groups/${design}`, { admins: [bob.id, eve.id] }, { cookie: ann })
    expect((await call(a, 'POST', `/api/team/people/${eve.id}/reset`, undefined, { cookie: bob.cookie })).status).toBe(403)
    // Written in the activity log as a group admin's doing.
    const log = (await call(a, 'GET', '/api/admin/audit', undefined, { cookie: ann })).body.entries as { text: string }[]
    expect(log.some((e) => e.text === 'Bob (group admin) made a set-your-password link for Eve')).toBe(true)
  })

  it('stop being one when their account is turned off or removed, or the admin takes it away', async () => {
    const { a, ann, design, bob } = await setup()
    await call(a, 'PATCH', `/api/admin/users/${bob.id}`, { disabled: true }, { cookie: ann })
    expect(groupsAdminOf(a.store.user(bob.id)!, a.store.groups)).toEqual([])
    await call(a, 'DELETE', `/api/admin/users/${bob.id}`, undefined, { cookie: ann })
    expect(a.store.groups.find((g) => g.id === design)!.admins).toBeUndefined()
    // Emptying a list takes it away (provider group names too).
    await call(a, 'PATCH', `/api/admin/groups/${design}`, { ssoGroups: ['Designers'] }, { cookie: ann })
    await call(a, 'PATCH', `/api/admin/groups/${design}`, { ssoGroups: [] }, { cookie: ann })
    expect(a.store.groups.find((g) => g.id === design)!.ssoGroups).toBeUndefined()
    // Everyone can't have group admins.
    await call(a, 'PATCH', '/api/admin/groups/everyone', { admins: [a.store.byEmail('ann@x.org')!.id] }, { cookie: ann })
    expect(a.store.groups.find((g) => g.everyone)!.admins).toBeUndefined()
  })
})

describe('who a group admin looks after', () => {
  const groups: Group[] = [
    { id: 'everyone', name: 'Everyone', permissions: [], everyone: true },
    { id: 'design', name: 'Design', permissions: [], admins: ['bob'], ssoGroups: ['designers'] },
    { id: 'sales', name: 'Sales', permissions: [], ssoGroups: ['sellers'] },
  ]
  const user = (over: Partial<User>): User => ({ id: 'x', email: 'x@x.org', name: 'X', role: 'user', groups: [], created: 0, ...over })
  const bob = user({ id: 'bob' })
  it('counts groups from single sign-on as well', () => {
    expect(looksAfter(bob, user({ groups: ['design'] }), groups)).toBe(true)
    expect(looksAfter(bob, user({ ssoGroups: ['designers'] }), groups)).toBe(true)
    expect(looksAfter(bob, user({ groups: ['design'], ssoGroups: ['sellers'] }), groups)).toBe(false)
    // Someone in no group at all isn't in Bob's care.
    expect(looksAfter(bob, user({}), groups)).toBe(false)
    expect(looksAfter(bob, bob, groups)).toBe(false)
  })
})
