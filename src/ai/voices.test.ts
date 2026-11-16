import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from '../api/ops'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { CALL_NAME, glossaryOf, unnamedVoice } from '../model/meeting'
import { heardSummary, heardWarning, sameVoice, voiceLine } from '../ui/useTalk'
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
    expect(voiceLine('no voices here', undefined, [])).toBe('no voices here')
  })

  it('says when it isn’t sure who, rather than letting the line run on as the last person’s', () => {
    expect(voiceLine('and the budget', undefined, two)).toBe('[Not sure who] and the budget')
    expect(joined(['[Sam] we could', '[Not sure who] and the budget'])).toBe('[Sam] we could\n[Not sure who] and the budget')
  })
})

describe('the microphone and the call, as two people', () => {
  const both = [
    { n: 0, name: 'Jordan' },
    { n: 1, name: CALL_NAME },
  ]

  it('puts the call down as the call, and the microphone as the person here', () => {
    expect(voiceLine('I’ll book it', 0, both, 'me')).toBe('[Jordan] I’ll book it')
    expect(voiceLine('We move to May', 1, both, 'call')).toBe('[The call] We move to May')
    // One of several voices on the call, not known which: still not the person here.
    expect(voiceLine('and the budget', undefined, both, 'call')).toBe('[Someone on the call] and the budget')
    expect(voiceLine('and the budget', undefined, both, 'me')).toBe('[Not sure who] and the budget')
    // From the first line, before the other has said anything.
    expect(voiceLine('We move to May', 1, [both[1]], 'call')).toBe('[The call] We move to May')
    expect(voiceLine('I’ll book it', 0, [both[0]], 'me')).toBe('[Jordan] I’ll book it')
    expect(voiceLine('I’ll book it', 0, [both[0]])).toBe('I’ll book it')
  })

  it('counts the call as a whole as a voice still to be named', () => {
    expect(unnamedVoice('The call')).toBe(true)
    expect(unnamedVoice(' the call ')).toBe(true)
    expect(unnamedVoice('Voice 12')).toBe(true)
    expect(unnamedVoice('Sam')).toBe(false)
    expect(unnamedVoice('The caller')).toBe(false)
    // Not a name for speech to text to spell.
    expect(glossaryOf(emptyBoard(), ['Jordan', 'The call', 'Voice 2'])).toEqual(['Jordan'])
  })

  it('says what was heard from where, and what was left out', () => {
    expect(heardSummary({ me: 0, call: 0, room: 4, echo: 0, again: 0 })).toBe('')
    expect(heardSummary({ me: 12, call: 1, room: 0, echo: 0, again: 0 })).toBe('Heard 12 lines from you and 1 line from the call.')
    expect(heardSummary({ me: 12, call: 30, room: 2, echo: 8, again: 1 })).toBe('Heard 12 lines from you and 30 lines from the call. Left out: 8 that were the call in your microphone, and 1 said over and over.')
    expect(heardSummary({ me: 0, call: 0, room: 9, echo: 0, again: 3 })).toBe('Left out: 3 said over and over.')
    expect(heardSummary({ me: 2, call: 2, room: 0, echo: 1, again: 0 })).toBe('Heard 2 lines from you and 2 lines from the call. Left out: 1 that was the call in your microphone.')
  })

  it('warns when one of the two isn’t being heard', () => {
    // Too soon to say.
    expect(heardWarning({ me: 3, call: 0, room: 0, echo: 0, again: 0 }, true)).toBeNull()
    expect(heardWarning({ me: 6, call: 0, room: 0, echo: 0, again: 0 }, true)).toMatch(/Nothing has been heard from the call/)
    expect(heardWarning({ me: 2, call: 0, room: 0, echo: 4, again: 0 }, true)).toMatch(/Nothing has been heard from the call/)
    expect(heardWarning({ me: 6, call: 1, room: 0, echo: 0, again: 0 }, true)).toBeNull()
    // The call heard, the microphone never, and much taken out of it: echo removal may be taking the person too.
    expect(heardWarning({ me: 0, call: 12, room: 0, echo: 4, again: 0 }, true)).toMatch(/turn echo removal off/)
    expect(heardWarning({ me: 0, call: 12, room: 0, echo: 4, again: 0 }, false)).toBeNull()
    expect(heardWarning({ me: 0, call: 12, room: 0, echo: 0, again: 0 }, true)).toBeNull()
    expect(heardWarning({ me: 1, call: 40, room: 0, echo: 9, again: 0 }, true)).toBeNull()
  })
})

describe('two voices that were one person', () => {
  it('keeps the earlier one, and tells the assistant', () => {
    const three = [
      { n: 1, name: 'Voice 1' },
      { n: 2, name: 'Voice 2' },
      { n: 3, name: 'Voice 3' },
    ]
    expect(sameVoice(three, 3, 1)).toEqual({ voices: [three[0], three[1]], told: ['[Voice 3 is Voice 1]'] })
  })

  it('keeps a name either of them was given', () => {
    const named = [
      { n: 1, name: 'Voice 1' },
      { n: 2, name: 'Brian' },
    ]
    expect(sameVoice(named, 2, 1)).toEqual({ voices: [{ n: 1, name: 'Brian' }], told: ['[Voice 1 is Brian]'] })
    const both = [
      { n: 1, name: 'Jason' },
      { n: 3, name: 'Voice 3' },
    ]
    expect(sameVoice(both, 3, 1)).toEqual({ voices: [{ n: 1, name: 'Jason' }], told: ['[Voice 3 is Jason]'] })
  })

  it('changes nothing for a voice it never showed', () => {
    const two = [
      { n: 1, name: 'Voice 1' },
      { n: 2, name: 'Sam' },
    ]
    expect(sameVoice(two, 5, 1)).toEqual({ voices: two, told: [] })
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
