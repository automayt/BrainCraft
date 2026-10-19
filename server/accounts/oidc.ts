/**
 * Single sign-on with OpenID Connect, the standard most identity providers speak (Entra ID, Okta,
 * Google Workspace, Keycloak, Authentik, Auth0…). Built on node:crypto alone:
 *
 * - discovery from `<issuer>/.well-known/openid-configuration`;
 * - the authorization-code flow with PKCE, `state` and `nonce` (kept in a short-lived, signed cookie);
 * - the code exchanged for tokens at the token endpoint;
 * - the ID token's signature checked against the provider's published keys (RS256/384/512,
 *   PS256, ES256/384), and its issuer, audience, expiry and nonce checked too.
 *
 * Settings: BRAINCRAFT_OIDC_ISSUER, BRAINCRAFT_OIDC_CLIENT_ID, BRAINCRAFT_OIDC_CLIENT_SECRET,
 * BRAINCRAFT_OIDC_SCOPES, BRAINCRAFT_OIDC_NAME (the button), BRAINCRAFT_OIDC_GROUPS_CLAIM, and
 * BRAINCRAFT_PUBLIC_URL for the address the provider sends people back to. BRAINCRAFT_DEV_IDP=1
 * uses the built-in pretend provider instead (devIdp.ts), for trying it on your own computer.
 */

import { createHash, createHmac, createPublicKey, type JsonWebKey, type KeyObject, randomBytes, timingSafeEqual, verify } from 'node:crypto'
import type { SsoIdentity, SsoProvider } from './service'

export interface OidcOptions {
  issuer: string
  clientId: string
  clientSecret?: string
  scopes?: string
  label?: string
  /** Where the provider sends people back to: `<public url>/api/auth/sso/callback`. */
  redirectUri: string
  /** The claim holding the person's groups (default "groups"). */
  groupsClaim?: string
  /** Signs the sign-in cookie. */
  secret?: Buffer
  fetch?: typeof fetch
  now?: () => number
}

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  userinfo_endpoint?: string
  token_endpoint_auth_methods_supported?: string[]
}

const b64 = (b: Buffer) => b.toString('base64url')
const sha256 = (s: string) => createHash('sha256').update(s).digest()

/** Leeway for clocks that disagree a little. */
const SKEW_S = 120
/** How long a sign-in may take at the provider. */
const START_MS = 10 * 60_000

const ALGS: Record<string, { hash: string; kind: 'rsa' | 'pss' | 'ec' }> = {
  RS256: { hash: 'sha256', kind: 'rsa' },
  RS384: { hash: 'sha384', kind: 'rsa' },
  RS512: { hash: 'sha512', kind: 'rsa' },
  PS256: { hash: 'sha256', kind: 'pss' },
  ES256: { hash: 'sha256', kind: 'ec' },
  ES384: { hash: 'sha384', kind: 'ec' },
}

export interface VerifyOptions {
  issuer: string
  clientId: string
  nonce: string
  now: number
  /** The key for a key id (refreshing the provider's keys once if it's unknown). */
  key: (kid: string | undefined) => Promise<KeyObject | undefined>
}

/** Checks an ID token; its claims, or throws saying what's wrong. */
export async function verifyIdToken(token: string, o: VerifyOptions): Promise<Record<string, unknown>> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('the ID token is malformed')
  let header: { alg?: string; kid?: string }
  let claims: Record<string, unknown>
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as typeof header
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new Error('the ID token is malformed')
  }
  const alg = header.alg ? ALGS[header.alg] : undefined
  // "none" and anything unexpected are refused outright.
  if (!alg) throw new Error(`the ID token uses an algorithm this server doesn't accept (${header.alg ?? 'none'})`)
  const key = await o.key(header.kid)
  if (!key) throw new Error('the ID token was signed with a key the provider doesn’t publish')
  const data = Buffer.from(`${parts[0]}.${parts[1]}`)
  const sig = Buffer.from(parts[2], 'base64url')
  const ok =
    alg.kind === 'ec'
      ? verify(alg.hash, data, { key, dsaEncoding: 'ieee-p1363' }, sig)
      : alg.kind === 'pss'
        ? verify(alg.hash, data, { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 }, sig)
        : verify(alg.hash, data, key, sig)
  if (!ok) throw new Error('the ID token’s signature doesn’t match')
  if (claims.iss !== o.issuer) throw new Error('the ID token comes from another issuer')
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(o.clientId)) throw new Error('the ID token is meant for another application')
  if (aud.length > 1 && claims.azp !== undefined && claims.azp !== o.clientId) throw new Error('the ID token is meant for another application')
  const nowS = o.now / 1000
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < nowS) throw new Error('the ID token has expired')
  if (typeof claims.nbf === 'number' && claims.nbf - SKEW_S > nowS) throw new Error('the ID token isn’t valid yet')
  if (claims.nonce !== o.nonce) throw new Error('the ID token doesn’t belong to this sign-in')
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('the ID token says nobody')
  return claims
}

export class OidcProvider implements SsoProvider {
  label: string
  redirectUri: string
  private o: OidcOptions & { secret: Buffer; fetch: typeof fetch; now: () => number }
  private meta: Discovery | null = null
  private keys = new Map<string, KeyObject>()
  private keysAt = 0

  constructor(o: OidcOptions) {
    this.o = { secret: randomBytes(32), fetch: globalThis.fetch.bind(globalThis), now: Date.now, ...o }
    this.label = o.label || 'Sign in with single sign-on'
    this.redirectUri = o.redirectUri
  }

  private get issuer() {
    return this.o.issuer.replace(/\/+$/, '')
  }

  /** The provider's endpoints (asked once, then remembered). */
  async discover(): Promise<Discovery> {
    if (this.meta) return this.meta
    const res = await this.o.fetch(`${this.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`the provider’s settings couldn’t be read (${res.status})`)
    const d = (await res.json()) as Discovery
    if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) throw new Error('the provider’s settings are missing endpoints')
    if (d.issuer.replace(/\/+$/, '') !== this.issuer) throw new Error('the provider says it is another issuer')
    this.meta = d
    return d
  }

  private async loadKeys() {
    const d = await this.discover()
    const res = await this.o.fetch(d.jwks_uri, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`the provider’s keys couldn’t be read (${res.status})`)
    const { keys } = (await res.json()) as { keys?: (JsonWebKey & { kid?: string; use?: string })[] }
    this.keys.clear()
    for (const k of keys ?? []) {
      if (k.use && k.use !== 'sig') continue
      try {
        this.keys.set(k.kid ?? '', createPublicKey({ key: k, format: 'jwk' }))
      } catch {
        // A key of a kind this server can't use is skipped.
      }
    }
    this.keysAt = this.o.now()
  }

  /** A key by id; an unknown id fetches the keys again (providers rotate them), at most once a minute. */
  private async key(kid: string | undefined): Promise<KeyObject | undefined> {
    if (!this.keys.size) await this.loadKeys()
    const find = () => (kid !== undefined ? this.keys.get(kid) : this.keys.size === 1 ? [...this.keys.values()][0] : undefined)
    if (!find() && this.o.now() - this.keysAt > 60_000) await this.loadKeys()
    return find()
  }

  private seal(v: object): string {
    const body = b64(Buffer.from(JSON.stringify(v)))
    return `${body}.${b64(createHmac('sha256', this.o.secret).update(body).digest())}`
  }

  private open(cookie: string | undefined): { state: string; nonce: string; verifier: string; returnTo: string; at: number } {
    const [body, mac] = (cookie ?? '').split('.')
    const want = createHmac('sha256', this.o.secret).update(body ?? '').digest()
    const got = Buffer.from(mac ?? '', 'base64url')
    if (!body || got.length !== want.length || !timingSafeEqual(got, want)) throw new Error('the sign-in wasn’t started here (or took too long); try again')
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ReturnType<OidcProvider['open']>
    if (this.o.now() - v.at > START_MS) throw new Error('the sign-in took too long; try again')
    return v
  }

  async start(returnTo: string): Promise<{ url: string; cookie: string }> {
    const d = await this.discover()
    const state = b64(randomBytes(16))
    const nonce = b64(randomBytes(16))
    const verifier = b64(randomBytes(32))
    const url = new URL(d.authorization_endpoint)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.o.clientId,
      redirect_uri: this.redirectUri,
      scope: this.o.scopes || 'openid email profile',
      state,
      nonce,
      code_challenge: b64(sha256(verifier)),
      code_challenge_method: 'S256',
    }).toString()
    const secure = this.redirectUri.startsWith('https:') ? '; Secure' : ''
    return { url: url.toString(), cookie: `braincraft_sso=${this.seal({ state, nonce, verifier, returnTo, at: this.o.now() })}; Path=/api/auth; Max-Age=600; HttpOnly; SameSite=Lax${secure}` }
  }

  async finish(query: URLSearchParams, cookie: string | undefined): Promise<SsoIdentity> {
    const err = query.get('error')
    if (err) throw new Error(query.get('error_description') || err)
    const saved = this.open(cookie)
    const state = query.get('state') ?? ''
    if (!state || state !== saved.state) throw new Error('the sign-in doesn’t match the one started here; try again')
    const code = query.get('code')
    if (!code) throw new Error('the provider sent no code')
    const d = await this.discover()

    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: saved.verifier, client_id: this.o.clientId })
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
    if (this.o.clientSecret) {
      // HTTP Basic unless the provider only takes the secret in the form.
      const methods = d.token_endpoint_auth_methods_supported ?? ['client_secret_basic']
      if (methods.includes('client_secret_basic')) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(this.o.clientId)}:${encodeURIComponent(this.o.clientSecret)}`).toString('base64')}`
      else form.set('client_secret', this.o.clientSecret)
    }
    const res = await this.o.fetch(d.token_endpoint, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(15_000) })
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string; error_description?: string }
    if (!res.ok || !tokens.id_token) throw new Error(tokens.error_description || tokens.error || `the provider wouldn’t exchange the code (${res.status})`)

    let claims = await verifyIdToken(tokens.id_token, { issuer: d.issuer, clientId: this.o.clientId, nonce: saved.nonce, now: this.o.now(), key: (kid) => this.key(kid) })
    // Some providers keep the email or groups out of the ID token; the user-info endpoint has them.
    const gc = this.o.groupsClaim || 'groups'
    if ((!claims.email || claims[gc] === undefined) && d.userinfo_endpoint && tokens.access_token) {
      const info = await this.o.fetch(d.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) })
      if (info.ok) {
        const more = (await info.json()) as Record<string, unknown>
        // The user-info answer must be about the same person.
        if (more.sub === claims.sub) claims = { ...more, ...claims, ...(claims[gc] === undefined && more[gc] !== undefined ? { [gc]: more[gc] } : {}) }
      }
    }
    const groupsRaw = claims[gc]
    const groups = Array.isArray(groupsRaw) ? groupsRaw.filter((g): g is string => typeof g === 'string') : typeof groupsRaw === 'string' ? [groupsRaw] : []
    return {
      issuer: d.issuer,
      subject: String(claims.sub),
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
      // Providers that don't say are trusted for their own users' emails only when told so.
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      ...(typeof claims.name === 'string' ? { name: claims.name } : typeof claims.preferred_username === 'string' ? { name: claims.preferred_username } : {}),
      groups,
      returnTo: saved.returnTo,
    }
  }
}

const isLocal = (url: string) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

/** The single sign-on the environment asks for, if any. */
export async function ssoFromEnv(env: NodeJS.ProcessEnv, publicUrl: string): Promise<OidcProvider | null> {
  const redirectUri = `${publicUrl.replace(/\/+$/, '')}/api/auth/sso/callback`
  if (/^(1|true|yes)$/i.test(env.BRAINCRAFT_DEV_IDP ?? '')) {
    // The pretend provider is for trying things on your own computer only.
    if (!isLocal(publicUrl)) throw new Error('BRAINCRAFT_DEV_IDP only works with a localhost BRAINCRAFT_PUBLIC_URL')
    return new OidcProvider({ issuer: `${publicUrl.replace(/\/+$/, '')}/dev-idp`, clientId: 'braincraft-dev', clientSecret: 'dev-secret', label: 'Sign in with the test provider', redirectUri })
  }
  const issuer = env.BRAINCRAFT_OIDC_ISSUER?.trim()
  const clientId = env.BRAINCRAFT_OIDC_CLIENT_ID?.trim()
  if (!issuer || !clientId) return null
  return new OidcProvider({
    issuer,
    clientId,
    clientSecret: env.BRAINCRAFT_OIDC_CLIENT_SECRET?.trim() || undefined,
    scopes: env.BRAINCRAFT_OIDC_SCOPES?.trim() || undefined,
    label: env.BRAINCRAFT_OIDC_NAME?.trim() || undefined,
    groupsClaim: env.BRAINCRAFT_OIDC_GROUPS_CLAIM?.trim() || undefined,
    redirectUri,
  })
}
