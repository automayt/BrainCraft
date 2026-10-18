import { describe, expect, it } from 'vitest'
import { Editor } from '../editor/Editor'
import { fakeMeasure } from './test-helpers'
import * as W from './wiki'
import { fileNameFor, pageMarkdown, pagesFromFiles, wikiFiles, wikiZip } from './wikiFiles'
import { crc32, zip } from './zip'

const dec = new TextDecoder()
const web = (to: { board?: string; item?: number }) => (to.board ? `https://braincraft.example/#open=${to.board}${to.item !== undefined ? `&item=${to.item}` : ''}` : null)

function wiki() {
  let b = W.emptyWiki('Trip', 1)
  const home = b.pages![0].id
  let plan: string, food: string
  ;[b, plan] = W.addPage(b, { title: 'Plan', text: '' }, 2)
  ;[b, food] = W.addPage(b, { title: 'Food / drink', parent: plan, text: 'Tapas' }, 3)
  b = W.setPageBody(b, plan, `See [[Eats › Lunch]](page:${food}#lunch) and @[Note](#4).\n![[Map]](board:k1#7)\n[[Other]](board:k2/page:x1)`)
  return { b, home, plan, food }
}

describe('wiki pages as Markdown files', () => {
  it('writes a page as plain Markdown, with its title and readable links', () => {
    const { b, plan } = wiki()
    expect(pageMarkdown(b, plan, web)).toBe(
      '# Plan\n\nSee [[Food / drink]] and Note.\n[Map](https://braincraft.example/#open=k1&item=7)\n[Other](https://braincraft.example/#open=k2)',
    )
  })

  it('lays a wiki out as files in folders, with safe and different names', () => {
    let { b } = wiki()
    ;[b] = W.addPage(b, { title: 'Plan' }, 4)
    const names = wikiFiles(b, web).map((f) => f.name)
    expect(names).toEqual(['Home.md', 'Plan.md', 'Plan/Food - drink.md', 'Plan (2).md'])
    expect(fileNameFor('  ..a<b>:c?  ')).toBe('a-b--c-')
    expect(fileNameFor('')).toBe('Untitled')
  })

  it('makes a zip any unzip tool can read', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686)
    const z = zip([{ name: 'a/é.md', data: new TextEncoder().encode('hi') }], new Date(2026, 9, 18, 12, 0, 0))
    const v = new DataView(z.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    // The end record points at the folder list, which names the file.
    const end = z.length - 22
    expect(v.getUint32(end, true)).toBe(0x06054b50)
    const central = v.getUint32(end + 16, true)
    expect(v.getUint32(central, true)).toBe(0x02014b50)
    expect(dec.decode(z.subarray(central + 46, central + 46 + v.getUint16(central + 28, true)))).toBe('a/é.md')
    expect(dec.decode(z.subarray(30 + 7, 30 + 7 + 2))).toBe('hi')
    expect(wikiZip(wiki().b, web).length).toBeGreaterThan(100)
  })

  it('reads Markdown files back as pages, and links by title find them again', () => {
    const pages = pagesFromFiles([
      { name: 'notes/Packing.md', text: '﻿# Packing list #\r\n\r\n- [ ] Towel\r\n' },
      { name: 'Ideas.markdown', text: 'No heading here' },
    ])
    expect(pages).toEqual([
      { title: 'Packing list', text: '- [ ] Towel\n' },
      { title: 'Ideas', text: 'No heading here' },
    ])
    const e = new Editor(W.emptyWiki('Trip', 1), fakeMeasure)
    const ids = e.importPages(pages)
    expect(ids).toHaveLength(2)
    expect(W.pageOrder(e.board).map((p) => p.title)).toEqual(['Home', 'Packing list', 'Ideas'])
    expect(W.pageByTitle(e.board, 'packing list')?.id).toBe(ids[0])
    // One undo takes the whole import back.
    e.undo()
    expect(W.pageOrder(e.board).map((p) => p.title)).toEqual(['Home'])
  })
})
