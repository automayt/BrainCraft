import { describe, expect, it } from 'vitest'
import type { Proposal } from './assistant'
import { fromSaved, ownerOf, toSaved } from './threadStore'
import type { Message } from './thread'

const proposal = (status: Proposal['status']): Proposal => ({ id: `p-${status}`, summary: 'Mind map', ops: [{ op: 'createNote', text: 'x' }], patches: [{ k: 'item', id: 1, v: null }] as unknown as Proposal['patches'], counts: { added: 1, changed: 0, removed: 0 }, status })

describe('keeping the conversation between visits', () => {
  it('leaves out pictures and what proposals would change, and a waiting one comes back discarded', () => {
    const messages: Message[] = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'turn this sketch into a board' }] }]
    const turns = [{ role: 'assistant' as const, text: 'Here.', proposals: [proposal('pending'), proposal('applied')], where: { key: 'b1', title: 'Launch', kind: 'board' as const } }]
    const saved = toSaved(messages, turns)!
    expect(JSON.stringify(saved.messages)).not.toContain('AAAA')
    expect(JSON.stringify(saved.messages)).toContain('[A picture was sent here.]')
    expect(saved.turns[0].proposals.map((p) => p.status)).toEqual(['discarded', 'applied'])
    expect(saved.turns[0].proposals[0].patches).toEqual([])
    expect(saved.turns[0].where).toEqual({ key: 'b1', title: 'Launch', kind: 'board' })
    // What's kept in memory is untouched.
    expect(turns[0].proposals[0].status).toBe('pending')
    expect(fromSaved(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })

  it('takes back only a real conversation', () => {
    expect(fromSaved(null)).toBeNull()
    expect(fromSaved({ v: 2, messages: [], turns: [] })).toBeNull()
    expect(fromSaved({ v: 1, messages: [], turns: [{ nope: 1 }, { role: 'user', text: 'hi', proposals: [] }] })!.turns).toHaveLength(1)
  })

  it('keeps it with the account when signed in, otherwise in this browser', () => {
    expect(ownerOf({ server: 'https://b.example', account: 'u1' })).toBe('account:https://b.example:u1')
    expect(ownerOf({ server: 'https://b.example', account: null })).toBe('browser')
    expect(ownerOf({ server: null, account: 'u1' })).toBe('browser')
  })
})
