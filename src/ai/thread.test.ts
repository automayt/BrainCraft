import { describe, expect, it } from 'vitest'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { Assistant } from './assistant'
import type { Backend, TurnRequest, TurnResult } from './backends'
import { BUDGET, type Message, dropStale, personIndices, sizeOf, summaryCut, transcript, withSummary } from './thread'

const said = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] })
const answer = (text: string): Message => ({ role: 'assistant', content: [{ type: 'text', text }] })
const BIG = 'x'.repeat(5000)

/** A spoken turn as the assistant sends it: the live note, the board, and the words. */
const spoken = (words: string) =>
  said(`[Open: the canvas board "Launch"] [Nothing selected]\n[Live: the person is talking to you while looking at the board. Long instructions.]\n\n[The board now:]\nBoard "Launch": ${BIG}\n\nThey said: ${JSON.stringify(words)}\n\n[What the message links to, read for you:]\n\n${BIG}`)

describe('keeping a long conversation light', () => {
  it('leaves out old reads but keeps what was said, and the latest exchanges whole', () => {
    const messages: Message[] = [
      spoken('a mind map of the launch'),
      { role: 'assistant', content: [{ type: 'text', text: 'Mind map.' }, { type: 'tool_use', id: 't1', name: 'propose_changes', input: { summary: 'Mind map', ops: Array.from({ length: 80 }, () => ({ op: 'createNote', text: 'note' })) } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Applied to the board (4 new, 0 changed, 0 removed).' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: BIG } }, { type: 'text', text: 'what is on the trip wiki?' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'read_page', input: { page: 3 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: BIG }] },
      answer('It lists the hotel and flights.'),
      spoken('add a budget'),
      answer('Budget added.'),
    ]
    expect(personIndices(messages)).toEqual([0, 2, 6])
    const light = dropStale(messages, 1)
    expect(sizeOf(light.slice(0, 6))).toBeLessThan(sizeOf(messages.slice(0, 6)) / 5)
    const first = JSON.stringify(light[0])
    // What they said stays; the board then, what it linked to and the long instructions don't.
    expect(first).toContain('They said: \\"a mind map of the launch\\"')
    expect(first).toContain('[The board then: left out')
    expect(first).toContain('[What it linked to was read here; left out]')
    expect(first).toContain('[Live: spoken]')
    expect(first).not.toContain(BIG)
    // The change's operations go; its summary and the short result stay, so the model knows what it did.
    expect(JSON.stringify(light[1])).toContain('"summary":"Mind map"')
    expect(JSON.stringify(light[1])).toContain('80 operations, left out')
    expect(JSON.stringify(light[2])).toContain('Applied to the board (4 new')
    expect(JSON.stringify(light[2])).toContain('[A picture was sent here.]')
    expect(JSON.stringify(light[4])).toContain('characters read here earlier; left out')
    // Tool calls and their results still pair up.
    expect((light[4].content as { tool_use_id: string }[])[0].tool_use_id).toBe('t2')
    // The latest exchange is untouched.
    expect(light.slice(6)).toEqual(messages.slice(6))
    // Nothing to drop with few exchanges.
    expect(dropStale(messages, 5)).toEqual(messages)
  })

  it('puts a summary in place of the oldest part, dropping results for calls no longer there', () => {
    const messages: Message[] = [said('plan the launch'), { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_board', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'the board' }, { type: 'text', text: 'make it a flowchart' }] }, answer('Done.')]
    expect(summaryCut(messages, 1)).toBe(2)
    const out = withSummary(messages, messages[2], 'They are planning a launch.')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ role: 'user', content: [{ type: 'text', text: '[Earlier in this conversation, summarised:]\nThey are planning a launch.' }, { type: 'text', text: 'make it a flowchart' }] })
    // A conversation that changed underneath (a new chat) is left alone.
    expect(withSummary(messages, said('gone'), 'x')).toEqual(messages)
    expect(transcript(messages)).toContain('(Assistant used read_board)')
  })
})

/** A model that answers in a few words, and summarises when asked to. */
class Fake implements Backend {
  label = 'fake'
  asked: TurnRequest[] = []
  async turn(req: TurnRequest): Promise<TurnResult> {
    this.asked.push(structuredClone(req))
    const summary = !req.tools.length
    return { content: [{ type: 'text', text: summary ? 'SUMMARY: launch planning.' : 'Noted.', citations: null }], stop: 'end_turn' }
  }
}

describe('a conversation that goes on and on', () => {
  it('is summarised in the background once trimming is not enough, keeping recent words', async () => {
    const saved = { ...BUDGET }
    Object.assign(BUDGET, { drop: 4_000, summarise: 8_000, keepWhole: 2, keepWords: 3 })
    try {
      const fake = new Fake()
      const a = new Assistant(fake, { board: () => emptyBoard(), measure: fakeMeasure, selection: () => [] })
      let changed = 0
      a.onChange = () => changed++
      const on = { text: () => {}, status: () => {}, proposal: () => {} }
      for (let k = 0; k < 8; k++) await a.send(`point ${k}: ${'y'.repeat(1500)}`, on)
      await new Promise((r) => setTimeout(r, 0))
      const summaries = fake.asked.filter((r) => !r.tools.length)
      expect(summaries.length).toBeGreaterThan(0)
      expect(changed).toBeGreaterThan(0)
      const first = JSON.stringify(a.messages[0])
      expect(first).toContain('[Earlier in this conversation, summarised:]')
      // The latest exchanges are still there word for word.
      expect(JSON.stringify(a.messages)).toContain('point 7')
      expect(JSON.stringify(a.messages)).not.toContain('point 0')
      expect(a.messages[0].role).toBe('user')
    } finally {
      Object.assign(BUDGET, saved)
    }
  })
})

describe('one conversation across boards and wikis', () => {
  it('tells the model when the person has moved to another board or wiki', async () => {
    const fake = new Fake()
    let open = { ...emptyBoard(), title: 'Launch' }
    const a = new Assistant(fake, { board: () => open, measure: fakeMeasure, selection: () => [] })
    const on = { text: () => {}, status: () => {}, proposal: () => {} }
    await a.send('plan the launch', on)
    await a.send('add the venue', on)
    open = { ...open, kind: 'wiki', title: 'Trip' } as typeof open
    await a.send('now write that up', on)
    const said = (i: number) => JSON.stringify(fake.asked[i].messages.at(-1))
    expect(said(1)).not.toContain('moved here')
    expect(said(2)).toContain('[Open: the wiki \\"Trip\\"] [They were on the canvas board \\"Launch\\" before, and moved here]')
    // The earlier words are all still there for "that" to mean something.
    expect(JSON.stringify(fake.asked[2].messages)).toContain('add the venue')
  })
})
