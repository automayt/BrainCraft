import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { addItem, emptyBoard, getItem } from './board'
import { fromJson, toJson } from './serialize'
import { embedFor, linkCardSize, linkItem, safeUrl, urlIn, withPreview } from './linkCard'
import { fakeMeasure } from './test-helpers'

describe('link cards', () => {
  it('recognises a pasted web address and nothing else', () => {
    expect(urlIn('  https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1')
    expect(urlIn('http://garage.example.org')).toBe('http://garage.example.org/')
    for (const t of ['', 'hello world', 'see https://example.com', 'ftp://example.com/', 'javascript:alert(1)', 'https://localhost/', 'example.com'])
      expect(urlIn(t), t).toBeNull()
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl(undefined)).toBeNull()
  })

  it('plays YouTube, Vimeo and Spotify links in place', () => {
    const yt = embedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')
    expect(yt).toMatchObject({ provider: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42', thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' })
    expect(embedFor('https://youtu.be/dQw4w9WgXcQ')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(embedFor('https://youtube.com/shorts/dQw4w9WgXcQ')?.ratio).toBeLessThan(1)
    expect(embedFor('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871')
    expect(embedFor('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=x')?.src).toBe('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC')
    expect(embedFor('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')?.provider).toBe('Spotify')
    for (const u of ['https://www.youtube.com/watch?v=short', 'https://www.youtube.com/channel/x', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://open.spotify.com/user/x', 'nope'])
      expect(embedFor(u), u).toBeNull()
  })

  it('fills in a preview, growing the card only if it was never resized', () => {
    let b = emptyBoard()
    let id: number
    ;[b, id] = addItem(b, linkItem('https://blog.example.com/post', { x: 0, y: 0 }))
    const card = getItem(b, id)!
    expect(card).toMatchObject({ kind: 'link', text: 'post', w: 360, h: 120 })
    const filled = withPreview(card, { title: 'Rebuilding a 240z', image: 'https://blog.example.com/cover.jpg' })
    expect(filled).toMatchObject({ text: 'Rebuilding a 240z', link: { checked: true, url: 'https://blog.example.com/post' } })
    expect(filled.h).toBe(linkCardSize(filled.link!).h)
    expect(filled.h).toBeGreaterThan(120)
    const resized = withPreview({ ...card, w: 500 }, { image: 'https://blog.example.com/cover.jpg' })
    expect([resized.w, resized.h]).toEqual([500, 120])
    // A preview can't change where the card points.
    expect(withPreview(card, { url: 'https://evil.example/' }).link!.url).toBe('https://blog.example.com/post')
  })

  it('sizes players to their shape', () => {
    expect(linkCardSize({ url: 'https://youtu.be/dQw4w9WgXcQ' })).toEqual({ w: 480, h: 270 + 76 })
  })

  it('can be created by an operation and survives saving', () => {
    const out = applyOps(emptyBoard(), [{ op: 'createLink', url: 'https://youtu.be/dQw4w9WgXcQ', at: { x: 10, y: 20 } }], { measure: fakeMeasure })
    const card = getItem(out.board, out.results[0].id!)!
    expect(card).toMatchObject({ kind: 'link', x: 10, y: 20, link: { url: 'https://youtu.be/dQw4w9WgXcQ' } })
    expect(() => applyOps(emptyBoard(), [{ op: 'createLink', url: 'javascript:alert(1)' }], { measure: fakeMeasure })).toThrow('web address')
    const again = fromJson(toJson(out.board))
    expect(getItem(again, card.id)?.link?.url).toBe('https://youtu.be/dQw4w9WgXcQ')
    // A link card without an address is dropped when loading.
    const broken = JSON.parse(toJson(out.board))
    delete broken.items[0].link
    expect(fromJson(JSON.stringify(broken)).items).toHaveLength(0)
  })
})
