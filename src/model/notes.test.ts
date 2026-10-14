import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, getItem, newItem } from './board'
import { addNote, allNotes, backlinks, deleteNote, mentionCandidates, mentionToken, parseNote, plainNote } from './notes'

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

  it('suggests objects to mention by label or kind', () => {
    const { b, a, c } = board()
    expect(mentionCandidates(b, 'appr').map((i) => i.id)).toEqual([c])
    expect(mentionCandidates(b, 'sticky').map((i) => i.id)).toEqual([a])
    expect(mentionCandidates(b, '', a).map((i) => i.id)).toEqual([c])
  })
})
