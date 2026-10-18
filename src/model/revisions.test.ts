import { describe, expect, it } from 'vitest'
import { applyPatches, diff } from '../collab/patch'
import { Editor } from '../editor/Editor'
import { applyOps } from '../api/ops'
import * as RV from './revisions'
import { cleanPatches } from './sanitize'
import { fromJson, toJson } from './serialize'
import { fakeMeasure } from './test-helpers'
import type { Board } from './types'
import * as W from './wiki'

function wiki(): { b: Board; page: string } {
  let b = W.emptyWiki('Trip', 1)
  let page: string
  ;[b, page] = W.addPage(b, { title: 'Packing', text: 'Towel' }, 2, 'Sam')
  return { b, page }
}

describe('page versions', () => {
  it('saves a version only when the page says something new, and numbers them', () => {
    let { b, page } = wiki()
    b = RV.savePageVersion(b, page)
    expect(RV.pageRevs(b, page)).toMatchObject([{ text: 'Towel', title: 'Packing', by: 'Sam', at: 2 }])
    // Nothing new: no new version (but a note lands on the latest one).
    expect(RV.savePageVersion(b, page)).toBe(b)
    b = RV.savePageVersion(b, page, { note: 'The start' })
    expect(RV.pageRevs(b, page)).toHaveLength(1)
    expect(RV.latestRev(b, page)!.note).toBe('The start')
    b = W.setPageBody(b, page, 'Towel\nTent', 5, 'Ana')
    expect(RV.unsavedChanges(b, page)).toBe(true)
    b = RV.savePageVersion(b, page)
    const revs = RV.pageRevs(b, page)
    expect(revs.map((r) => [r.text, r.by])).toEqual([
      ['Towel', 'Sam'],
      ['Towel\nTent', 'Ana'],
    ])
    expect(RV.revNumber(b, revs[1])).toBe(2)
    expect(RV.recentChanges(b).map((c) => [c.rev.id, c.prev?.id])).toEqual([
      [revs[1].id, revs[0].id],
      [revs[0].id, undefined],
    ])
  })

  it('keeps milestones and the latest version when pruning, and stays within its budget', () => {
    let { b, page } = wiki()
    b = RV.savePageVersion(b, page, { keep: true })
    for (let k = 0; k < RV.REV_KEEP + 10; k++) b = RV.savePageVersion(W.setPageBody(b, page, `v${k}`, 10 + k), page)
    const revs = RV.pageRevs(b, page)
    expect(revs.length).toBe(RV.REV_KEEP + 1)
    expect(revs[0]).toMatchObject({ text: 'Towel', keep: true })
    expect(revs.at(-1)!.text).toBe(`v${RV.REV_KEEP + 9}`)
    // Lots of long pages, each rewritten: older versions go to keep the total down, every page's latest stays.
    const pages: string[] = []
    for (let k = 0; k < 20; k++) {
      let id: string
      ;[b, id] = W.addPage(b, { title: `Long ${k}`, text: `${k}`.padEnd(W.BODY_MAX - 10, 'x') }, 200 + k)
      b = RV.savePageVersion(b, id)
      b = RV.savePageVersion(W.setPageBody(b, id, `${k}`.padEnd(W.BODY_MAX - 10, 'y'), 300 + k), id)
      pages.push(id)
    }
    const total = b.revs!.reduce((n, r) => n + r.text.length, 0)
    expect(total).toBeLessThanOrEqual(RV.REV_TEXT_BUDGET)
    for (const id of pages) expect(RV.latestRev(b, id)!.text.endsWith('y')).toBe(true)
    expect(RV.pageRevs(b, page)[0].keep).toBe(true)
  })

  it('keeps version numbers fixed when older versions go, and says that they went', () => {
    let { b, page } = wiki()
    for (let k = 0; k < RV.REV_KEEP + 5; k++) b = RV.savePageVersion(W.setPageBody(b, page, `v${k}`, 10 + k), page)
    const revs = RV.pageRevs(b, page)
    expect(revs).toHaveLength(RV.REV_KEEP)
    expect(RV.revNumber(b, revs.at(-1)!)).toBe(RV.REV_KEEP + 5)
    expect(RV.revNumber(b, revs[0])).toBe(6)
    expect(RV.olderGone(b, page)).toBe(true)
  })

  it('never puts a note over a friend’s, and groups one person’s ticks', () => {
    let { b, page } = wiki()
    b = RV.savePageVersion(b, page, { note: 'Added flights' })
    // Ana opens the page, changes nothing, and writes a note: Sam's stays.
    b = RV.savePageVersion(b, page, { note: 'Looks good', me: 'Ana' })
    expect(RV.latestRev(b, page)!.note).toBe('Added flights')
    // Ticks a moment apart make one version, with both notes; someone else's tick makes a new one.
    b = RV.savePageVersion(W.setPageBody(b, page, 'Towel\n- [x] A', 100, 'Ana'), page, { at: 100, by: 'Ana', quick: true, note: 'Ticked “A”' })
    b = RV.savePageVersion(W.setPageBody(b, page, 'Towel\n- [x] A\n- [x] B', 200, 'Ana'), page, { at: 200, by: 'Ana', quick: true, note: 'Ticked “B”' })
    expect(RV.pageRevs(b, page)).toHaveLength(2)
    expect(RV.latestRev(b, page)).toMatchObject({ by: 'Ana', note: 'Ticked “A”, Ticked “B”', text: 'Towel\n- [x] A\n- [x] B' })
    b = RV.savePageVersion(W.setPageBody(b, page, 'Towel', 300, 'Lee'), page, { at: 300, by: 'Lee', quick: true })
    expect(RV.pageRevs(b, page)).toHaveLength(3)
  })

  it('saves a tick while reading as a small version, credited to whoever ticked', () => {
    let { b, page } = wiki()
    b = W.setPageBody(b, page, '- [ ] Book the van', 3, 'Sam')
    const e = new Editor(b, fakeMeasure)
    e.author = 'Ana'
    e.tickTask(page, 0)
    expect(RV.latestRev(e.board, page)).toMatchObject({ by: 'Ana', note: 'Ticked “Book the van”', text: '- [x] Book the van' })
  })

  it('credits a blank line to the version that wrote it, not to "not saved yet"', () => {
    let { b, page } = wiki()
    b = RV.savePageVersion(W.setPageBody(b, page, 'Top\n\nBottom', 3, 'Sam'), page)
    expect(RV.whoWrote(b, page).map((l) => l.rev?.by ?? null)).toEqual(['Sam', 'Sam', 'Sam'])
  })

  it('tells who wrote each line', () => {
    let { b, page } = wiki()
    b = RV.savePageVersion(b, page)
    b = RV.savePageVersion(W.setPageBody(b, page, 'Towel\nTent\nStove', 5, 'Ana'), page)
    b = W.setPageBody(b, page, 'Towel\nStove\nMap', 6, 'Lee')
    expect(RV.whoWrote(b, page).map((l) => [l.s, l.rev?.by ?? null])).toEqual([
      ['Towel', 'Sam'],
      ['Stove', 'Ana'],
      ['Map', null],
    ])
  })

  it('travels through live sessions and files, checked like everything else', () => {
    const { b: start, page } = wiki()
    const b = RV.savePageVersion(start, page, { note: 'First' })
    const patches = cleanPatches(diff(start, b))
    expect(patches.map((p) => p.k)).toEqual(['rev'])
    expect(applyPatches(start, patches).revs).toHaveLength(1)
    expect(fromJson(toJson(b)).revs).toMatchObject([{ page, note: 'First' }])
    // Junk is refused; a version of a page that isn't there is dropped.
    expect(cleanPatches([{ k: 'rev', id: 'x', v: { id: 'x', page, text: 5 } }])).toEqual([])
    const orphan = { ...b.revs![0], id: 'orphan1', page: 'nope' }
    expect(applyPatches(start, [{ k: 'rev', id: 'orphan1', v: orphan }]).revs).toBeUndefined()
    // Deleting the page for good takes its history with it.
    expect(W.deletePage(b, page).revs).toBeUndefined()
  })

  it('saves versions as people write, which undo never takes away', () => {
    const { b, page } = wiki()
    const e = new Editor(b, fakeMeasure)
    e.author = 'Ana'
    e.beginPageEdit(page)
    e.setPageText(page, 'Towel\nTent')
    e.endPageEdit(page, 'Added the tent')
    expect(RV.pageRevs(e.board, page).map((r) => [r.text, r.note])).toEqual([
      ['Towel', undefined],
      ['Towel\nTent', 'Added the tent'],
    ])
    e.undo()
    expect(W.pageText(e.board, page)).toBe('Towel')
    expect(RV.pageRevs(e.board, page)).toHaveLength(2)
    e.redo()
    expect(RV.pageRevs(e.board, page)).toHaveLength(2)
    // An AI change brings its versions in the same step; undoing it keeps them in the history.
    const proposed = applyOps(e.board, [{ op: 'updatePage', page, append: 'Map' }], { measure: fakeMeasure }).board
    e.applyAi('p1', 'Add the map', diff(e.board, proposed))
    const withAi = RV.pageRevs(e.board, page).length
    expect(withAi).toBe(3)
    e.undo()
    expect(W.pageText(e.board, page)).toBe('Towel\nTent')
    expect(RV.pageRevs(e.board, page)).toHaveLength(withAi)
    // A rename is a version too, and putting one back saves the result with a note.
    e.setPageTitle(page, 'Packing list')
    expect(RV.latestRev(e.board, page)!.title).toBe('Packing list')
    e.restorePageVersion(page, 'Packing', 'Towel', 'version 1')
    expect(RV.latestRev(e.board, page)).toMatchObject({ text: 'Towel', note: 'Put back version 1' })
  })

  it('records AI and API page changes, with their note', () => {
    const { b, page } = wiki()
    const { board } = applyOps(b, [{ op: 'updatePage', page, append: 'Sun cream', note: 'Added sun cream' }], { measure: fakeMeasure })
    expect(RV.pageRevs(board, page).map((r) => [r.text, r.by, r.note])).toEqual([
      ['Towel', 'Sam', undefined],
      ['Towel\nSun cream', 'AI', 'Added sun cream'],
    ])
  })
  it('brings a page’s history back with the page, and keeps versions through AI history toggles', () => {
    const { b, page } = wiki()
    const e = new Editor(b, fakeMeasure)
    e.beginPageEdit(page)
    e.setPageText(page, 'Towel\nTent')
    e.endPageEdit(page)
    expect(RV.pageRevs(e.board, page)).toHaveLength(2)
    e.deletePageForever(page)
    e.undo()
    expect(RV.pageRevs(e.board, page)).toHaveLength(2)
    // Undoing an AI change from the AI history leaves its versions in place.
    const proposed = applyOps(e.board, [{ op: 'updatePage', page, append: 'Map' }], { measure: fakeMeasure }).board
    e.applyAi('p1', 'Add the map', diff(e.board, proposed))
    const n = RV.pageRevs(e.board, page).length
    e.toggleAiChange('p1')
    expect(W.pageText(e.board, page)).toBe('Towel\nTent')
    expect(RV.pageRevs(e.board, page)).toHaveLength(n)
  })

  it('saves the merged words as the AI’s version when someone typed meanwhile', () => {
    const { b, page } = wiki()
    const e = new Editor(b, fakeMeasure)
    const proposed = applyOps(e.board, [{ op: 'updatePage', page, append: 'Map' }], { measure: fakeMeasure }).board
    const bases = { [page]: W.pageText(e.board, page) }
    const patches = diff(e.board, proposed)
    e.setPageText(page, 'Hat\nTowel')
    e.applyAi('p1', 'Add the map', patches, bases)
    expect(W.pageText(e.board, page)).toBe('Hat\nTowel\nMap')
    expect(RV.latestRev(e.board, page)).toMatchObject({ text: 'Hat\nTowel\nMap', by: 'AI', note: 'Add the map' })
    expect(RV.unsavedChanges(e.board, page)).toBe(false)
  })

  it('counts the every-few-minutes rule from the last save here, not from when the words were written', () => {
    const { b, page } = wiki()
    const e = new Editor(b, fakeMeasure)
    // The page was last written long ago; starting to write saves it once, and quick typing adds nothing.
    e.beginPageEdit(page)
    e.setPageText(page, 'Towel\nT')
    e.setPageText(page, 'Towel\nTent')
    e.endPageEdit(page)
    expect(RV.pageRevs(e.board, page).map((r) => r.text)).toEqual(['Towel', 'Towel\nTent'])
  })
})

describe('page versions in a live room', () => {
  async function room(b: Board) {
    const { Room } = await import('../collab/room')
    const r = new Room({ id: 'r', board: b, version: 0, editKey: 'e'.repeat(20), viewKey: 'v'.repeat(20), nextSlot: 1, created: 0, updated: 0 }, fakeMeasure)
    const inbox: { t: string }[] = []
    r.join({ id: 'a', role: 'edit', send: (m) => inbox.push(m) })
    return { r, inbox }
  }

  it('keeps versions a log: no rewriting words, no removing ones kept for good, no far-future times', async () => {
    let { b, page } = wiki()
    b = RV.savePageVersion(b, page, { keep: true })
    const { r } = await room(b)
    const rev = b.revs![0]
    r.receive('a', { t: 'patch', seq: 1, patches: [{ k: 'rev', id: rev.id, v: { ...rev, text: 'Rewritten' } }] })
    expect(r.data.board.revs![0].text).toBe('Towel')
    r.receive('a', { t: 'patch', seq: 2, patches: [{ k: 'rev', id: rev.id, v: null }] })
    expect(r.data.board.revs).toHaveLength(1)
    // A note may be added later.
    r.receive('a', { t: 'patch', seq: 3, patches: [{ k: 'rev', id: rev.id, v: { ...rev, note: 'Start' } }] })
    expect(r.data.board.revs![0].note).toBe('Start')
    const future = { ...rev, id: 'future1', at: 8.64e15 }
    expect(cleanPatches([{ k: 'rev', id: 'future1', v: future }])[0]).toMatchObject({ v: { at: expect.any(Number) } })
    expect((cleanPatches([{ k: 'rev', id: 'future1', v: future }])[0] as { v: { at: number } }).v.at).toBeLessThanOrEqual(Date.now() + 86_400_001)
  })

  it('takes someone’s words even when the wiki has too many versions (just not the new version)', async () => {
    let { b, page } = wiki()
    b = { ...b, revs: Array.from({ length: RV.MAX_REVS }, (_, k) => ({ id: `r${k}`, page, at: k, title: 'Packing', text: '' })) }
    const { r, inbox } = await room(b)
    // An editor whose browser didn't prune: the words, and one version too many.
    const body = W.setPageBody(b, page, 'Towel\nTent', 10, 'Sam').bodies!.find((x) => x.id === page)!
    r.receive('a', {
      t: 'patch',
      seq: 1,
      patches: [
        { k: 'body', id: page, v: body },
        { k: 'rev', id: 'new1', v: { id: 'new1', page, at: 10, title: 'Packing', text: 'Towel\nTent' } },
      ],
    })
    expect(inbox.at(-1)).toMatchObject({ t: 'ack' })
    expect(W.pageText(r.data.board, page)).toBe('Towel\nTent')
    expect(r.data.board.revs).toHaveLength(RV.MAX_REVS)
  })

  it('applies thousands of version patches at once quickly', () => {
    const { b, page } = wiki()
    const many = { ...b, revs: Array.from({ length: 20_000 }, (_, k) => ({ id: `r${k}`, page, at: k, title: 'P', text: '' })) }
    const patches = Array.from({ length: 5000 }, (_, k) => ({ k: 'rev' as const, id: `r${k}`, v: { id: `r${k}`, page, at: k, title: 'P', text: '', note: 'n' } }))
    const t = performance.now()
    applyPatches(many, patches)
    expect(performance.now() - t).toBeLessThan(150)
  })

  it('never keeps more versions in all than a room accepts', () => {
    let { b } = wiki()
    const pages: string[] = []
    for (let k = 0; k < 400; k++) {
      let id: string
      ;[b, id] = W.addPage(b, { title: `P${k}` }, 10)
      pages.push(id)
    }
    b = { ...b, revs: pages.flatMap((id) => Array.from({ length: 40 }, (_, k) => ({ id: `${id}-${k}`, page: id, at: k, title: 'P', text: `${k}` }))) }
    b = RV.pruneRevs(b)
    expect(b.revs!.length).toBeLessThanOrEqual(RV.REV_TOTAL_KEEP)
  })
})
