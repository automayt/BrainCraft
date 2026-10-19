import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DevIdp } from './devIdp'
import { cookieOf, req, res, tempDir } from './fakes'
import { OidcProvider, verifyIdToken } from './oidc'
import { Accounts, parseCookies } from './service'

let server: Server
let idp: DevIdp
let issuer = ''

beforeAll(async () => {
  server = createServer((rq, rs) => {
    const chunks: Buffer[] = []
    rq.on('data', (c: Buffer) => chunks.push(c))
    rq.on('end', () => void idp.handle(rq, rs, new URL(rq.url ?? '/', issuer), async () => Buffer.concat(chunks).toString('utf8')))
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/idp`
  idp = new DevIdp(issuer)
})
afterAll(() => new Promise<void>((ok) => server.close(() => ok())))

const REDIRECT = 'http://localhost:8080/api/auth/sso/callback'

function setup(admins: string[] = []) {
  const sso = new OidcProvider({ issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, label: 'Sign in with Test', redirectUri: REDIRECT })
  const accounts = new Accounts({ dir: tempDir(), sso, admins })
  const call = async (path: string, cookie = '') => {
    const r = res()
    await accounts.handle(req('GET', { cookie }), r, new URL(`http://localhost:8080${path}`), async () => '')
    return r.reply
  }
  /** A whole sign-in: start here, sign in at the provider as `person`, come back. */
  const signIn = async (person: { email: string; name: string; groups: string[] }) => {
    const start = await call('/api/auth/sso/start?return=/boards')
    expect(start.status).toBe(302)
    const authorize = new URL(String(start.headers.location))
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    const ssoCookie = String(start.headers['set-cookie']).split(';')[0]
    // The person fills in the provider's form.
    const form = new URLSearchParams(authorize.searchParams)
    form.set('email', person.email)
    form.set('name', person.name)
    form.set('groups', person.groups.join(','))
    const back = await fetch(`${issuer}/authorize`, { method: 'POST', body: form, redirect: 'manual' })
    const callback = new URL(String(back.headers.get('location')))
    const done = await call(`/api/auth/sso/callback${callback.search}`, ssoCookie)
    return { done, callback, ssoCookie }
  }
  return { accounts, call, signIn, sso }
}

describe('single sign-on against the test provider', () => {
  it('signs someone in end to end, makes their account, and puts them in groups by the provider’s', async () => {
    const t = setup(['boss@x.org'])
    const g = t.accounts.store.addGroup({ name: 'Staff', permissions: ['people.see'], ssoGroups: ['staff-all'] })
    const { done } = await t.signIn({ email: 'Sam@X.org', name: 'Sam', groups: ['Staff-All'] })
    expect(done.status).toBe(302)
    expect(done.headers.location).toBe('/boards')
    const me = await t.call('/api/auth/me', cookieOf(done))
    expect(me.body).toMatchObject({ user: { email: 'sam@x.org', name: 'Sam', sso: true, role: 'user' }, permissions: expect.arrayContaining(['people.see']) })
    expect(t.accounts.store.byEmail('sam@x.org')!.ssoGroups).toEqual(['Staff-All'])
    expect(g.id).toBeTruthy()
    // Someone listed in BRAINCRAFT_ADMINS comes in as an admin.
    const boss = await t.signIn({ email: 'boss@x.org', name: 'Boss', groups: [] })
    expect((await t.call('/api/auth/me', cookieOf(boss.done))).body).toMatchObject({ user: { role: 'admin' } })
  })

  it('links an account an admin made earlier by its verified email, once', async () => {
    const t = setup()
    const made = t.accounts.store.addUser({ email: 'lee@x.org', name: 'Lee (added)', role: 'user' })
    const { done } = await t.signIn({ email: 'lee@x.org', name: 'Lee', groups: [] })
    expect((await t.call('/api/auth/me', cookieOf(done))).body).toMatchObject({ user: { id: made.id, sso: true } })
    expect(t.accounts.store.users).toHaveLength(1)
  })

  it('refuses a replayed sign-in and a cookie from somewhere else', async () => {
    const t = setup()
    const { callback, ssoCookie } = await t.signIn({ email: 'a@x.org', name: 'A', groups: [] })
    const again = await t.call(`/api/auth/sso/callback${callback.search}`, ssoCookie)
    expect(String(again.headers.location)).toMatch(/#signin-error=/)
    const forged = await t.call(`/api/auth/sso/callback${callback.search}`, 'braincraft_sso=abc.def')
    expect(decodeURIComponent(String(forged.headers.location))).toMatch(/wasn’t started here/)
    // A different state than the one started.
    const start = await t.call('/api/auth/sso/start')
    const cookie = String(start.headers['set-cookie']).split(';')[0]
    const wrong = await t.call('/api/auth/sso/callback?code=x&state=not-it', cookie)
    expect(decodeURIComponent(String(wrong.headers.location))).toMatch(/doesn’t match/)
    expect(parseCookies('a=1; braincraft_sso=x.y')).toEqual({ a: '1', braincraft_sso: 'x.y' })
  })
})

describe('checking ID tokens', () => {
  const person = { email: 'a@x.org', name: 'A', groups: [] }
  const key = async () => createPublicKey({ key: (idp as unknown as { publicJwk: object }).publicJwk as never, format: 'jwk' }) as never
  const opts = (over: object = {}) => ({ issuer, clientId: idp.clientId, nonce: 'n1', now: Date.now(), key, ...over })

  it('accepts a good one', async () => {
    expect((await verifyIdToken(idp.idToken(person, 'n1'), opts())).email).toBe('a@x.org')
  })

  it('refuses the wrong audience, issuer or nonce, an expired token, a forged signature and "none"', async () => {
    await expect(verifyIdToken(idp.idToken(person, 'n1', { aud: 'someone-else' }), opts())).rejects.toThrow(/another application/)
    await expect(verifyIdToken(idp.idToken(person, 'n1', { iss: 'https://evil.example' }), opts())).rejects.toThrow(/another issuer/)
    await expect(verifyIdToken(idp.idToken(person, 'other'), opts())).rejects.toThrow(/doesn’t belong/)
    await expect(verifyIdToken(idp.idToken(person, 'n1', { exp: Math.floor(Date.now() / 1000) - 3600 }), opts())).rejects.toThrow(/expired/)
    const good = idp.idToken(person, 'n1').split('.')
    const tampered = `${good[0]}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(good[1], 'base64url').toString()), email: 'boss@x.org' })).toString('base64url')}.${good[2]}`
    await expect(verifyIdToken(tampered, opts())).rejects.toThrow(/signature/)
    const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${good[1]}.`
    await expect(verifyIdToken(none, opts())).rejects.toThrow(/algorithm/)
    // Signed by a key the provider doesn't publish.
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey
    await expect(verifyIdToken(idp.idToken(person, 'n1'), opts({ key: async () => other }))).rejects.toThrow(/signature/)
  })

  it('fetches the provider’s keys again for an unknown key id', async () => {
    const p = new OidcProvider({ issuer, clientId: idp.clientId, redirectUri: REDIRECT })
    let fetches = 0
    const counting = (async (u: string, i?: RequestInit) => {
      if (String(u).endsWith('/jwks')) fetches++
      return fetch(u, i)
    }) as typeof fetch
    ;(p as unknown as { o: { fetch: typeof fetch } }).o.fetch = counting
    const lookup = (p as unknown as { key: (kid?: string) => Promise<unknown> }).key.bind(p)
    expect(await lookup((idp as unknown as { kid: string }).kid)).toBeTruthy()
    expect(fetches).toBe(1)
    expect(await lookup('rotated-away')).toBeUndefined()
    // Once a minute at most: a second unknown id right away doesn't fetch again.
    expect(await lookup('rotated-away-2')).toBeUndefined()
    expect(fetches).toBeLessThanOrEqual(2)
  })
})
