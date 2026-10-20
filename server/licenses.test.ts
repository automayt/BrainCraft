import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXTRA_CREDITS, SHIPPED_FONTS, allowed, noticesText } from '../vite.licenses'

describe('what BrainCraft ships, and on what terms', () => {
  it('lets through permissive licences only, reading AND and OR the way licences mean them', () => {
    for (const ok of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', 'OFL-1.1', '(MIT AND Zlib)', '(MPL-2.0 OR Apache-2.0)', 'GPL-3.0 OR MIT']) expect(allowed(ok), ok).toBe(true)
    for (const bad of ['GPL-3.0', 'AGPL-3.0', 'MIT AND GPL-2.0', 'UNKNOWN', 'SEE LICENSE IN LICENSE.txt', 'CC-BY-NC-4.0']) expect(allowed(bad), bad).toBe(false)
  })

  it('credits every font it copies, with its copyright and licence text, and copies only those', () => {
    const families = ['Excalifont', 'Virgil', 'Nunito', 'ComicShanns', 'Assistant', 'Lilita', 'Xiaolai']
    expect([...SHIPPED_FONTS].sort()).toEqual([...families].sort())
    // Fonts whose licence wording wasn't clear stay out.
    expect(SHIPPED_FONTS).not.toContain('Liberation')
    expect(SHIPPED_FONTS).not.toContain('Cascadia')
    for (const f of SHIPPED_FONTS) expect(existsSync(`node_modules/@excalidraw/excalidraw/dist/prod/fonts/${f}`), f).toBe(true)
    expect(EXTRA_CREDITS).toHaveLength(SHIPPED_FONTS.length)
    for (const c of EXTRA_CREDITS) {
      expect(allowed(c.license), c.name).toBe(true)
      expect(c.text, c.name).toMatch(/^Copyright/)
      expect(c.text, c.name).toMatch(c.license === 'MIT' ? /Permission is hereby granted/ : /SIL Open Font License, Version 1\.1/)
    }
  })

  it('writes a notices file that thanks them and carries each licence', () => {
    const text = noticesText([{ name: 'tiny', version: '1.0.0', license: 'MIT', homepage: 'https://example.org/tiny', text: 'Copyright (c) Tiny\n\nPermission is hereby granted…' }])
    expect(text).toMatch(/^BrainCraft is built with these open-source projects/)
    expect(text).toContain('- tiny 1.0.0 (MIT) https://example.org/tiny')
    expect(text).toContain('Copyright (c) Tiny')
  })
})
