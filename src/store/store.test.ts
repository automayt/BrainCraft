import { describe, expect, it } from 'vitest'
import { addItem, connect, emptyBoard, newItem } from '../model/board'
import { welcomeBoard } from '../model/serialize'
import { MemoryKV } from './kv'
import { AUTO_VERSION_EVERY, AUTO_VERSIONS_KEPT, Library, thumbnail } from './library'
import { decodeBoard, encodeBoard, sharedFromHash, shareUrl, withoutImages } from './share'

function library() {
  const lib = new Library(new MemoryKV())
  let t = 1_000_000
  lib.now = () => t
  return { lib, advance: (ms: number) => (t += ms) }
}

describe('board library', () => {
  it('creates, lists newest first, loads and removes boards', async () => {
    const { lib, advance } = library()
    const a = await lib.create(emptyBoard('Alpha'))
    advance(1000)
    const b = await lib.create(welcomeBoard())
    expect((await lib.list()).map((m) => m.title)).toEqual(['Welcome to BrainCraft', 'Alpha'])
    expect((await lib.load(b))!.items.length).toBe(welcomeBoard().items.length)
    expect((await lib.meta(b))!.thumb.length).toBeGreaterThan(0)
    await lib.remove(a)
    expect((await lib.list()).map((m) => m.id)).toEqual([b])
    expect(await lib.load(a)).toBeNull()
  })

  it('keeps the creation time and bumps the update time on save', async () => {
    const { lib, advance } = library()
    const id = await lib.create(emptyBoard('Plan'))
    const created = (await lib.meta(id))!.created
    advance(5000)
    await lib.save(id, emptyBoard('Plan v2'))
    const meta = (await lib.meta(id))!
    expect(meta).toMatchObject({ created, updated: created + 5000, title: 'Plan v2' })
  })

  it('duplicates a board under a new id', async () => {
    const { lib } = library()
    const id = await lib.create(emptyBoard('Plan'))
    const copy = (await lib.duplicate(id))!
    expect(copy).not.toBe(id)
    expect((await lib.meta(copy))!.title).toBe('Plan (copy)')
  })

  it('takes automatic versions at most every few minutes and prunes old ones', async () => {
    const { lib, advance } = library()
    const id = await lib.create(emptyBoard('A'))
    await lib.save(id, emptyBoard('A1'))
    advance(1000)
    await lib.save(id, emptyBoard('A2'))
    expect((await lib.versions(id)).map((v) => v.title)).toEqual(['A1'])
    advance(AUTO_VERSION_EVERY)
    await lib.save(id, emptyBoard('A3'))
    expect((await lib.versions(id)).map((v) => v.title)).toEqual(['A3', 'A1'])

    await lib.addVersion(id, emptyBoard('Keep me'), 'Before the reorg')
    for (let k = 0; k < AUTO_VERSIONS_KEPT + 5; k++) {
      advance(AUTO_VERSION_EVERY)
      await lib.save(id, emptyBoard(`v${k}`))
    }
    const versions = await lib.versions(id)
    expect(versions.filter((v) => !v.name)).toHaveLength(AUTO_VERSIONS_KEPT)
    expect(versions.find((v) => v.name)?.title).toBe('Keep me')
  })

  it('restores a version', async () => {
    const { lib } = library()
    const id = await lib.create(welcomeBoard())
    const v = await lib.addVersion(id, welcomeBoard(), 'Original')
    await lib.save(id, emptyBoard('Wiped'))
    expect((await lib.loadVersion(id, v.at))!.title).toBe('Welcome to BrainCraft')
    await lib.deleteVersion(id, v.at)
    expect(await lib.loadVersion(id, v.at)).toBeNull()
  })

  it('draws thumbnails within 0–1000 and keeps the content aspect', () => {
    let b = emptyBoard()
    ;[b] = addItem(b, newItem('sticky', { x: 100, y: 100, w: 200, h: 100 }))
    ;[b] = addItem(b, newItem('rect', { x: 500, y: 200, w: 200, h: 100 }))
    const { thumb, aspect } = thumbnail(b)
    expect(aspect).toBe(600 / 200)
    for (const [x, y, w, h] of thumb) {
      expect(x + w).toBeLessThanOrEqual(1000)
      expect(y + h).toBeLessThanOrEqual(1000)
    }
    expect(thumbnail(emptyBoard()).thumb).toEqual([])
  })
})

describe('share links', () => {
  it('round-trips a board through a compact link', async () => {
    const b = welcomeBoard()
    const text = await encodeBoard(b)
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(text.length).toBeLessThan(JSON.stringify(b).length / 2)
    const back = await decodeBoard(text)
    expect(back.items).toEqual(b.items)
    expect(back.connectors).toEqual(b.connectors)
  })

  it('builds and reads #view= links', async () => {
    const url = await shareUrl(emptyBoard('Shared'), 'https://example.com/app/?x=1#old')
    expect(url.startsWith('https://example.com/app/?x=1#view=')).toBe(true)
    const hash = new URL(url).hash
    expect((await decodeBoard(sharedFromHash(hash)!)).title).toBe('Shared')
    expect(sharedFromHash('#something-else')).toBeNull()
  })

  it('can leave images out', () => {
    let b = emptyBoard()
    let img: number, note: number
    ;[b, img] = addItem(b, newItem('image', { x: 0, y: 0, w: 10, h: 10 }, { src: 'data:image/png;base64,AAAA' }))
    ;[b, note] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }))
    ;[b] = connect(b, img, note)
    const out = withoutImages(b)
    expect(out.items.map((i) => i.id)).toEqual([note])
    expect(out.connectors).toEqual([])
  })
})

describe('templates', () => {
  it('every template builds a board', async () => {
    const { TEMPLATES, boardFromTemplate } = await import('../model/templates')
    const { fakeMeasure } = await import('../model/test-helpers')
    for (const t of TEMPLATES) {
      const b = boardFromTemplate(t, fakeMeasure)
      expect(b.title).toBe(t.title)
      if (t.id !== 'blank') expect(b.items.length).toBeGreaterThan(0)
    }
  })
})
