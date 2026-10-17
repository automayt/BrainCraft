import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { type Op, applyOps } from '../api/ops'
import { Editor } from '../editor/Editor'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import type { Id } from '../model/types'
import { BoardView } from './BoardView'
import { pdfOfJpegs } from './imageExport'
import { EditorContext } from './useEditor'

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

describe('drawing the board as a picture', () => {
  it('draws every kind of object without the live app around it', () => {
    const editor = new Editor(emptyBoard(), fakeMeasure)
    const board = applyOps(
      emptyBoard(),
      [
        { op: 'createNote', text: 'Note' },
        { op: 'createText', text: 'Text' },
        { op: 'createShape', shape: 'ellipse', text: 'Shape' },
        { op: 'createComment', text: 'Comment' },
        { op: 'createMindMap', outline: 'Trip\n  Food\n  Beds' },
        { op: 'createFlowchart', mermaid: 'flowchart TD\n  A --> B{Ok?}' },
        { op: 'createTable', columns: ['A', 'B'], rows: [['1', '2']] },
        { op: 'createKanban' },
        { op: 'createTimeline', lanes: [{ name: 'L', entries: [{ title: 'E', start: '2026-10-01', end: '2026-10-05' }] }] },
        { op: 'createDatabase', views: ['table', 'board', 'timeline', 'calendar', 'gallery'] },
        { op: 'createCode', code: 'const a = 1' },
        { op: 'createLink', url: 'https://example.com/' },
        { op: 'createSpinner', options: ['Yes', 'No'] },
        { op: 'createFrame', title: 'Frame', w: 400, h: 300 },
      ] as Op[],
      { measure: fakeMeasure },
    ).board
    editor.load(board)
    const kinds = new Set(board.items.map((i) => i.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(13)
    // A static render, as the image export does (no live store to subscribe to).
    const svg = renderToStaticMarkup(
      createElement(EditorContext.Provider, { value: editor }, createElement(BoardView, { board, hidden: new Set<Id>(), editingId: null, editingLabel: null, selectedConnector: null, selection: new Set<Id>() })),
    )
    expect(svg).toContain('const')
  })
})
