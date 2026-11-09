import { describe, expect, it } from 'vitest'
import type { ServerBoard } from './account'
import { boardEntries, byOpened, categoriesOf, shownEntries } from './boardList'
import type { BoardMeta } from './library'

const SERVER = 'https://boards.example'
const meta = (id: string, title: string, updated: number, extra: Partial<BoardMeta> = {}): BoardMeta => ({ id, title, updated, created: 0, items: 3, thumb: [], aspect: 1, ...extra })
const remote = (id: string, title: string, updated: number, extra: Partial<ServerBoard> = {}): ServerBoard => ({ id, title, updated, level: 'edit', owner: { id: 'me', name: 'Me' }, ...extra })

describe('your boards as one list', () => {
  it('a server board opened here is one entry, newest first, with the later title', () => {
    const local = [
      meta('a', 'Trip', 100, { live: { server: SERVER, id: 'S1', key: '', role: 'edit', account: true } }),
      meta('b', 'Recipes', 300),
      // The same server id on another server isn't the same board.
      meta('c', 'Elsewhere', 50, { live: { server: 'https://other.example', id: 'S2', key: '', role: 'edit', account: true } }),
    ]
    const server = [remote('S1', 'Trip to Rome', 200), remote('S2', 'Budget', 400, { owner: { id: 'sam', name: 'Sam' }, kind: 'wiki' })]
    const all = boardEntries(local, server, SERVER)
    expect(all.map((e) => [e.key, e.title, e.updated])).toEqual([
      ['server:S2', 'Budget', 400],
      ['b', 'Recipes', 300],
      ['a', 'Trip to Rome', 200],
      ['c', 'Elsewhere', 50],
    ])
    expect(all[2].server?.id).toBe('S1')
    // Opened here a while ago: Recent goes by that, not by a friend's later edit.
    const opened = boardEntries([{ ...local[1], opened: 500 }, ...local.filter((b) => b.id !== 'b')], server, SERVER)
    expect(byOpened(opened).map((e) => e.key)).toEqual(['b', 'server:S2', 'a', 'c'])
    expect(all[2].local?.id).toBe('a')
    expect(shownEntries(all, { filter: 'shared', me: 'me' }).map((e) => e.entry.title)).toEqual(['Budget'])
    expect(shownEntries(all, { filter: 'wikis' }).map((e) => e.entry.title)).toEqual(['Budget'])
    expect(shownEntries(all, { query: 'RO' }).map((e) => e.entry.title)).toEqual(['Trip to Rome'])
  })

  it('by name, child boards follow the board they came from, whichever list they are in', () => {
    const local = [meta('p', 'Plans', 10, { live: { server: SERVER, id: 'P', key: '', role: 'edit', account: true } }), meta('z', 'Zoo', 20)]
    const server = [remote('P', 'Plans', 10), remote('K', 'Kit list', 30, { parent: 'P' }), remote('A', 'Art', 5)]
    const shown = shownEntries(boardEntries(local, server, SERVER), { sort: 'name' })
    expect(shown.map((e) => [e.entry.title, e.depth])).toEqual([
      ['Art', 0],
      ['Plans', 0],
      ['Kit list', 1],
      ['Zoo', 0],
    ])
  })
})

describe('categories', () => {
  const local = [meta('a', 'Trip', 100, { live: { server: SERVER, id: 'S1', key: '', role: 'edit', account: true } }), meta('b', 'Recipes', 300), meta('c', 'Notes', 200)]
  const server = [remote('S1', 'Trip', 100, { category: 'Webex meetings' }), remote('S2', 'Budget', 50, { category: 'Webex meetings' })]
  // This browser's own categories, by its ids; 'a' is on the server, so the server's word counts.
  const all = boardEntries(local, server, SERVER, { a: 'Old', b: 'Cooking' })

  it('come from the server for its boards, and from this browser for its own', () => {
    expect(Object.fromEntries(all.map((e) => [e.title, e.category ?? null]))).toEqual({ Trip: 'Webex meetings', Recipes: 'Cooking', Notes: null, Budget: 'Webex meetings' })
  })

  it('are listed by name with how many boards each has', () => {
    expect(categoriesOf(all)).toEqual([
      { name: 'Cooking', count: 1 },
      { name: 'Webex meetings', count: 2 },
    ])
  })

  it('narrow the list to one, or to boards in none', () => {
    expect(shownEntries(all, { category: 'Webex meetings', sort: 'name' }).map((e) => e.entry.title)).toEqual(['Budget', 'Trip'])
    expect(shownEntries(all, { category: null }).map((e) => e.entry.title)).toEqual(['Notes'])
    expect(shownEntries(all, {})).toHaveLength(4)
  })
})
