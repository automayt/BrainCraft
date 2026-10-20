import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addFile } from '../src/model/files'
import { emptyWiki } from '../src/model/wiki'
import { BoardFiles } from './boardFiles'

/** A board's files over real HTTP; "edit" in the path's first part decides whether the asker may change them. */
describe('a board’s files on the server', () => {
  const files = new BoardFiles(join(mkdtempSync(join(tmpdir(), 'braincraft-files-')), 'files'), { file: 1000, board: 1500, text: 50 })
  const board = addFile(emptyWiki('KB'), { id: 'file0001', name: 'Plan “final”.pdf', type: 'application/pdf', size: 3, at: 1 })
  let server: Server
  let base = ''
  beforeAll(async () => {
    server = createServer((req, res) => {
      const [who, ...rest] = (req.url ?? '').split('?')[0].split('/').filter(Boolean)
      void files.handle('b1', board, req, res, rest, who === 'edit').then((handled) => {
        if (!handled) res.writeHead(404).end('{}')
      })
    })
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    const a = server.address()
    base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
  })
  afterAll(() => server.close())

  it('keeps a file’s bytes and words, and gives them back to anyone who can open the board', async () => {
    expect((await fetch(`${base}/edit/file0001`, { method: 'PUT', body: 'PDF', headers: { 'content-type': 'application/pdf' } })).status).toBe(200)
    expect((await fetch(`${base}/edit/file0001/text`, { method: 'PUT', body: 'x'.repeat(80) })).status).toBe(200)
    const got = await fetch(`${base}/view/file0001`)
    expect(got.status).toBe(200)
    expect(await got.text()).toBe('PDF')
    // A PDF opens in place, in a sandbox, under its own name.
    expect(got.headers.get('content-type')).toBe('application/pdf')
    expect(got.headers.get('content-disposition')).toMatch(/^inline; filename="Plan _final_.pdf"; filename\*=UTF-8''Plan%20%E2%80%9Cfinal%E2%80%9D.pdf$/)
    expect(got.headers.get('content-security-policy')).toContain('sandbox')
    expect((await fetch(`${base}/view/file0001?download=1`)).headers.get('content-disposition')).toMatch(/^attachment/)
    // Words are cut to the limit.
    expect((await (await fetch(`${base}/view/file0001/text`)).text()).length).toBe(50)
  })

  it('downloads anything that could run as the site, rather than showing it', async () => {
    await fetch(`${base}/edit/page0001`, { method: 'PUT', body: '<script>alert(1)</script>', headers: { 'content-type': 'text/html' } })
    const got = await fetch(`${base}/view/page0001`)
    expect(got.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(got.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('lets only people who can edit change files, and keeps to the size limits', async () => {
    expect((await fetch(`${base}/view/file0002`, { method: 'PUT', body: 'x' })).status).toBe(403)
    expect((await fetch(`${base}/view/file0001`, { method: 'DELETE' })).status).toBe(403)
    const big = await fetch(`${base}/edit/file0003`, { method: 'PUT', body: 'x'.repeat(1001) })
    expect(big.status).toBe(413)
    expect(((await big.json()) as { error: string }).error).toMatch(/bigger than this server takes/)
    // The board's space runs out: 1500 bytes in all.
    expect((await fetch(`${base}/edit/file0004`, { method: 'PUT', body: 'x'.repeat(900) })).status).toBe(200)
    expect((await fetch(`${base}/edit/file0005`, { method: 'PUT', body: 'x'.repeat(900) })).status).toBe(413)
    // Deleting gives the space back.
    expect((await fetch(`${base}/edit/file0004`, { method: 'DELETE' })).status).toBe(200)
    expect((await fetch(`${base}/view/file0004`)).status).toBe(404)
    expect((await fetch(`${base}/edit/file0005`, { method: 'PUT', body: 'x'.repeat(900) })).status).toBe(200)
    // Ids that could reach outside the folder aren't file routes at all.
    expect((await fetch(`${base}/view/..%2F..%2Fsecret`)).status).toBe(404)
  })

  it('forgets every file when the board goes', async () => {
    files.removeBoard('b1')
    expect((await fetch(`${base}/view/file0001`)).status).toBe(404)
    expect(files.used('b1')).toBe(0)
  })
})
