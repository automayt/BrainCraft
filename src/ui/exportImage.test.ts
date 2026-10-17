import { describe, expect, it } from 'vitest'
import { pdfOfJpegs } from './exportImage'

describe('PDF export', () => {
  it('writes one page per image with a correct cross-reference table', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const blob = pdfOfJpegs([
      { jpeg, w: 1600, h: 900 },
      { jpeg, w: 800, h: 800 },
    ])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text).toContain('/MediaBox [0 0 960 540]')
    expect(text).toContain('/MediaBox [0 0 960 960]')
    // Every xref entry points at the start of its object.
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1])
    const entries = text.slice(xrefAt).split('\n').slice(3).filter((l) => /^\d{10} 00000 n $/.test(l))
    expect(entries).toHaveLength(8)
    entries.forEach((e, k) => {
      const at = Number(e.slice(0, 10))
      expect(text.slice(at, at + `${k + 1} 0 obj`.length)).toBe(`${k + 1} 0 obj`)
    })
  })
})
