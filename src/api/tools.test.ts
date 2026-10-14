import { describe, expect, it } from 'vitest'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import type { Board } from '../model/types'
import { pairingFromHash, parsePairing } from './bridge'
import { applyOps } from './ops'
import { type ToolHost, TOOL_DEFS, pickBoard, runTool } from './tools'

function host(): ToolHost & { b: Board } {
  const h = {
    b: emptyBoard('Test'),
    where: () => 'a test board',
    board: () => h.b,
    apply: (ops: Parameters<ToolHost['apply']>[0]) => {
      const out = applyOps(h.b, ops, { measure: fakeMeasure })
      h.b = out.board
      return out.results
    },
    listBoards: async () => [{ id: '1', title: 'Test' }],
    openBoard: async () => ({ id: '1', title: 'Test' }),
    createBoard: async (title: string) => ({ id: '2', title }),
  }
  return h
}

describe('AI tools', () => {
  it('has a schema for every tool', () => {
    for (const t of TOOL_DEFS) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.description.length).toBeGreaterThan(20)
    }
  })

  it('builds, reads and searches a board', async () => {
    const h = host()
    await runTool(h, 'apply_ops', {
      ops: [
        { op: 'createMindMap', ref: 'm', outline: 'Plan\n  Budget\n  Hiring' },
        { op: 'createNote', ref: 'n', text: 'Budget review Friday' },
        { op: 'connect', from: 'm', to: 'n' },
      ],
    })
    const desc = (await runTool(h, 'read_board')) as { counts: Record<string, number>; links: unknown[] }
    expect(desc.counts).toEqual({ mind: 3, sticky: 1 })
    expect(desc.links).toHaveLength(1)
    const found = (await runTool(h, 'find', { query: 'budget' })) as unknown[]
    expect(found).toHaveLength(2)
    const root = (await runTool(h, 'get_object', { id: 1 })) as { data: { outline: string } }
    expect(root.data.outline).toContain('Hiring')
  })

  it('accepts operations sent as a JSON string', async () => {
    const h = host()
    await runTool(h, 'apply_ops', { ops: JSON.stringify({ ops: [{ op: 'createNote', text: 'Hi' }] }) })
    expect(h.b.items).toHaveLength(1)
  })

  it('reports bad input clearly', async () => {
    const h = host()
    await expect(runTool(h, 'apply_ops', { ops: 'nonsense' })).rejects.toThrow(/list of operations/)
    await expect(runTool(h, 'get_object', { id: 42 })).rejects.toThrow(/No object with id 42/)
    await expect(runTool(h, 'nope')).rejects.toThrow(/Unknown tool/)
  })

  it('picks boards by id, title or part of a title', () => {
    const boards = [
      { id: 'a', title: 'Q4 plan' },
      { id: 'b', title: 'Retro' },
    ]
    expect(pickBoard(boards, 'b').title).toBe('Retro')
    expect(pickBoard(boards, 'q4 PLAN').id).toBe('a')
    expect(pickBoard(boards, 'plan').id).toBe('a')
    expect(() => pickBoard(boards, 'zzz')).toThrow(/"Q4 plan", "Retro"/)
  })

  it('reads pairing links and tokens', () => {
    expect(pairingFromHash('#ai=4319.abcdefghijklmnopqr')).toEqual({ port: 4319, token: 'abcdefghijklmnopqr' })
    expect(parsePairing('https://x.io/app/#ai=4400.abcdefghijklmnopqr')).toEqual({ port: 4400, token: 'abcdefghijklmnopqr' })
    expect(parsePairing('abcdefghijklmnopqr')).toEqual({ port: 4319, token: 'abcdefghijklmnopqr' })
    expect(parsePairing('short')).toBeNull()
  })
})
