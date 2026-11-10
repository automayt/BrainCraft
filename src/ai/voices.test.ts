import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from '../api/ops'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { voiceLine } from '../ui/useTalk'
import { Utterances, joined } from './listen'

describe('who said what, as the assistant reads it', () => {
  const two = [
    { n: 1, name: 'Voice 1' },
    { n: 2, name: 'Sam' },
  ]

  it('names the person once there’s more than one voice', () => {
    expect(voiceLine('move it to May', 2, two)).toBe('[Sam] move it to May')
    expect(voiceLine('hello', 1, two)).toBe('[Voice 1] hello')
  })

  it('leaves someone talking alone as they are', () => {
    expect(voiceLine('a mind map of the launch', 1, [{ n: 1, name: 'Voice 1' }])).toBe('a mind map of the launch')
    expect(voiceLine('no voices here', undefined, two)).toBe('no voices here')
  })

  it('gives each person’s lines a line of their own, and runs one person’s phrases together', () => {
    expect(joined(['[Sam] we could', 'move it', '[Lee] or not'])).toBe('[Sam] we could move it\n[Lee] or not')
    expect(joined(['just', 'talking'])).toBe('just talking')
  })

  it('sends a turn that way', async () => {
    const sent: string[] = []
    let fire: () => void = () => {}
    const u = new Utterances(async (t) => void sent.push(t), { setTimer: (f) => ((fire = f), 1), clearTimer: () => {} })
    u.heard('[Sam] budget first')
    u.heard('[Lee] venue first')
    fire()
    await Promise.resolve()
    expect(sent).toEqual(['[Sam] budget first\n[Lee] venue first'])
  })
})

describe('ideas carry who they came from', () => {
  const ctx = { measure: fakeMeasure }
  const people = (b: ReturnType<typeof emptyBoard>) => Object.fromEntries(b.items.map((i) => [i.text, i.assignees ?? []]))

  it('when a mind map is made', () => {
    const { board } = applyOps(emptyBoard(), [{ op: 'createMindMap', tree: { text: 'Launch', children: [{ text: 'Move to May', who: ['Sam'], children: [{ text: 'Tell press', who: ['Lee'], children: [] }] }, { text: 'Budget', children: [] }] } } as Op], ctx)
    expect(people(board)).toEqual({ Launch: [], 'Move to May': ['Sam'], 'Tell press': ['Lee'], Budget: [] })
  })

  it('when ideas are added', () => {
    let { board, results } = applyOps(emptyBoard(), [{ op: 'createMindMap', outline: 'Launch' }], ctx)
    ;({ board } = applyOps(board, [{ op: 'addIdeas', parent: results[0].id!, ideas: [{ text: 'Venue', who: 'Lee' }, { text: 'Dates', who: ['Sam', 'Lee'], children: [{ text: 'May' }] }] } as Op], ctx))
    expect(people(board)).toEqual({ Launch: [], Venue: ['Lee'], Dates: ['Sam', 'Lee'], May: [] })
  })

  it('ignores names that aren’t names', () => {
    let { board, results } = applyOps(emptyBoard(), [{ op: 'createMindMap', outline: 'Launch' }], ctx)
    ;({ board } = applyOps(board, [{ op: 'addIdeas', parent: results[0].id!, ideas: [{ text: 'Venue', who: [3, '  '] }] } as unknown as Op], ctx))
    expect(people(board)).toEqual({ Launch: [], Venue: [] })
  })
})
