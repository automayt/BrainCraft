/**
 * Spoken turns with a real model: what someone says in Flowstate, turn by turn, and whether the
 * board that results is built the way BrainCraft builds things (a real mind map, a real flowchart,
 * nothing piled up). Skipped unless a BrainCraft server with a command-line agent is named:
 *
 *   BRAINCRAFT_EVAL_SERVER=http://localhost:4193 BRAINCRAFT_EVAL_AGENT=custom npx vitest run src/ai/spoken.eval.test.ts
 *
 * (Start that server with BRAINCRAFT_AI_COMMAND set to the model to try, e.g. `claude -p --tools ""
 * --no-session-persistence --model haiku`.) Slow and uses the model for real, so it isn't part of
 * `npm run check`.
 */

import { describe, expect, it } from 'vitest'
import { applyPatches } from '../collab/patch'
import { emptyBoard } from '../model/board'
import { layoutAll } from '../model/mindmap'
import { fakeMeasure } from '../model/test-helpers'
import type { Board, Item } from '../model/types'
import { Assistant, type Proposal } from './assistant'
import { CommandBackend } from './backends'

const server = process.env.BRAINCRAFT_EVAL_SERVER
const agent = process.env.BRAINCRAFT_EVAL_AGENT ?? 'custom'

/** Talks to the assistant like Flowstate does, applying each change at once; the board and what it said. */
async function talk(lines: string[]) {
  let board: Board = emptyBoard()
  const said: string[] = []
  const a = new Assistant(new CommandBackend({ base: server!, agent, label: 'eval' }), { board: () => board, measure: fakeMeasure, selection: () => [] })
  for (const line of lines) {
    let reply = ''
    await a.send(
      line,
      {
        text: (d) => (reply += d),
        status: () => {},
        proposal: () => {},
        apply: (p: Proposal) => {
          let next = applyPatches(board, p.patches)
          for (const x of p.patches) if ((x.k === 'item' || x.k === 'conn') && x.v && x.id >= next.nextId) next = { ...next, nextId: x.id + 1 }
          board = layoutAll(next, fakeMeasure)
          return true
        },
      },
      undefined,
      [],
      true,
    )
    said.push(`${line} → ${reply.trim()}`)
  }
  // How often a proposal went back to be tidied (see ai/check.ts).
  const tidied = JSON.stringify(a.messages).split('Not applied yet').length - 1
  said.push(`(sent back to tidy: ${tidied})`)
  return { board, said }
}

const byText = (b: Board, t: string) => b.items.find((i) => i.text.trim().toLowerCase() === t.toLowerCase())
const named = (b: Board, re: RegExp) => b.items.find((i) => re.test(i.text))
const overlaps = (b: Board) => {
  const items = b.items.filter((i) => i.kind !== 'frame' && i.kind !== 'pen')
  const out: string[] = []
  const hit = (p: Item, q: Item) => Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 4 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 4
  for (let a = 0; a < items.length; a++) for (let z = a + 1; z < items.length; z++) if (hit(items[a], items[z])) out.push(`${items[a].text} / ${items[z].text}`)
  return out
}

describe.skipIf(!server)('spoken turns with a real model', () => {
  it('builds the infrastructure mind map as a real mind map', async () => {
    const { board, said } = await talk([
      "Let's make a mind map called infrastructure.",
      'Add Jason and Brian off of that.',
      'Under Jason, add workstations and desktops.',
      'Under workstations: hardware upgrades and repairs, OS updates and patching, and software installs and licensing.',
      'Brian handles servers. Under servers add patching, backups, and monitoring.',
      'Actually, rename monitoring to monitoring and alerts.',
    ])
    console.log(said.join('\n'))
    const root = named(board, /^infrastructure$/i)!
    const jason = byText(board, 'Jason')!
    const brian = byText(board, 'Brian')!
    const servers = named(board, /^servers$/i)!
    expect(root).toMatchObject({ kind: 'mind' })
    expect(root.parent).toBeUndefined()
    expect(jason).toMatchObject({ kind: 'mind', parent: root.id })
    expect(brian).toMatchObject({ kind: 'mind', parent: root.id })
    expect(named(board, /^workstations$/i)).toMatchObject({ parent: jason.id })
    expect(servers).toMatchObject({ parent: brian.id })
    expect(named(board, /monitoring and alerts|monitoring & alerts/i)).toMatchObject({ parent: servers.id })
    // Nothing faked or crammed: every object an idea, no lines, one idea each, nothing piled up.
    expect(board.items.filter((i) => i.kind !== 'mind').map((i) => `${i.kind} ${i.text}`)).toEqual([])
    expect(board.connectors).toHaveLength(0)
    expect(board.items.filter((i) => i.text.includes('\n')).map((i) => i.text)).toEqual([])
    expect(overlaps(board)).toEqual([])
  }, 900_000)

  it('builds a flowchart with a labelled decision', async () => {
    const { board, said } = await talk([
      'Make a flowchart for laptop requests: a request comes in, then the manager approves it.',
      'If they approve, order the laptop; if not, tell them why.',
      'After ordering, set it up, then hand it over.',
    ])
    console.log(said.join('\n'))
    expect(board.items.every((i) => i.kind === 'flow')).toBe(true)
    const decision = board.items.find((i) => i.shape === 'decision')!
    expect(decision).toBeDefined()
    const labels = board.connectors.filter((c) => c.from === decision.id).map((c) => (c.label ?? '').toLowerCase())
    expect(labels.some((l) => /yes|approve/.test(l))).toBe(true)
    expect(labels.some((l) => /no|reject|declin/.test(l))).toBe(true)
    expect(named(board, /hand/i)).toBeDefined()
    expect(overlaps(board)).toEqual([])
  }, 900_000)

  it('keeps a Kanban board up to date', async () => {
    const { board, said } = await talk([
      'Make a kanban for the office move with to do, doing and done.',
      'Add book the movers and order boxes to to do.',
      "Move book the movers to doing, it's under way.",
    ])
    console.log(said.join('\n'))
    const kanbans = board.items.filter((i) => i.kind === 'kanban')
    expect(kanbans).toHaveLength(1)
    const cols = kanbans[0].kanban!.columns
    const where = (re: RegExp) => cols.find((c) => c.cards.some((k) => re.test(k.title)))?.title.toLowerCase()
    expect(where(/movers/i)).toMatch(/doing/)
    expect(where(/boxes/i)).toMatch(/to do/)
  }, 900_000)
})
