import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BusyError, checkUrl, isPublicAddress, PreviewCache, readMeta, unfurl, UnfurlError } from './unfurl'

describe('which addresses may be fetched', () => {
  it('allows public addresses only', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(ip), ip).toBe(true)
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.99',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a00:1',
      '2002:a00::1',
      'not-an-ip',
    ])
      expect(isPublicAddress(ip), ip).toBe(false)
  })

  it('accepts plain http(s) links on standard ports', () => {
    expect(checkUrl('https://example.com/a?b=1').hostname).toBe('example.com')
    expect(checkUrl('http://example.com:80/').hostname).toBe('example.com')
    for (const bad of ['ftp://example.com/', 'file:///etc/passwd', 'https://user:pw@example.com/', 'http://example.com:8080/', 'javascript:alert(1)', 'nope'])
      expect(() => checkUrl(bad), bad).toThrow(UnfurlError)
  })
})

describe('reading a page head', () => {
  it('prefers Open Graph, decodes entities and resolves the picture', () => {
    const html = `<!doctype html><html><head>
      <title>Plain &amp; simple</title>
      <meta name="description" content="Fallback">
      <meta property="og:title" content="Rust &#8211; the &quot;fun&quot; part">
      <meta content='Shared description' property='og:description'>
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Garage Blog">
    </head><body><meta property="og:title" content="ignored"></body></html>`
    expect(readMeta(html, new URL('https://blog.example.com/post/1'))).toEqual({
      title: 'Rust – the "fun" part',
      description: 'Shared description',
      image: 'https://blog.example.com/img/cover.png',
      site: 'Garage Blog',
    })
  })

  it('falls back to the title tag and host name, and drops odd pictures', () => {
    expect(readMeta('<title> Hello\n world </title><meta property="og:image" content="javascript:alert(1)">', new URL('https://www.example.org/'))).toEqual({
      title: 'Hello world',
      site: 'example.org',
    })
  })
})

describe('fetching previews', () => {
  let server: Server
  let port = 0
  const pages: Record<string, (res: import('node:http').ServerResponse) => void> = {
    '/page': (res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><head><title>Local page</title><meta property="og:description" content="Hi"></head><body>…</body></html>')
    },
    '/moved': (res) => {
      res.writeHead(302, { location: '/page' })
      res.end()
    },
    '/to-private': (res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
      res.end()
    },
    '/file.pdf': (res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end('%PDF')
    },
    '/gone': (res) => {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end('<title>Not here</title>')
    },
  }

  beforeAll(async () => {
    server = createServer((req, res) => (pages[req.url ?? ''] ?? pages['/gone'])(res))
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())))

  // The test server is on loopback at a random port: point a made-up name at it and allow just that.
  const local = (path: string) => `http://site.test:${port}${path}`
  const opts = {
    lookup: (_h: string, cb: (e: Error | null, a: { address: string; family: number }[]) => void) => cb(null, [{ address: '127.0.0.1', family: 4 }]),
    allow: (ip: string) => ip === '127.0.0.1',
    anyPort: true,
  }

  it('refuses private addresses by default, even behind a friendly name', async () => {
    await expect(unfurl('http://localhost/', { lookup: opts.lookup })).rejects.toThrow('public internet')
    await expect(unfurl('http://127.0.0.1/')).rejects.toThrow('public internet')
    await expect(unfurl('http://[::1]/')).rejects.toThrow('public internet')
  })

  it('reads a page, following redirects that stay allowed', async () => {
    const p = await unfurl(local('/moved'), opts)
    expect(p).toMatchObject({ title: 'Local page', description: 'Hi', site: 'site.test' })
  })

  it('stops at a redirect into a private network', async () => {
    await expect(unfurl(local('/to-private'), opts)).rejects.toThrow('public internet')
  })

  it('names non-HTML files after the file and reports errors', async () => {
    expect(await unfurl(local('/file.pdf'), opts)).toMatchObject({ title: 'file.pdf' })
    await expect(unfurl(local('/gone'), opts)).rejects.toThrow('404')
  })
})

describe('preview cache', () => {
  it('reuses answers and failures for a while', async () => {
    const cache = new PreviewCache(2)
    let calls = 0
    const ok = async (url: string) => {
      calls++
      return { url, title: 'T' }
    }
    await cache.get('a', ok, 0)
    await cache.get('a', ok, 1000)
    expect(calls).toBe(1)
    await cache.get('a', ok, 2 * 60 * 60_000)
    expect(calls).toBe(2)
    const bad = async () => {
      calls++
      throw new UnfurlError('nope')
    }
    await expect(cache.get('b', bad, 0)).rejects.toThrow('nope')
    await expect(cache.get('b', bad, 1000)).rejects.toThrow('nope')
    expect(calls).toBe(3)
  })
})

describe('preview hardening', () => {
  it('blocks IPv6 forms that carry private IPv4 addresses', () => {
    for (const ip of ['::a00:1', '::ffff:0:a00:1', '64:ff9b:1::a00:1']) expect(isPublicAddress(ip), ip).toBe(false)
  })

  it('never remembers that the server itself was busy', async () => {
    const cache = new PreviewCache()
    await expect(cache.get('p', () => Promise.reject(new BusyError('Busy')))).rejects.toThrow('Busy')
    expect(await cache.get('p', async (url) => ({ url }))).toEqual({ url: 'p' })
  })

  it('shares one fetch between people asking for the same page at once', async () => {
    const cache = new PreviewCache()
    let calls = 0
    let release!: () => void
    const slow = (url: string) =>
      new Promise<{ url: string }>((ok) => {
        calls++
        release = () => ok({ url })
      })
    const a = cache.get('p', slow)
    const b = cache.get('p', slow)
    release()
    expect(await a).toEqual(await b)
    expect(calls).toBe(1)
  })

  it('marks slow sites as worth trying again, and gives up on a slow drip at the deadline', async () => {
    const { createServer } = await import('node:http')
    const drip = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      const t = setInterval(() => res.write(' '), 50)
      res.on('close', () => clearInterval(t))
    })
    await new Promise<void>((ok) => drip.listen(0, '127.0.0.1', ok))
    const port = (drip.address() as import('node:net').AddressInfo).port
    const started = Date.now()
    const err = await unfurl(`http://drip.test:${port}/`, {
      lookup: (_h, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]),
      allow: () => true,
      anyPort: true,
      totalMs: 400,
    }).catch((e: unknown) => e)
    drip.close()
    expect(err).toBeInstanceOf(UnfurlError)
    expect((err as UnfurlError).temporary).toBe(true)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
