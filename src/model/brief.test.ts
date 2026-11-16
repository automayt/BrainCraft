import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { describeBoard } from '../api/queries'
import { applyPatches, diff, keyOf, valuesOf } from '../collab/patch'
import { emptyBoard } from './board'
import { childBoard, planByFrame, unitsOf } from './divide'
import { cleanBoard, cleanBrief, cleanPatches } from './sanitize'
import { fromJson, toJson } from './serialize'
import { boardOfFrame } from './subBoard'
import { fakeMeasure } from './test-helpers'
import { BRIEF_MAX, type Board } from './types'
import { emptyWiki } from './wiki'

const ops = (b: Board, list: Parameters<typeof applyOps>[1]) => applyOps(b, list, { measure: fakeMeasure }).board
const BRIEF = 'The warehouse move. On topic: the schedule and suppliers. Not for the notes: hiring.'
const withBrief = (b: Board, brief = BRIEF): Board => ({ ...b, brief })

describe('a board’s brief', () => {
  it('is kept with the board, through saving and opening', () => {
    const b = withBrief(ops(emptyBoard('Move'), [{ op: 'createNote', text: 'One' }]))
    expect(fromJson(toJson(b)).brief).toBe(BRIEF)
    expect(fromJson(toJson(withBrief(emptyWiki('Handbook')))).brief).toBe(BRIEF)
    expect('brief' in fromJson(toJson(emptyBoard('Plain')))).toBe(false)
  })

  it('is only ever some words, no longer than a brief may be', () => {
    expect(cleanBrief(BRIEF)).toBe(BRIEF)
    expect(cleanBrief('   \n ')).toBeUndefined()
    expect(cleanBrief('')).toBeUndefined()
    for (const bad of [42, null, undefined, {}, ['a'], true]) expect(cleanBrief(bad)).toBeUndefined()
    expect(cleanBrief('x'.repeat(BRIEF_MAX + 500))).toHaveLength(BRIEF_MAX)
    // From a file, or from someone else in a live session.
    const raw = JSON.parse(toJson(emptyBoard('Move')))
    expect('brief' in fromJson(JSON.stringify({ ...raw, brief: { not: 'words' } }))).toBe(false)
    expect(fromJson(JSON.stringify({ ...raw, brief: 'y'.repeat(BRIEF_MAX * 3) })).brief).toHaveLength(BRIEF_MAX)
    expect(cleanBoard({ ...emptyBoard('Move'), brief: 7 as unknown as string }).brief).toBeUndefined()
    expect(cleanBoard(withBrief(emptyBoard('Move'))).brief).toBe(BRIEF)
  })

  it('goes to everyone in a live session, and is undone like any other change', () => {
    const a = emptyBoard('Move')
    const z = withBrief(a)
    const made = diff(a, z)
    expect(made).toEqual([{ k: 'brief', v: BRIEF }])
    expect(keyOf(made[0])).toBe('brief')
    expect(applyPatches(a, made).brief).toBe(BRIEF)
    // Changed, then taken off.
    expect(diff(z, withBrief(a, 'Something else'))).toEqual([{ k: 'brief', v: 'Something else' }])
    const gone = diff(z, a)
    expect(gone).toEqual([{ k: 'brief', v: null }])
    expect('brief' in applyPatches(z, gone)).toBe(false)
    // What a board holds under the patch, as a session reads it when it reconnects.
    expect(valuesOf(z)(made[0])).toBe(BRIEF)
    expect(valuesOf(a)(made[0])).toBeNull()
    // Nothing else on the board changes with it, and it doesn't change with anything else.
    expect(diff(z, { ...z, title: 'Moved' })).toEqual([{ k: 'title', v: 'Moved' }])
    expect(applyPatches(z, [{ k: 'title', v: 'Moved' }]).brief).toBe(BRIEF)
  })

  it('is checked on its way in from someone else', () => {
    expect(cleanPatches([{ k: 'brief', v: BRIEF }])).toEqual([{ k: 'brief', v: BRIEF }])
    expect(cleanPatches([{ k: 'brief', v: null }])).toEqual([{ k: 'brief', v: null }])
    expect(cleanPatches([{ k: 'brief', v: 'z'.repeat(BRIEF_MAX + 1) }])).toEqual([{ k: 'brief', v: 'z'.repeat(BRIEF_MAX) }])
    // What isn't words takes the brief off rather than putting something else there.
    expect(cleanPatches([{ k: 'brief', v: { evil: true } }])).toEqual([{ k: 'brief', v: null }])
  })

  it('goes with a part of the board that becomes a board of its own', () => {
    const b = withBrief(
      ops(emptyBoard('Move'), [
        { op: 'createNote', ref: 'n', text: 'Book the vans', at: { x: 20, y: 60 } },
        { op: 'createFrame', title: 'Transport', around: ['n'] },
        { op: 'createNote', text: 'Elsewhere', at: { x: 2000, y: 0 } },
      ]),
    )
    const frame = b.items.find((i) => i.kind === 'frame')!.id
    expect(boardOfFrame(b, frame)?.brief).toBe(BRIEF)
    const group = planByFrame(unitsOf(b)).groups[0]
    expect(childBoard(b, group).brief).toBe(BRIEF)
    // A board with none makes children with none.
    const { brief: _, ...plain } = b
    expect('brief' in boardOfFrame(plain, frame)!).toBe(false)
    expect('brief' in childBoard(plain, planByFrame(unitsOf(plain)).groups[0])).toBe(false)
  })

  it('is shown to an assistant that reads the board from outside the app', () => {
    const b = withBrief(ops(emptyBoard('Move'), [{ op: 'createNote', text: 'One' }]))
    expect(describeBoard(b)).toMatchObject({ title: 'Move', brief: BRIEF })
    expect(String((describeBoard(b) as { briefNote?: string }).briefNote)).toContain('what this board is for')
    expect(describeBoard(withBrief(emptyWiki('Handbook')))).toMatchObject({ kind: 'wiki', brief: BRIEF })
    expect('brief' in describeBoard(emptyBoard('Plain'))).toBe(false)
  })
})
