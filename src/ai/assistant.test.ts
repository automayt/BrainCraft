import { describe, expect, it } from 'vitest'

import type Anthropic from '@anthropic-ai/sdk'

import { applyOps } from '../api/ops'

import { emptyBoard } from '../model/board'

import { addFile } from '../model/files'

import type { Board } from '../model/types'

import { emptyWiki } from '../model/wiki'

import { fakeMeasure } from '../model/test-helpers'

import { Assistant, type Proposal } from './assistant'

import { AnthropicBackend } from './backends'



type Block = Record<string, unknown>



/** A stand-in client that replies with scripted turns and records what it was sent. */

function fakeClient(turns: { content: Block[]; stop_reason: string }[]) {

  const sent: Record<string, unknown>[] = []

  const client = {

    beta: {

      messages: {

        stream(params: Record<string, unknown>) {

          sent.push(structuredClone(params))

          const turn = turns.shift()!

          const handlers: ((t: string) => void)[] = []

          return {

            on(_: string, f: (t: string) => void) {

              handlers.push(f)

            },

            async finalMessage() {

              for (const b of turn.content) if (b.type === 'text') handlers.forEach((h) => h(b.text as string))

              return { content: turn.content, stop_reason: turn.stop_reason }

            },

          }

        },

      },

    },

  }

  return { client: client as unknown as Anthropic, sent }

}



function board() {

  return applyOps(emptyBoard('Ideas'), [{ op: 'createNote', text: 'Faster checkout' }, { op: 'createNote', text: 'Saved carts' }], { measure: fakeMeasure }).board

}



describe('assistant', () => {

  it('reads the board, proposes changes as a preview, then answers', async () => {

    const b = board()

    const { client, sent } = fakeClient([

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'read_board', input: {} }] },

      {

        stop_reason: 'tool_use',

        content: [{ type: 'tool_use', id: 't2', name: 'propose_changes', input: { summary: 'Frame the ideas', ops: [{ op: 'createFrame', title: 'Checkout', around: [1, 2] }] } }],

      },

      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I grouped @[Faster checkout](#1) and @[Saved carts](#2).' }] },

    ])

    const proposals: Proposal[] = []

    let text = ''

    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: () => b, measure: fakeMeasure, selection: () => [1] })

    await a.send('Group these', { text: (t) => (text += t), status: () => {}, proposal: (p) => proposals.push(p) })



    expect(text).toContain('#1')

    expect(proposals).toHaveLength(1)

    expect(proposals[0]).toMatchObject({ summary: 'Frame the ideas', counts: { added: 1 }, status: 'pending' })

    // The board itself is untouched: proposals are only previews.

    expect(b.items).toHaveLength(2)

    // The selection travels with the message, and tool results come back in one user turn.

    const first = sent[0].messages as { content: { text: string }[] }[]

    expect(first[0].content[0].text).toContain('[Selected object ids: 1]')

    const third = sent[2].messages as { role: string; content: Block[] }[]

    expect(third.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2' }] })

    expect(sent[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], cache_control: { type: 'ephemeral' } })

    // Tools and system are byte-identical from step to step, so the cached prefix holds.

    expect(JSON.stringify(sent[2].tools)).toBe(JSON.stringify(sent[0].tools))

    expect(JSON.stringify(sent[2].system)).toBe(JSON.stringify(sent[0].system))

    // Claude reads the compact board text.

    const second = sent[1].messages as { content: Block[] }[]

    expect(second.at(-1)!.content[0].content).toMatch(/^Board "Ideas": 2 objects/)

  })



  it('hands invalid operations back to Claude as an error to fix', async () => {

    const b = board()

    const { client, sent } = fakeClient([

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_changes', input: { summary: 'x', ops: [{ op: 'connect', from: 99, to: 1 }] } }] },

      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry.' }] },

    ])

    const proposals: Proposal[] = []

    await new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: () => b, measure: fakeMeasure, selection: () => [] }).send('Connect', {

      text: () => {},

      status: () => {},

      proposal: (p) => proposals.push(p),

    })

    expect(proposals).toHaveLength(0)

    const msgs = sent[1].messages as { content: Block[] }[]

    expect(msgs.at(-1)!.content[0]).toMatchObject({ is_error: true })

  })



  it('never runs tools from a turn cut off by the length limit', async () => {

    const b = board()

    const { client, sent } = fakeClient([

      { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't1', name: 'propose_changes', input: { summary: 'x', ops: [{ op: 'createNote', text: 'a' }] } }] },

      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] },

    ])

    const proposals: Proposal[] = []

    await new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: () => b, measure: fakeMeasure, selection: () => [] }).send('Add', { text: () => {}, status: () => {}, proposal: (p) => proposals.push(p) })

    expect(proposals).toHaveLength(0)

    expect(((sent[1].messages as { content: Block[] }[]).at(-1)!.content[0] as Block).is_error).toBe(true)

  })



  it('skips the fallback parameter on Haiku', async () => {

    const { client, sent } = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] }])

    await new Assistant(new AnthropicBackend(client, 'claude-haiku-5-5', 'Haiku'), { board, measure: fakeMeasure, selection: () => [] }).send('Hi', { text: () => {}, status: () => {}, proposal: () => {} })

    expect(sent[0].fallbacks).toBeUndefined()

  })

})



describe('pictures', () => {

  it('sends images before the text in the same message', async () => {

    const { client, sent } = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'A flowchart.' }] }])

    await new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board, measure: fakeMeasure, selection: () => [7] }).send('What is this?', { text: () => {}, status: () => {}, proposal: () => {} }, undefined, [

      { mediaType: 'image/png', data: 'iVBORw0KGgo=' },

    ])

    const content = (sent[0].messages as { content: Block[] }[])[0].content

    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } })

    expect(content[1]).toMatchObject({ type: 'text' })

  })

})



describe('assistant after something goes wrong', () => {

  const quiet = { text: () => {}, status: () => {}, proposal: () => {} }



  it('hands an op that trips over a wrong type back to Claude, and keeps going', async () => {

    const b = board()

    const { client, sent } = fakeClient([

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_changes', input: { summary: 'x', ops: [{ op: 'createKanban', columns: 'To do' }] } }] },

      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fixed.' }] },

    ])

    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: () => b, measure: fakeMeasure, selection: () => [] })

    await a.send('Make a board', quiet)

    const second = sent[1].messages as { role: string; content: Block[] }[]

    expect(second.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] })

  })



  it('answers tool calls left open when a request fails mid-step', async () => {

    const { client } = fakeClient([{ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'read_board', input: {} }] }])

    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: board, measure: fakeMeasure, selection: () => [] })

    const status = (s: string | null) => {

      if (s === 'Reading the board…') throw new Error('The window closed')

    }

    await expect(a.send('Look', { ...quiet, status })).rejects.toThrow('The window closed')

    // The conversation still ends on a user turn answering every call, so the next request is valid.

    const last = a.messages.at(-1)!

    expect(last.role).toBe('user')

    expect(last.content).toMatchObject([{ type: 'tool_result', tool_use_id: 't1', is_error: true }])

  })

})



describe('the assistant and other boards', () => {

  const wiki = () => {

    let w = applyOps(emptyWiki('Trip wiki'), [{ op: 'createPage', title: 'Packing', text: '# Packing\n- [ ] Tent\n- [ ] Stove' }], { measure: fakeMeasure }).board

    w = applyOps(w, [{ op: 'createPage', title: 'Budget', text: 'Up to 400 each' }], { measure: fakeMeasure }).board

    return w

  }

  const others = (w: Board) => ({ boards: [{ key: 'w1', title: 'Trip wiki', kind: 'wiki' as const, pages: (w.pages ?? []).map((p) => ({ id: p.id, title: p.title })) }], selfKeys: ['b1'], read: async (k: string) => (k === 'w1' ? w : null), me: 'Sam' })



  it('sends what a message links to along with it: a page elsewhere, an object here', async () => {

    const w = wiki()

    const packing = w.pages!.find((p) => p.title === 'Packing')!

    const { client, sent } = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tent and stove.' }] }])

    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: board, measure: fakeMeasure, selection: () => [], others: () => others(w) })

    await a.send(`What's left on [[Packing]](board:w1/page:${packing.id}) for @[Faster checkout](#1)?`, { text: () => {}, status: () => {}, proposal: () => {} })

    const said = JSON.stringify((sent[0].messages as { content: unknown }[])[0].content)

    expect(said).toContain('What the message links to')

    expect(said).toContain('- [ ] Tent')

    expect(said).toContain('Faster checkout')

    // A link to something that's gone says so rather than failing.

    const { client: c2, sent: s2 } = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }])

    const b2 = new Assistant(new AnthropicBackend(c2, 'claude-opus-5-5', 'Opus'), { board: board, measure: fakeMeasure, selection: () => [], others: () => others(w) })

    await b2.send('See [[Old]](board:gone)', { text: () => {}, status: () => {}, proposal: () => {} })

    expect(JSON.stringify(s2[0].messages)).toContain('isn\'t here any more')

  })



  it('lists the other boards and reads one with "board", never changing it', async () => {

    const w = wiki()

    const { client, sent } = fakeClient([

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'list_boards', input: {} }] },

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'read_page', input: { board: 'w1', page: 'Budget' } }] },

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't3', name: 'find', input: { board: 'nope', query: 'x' } }] },

      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Up to 400 each, see [[Budget]](board:w1/page:x).' }] },

    ])

    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: board, measure: fakeMeasure, selection: () => [], others: () => others(w) })

    await a.send('What is the trip budget?', { text: () => {}, status: () => {}, proposal: () => {} })

    const results = (n: number) => JSON.stringify((sent[n].messages as unknown[]).at(-1))

    expect(results(1)).toContain('Trip wiki')

    expect(results(1)).toContain('Packing')

    expect(results(2)).toContain('Up to 400 each')

    expect(results(3)).toContain('No board with the key')

    // The tools say how to name another board.

    const tools = sent[0].tools as { name: string; input_schema: { properties: Record<string, unknown> } }[]

    expect(tools.find((t) => t.name === 'read_page')!.input_schema.properties.board).toBeTruthy()

    expect(tools.some((t) => t.name === 'list_boards')).toBe(true)

  })

})



describe('the assistant and files', () => {

  it('lists the board’s files and reads one in chunks', async () => {

    const b = addFile(board(), { id: 'file0001', name: 'Plan.pdf', type: 'application/pdf', size: 9, at: 1, chars: 50_000, excerpt: 'Day one' })

    const text = `${'a'.repeat(40_000)}THE END`

    const { client, sent } = fakeClient([

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'list_files', input: {} }] },

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'read_file', input: { id: 'file0001' } }] },

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't3', name: 'read_file', input: { id: 'file0001', from: 40_000 } }] },

      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't4', name: 'read_file', input: { id: 'nope' } }] },

      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'It ends.' }] },

    ])

    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: () => b, measure: fakeMeasure, selection: () => [], fileText: async (id) => (id === 'file0001' ? text : null) })

    await a.send('What does the plan say?', { text: () => {}, status: () => {}, proposal: () => {} })

    const result = (n: number) => JSON.stringify((sent[n].messages as unknown[]).at(-1))

    expect(result(1)).toContain('Plan.pdf')

    expect(result(1)).toContain('Day one')

    expect(result(2)).toContain('read on with')

    expect(result(2)).not.toContain('THE END')

    expect(result(3)).toContain('THE END')

    expect(result(4)).toContain('No file with the id')

  })

})




describe('the assistant writing to other boards and wikis', () => {
  it('proposes a new wiki written from the open board, checked before it is shown', async () => {
    const b = board()
    const { client, sent } = fakeClient([
      // A canvas op in a wiki is refused, and the model is told why.
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_elsewhere', input: { summary: 'x', create: { kind: 'wiki', title: 'Ideas' }, ops: [{ op: 'createNote', text: 'no' }] } }] },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't2',
            name: 'propose_elsewhere',
            input: { summary: 'A wiki page from the Ideas board', create: { kind: 'wiki', title: 'Ideas' }, ops: [{ op: 'createPage', title: 'Checkout ideas', text: '# Checkout ideas\n\nFrom [[Ideas]](board:b1).\n\n- Faster checkout\n- Saved carts' }] },
          },
        ],
      },
      // The open board itself goes through propose_changes.
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't3', name: 'propose_elsewhere', input: { summary: 'x', board: 'b1', ops: [{ op: 'createNote', text: 'x' }] } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Proposed.' }] },
    ])
    const proposals: Proposal[] = []
    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), {
      board: () => b,
      measure: fakeMeasure,
      selection: () => [],
      others: () => ({ boards: [], selfKeys: ['b1'], read: async () => null, me: 'Sam', link: 'b1' }),
    })
    await a.send('Make a wiki article from this board', { text: () => {}, status: () => {}, proposal: (p) => proposals.push(p) })
    // Each message says what's open and its key, for links back.
    expect(JSON.stringify((sent[0].messages as { content: unknown }[])[0].content)).toContain('[Open: the canvas board \\"Ideas\\", key b1]')
    expect(JSON.stringify((sent[1].messages as unknown[]).at(-1))).toMatch(/wiki/)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({ summary: 'A wiki page from the Ideas board', target: { create: { kind: 'wiki', title: 'Ideas' }, kind: 'wiki', title: 'Ideas' }, counts: { added: 1 }, status: 'pending' })
    expect(JSON.stringify((sent[3].messages as unknown[]).at(-1))).toContain('use propose_changes')
    // Nothing on the open board changed.
    expect(b.items).toHaveLength(2)
  })

  it('proposes changes to an existing wiki by its key', async () => {
    const w = applyOps(emptyWiki('Trip wiki'), [{ op: 'createPage', title: 'Packing', text: '- Tent' }], { measure: fakeMeasure }).board
    const { client } = fakeClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_elsewhere', input: { summary: 'Add stove', board: 'w1', ops: [{ op: 'updatePage', page: 'Packing', append: '- Stove' }] } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ])
    const proposals: Proposal[] = []
    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), {
      board,
      measure: fakeMeasure,
      selection: () => [],
      others: () => ({ boards: [{ key: 'w1', title: 'Trip wiki', kind: 'wiki' }], selfKeys: ['b1'], read: async (k) => (k === 'w1' ? w : null), me: 'Sam' }),
    })
    await a.send('Add a stove to the packing list', { text: () => {}, status: () => {}, proposal: (p) => proposals.push(p) })
    expect(proposals[0]).toMatchObject({ target: { board: 'w1', kind: 'wiki', title: 'Trip wiki' }, counts: { changed: 1 } })
  })
})

describe('talking to the assistant', () => {
  it('sends the board with what was said, and its changes go on the board at once', async () => {
    const b = board()
    const { client, sent } = fakeClient([
      { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Mind map of the checkout ideas.' }, { type: 'tool_use', id: 't1', name: 'propose_changes', input: { summary: 'A mind map of the ideas', ops: [{ op: 'createMindMap', outline: 'Checkout\n  Faster\n  Saved carts' }] } }] },
      { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Swapped in guest checkout.' }, { type: 'tool_use', id: 't2', name: 'propose_changes', input: { summary: 'Guest checkout', ops: [{ op: 'createNote', text: 'Guest checkout' }] } }] },
    ])
    const applied: Proposal[] = []
    const shown: Proposal[] = []
    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: () => b, measure: fakeMeasure, selection: () => [] })
    await a.send('so the checkout ideas, faster and saved carts', { text: () => {}, status: () => {}, proposal: (p) => shown.push(p), apply: (p) => (applied.push(p), true) }, undefined, [], true)
    const first = JSON.stringify((sent[0].messages as { content: unknown }[])[0].content)
    // It's told it's a live conversation, sees the board, and gets the words.
    expect(first).toContain('[Live:')
    expect(first).toContain('[The board now:]')
    expect(first).toContain('Faster checkout')
    expect(first).toContain('They said: \\"so the checkout ideas, faster and saved carts\\"')
    expect(applied).toHaveLength(1)
    expect(shown[0].status).toBe('applied')
    // Once it's on the board the turn is over: no second request just to say so.
    expect(sent).toHaveLength(1)

    // The next words go with the news that the last change was applied, in one message.
    await a.send('actually replace saved carts with guest checkout', { text: () => {}, status: () => {}, proposal: (p) => shown.push(p), apply: (p) => (applied.push(p), true) }, undefined, [], true)
    expect(sent).toHaveLength(2)
    const msgs = sent[1].messages as { role: string; content: { type: string; content?: string; text?: string }[] }[]
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(msgs[2].content[0].type).toBe('tool_result')
    expect(msgs[2].content[0].content).toMatch(/^Applied to the board/)
    expect(msgs[2].content.at(-1)!.text).toContain('They said: "actually replace saved carts with guest checkout"')
    expect(applied).toHaveLength(2)
  })

  it('carries on as usual when a change could not be applied', async () => {
    const b = board()
    const { client, sent } = fakeClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_changes', input: { summary: 'Notes', ops: [{ op: 'createNote', text: 'Hi' }] } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Shown as a preview.' }] },
    ])
    const a = new Assistant(new AnthropicBackend(client, 'claude-opus-5-5', 'Opus'), { board: () => b, measure: fakeMeasure, selection: () => [] })
    // A read-only board: nothing applied, so it's a preview and the model is told so.
    await a.send('a note saying hi', { text: () => {}, status: () => {}, proposal: () => {}, apply: () => false }, undefined, [], true)
    expect(sent).toHaveLength(2)
  })
})

