/**
 * Managing time on a timeline, with a real model: asked in plain words to plan a team's hours, it
 * should make a timeline that carries them (a lane each, what they have a week, hours on the spans,
 * the budget); and shown one where someone has too much on, it should say who and when, and put it
 * right by changing the timeline. Skipped unless a BrainCraft server with a command-line agent is
 * named, as for spoken.eval.test.ts:
 *
 *   BRAINCRAFT_EVAL_SERVER=http://localhost:4193 BRAINCRAFT_EVAL_AGENT=custom npx vitest run src/ai/timelineHours.eval.test.ts --silent=false
 *
 * Slow and uses the model for real, so it isn't part of `npm run check`.
 */

import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from '../api/ops'
import { applyPatches } from '../collab/patch'
import { emptyBoard } from '../model/board'
import { layoutAll } from '../model/mindmap'
import { fakeMeasure } from '../model/test-helpers'
import { toDay } from '../model/timeline'
import { hoursText, overloaded, timelineHours } from '../model/timelineHours'
import type { Board, TimelineData } from '../model/types'
import { Assistant, type Proposal } from './assistant'
import { CommandBackend } from './backends'

const server = process.env.BRAINCRAFT_EVAL_SERVER
const agent = process.env.BRAINCRAFT_EVAL_AGENT ?? 'custom'

/** Asks the assistant something on a board, applying what it proposes: the board after, and its words. */
async function ask(board: Board, text: string): Promise<{ board: Board; said: string }> {
  let now = board
  let said = ''
  const a = new Assistant(new CommandBackend({ base: server!, agent, label: 'eval' }), { board: () => now, measure: fakeMeasure, selection: () => [] })
  await a.send(
    text,
    {
      text: (d) => (said += d),
      status: () => {},
      proposal: () => {},
      apply: (p: Proposal) => {
        let next = applyPatches(now, p.patches)
        for (const x of p.patches) if ((x.k === 'item' || x.k === 'conn') && x.v && x.id >= next.nextId) next = { ...next, nextId: x.id + 1 }
        now = layoutAll(next, fakeMeasure)
        return true
      },
    },
    undefined,
    [],
    true,
  )
  return { board: now, said: said.trim() }
}

const timelines = (b: Board): TimelineData[] => b.items.flatMap((i) => (i.kind === 'timeline' && i.timeline ? [i.timeline] : []))
const show = (t: TimelineData) => t.lanes.map((l) => `${l.name}${l.capacity !== undefined ? ` (${l.capacity} h/wk)` : ''}: ${t.entries.filter((e) => e.lane === l.id).map((e) => `${e.title} ${e.start}..${e.end ?? ''} ${e.hours ?? '-'}h${e.per ? `/${e.per}` : ''}${e.spent !== undefined ? ` spent ${e.spent}` : ''}`).join('; ')}`).join('\n  ')

describe.skipIf(!server)('managing time on a timeline, with a real model', () => {
  it('plans a team’s hours as a timeline that carries them', async () => {
    const { board, said } = await ask(
      emptyBoard('Launch'),
      'Plan our time for the launch. Sam and Priya each have 40 hours a week. Sam does research the week of the 16th of November 2026, about 30 hours. Priya builds it from the 18th to the 27th of November, 70 hours. Then both do launch prep the first week of December, 20 hours each. We have a budget of 150 hours in all.',
    )
    const [t] = timelines(board)
    console.log(`PLANNING\nsaid: ${said}\ntimeline:\n  ${t ? show(t) : '(none made)'}\nbudget: ${JSON.stringify(t?.budget)}\nin words: ${t ? hoursText(t, toDay('2026-11-16')) : ''}`)
    expect(t, 'a timeline was made').toBeTruthy()
    const lane = (name: string) => t.lanes.find((l) => l.name.toLowerCase().includes(name))
    // A lane each, with the hours a week they have.
    expect(lane('sam')?.capacity).toBe(40)
    expect(lane('priya')?.capacity).toBe(40)
    // The hours are on the spans, and add up to what was said.
    const h = timelineHours(t)
    const of = (name: string) => h.lanes.find((l) => l.lane === lane(name)!.id)!.planned
    expect(of('sam')).toBe(50)
    expect(of('priya')).toBe(90)
    expect(t.budget).toEqual({ hours: 150 })
    // Priya's build covers the dates said.
    const build = t.entries.find((e) => e.lane === lane('priya')!.id && e.hours === 70)
    expect(build).toMatchObject({ start: '2026-11-18', end: '2026-11-27' })
  }, 240_000)

  it('says who has too much on and when, and puts it right on the timeline', async () => {
    const start = applyOps(
      emptyBoard('Launch'),
      [
        {
          op: 'createTimeline',
          title: 'Launch team',
          lanes: [
            { name: 'Sam', capacity: 40, entries: [{ title: 'Research', start: '2026-11-16', end: '2026-11-20', hours: 20 }] },
            {
              name: 'Priya',
              capacity: 40,
              entries: [
                { title: 'Build', start: '2026-11-23', end: '2026-11-27', hours: 40 },
                { title: 'Docs', start: '2026-11-23', end: '2026-11-27', hours: 30 },
              ],
            },
          ],
        } as Op,
      ],
      { measure: fakeMeasure },
    ).board
    const before = timelines(start)[0]
    expect(overloaded(before, before.lanes[1])).toHaveLength(1)
    const { board, said } = await ask(start, 'Is anyone overloaded on the launch team? If so, sort it out by handing work to whoever has room that week.')
    const [t] = timelines(board)
    console.log(`REBALANCING\nsaid: ${said}\nbefore:\n  ${show(before)}\nafter:\n  ${show(t)}\nin words: ${hoursText(t, toDay('2026-11-16'))}`)
    // It knew who and when from what the board says.
    expect(said).toMatch(/Priya/)
    // Afterwards nobody has more than they have hours for, and no work was lost.
    for (const l of t.lanes) expect(overloaded(t, l), `${l.name} still has too much`).toEqual([])
    expect(timelineHours(t).planned).toBe(90)
    expect(t.lanes.map((l) => l.name).sort()).toEqual(['Priya', 'Sam'])
  }, 240_000)
})
