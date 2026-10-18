import { describe, expect, it } from 'vitest'
import { applyPatches, diff } from '../collab/patch'
import { Editor } from '../editor/Editor'
import { addItem, emptyBoard, newItem } from './board'
import { startBrainstorm } from './brainstorm'
import { embedBoard, embedSet, embedToken, makeSnap, snapBoard, SNAP_MAX_TOTAL } from './embed'
import { embedKeys, parseMarkdown } from './markdown'
import { cleanPatches } from './sanitize'
import { fromJson, toJson } from './serialize'
import { fakeMeasure } from './test-helpers'
import type { Board, Item } from './types'
import * as W from './wiki'
import { WIKI_TEMPLATES, wikiFromTemplate } from './wikiTemplates'

const note = (x: number, text: string, extra: Partial<Item> = {}) => newItem('sticky', { x, y: 0, w: 100, h: 100 }, { text, ...extra })

function board() {
  let b = emptyBoard('Plan')
  let a: number, z: number, frame: number, outside: number
  ;[b, a] = addItem(b, note(20, 'Lisbon'))
  ;[b, z] = addItem(b, note(150, 'Porto', { locked: true }))
  ;[b, frame] = addItem(b, newItem('frame', { x: 0, y: -20, w: 300, h: 160 }, { text: 'Places' }))
  ;[b, outside] = addItem(b, note(900, 'Elsewhere'))
  return { b, a, z, frame, outside }
}

describe('embeds', () => {
  it('reads an embed line, with an optional height, and finds what a page embeds', () => {
    const blocks = parseMarkdown('Intro\n![[Places|320]](board:plan1#7)\n![[Whole]](board:plan1)\nnot ![[inline]](board:x#1)')
    expect(blocks.map((b) => b.t)).toEqual(['p', 'embed', 'embed', 'p'])
    expect(blocks[1]).toMatchObject({ t: 'embed', label: 'Places', board: 'plan1', item: 7, height: 320 })
    expect(blocks[2]).toMatchObject({ t: 'embed', board: 'plan1' })
    expect(embedKeys('![[A]](board:k#3)\ntext\n![[B]](board:k)')).toEqual(['k#3', 'k'])
    expect(embedToken('Lisbon | [x]', 'k', 3)).toBe('![[Lisbon x]](board:k#3)')
  })

  it('shows a frame with what’s in it (locked things too), and nothing else', () => {
    const { b, a, z, frame, outside } = board()
    expect([...embedSet(b, frame)].sort()).toEqual([a, z, frame].sort())
    const part = embedBoard(b, frame)!
    expect(part.items.map((i) => i.text).sort()).toEqual(['Lisbon', 'Places', 'Porto'])
    expect(part.items.some((i) => i.id === outside)).toBe(false)
    expect(embedBoard(b, 999)).toBeNull()
    expect(embedBoard(b)).toBe(b)
  })

  it('keeps every unrevealed brainstorm note out of a snapshot, your own included', () => {
    let b = emptyBoard('Ideas')
    ;[b] = startBrainstorm(b, { x: 0, y: 0 }, 'Sam', 'Names?')
    let mine: number
    ;[b, mine] = addItem(b, note(0, 'My secret', { hiddenBy: 'Sam' }))
    ;[b] = addItem(b, note(200, 'Alex secret', { hiddenBy: 'Alex' }))
    const snap = makeSnap(b, 'ideas', undefined, 5)!
    expect(snap.items.filter((i) => i.text.includes('secret'))).toEqual([])
    expect(snap.items.find((i) => i.id === mine)).toMatchObject({ text: '', masked: true })
  })

  it('leaves big pictures out of a snapshot', () => {
    let b = emptyBoard('Photos')
    const big = 'data:image/png;base64,' + 'A'.repeat(SNAP_MAX_TOTAL)
    ;[b] = addItem(b, { ...newItem('image', { x: 0, y: 0, w: 100, h: 100 }), src: 'data:image/png;base64,AAAA' })
    ;[b] = addItem(b, { ...newItem('image', { x: 200, y: 0, w: 100, h: 100 }), src: big })
    const snap = makeSnap(b, 'photos', undefined, 1)!
    expect(snap.items.map((i) => !!i.src)).toEqual([true, false])
  })

  it('syncs, saves and cleans snapshots, and drops ones no page uses any more', () => {
    const { b: plan, frame } = board()
    let wiki: Board = W.emptyWiki('Trip', 1)
    const page = wiki.pages![0].id
    wiki = W.setPageBody(wiki, page, embedToken('Places', 'plan1', frame))
    const e = new Editor(wiki, fakeMeasure)
    const snap = makeSnap(plan, 'plan1', frame, 9)!
    e.keepSnap(snap)
    expect(e.board.snaps!.map((s) => s.key)).toEqual(['plan1#' + frame])
    // Through a live session and a file.
    const patches = cleanPatches(diff(wiki, e.board))
    expect(patches.map((p) => p.k)).toEqual(['snap'])
    expect(applyPatches(wiki, patches).snaps![0].items).toHaveLength(3)
    expect(fromJson(toJson(e.board)).snaps![0].items.map((i) => i.text).sort()).toEqual(['Lisbon', 'Places', 'Porto'])
    expect(snapBoard(e.board.snaps![0]).items).toHaveLength(3)
    // Junk is refused.
    expect(cleanPatches([{ k: 'snap', id: 'bad key!', v: snap }, { k: 'snap', id: 'other', v: snap }])).toEqual([])
    // The page stops embedding it: the next refresh drops it.
    e.setPageText(page, 'No embeds now')
    e.keepSnap({ ...snap, key: 'plan1' })
    expect(e.board.snaps).toBeUndefined()
  })

  it('makes wikis from templates', () => {
    for (const t of WIKI_TEMPLATES) {
      const b = wikiFromTemplate(t.id, 'Lisbon')
      expect(b.kind).toBe('wiki')
      expect(b.title).toBe('Lisbon')
      expect(W.pageOrder(b).length).toBe(Math.max(1, t.pages.length))
    }
    const trip = wikiFromTemplate('wiki-trip', 'Lisbon')
    expect(W.pageText(trip, W.pageOrder(trip)[0].id)).toContain('# Lisbon')
    expect(wikiFromTemplate('nope').title).toBe('Untitled wiki')
  })
})
