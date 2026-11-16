/**
 * A board's brief with a real model: a short meeting in which people also talk about two things
 * that aren't the meeting's business, noted once on a board whose brief says so and once on a board
 * with no brief. The brief should keep them out of the notes, and without one they should be in
 * (or the brief isn't what kept them out). Skipped unless a BrainCraft server with a command-line
 * agent is named, as for spoken.eval.test.ts:
 *
 *   BRAINCRAFT_EVAL_SERVER=http://localhost:4193 BRAINCRAFT_EVAL_AGENT=custom npx vitest run src/ai/brief.eval.test.ts --silent=false
 *
 * Slow and uses the model for real, so it isn't part of `npm run check`.
 */

import { describe, expect, it } from 'vitest'
import { applyPatches } from '../collab/patch'
import { emptyBoard } from '../model/board'
import { layoutAll } from '../model/mindmap'
import { fakeMeasure } from '../model/test-helpers'
import type { Board } from '../model/types'
import { Assistant, type Proposal } from './assistant'
import { CommandBackend } from './backends'

const server = process.env.BRAINCRAFT_EVAL_SERVER
const agent = process.env.BRAINCRAFT_EVAL_AGENT ?? 'custom'

const BRIEF = `Planning the spring product launch, weekly.
On topic: the launch date, the venue and the budget.
Not for the notes: hiring, and the office move.
"The Mill" is the venue we're looking at.`

/** The meeting, in the stretches the notes hear it in. Each has launch talk and talk about something else. */
const SAID = [
  ['[Sam] Let’s move the launch to May the twelfth, The Mill is free that week.', '[Brian] The Mill quoted us eight thousand, so we’re two thousand over budget.', '[Sam] Separately, we still need to hire two engineers for the platform team. The job posting opens on Monday.'],
  ['[Brian] And the office move is slipping to July, because the movers cancelled on us.', '[Sam] Okay, back to the launch. Brian, can you confirm The Mill by Friday?', '[Brian] Yes, I’ll confirm the venue by Friday.'],
]

/** Takes the meeting's notes as MeetingNotes does; everything written on the board, and what the notes said. */
async function meet(brief?: string) {
  let board: Board = { ...emptyBoard('Launch'), ...(brief ? { brief } : {}) }
  const said: string[] = []
  const a = new Assistant(new CommandBackend({ base: server!, agent, label: 'eval' }), { board: () => board, measure: fakeMeasure, selection: () => [] })
  for (const stretch of SAID) {
    let reply = ''
    await a.send(
      stretch.join('\n'),
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
      'meeting',
    )
    said.push(reply.trim())
  }
  const written = board.items.flatMap((i) => [i.text, ...(i.table?.rows ?? []).map((r) => Object.values(r.cells).join(' | '))]).filter((t) => t.trim())
  return { written, said }
}

const about = (written: string[], re: RegExp) => written.filter((t) => re.test(t))
const HIRING = /\bhir(e|ing)\b|engineers?|platform team|job posting/i
const MOVE = /office move|movers/i
const LAUNCH = /may|mill|venue|budget|eight thousand|8[,.]?000/i

describe.skipIf(!server)('a board’s brief with a real model', () => {
  it('keeps a meeting’s notes to what the brief says it’s about', async () => {
    const { written, said } = await meet(BRIEF)
    console.log(`WITH THE BRIEF\nsaid: ${said.join(' / ')}\nwritten:\n- ${written.join('\n- ')}`)
    // The launch is noted...
    expect(about(written, LAUNCH).length).toBeGreaterThan(1)
    expect(about(written, /friday/i).length).toBeGreaterThan(0)
    // ...and what the brief says isn't for the notes is nowhere on the board.
    expect(about(written, HIRING)).toEqual([])
    expect(about(written, MOVE)).toEqual([])
  }, 900_000)

  it('notes the same talk when the board has no brief', async () => {
    const { written, said } = await meet()
    console.log(`WITHOUT A BRIEF\nsaid: ${said.join(' / ')}\nwritten:\n- ${written.join('\n- ')}`)
    expect(about(written, LAUNCH).length).toBeGreaterThan(1)
    // Thorough notes take down everything said: so it's the brief that leaves these out above.
    expect(about(written, HIRING).length + about(written, MOVE).length).toBeGreaterThan(0)
  }, 900_000)
})
