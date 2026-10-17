import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, getItem, newItem } from './board'
import * as RX from './reactions'
import type { Board, Id } from './types'

function board(n: number): [Board, Id[]] {
  let b = emptyBoard()
  const ids: Id[] = []
  for (let k = 0; k < n; k++) {
    let id: Id
    ;[b, id] = addItem(b, newItem('sticky', { x: k * 250, y: 0, w: 200, h: 200 }, { text: `Option ${k}` }))
    ids.push(id)
  }
  return [b, ids]
}

describe('reactions', () => {
  it('adds and removes a person’s reaction', () => {
    const [b, [id]] = board(1)
    let i = getItem(b, id)!
    i = RX.toggleReaction(i, '👍', 'Sam')
    i = RX.toggleReaction(i, '👍', 'Ana')
    i = RX.toggleReaction(i, '❤️', 'Ana')
    expect(RX.reactionList(i)).toEqual([
      { emoji: '👍', who: ['Sam', 'Ana'] },
      { emoji: '❤️', who: ['Ana'] },
    ])
    i = RX.toggleReaction(RX.toggleReaction(RX.toggleReaction(i, '👍', 'Sam'), '👍', 'Ana'), '❤️', 'Ana')
    expect(i.reactions).toBeUndefined()
  })
})

describe('dot voting', () => {
  it('limits each person’s votes, hides nothing in the data, and ranks results', () => {
    const [b0, ids] = board(4)
    const [b1, poll] = RX.startPoll(b0, ids, { question: 'Dinner?', each: 2 })
    expect(RX.pollOf(b1, poll)!.poll).toMatchObject({ options: ids, each: 2, revealed: false })
    expect(RX.activePoll(b1)!.id).toBe(poll)
    let b = RX.castVote(b1, poll, ids[2], 'Sam', 1)
    b = RX.castVote(b, poll, ids[2], 'Sam', 1)
    // A third vote is over the allowance.
    expect(RX.castVote(b, poll, ids[0], 'Sam', 1)).toBe(b)
    b = RX.castVote(b, poll, ids[0], 'Ana', 1)
    expect(RX.usedVotes(b, poll, 'Sam')).toBe(2)
    expect(RX.voters(b, poll).sort()).toEqual(['Ana', 'Sam'])
    expect(RX.results(b, poll).map((r) => [r.item.text, r.votes])).toEqual([
      ['Option 2', 2],
      ['Option 0', 1],
      ['Option 1', 0],
      ['Option 3', 0],
    ])
    // Taking one back frees it up.
    b = RX.castVote(b, poll, ids[2], 'Sam', -1)
    expect(RX.usedVotes(b, poll, 'Sam')).toBe(1)
    // Ended votes take no more.
    b = RX.endPoll(b, poll)
    expect(RX.castVote(b, poll, ids[1], 'Ana', 1)).toBe(b)
    expect(RX.pollOf(b, poll)!.poll.revealed).toBe(true)
  })

  it('sorts the options by votes into a grid', () => {
    const [b0, ids] = board(4)
    const [b1, poll] = RX.startPoll(b0, ids)
    const b2 = RX.castVote(RX.castVote(b1, poll, ids[3], 'Sam', 1), poll, ids[3], 'Ana', 1)
    const sorted = RX.sortByVotes(b2, poll)
    const first = getItem(sorted, ids[3])!
    expect([first.x, first.y]).toEqual([0, 0])
  })
})
