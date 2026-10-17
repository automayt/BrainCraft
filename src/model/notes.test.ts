import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, getItem, newItem, updateItem } from './board'
import {
  addNote,
  allNotes,
  backlinks,
  deleteNote,
  fromEditable,
  linkCandidates,
  linksIn,
  linkToken,
  mentionCandidates,
  mentionToken,
  parseNote,
  plainNote,
  resolveName,
  toEditable,
} from './notes'

function board() {
  let b = emptyBoard()
  let a: number, c: number
  ;[b, a] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }, { text: 'Budget' }))
  ;[b, c] = addItem(b, newItem('flow', { x: 0, y: 0, w: 10, h: 10 }, { text: 'Approve spend', shape: 'decision' }))
  return { b, a, c }
}

describe('work notes', () => {
  it('adds timestamped notes in order and ignores blank ones', () => {
    let { b, a } = board()
    b = addNote(b, a, 'first', 'Sam', 1000)
    b = addNote(b, a, '   ')
    b = addNote(b, a, 'second', undefined, 2000)
    expect(getItem(b, a)!.notes!.map((n) => [n.text, n.at, n.author])).toEqual([
      ['first', 1000, 'Sam'],
      ['second', 2000, undefined],
    ])
  })

  it('deletes notes, dropping the list when empty', () => {
    let { b, a } = board()
    b = addNote(b, a, 'x')
    const id = getItem(b, a)!.notes![0].id
    b = deleteNote(b, a, id)
    expect(getItem(b, a)!.notes).toBeUndefined()
  })

  it('parses mentions and finds backlinks', () => {
    let { b, a, c } = board()
    const text = `Needs sign-off from ${mentionToken('Approve [spend]', c)} first`
    expect(parseNote(text)).toEqual([
      { text: 'Needs sign-off from ' },
      { mention: c, label: 'Approve spend' },
      { text: ' first' },
    ])
    expect(plainNote(text)).toBe('Needs sign-off from @Approve spend first')
    b = addNote(b, a, text, undefined, 5)
    b = addNote(b, c, 'unrelated', undefined, 9)
    expect(backlinks(b, c).map((r) => r.item.id)).toEqual([a])
    expect(allNotes(b).map((r) => r.note.at)).toEqual([9, 5])
  })

  it('parses wiki-links to objects, boards and objects on other boards', () => {
    const { c } = board()
    const text = `See ${linkToken('Cars', { board: 'abc-1' })}, ${linkToken('Approve', { item: c })} and ${linkToken('Wheels', { board: 'abc-1', item: 7 })} or [[Someday]]`
    expect(parseNote(text)).toEqual([
      { text: 'See ' },
      { link: { board: 'abc-1' }, label: 'Cars' },
      { text: ', ' },
      { link: { item: c }, label: 'Approve' },
      { text: ' and ' },
      { link: { board: 'abc-1', item: 7 }, label: 'Wheels' },
      { text: ' or ' },
      { link: null, label: 'Someday' },
    ])
    expect(plainNote(text)).toBe('See Cars, Approve and Wheels or Someday')
    expect(linksIn(`${mentionToken('A', 3)} ${text}`)).toEqual([{ item: 3 }, { board: 'abc-1' }, { item: c }, { board: 'abc-1', item: 7 }])
  })

  it('leaves look-alikes as text', () => {
    expect(parseNote('[[x]]() and [[]] and [x](#3)')).toEqual([{ text: '[[x]]()' }, { text: ' and [[]] and [x](#3)' }])
  })

  it('round-trips links through a text box', () => {
    const stored = `Ask ${mentionToken('Budget', 1)} about ${linkToken('Cars', { board: 'k' })} and [[Later]]`
    const { text, picks } = toEditable(stored)
    expect(text).toBe('Ask @Budget about [[Cars]] and [[Later]]')
    expect(fromEditable(`${text}, then [[Cars]] again`, picks)).toBe(`${stored}, then ${linkToken('Cars', { board: 'k' })} again`)
    expect(fromEditable('no picks', new Map())).toBe('no picks')
  })

  it('matches typed [[Name]] links to boards first, then objects', () => {
    const { b, a } = board()
    const boards = [{ key: 'k1', title: 'Budget' }]
    expect(resolveName(' budget ', b, boards)).toEqual({ board: 'k1' })
    expect(resolveName('Budget', b, [])).toEqual({ item: a })
    expect(resolveName('Nothing', b, boards)).toBeNull()
  })

  it('finds backlinks in descriptions and comments, including by name and through this board’s key', () => {
    let { b, a, c } = board()
    b = updateItem(b, a, (i) => ({ ...i, description: `Blocked by ${linkToken('Approve', { item: c })}` }))
    b = addNote(b, a, `Also ${linkToken('Approve', { board: 'me', item: c })}`, undefined, 5)
    b = addNote(b, a, `Not ${linkToken('Approve', { board: 'other', item: c })}`, undefined, 6)
    b = addNote(b, a, 'Ping [[approve spend]]', undefined, 7)
    const refs = backlinks(b, c, ['me'])
    expect(refs.map((r) => r.note?.at ?? 'description')).toEqual(['description', 7, 5])
    expect(backlinks(b, c).map((r) => r.note?.at ?? 'description')).toEqual(['description', 7])
  })

  it('suggests boards and objects to link to', () => {
    const { b, c } = board()
    const boards = [
      { key: 'k1', title: 'Cars' },
      { key: 'k2', title: 'Approvals log' },
    ]
    expect(linkCandidates(b, 'appr', boards).map((x) => x.to)).toEqual([{ board: 'k2' }, { item: c }])
    expect(linkCandidates(b, '', boards, undefined, 3).map((x) => x.hint)).toEqual(['Board', 'Board', 'Sticky note'])
  })

  it('suggests objects to mention by label or kind', () => {
    const { b, a, c } = board()
    expect(mentionCandidates(b, 'appr').map((i) => i.id)).toEqual([c])
    expect(mentionCandidates(b, 'sticky').map((i) => i.id)).toEqual([a])
    expect(mentionCandidates(b, '', a).map((i) => i.id)).toEqual([c])
  })
})
