/**
 * A pretend single sign-on provider: a small but real OpenID Connect provider (discovery, an
 * authorize page, a token endpoint with PKCE, published keys, user info), so sign-in can be tried
 * and tested without a real one. With BRAINCRAFT_DEV_IDP=1 the server serves it at /dev-idp,
 * where its sign-in page asks for any email, name and groups. Tests run it on its own port.
 *
 * Never for real use: anyone can claim to be anyone here.
 */

import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export interface DevPerson {
  email: string
  name: string
  groups: string[]
}

interface Pending {
  person: DevPerson
  clientId: string
  redirectUri: string
  nonce: string
  challenge: string
  expires: number
}

export class DevIdp {
  /** The issuer: its address, e.g. http://localhost:8080/dev-idp. */
  issuer: string
  clientId: string
  clientSecret: string
  private privateKey: KeyObject
  private publicJwk: Record<string, unknown>
  private kid = b64(randomBytes(6))
  private codes = new Map<string, Pending>()
  private access = new Map<string, DevPerson>()
  now: () => number

  constructor(issuer: string, clientId = 'braincraft-dev', clientSecret = 'dev-secret', now: () => number = Date.now) {
    this.issuer = issuer.replace(/\/+$/, '')
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.now = now
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    this.privateKey = privateKey
    this.publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: this.kid, alg: 'RS256', use: 'sig' }
  }

  /** An ID token for someone, signed with this provider's key (tests bend the claims to make bad ones). */
  idToken(person: DevPerson, nonce: string, extra: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
    const nowS = Math.floor(this.now() / 1000)
    const h = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: this.kid, ...header }))
    const c = b64(
      JSON.stringify({
        iss: this.issuer,
        sub: b64(createHash('sha256').update(person.email.toLowerCase()).digest()).slice(0, 22),
        aud: this.clientId,
        iat: nowS,
        exp: nowS + 600,
        nonce,
        email: person.email,
        email_verified: true,
        name: person.name,
        groups: person.groups,
        ...extra,
      }),
    )
    return `${h}.${c}.${b64(sign('sha256', Buffer.from(`${h}.${c}`), this.privateKey))}`
  }

  /** Approves a sign-in as `person` (what the authorize page does): the code to send back. */
  approve(params: URLSearchParams, person: DevPerson): { redirect: string } | { error: string } {
    const clientId = params.get('client_id') ?? ''
    const redirectUri = params.get('redirect_uri') ?? ''
    if (clientId !== this.clientId) return { error: 'Unknown client_id' }
    if (params.get('response_type') !== 'code') return { error: 'Only response_type=code' }
    if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) return { error: 'PKCE (S256) is required' }
    const code = b64(randomBytes(18))
    this.codes.set(code, { person, clientId, redirectUri, nonce: params.get('nonce') ?? '', challenge: params.get('code_challenge')!, expires: this.now() + 60_000 })
    const back = new URL(redirectUri)
    back.searchParams.set('code', code)
    back.searchParams.set('state', params.get('state') ?? '')
    return { redirect: back.toString() }
  }

  /** Serves the provider's endpoints under its issuer's path; false for other paths. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, body: () => Promise<string>): Promise<boolean> {
    const base = new URL(this.issuer).pathname.replace(/\/+$/, '')
    if (!url.pathname.startsWith(`${base}/`)) return false
    const path = url.pathname.slice(base.length)
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(v))
    }

    if (path === '/.well-known/openid-configuration') {
      return (
        json(200, {
          issuer: this.issuer,
          authorization_endpoint: `${this.issuer}/authorize`,
          token_endpoint: `${this.issuer}/token`,
          jwks_uri: `${this.issuer}/jwks`,
          userinfo_endpoint: `${this.issuer}/userinfo`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        }),
        true
      )
    }
    if (path === '/jwks') return json(200, { keys: [this.publicJwk] }), true

    if (path === '/authorize' && req.method === 'GET') {
      const hidden = [...url.searchParams].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Test sign-in</title>
<style>body{font:15px system-ui;max-width:420px;margin:60px auto;padding:0 16px}label{display:block;margin:12px 0 4px}input[type=text],input[type=email]{width:100%;padding:8px;font:inherit}button{margin-top:16px;padding:8px 16px;font:inherit}p{color:#a33}</style>
<h1>Test sign-in provider</h1><p>For trying single sign-on on your own computer. Anyone can be anyone here.</p>
<form method="post">${hidden}<label>Email</label><input type="email" name="email" required value="admin@example.com">
<label>Name</label><input type="text" name="name" value="Test Admin"><label>Groups (comma-separated)</label><input type="text" name="groups" value="">
<button>Sign in</button></form>`)
      return true
    }
    if (path === '/authorize' && req.method === 'POST') {
      const form = new URLSearchParams(await body())
      const email = (form.get('email') ?? '').trim()
      if (!email) return json(400, { error: 'email required' }), true
      const out = this.approve(form, { email, name: (form.get('name') ?? '').trim() || email, groups: (form.get('groups') ?? '').split(',').map((g) => g.trim()).filter(Boolean) })
      if ('error' in out) return json(400, { error: out.error }), true
      res.writeHead(302, { location: out.redirect })
      return res.end(), true
    }

    if (path === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await body())
      let clientId = form.get('client_id') ?? ''
      let secret = form.get('client_secret') ?? ''
      const auth = req.headers.authorization
      if (auth?.startsWith('Basic ')) {
        const [id, s] = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':')
        clientId = decodeURIComponent(id ?? '')
        secret = decodeURIComponent(s ?? '')
      }
      if (clientId !== this.clientId || secret !== this.clientSecret) return json(401, { error: 'invalid_client' }), true
      const p = this.codes.get(form.get('code') ?? '')
      this.codes.delete(form.get('code') ?? '')
      if (!p || p.expires < this.now()) return json(400, { error: 'invalid_grant', error_description: 'Unknown or used code' }), true
      if (p.redirectUri !== form.get('redirect_uri')) return json(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' }), true
      if (b64(createHash('sha256').update(form.get('code_verifier') ?? '').digest()) !== p.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE check failed' }), true
      const accessToken = b64(randomBytes(18))
      this.access.set(accessToken, p.person)
      return json(200, { token_type: 'Bearer', expires_in: 600, access_token: accessToken, id_token: this.idToken(p.person, p.nonce) }), true
    }

    if (path === '/userinfo') {
      const person = this.access.get((req.headers.authorization ?? '').replace(/^Bearer /, ''))
      if (!person) return json(401, { error: 'invalid_token' }), true
      const claims = JSON.parse(Buffer.from(this.idToken(person, '').split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
      return json(200, { sub: claims.sub, email: person.email, email_verified: true, name: person.name, groups: person.groups }), true
    }
    return json(404, { error: 'Not found' }), true
  }
}
