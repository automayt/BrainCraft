/**
 * Link previews: a web page's title, description and picture, for link cards.
 *
 * The server fetches pages for anyone who can reach it, so it must not become a
 * way into private networks (SSRF). Only http and https on the standard ports;
 * no user names or passwords in the address; every DNS answer has to be a
 * public address, and the connection goes to the address that was checked, so
 * a second lookup can't swap in a private one; each redirect is checked the same
 * way; and the time and the bytes read are capped. Only metadata comes back,
 * never the page itself.
 */

import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

export interface Preview {
  url: string
  title?: string
  description?: string
  image?: string
  site?: string
}

export class UnfurlError extends Error {}

// Addresses that aren't the public internet: private, loopback, link-local,
// carrier-grade NAT, documentation, multicast, reserved, and IPv6 forms that
// can carry an IPv4 address inside them.
// Two lists, because a BlockList also matches IPv4 addresses against IPv6 rules like ::ffff:0:0/96.
const BLOCKED4 = new BlockList()
const BLOCKED6 = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  BLOCKED4.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  ['::', 127],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  BLOCKED6.addSubnet(net, bits, 'ipv6')

/** Whether `ip` is an address on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip)
  if (!v) return false
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapped) return isPublicAddress(mapped[1])
  return v === 4 ? !BLOCKED4.check(ip, 'ipv4') : !BLOCKED6.check(ip, 'ipv6')
}

/** The address as a URL this server is willing to fetch, or an error saying why not. */
export function checkUrl(raw: string, anyPort = false): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new UnfurlError('That isn’t a web address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnfurlError('Only http and https links have previews')
  if (url.username || url.password) throw new UnfurlError('Links with a user name or password don’t get previews')
  if (!anyPort && url.port && url.port !== '80' && url.port !== '443') throw new UnfurlError('Only links on the standard ports get previews')
  if (raw.length > 2048) throw new UnfurlError('That link is too long')
  return url
}

type Lookup = (host: string, cb: (err: Error | null, addresses: LookupAddress[]) => void) => void

export interface UnfurlOptions {
  /** DNS lookup returning every address; replaceable in tests. */
  lookup?: Lookup
  /** Which addresses may be connected to (default: public ones only). */
  allow?: (ip: string) => boolean
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** Allow any port (tests, whose server sits on a random one). */
  anyPort?: boolean
}

const systemLookup: Lookup = (host, cb) => dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => cb(err, addrs ?? []))

interface Fetched {
  status: number
  location?: string
  type: string
  body: string
}

/** One GET, connecting only to an address `allow` accepts. Reads at most `maxBytes`. */
function fetchOnce(url: URL, o: Required<UnfurlOptions>): Promise<Fetched> {
  return new Promise((ok, fail) => {
    const host = url.hostname.replace(/^\[|\]$/g, '')
    // Node connects straight to an IP literal without a lookup, so check those here.
    if (isIP(host) && !o.allow(host)) return fail(new UnfurlError('That address isn’t on the public internet'))
    const lookup = (hostname: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
      o.lookup(hostname, (err, addrs) => {
        if (err) return cb(new UnfurlError('That site couldn’t be found'))
        if (!addrs.length || !addrs.every((a) => o.allow(a.address))) return cb(new UnfurlError('That address isn’t on the public internet'))
        if (opts.all) cb(null, addrs)
        else cb(null, addrs[0].address, addrs[0].family)
      })
    }
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(
      url,
      {
        method: 'GET',
        lookup: lookup as never,
        headers: { 'user-agent': 'BrainCraft link preview', accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en' },
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0
        const type = String(res.headers['content-type'] ?? '')
        const location = res.headers.location
        // Only HTML is worth reading; the <head> is near the top.
        if (status >= 300 || !/html/i.test(type)) {
          res.resume()
          req.destroy()
          return ok({ status, ...(location ? { location } : {}), type, body: '' })
        }
        const chunks: Buffer[] = []
        let size = 0
        const done = () => ok({ status, type, body: Buffer.concat(chunks).toString('utf8') })
        res.on('data', (c: Buffer) => {
          chunks.push(c)
          size += c.length
          if (size >= o.maxBytes || /<\/head>/i.test(c.toString('latin1'))) {
            res.destroy()
            done()
          }
        })
        res.on('end', done)
        res.on('error', done)
      },
    )
    req.setTimeout(o.timeoutMs, () => req.destroy(new UnfurlError('That site took too long to answer')))
    req.on('error', (err) => fail(err instanceof UnfurlError ? err : new UnfurlError('That site couldn’t be reached')))
    req.end()
  })
}

/** Fetches `raw` (following checked redirects) and reads its preview. */
export async function unfurl(raw: string, options: UnfurlOptions = {}): Promise<Preview> {
  const o: Required<UnfurlOptions> = {
    lookup: systemLookup,
    allow: isPublicAddress,
    timeoutMs: 5000,
    // Some sites (video sites especially) put ~1 MB of scripts before their preview tags.
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 4,
    anyPort: false,
    ...options,
  }
  const start = checkUrl(raw, o.anyPort)
  let url = start
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    const r = await fetchOnce(url, o)
    if (r.status >= 300 && r.status < 400 && r.location) {
      url = checkUrl(new URL(r.location, url).href, o.anyPort)
      continue
    }
    if (r.status >= 400) throw new UnfurlError(`That page answered ${r.status}`)
    const site = siteName(url)
    if (!r.body) return { url: start.href, site, title: fileName(url) ?? site }
    return { ...readMeta(r.body, url), url: start.href }
  }
  throw new UnfurlError('That link redirects too many times')
}

const siteName = (url: URL) => url.hostname.replace(/^www\./, '')

function fileName(url: URL): string | undefined {
  const last = decodeURIComponent(url.pathname.split('/').pop() ?? '')
  return last || undefined
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

const clip = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Title, description, picture and site name from a page's <head>, Open Graph first. */
export function readMeta(html: string, base: URL): Omit<Preview, 'url'> {
  const head = html.slice(0, (html.search(/<\/head>/i) + 1 || html.length + 1) + 6)
  const meta = new Map<string, string>()
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>()
    for (const a of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) attrs.set(a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '')
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase()
    const content = attrs.get('content')
    if (key && content && !meta.has(key)) meta.set(key, decode(content))
  }
  const first = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v)
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  const title = first('og:title', 'twitter:title') ?? (titleTag ? decode(titleTag) : undefined)
  const description = first('og:description', 'twitter:description', 'description')
  let image: string | undefined
  const rawImage = first('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src')
  if (rawImage) {
    try {
      const u = new URL(rawImage, base)
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.href.length <= 2048) image = u.href
    } catch {
      // Not a usable address: no picture.
    }
  }
  return {
    ...(title ? { title: clip(title, 200) } : {}),
    ...(description ? { description: clip(description, 300) } : {}),
    ...(image ? { image } : {}),
    site: clip(first('og:site_name'), 80) ?? siteName(base),
  }
}

/** Remembers previews (and failures, briefly) so a busy board doesn't refetch the same page. */
export class PreviewCache {
  private entries = new Map<string, { at: number; value: Preview | UnfurlError }>()
  private readonly max: number
  constructor(max = 500) {
    this.max = max
  }

  async get(url: string, fetcher: (url: string) => Promise<Preview>, now = Date.now()): Promise<Preview> {
    const hit = this.entries.get(url)
    const ttl = hit?.value instanceof UnfurlError ? 5 * 60_000 : 60 * 60_000
    if (hit && now - hit.at < ttl) {
      if (hit.value instanceof UnfurlError) throw hit.value
      return hit.value
    }
    let value: Preview | UnfurlError
    try {
      value = await fetcher(url)
    } catch (err) {
      value = err instanceof UnfurlError ? err : new UnfurlError('That page couldn’t be read')
    }
    this.entries.delete(url)
    this.entries.set(url, { at: now, value })
    // Oldest out first (a Map keeps insertion order).
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!)
    if (value instanceof UnfurlError) throw value
    return value
  }
}
