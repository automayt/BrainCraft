import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { applyOps } from '../api/ops'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { Assistant, type Proposal } from './assistant'

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
    const a = new Assistant(client, { board: () => b, measure: fakeMeasure, selection: () => [1] })
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
    await new Assistant(client, { board: () => b, measure: fakeMeasure, selection: () => [] }).send('Connect', {
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
    await new Assistant(client, { board: () => b, measure: fakeMeasure, selection: () => [] }).send('Add', { text: () => {}, status: () => {}, proposal: (p) => proposals.push(p) })
    expect(proposals).toHaveLength(0)
    expect(((sent[1].messages as { content: Block[] }[]).at(-1)!.content[0] as Block).is_error).toBe(true)
  })

  it('skips the fallback parameter on Haiku', async () => {
    const { client, sent } = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] }])
    await new Assistant(client, { board, measure: fakeMeasure, selection: () => [] }, 'claude-haiku-5-5').send('Hi', { text: () => {}, status: () => {}, proposal: () => {} })
    expect(sent[0].fallbacks).toBeUndefined()
  })
})
