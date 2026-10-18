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
    e.restorePageVersion(page, 'Packing', 'Towel', '(version 1)')
    expect(RV.latestRev(e.board, page)).toMatchObject({ text: 'Towel', note: 'Put back the version (version 1)' })
  })

  it('records AI and API page changes, with their note', () => {
    const { b, page } = wiki()
    const { board } = applyOps(b, [{ op: 'updatePage', page, append: 'Sun cream', note: 'Added sun cream' }], { measure: fakeMeasure })
    expect(RV.pageRevs(board, page).map((r) => [r.text, r.by, r.note])).toEqual([
      ['Towel', 'Sam', undefined],
      ['Towel\nSun cream', 'AI', 'Added sun cream'],
    ])
  })
})
