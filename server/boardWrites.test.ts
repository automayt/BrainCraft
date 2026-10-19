import { describe, expect, it } from 'vitest'
import { applyOps } from '../src/api/ops'
import { Room, type RoomData } from '../src/collab/room'
import { emptyBoard } from '../src/model/board'
import { fakeMeasure } from '../src/model/test-helpers'
import type { Board } from '../src/model/types'
import { emptyWiki, pageByTitle } from '../src/model/wiki'
import { boardWrite } from './boardWrites'
import { res } from './accounts/fakes'

const roomOf = (board: Board) => new Room({ id: 'b', board, version: 0, editKey: 'e'.repeat(24), viewKey: 'v'.repeat(24), nextSlot: 1, created: 0, updated: 0 } as RoomData, fakeMeasure)

async function call(room: Room, method: string, path: string, body: unknown, canEdit = true) {
  const r = res()
  const url = new URL(`http://x/${path}`)
  const handled = await boardWrite(room, method, url.pathname.split('/').filter(Boolean), url.searchParams, async () => (body === undefined ? '' : JSON.stringify(body)), { canEdit }, r)
  return handled ? r.reply : null
}

describe('a wiki’s pages over HTTP (shared by key)', () => {
  it('makes, changes, moves and trashes pages, keeping history, with an edit key only', async () => {
    const room = roomOf(emptyWiki('Club'))
    const made = await call(room, 'POST', 'pages', { title: 'Plan', text: 'Day 1', note: 'Started' })
    expect(made).toMatchObject({ status: 201, body: { title: 'Plan', text: 'Day 1' } })
    const page = String(made!.body.page)
    expect((await call(room, 'PUT', `pages/${page}`, { text: 'Day 1 and 2', note: 'More days' }))!.body).toMatchObject({ text: 'Day 1 and 2', versions: 2 })
    expect((await call(room, 'POST', `pages/${encodeURIComponent('Plan')}/move`, { parent: 'Home' }))!.body).toMatchObject({ path: ['Home'] })
    expect((await call(room, 'PUT', 'pages/Nope', { text: 'x' }))!.status).toBe(404)
    expect((await call(room, 'PUT', `pages/${page}`, { protected: 'yes' }))!.status).toBe(422)
    expect((await call(room, 'POST', 'pages', 'not an object'))!.status).toBe(400)
    expect((await call(room, 'POST', 'pages', { title: 'Mine' }, false))!.status).toBe(403)
    expect((await call(room, 'DELETE', `pages/${page}`, undefined))!.body).toMatchObject({ trashed: true })
    expect(pageByTitle(room.data.board, 'Plan')).toBeUndefined()
    // Shared by key nobody manages: protection is the app's guard, not the server's.
    await call(room, 'PUT', 'pages/Home', { protected: true })
    expect((await call(room, 'PUT', 'pages/Home', { text: 'Still fine' }))!.status).toBe(200)
  })

  it('exports any board as a file, in the formats that suit it', async () => {
    const canvas = roomOf(applyOps(emptyBoard('Trip'), [{ op: 'createNote', text: 'Sea' }], { measure: fakeMeasure }).board)
    const md = await call(canvas, 'GET', 'export?format=md', undefined, false)
    expect(md!.headers['content-disposition']).toMatch(/filename="Trip\.md"/)
    expect(String(md!.body.text)).toContain('- Sea')
    const json = await call(canvas, 'GET', 'export', undefined, false)
    expect(json!.body).toMatchObject({ title: 'Trip' })
    expect((await call(canvas, 'GET', 'export?format=html', undefined, false))!.status).toBe(400)
    expect((await call(canvas, 'POST', 'pages', { title: 'x' }))!.status).toBe(409)

    const wiki = roomOf(applyOps(emptyWiki('Café'), [{ op: 'createPage', title: 'Menu', text: 'Coffee' }], { measure: fakeMeasure }).board)
    const html = await call(wiki, 'GET', 'export?format=html', undefined, false)
    expect(html!.headers['content-disposition']).toMatch(/filename\*=UTF-8''Caf%C3%A9\.html/)
    expect(String(html!.body.text)).toContain('Coffee')
    const zip = await call(wiki, 'GET', 'export?format=zip', undefined, false)
    expect(zip!.headers['content-type']).toBe('application/zip')
    expect(String((await call(wiki, 'GET', 'pages/Menu/export?format=html', undefined, false))!.body.text)).not.toContain('Start writing here')
    // Anything else isn't this module's.
    expect(await call(wiki, 'GET', 'objects', undefined, false)).toBeNull()
  })
})
