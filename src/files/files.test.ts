import { describe, expect, it } from 'vitest'
import { applyPatches, diff } from '../collab/patch'
import { emptyBoard } from '../model/board'
import { addFile, cleanFile, filesOf, formatSize, kindOf, removeFile, titleOfFile, trashFile } from '../model/files'
import { cleanPatches } from '../model/sanitize'
import { fromJson, toJson } from '../model/serialize'
import { emptyWiki } from '../model/wiki'
import { csvToMarkdown, docxToMarkdown, parseCsv, pptxToMarkdown, xlsxToMarkdown } from './office'
import { pdfLinesToMarkdown } from './pdfText'
import { wikiPagesFor } from './toWiki'
import { unzip } from './unzip'
import { parseXml, textOf } from './xml'

const enc = new TextEncoder()

/** A zip file built by hand: each entry stored, or compressed when `deflate` (as Office files are). */
async function makeZip(entries: { name: string; text: string; deflate?: boolean }[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const raw = enc.encode(e.text)
    const data = e.deflate ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()) : raw
    const name = enc.encode(e.name)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, e.deflate ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    parts.push(local, data)
    const c = new Uint8Array(46 + name.length)
    const cv = new DataView(c.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, e.deflate ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    c.set(name, 46)
    central.push(c)
    offset += local.length + data.length
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, size, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="r"'
const run = (t: string, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`
const para = (inner: string, style?: string, list?: [number, number]) =>
  `<w:p>${style || list ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? `<w:numPr><w:ilvl w:val="${list[0]}"/><w:numId w:val="${list[1]}"/></w:numPr>` : ''}</w:pPr>` : ''}${inner}</w:p>`
const cellXml = (t: string) => `<w:tc><w:p>${run(t)}</w:p></w:tc>`

describe('reading files', () => {
  it('reads a zip, stored or compressed', async () => {
    const z = unzip(await makeZip([{ name: 'a.txt', text: 'plain' }, { name: 'b/c.xml', text: '<x>squeezed '.repeat(50), deflate: true }]))
    expect(z.names).toEqual(['a.txt', 'b/c.xml'])
    expect(await z.text('a.txt')).toBe('plain')
    expect((await z.text('b/c.xml'))!.startsWith('<x>squeezed <x>')).toBe(true)
    expect(await z.read('nope')).toBeNull()
    expect(() => unzip(enc.encode('not a zip at all, sorry'))).toThrow(/zip/)
  })

  it('reads XML: attributes, entities, CDATA, comments', () => {
    const x = parseXml('<?xml version="1.0"?><!-- c --><a k="1 &amp; 2"><b>x &lt;y&gt; &#233;&#x41;</b><![CDATA[<raw>]]><c/></a>')
    expect(x.name).toBe('a')
    expect(x.attrs.k).toBe('1 & 2')
    expect(textOf(x)).toBe('x <y> éA<raw>')
  })

  it('turns a Word document into Markdown: title, headings, bold, links, nested lists and tables', async () => {
    const doc = `<w:document ${W}><w:body>
      ${para(run('Trip plan'), 'Title')}
      ${para(run('Getting there'), 'Heading1')}
      ${para(`${run('Take the ')}${run('9:10', true)}${run(' train &amp; ')}<w:hyperlink r:id="rId5">${run('book here')}</w:hyperlink>`)}
      ${para(run('Tent'), undefined, [0, 1])}
      ${para(run('Pegs'), undefined, [1, 1])}
      ${para(run('First'), undefined, [0, 2])}
      <w:tbl><w:tr>${cellXml('Who')}${cellXml('Pays')}</w:tr><w:tr>${cellXml('Sam')}${cellXml('£40 | cash')}</w:tr></w:tbl>
    </w:body></w:document>`
    const styles = `<w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`
    const numbering = `<w:numbering ${W}>
      <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
      <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
    const rels = '<Relationships><Relationship Id="rId5" Target="https://example.org/book" TargetMode="External"/></Relationships>'
    const bytes = await makeZip([
      { name: 'word/document.xml', text: doc, deflate: true },
      { name: 'word/styles.xml', text: styles },
      { name: 'word/numbering.xml', text: numbering },
      { name: 'word/_rels/document.xml.rels', text: rels },
    ])
    const { markdown, title } = await docxToMarkdown(bytes)
    expect(title).toBe('Trip plan')
    expect(markdown).toBe(
      '# Trip plan\n\n## Getting there\n\nTake the **9:10** train & [book here](https://example.org/book)\n\n- Tent\n  - Pegs\n1. First\n\n| Who | Pays |\n| --- | --- |\n| Sam | £40 \\| cash |\n',
    )
    await expect(docxToMarkdown(await makeZip([{ name: 'x.txt', text: '' }]))).rejects.toThrow(/Word/)
  })

  it('turns slides into a section each, with their points and the speaker’s notes', async () => {
    const P = 'xmlns:p="p" xmlns:a="a" xmlns:r="r"'
    const sp = (ph: string, paras: [string, number][]) =>
      `<p:sp><p:nvSpPr><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paras.map(([t, l]) => `<a:p><a:pPr lvl="${l}"/><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`
    const bytes = await makeZip([
      { name: 'ppt/presentation.xml', text: `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>` },
      { name: 'ppt/_rels/presentation.xml.rels', text: '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>' },
      { name: 'ppt/slides/slide1.xml', text: `<p:sld ${P}><p:cSld><p:spTree>${sp('title', [['Why go', 0]])}${sp('', [['Rest', 0], ['Sleep', 1]])}</p:spTree></p:cSld></p:sld>`, deflate: true },
      { name: 'ppt/slides/_rels/slide1.xml.rels', text: '<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide1.xml"/></Relationships>' },
      { name: 'ppt/notesSlides/notesSlide1.xml', text: `<p:notes ${P}><p:cSld><p:spTree>${sp('body', [['Say it slowly', 0]])}</p:spTree></p:cSld></p:notes>` },
    ])
    const got = await pptxToMarkdown(bytes)
    expect(got).toMatchObject({ pages: 1, title: 'Why go' })
    expect(got.markdown).toBe('## 1. Why go\n\n- Rest\n  - Sleep\n\n> **Notes:** Say it slowly\n')
  })

  it('turns each sheet of a workbook into a table, and reads CSV', async () => {
    const bytes = await makeZip([
      { name: 'xl/workbook.xml', text: '<workbook xmlns:r="r"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/sharedStrings.xml', text: '<sst><si><t>Item</t></si><si><t>Cost</t></si><si><r><t>Tra</t></r><r><t>in</t></r></si></sst>' },
      {
        name: 'xl/worksheets/sheet1.xml',
        text: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>40</v></c></row></sheetData></worksheet>',
        deflate: true,
      },
    ])
    const got = await xlsxToMarkdown(bytes)
    expect(got.markdown).toBe('## Budget\n\n| Item | Cost |  |\n| --- | --- | --- |\n| Train |  | 40 |\n')
    expect(parseCsv('a,"b, c","say ""hi"""\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ])
    expect(csvToMarkdown('x\ty\n1\t2').markdown).toBe('| x | y |\n| --- | --- |\n| 1 | 2 |\n')
  })

  it('turns a PDF’s lines into headings, paragraphs and lists, without running heads or page numbers', () => {
    const page = (n: number) => [
      { text: 'Trip guide 2026', size: 9, y: 20 },
      ...(n === 1
        ? [
            { text: 'Getting there', size: 22, y: 60 },
            { text: 'The train leaves at nine and the journey is long, so bring some-', size: 11, y: 100 },
            { text: 'thing to read on the way.', size: 11, y: 114 },
            { text: '• Tickets', size: 11, y: 150 },
            { text: '• Snacks for the', size: 11, y: 164 },
            { text: 'whole day', size: 11, y: 178 },
          ]
        : [{ text: `Page ${n} has its own words about the trip.`, size: 11, y: 100 }]),
      { text: String(n), size: 9, y: 800 },
    ]
    const md = pdfLinesToMarkdown([page(1), page(2), page(3)])
    expect(md).not.toContain('Trip guide')
    expect(md).not.toMatch(/^\d$/m)
    expect(md).toContain('Page 3 has its own words about the trip.')
    expect(md.startsWith('## Getting there\n\nThe train leaves at nine and the journey is long, so bring something to read on the way.\n\n- Tickets\n- Snacks for the whole day\n')).toBe(true)
  })
})

describe('a file as wiki pages', () => {
  const facts = { name: 'Trip_plan.docx', kind: 'word' as const, at: new Date(2026, 9, 20, 12).getTime(), by: 'Sam' }

  it('is one page with where it came from, and contents when it has many headings', () => {
    const plan = wikiPagesFor(facts, '# Trip plan\n\n## A\nx\n## B\ny\n## C\nz\n### D\nw\n', 'Trip plan')
    expect(plan.title).toBe('Trip plan')
    expect(plan.children).toEqual([])
    expect(plan.text).toMatch(/^> \[!note\] From a file\n> \*\*Trip_plan.docx\*\* \(Document\), added 20 Oct 2026 by Sam/)
    expect(plan.text).toContain('{{toc}}')
    // The page's title says it: the document's own title heading goes.
    expect(plan.text).not.toContain('# Trip plan')
    expect(wikiPagesFor(facts, 'Just a line.').title).toBe('Trip plan')
  })

  it('splits a long document into a page per section under a contents page', () => {
    const section = (n: number) => `## Part ${n}\n\n${'word '.repeat(600)}\n\n### Detail ${n}\n\nmore`
    const plan = wikiPagesFor({ ...facts, kind: 'pdf', pages: 30 }, `Intro words.\n\n${[1, 2, 3].map(section).join('\n\n')}`)
    expect(plan.children.map((c) => c.title)).toEqual(['Part 1', 'Part 2', 'Part 3'])
    expect(plan.text).toContain('{{children}}')
    expect(plan.text).toContain('Intro words.')
    expect(plan.text).toContain('(PDF, 30 pages)')
    // A section's own headings move up a level on its page.
    expect(plan.children[0].text).toMatch(/^word [\s\S]*\n## Detail 1\n/)
  })

  it('cuts a very long document without sections into parts that fit a page', () => {
    const plan = wikiPagesFor(facts, Array.from({ length: 4000 }, (_, k) => `Paragraph ${k} ${'x'.repeat(80)}`).join('\n\n'))
    expect(plan.children.length).toBeGreaterThan(1)
    expect(plan.children.every((c) => c.text.length <= 200_000)).toBe(true)
  })
})

describe('files on a board', () => {
  const f = { id: 'file0001', name: 'Plan.pdf', type: 'application/pdf', size: 1200, at: 5, by: 'Sam', chars: 300, pages: 2, excerpt: 'Hello' }

  it('are kept with the board, checked, and saved with it', () => {
    let b = addFile(emptyWiki('KB'), f)
    expect(filesOf(b).map((x) => x.id)).toEqual(['file0001'])
    b = trashFile(b, 'file0001', true, 9)
    expect(filesOf(b)).toEqual([])
    expect(filesOf(b, true)[0].trashed).toBe(9)
    expect(fromJson(toJson(b)).files).toEqual(b.files)
    expect(removeFile(b, 'file0001').files).toBeUndefined()
    // Junk is dropped, and smuggled fields don't survive.
    expect(cleanFile({ ...f, id: 'bad id!' })).toBeNull()
    expect(cleanFile({ ...f, name: '' })).toBeNull()
    expect(cleanFile({ ...f, type: '<script>', size: -4, extra: 1 })).toEqual({ ...f, type: 'application/octet-stream', size: 0 })
    expect(addFile(addFile(emptyBoard(), f), f).files).toHaveLength(1)
  })

  it('go to friends as patches, like pages', () => {
    const a = emptyWiki('KB')
    const b = addFile(a, f)
    const patches = diff(a, b)
    expect(patches).toEqual([{ k: 'file', id: 'file0001', v: f }])
    expect(applyPatches(a, cleanPatches(JSON.parse(JSON.stringify(patches)))).files).toEqual([f])
    expect(applyPatches(b, diff(b, a)).files).toBeUndefined()
    expect(cleanPatches([{ k: 'file', id: 'file0001', v: { ...f, id: 'other01' } }])).toEqual([])
  })

  it('know what kind they are and how big', () => {
    expect(kindOf('a.PDF')).toBe('pdf')
    expect(kindOf('notes', 'text/plain')).toBe('text')
    expect(kindOf('x.docx')).toBe('word')
    expect(formatSize(1536)).toBe('2 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(titleOfFile('Q3_report-final.pdf')).toBe('Q3 report-final')
  })
})
