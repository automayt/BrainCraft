/**
 * A meeting's review with a real model: a planning meeting that changes its mind. It agrees a
 * date early, finds out later the date can't be met, and moves it; a cheaper venue is put forward
 * and never agreed; one voice is never named except by the others. Notes taken as it went would
 * say "May 12". A review that has made sense of the whole meeting says June 2, and why.
 *
 * Skipped unless something to ask is named. Either a BrainCraft server with a command-line agent
 * (as for brief.eval.test.ts):
 *
 *   BRAINCRAFT_EVAL_SERVER=http://localhost:4193 BRAINCRAFT_EVAL_AGENT=claude npx vitest run src/ai/review.eval.test.ts --silent=false
 *
 * or an OpenAI-compatible model server, asked directly:
 *
 *   BRAINCRAFT_EVAL_OPENAI=http://localhost:8000/v1 BRAINCRAFT_EVAL_MODEL=my-model npx vitest run src/ai/review.eval.test.ts --silent=false
 *
 * (BRAINCRAFT_EVAL_KEY for its key, when it wants one.) It prints the review, to read and to
 * compare one model with another. Slow and uses the model for real, so it isn't part of `npm run check`.
 */

import { describe, expect, it } from 'vitest'
import { correctSpeakers, overviewText, parseReview } from '../model/meetingReview'
import { MEETING_REVIEW } from './assistant'
import { type Backend, CommandBackend, OpenAiBackend } from './backends'
import { askWhole } from './once'

const server = process.env.BRAINCRAFT_EVAL_SERVER
const openai = process.env.BRAINCRAFT_EVAL_OPENAI
const model = process.env.BRAINCRAFT_EVAL_MODEL ?? ''

const backend = (): Backend =>
  openai
    ? new OpenAiBackend({ base: openai, apiKey: process.env.BRAINCRAFT_EVAL_KEY, headers: {}, model, textTools: false, label: 'eval' })
    : new CommandBackend({ base: server!, agent: process.env.BRAINCRAFT_EVAL_AGENT ?? 'custom', label: 'eval' })

/** The meeting: when, who (as the notes knew them), what. */
const SAID: [string, string, string][] = [
  ['0:10', 'Sam', 'Okay, two things to settle today: the launch date and where we hold it. I’d like to leave with both.'],
  ['0:32', 'Sam', 'My proposal is May the twelfth at The Mill. It’s free that week and it holds two hundred.'],
  ['1:05', 'Brian', 'The Mill quoted us eight thousand for the day. Our venue budget is six, so that’s two thousand over.'],
  ['1:40', 'Sam', 'I know. I think the room is worth it, we need the two hundred seats for the press and the beta users.'],
  ['2:15', 'Brian', 'Fine, but I want it written down that we’re over before anyone signs.'],
  ['3:02', 'Voice 4', 'On the product side, the beta is with forty users now. Feedback is good, but there are two crash bugs still open on the import screen.'],
  ['3:40', 'Sam', 'How long to fix those, Priya?'],
  ['3:48', 'Voice 4', 'About two weeks if nothing else lands on us. I wouldn’t launch with them open.'],
  ['4:30', 'Sam', 'Two weeks is fine for May the twelfth. So, are we agreed on May the twelfth at The Mill?'],
  ['4:41', 'Brian', 'Agreed on the date. The venue, I still want to look at something cheaper.'],
  ['4:50', 'Voice 4', 'Agreed.'],
  ['5:20', 'Sam', 'Good. May the twelfth it is.'],
  ['7:10', 'Brian', 'So, cheaper: Riverside Hall is five and a half thousand, which is inside the budget.'],
  ['7:35', 'Brian', 'The catch is it holds a hundred and twenty, not two hundred.'],
  ['8:02', 'Sam', 'That’s the problem. With press, partners and beta users we’re at a hundred and eighty already.'],
  ['8:30', 'Brian', 'We could cap the beta users at forty and stream it for the rest.'],
  ['9:05', 'Sam', 'I don’t love a stream for a launch. Let’s not decide the venue until we know if finance will cover the gap.'],
  ['11:15', 'Jo', 'Sorry I’m late. Before we lock a date, has anyone checked where legal is on the new terms of service?'],
  ['11:40', 'Sam', 'No. Go on.'],
  ['11:52', 'Jo', 'They told me this morning they need three weeks from today. So they finish on May the fifth at the earliest.'],
  ['12:30', 'Jo', 'And we can’t send invitations until the terms are signed off, because the invitation links to them.'],
  ['13:05', 'Brian', 'The printer needs two weeks for the invitations after we give them the final text.'],
  ['13:28', 'Jo', 'So May the fifth plus two weeks is May the nineteenth before invitations even go out.'],
  ['13:50', 'Sam', 'Then May the twelfth is dead. We’d be inviting people after the event.'],
  ['14:20', 'Voice 4', 'That also gives us more room on the crash bugs, honestly.'],
  ['15:10', 'Sam', 'What’s the first date that works if invitations go out on the nineteenth?'],
  ['15:32', 'Jo', 'People need two weeks’ notice. So June the second.'],
  ['15:50', 'Brian', 'I’d need to check The Mill is free on June the second. They were only holding the May week for us.'],
  ['16:20', 'Sam', 'Okay. Decision: the launch moves to June the second. Everyone fine with that?'],
  ['16:31', 'Jo', 'Yes.'],
  ['16:34', 'Brian', 'Yes, if the venue is free.'],
  ['16:40', 'Voice 4', 'Yes.'],
  ['18:05', 'Sam', 'Venue, then. I’ll ask finance for the extra two thousand for The Mill. If they say no, we take Riverside and cap the room.'],
  ['18:40', 'Brian', 'I’d rather decide now and take Riverside. We keep saying we’ll stay inside the budget.'],
  ['19:10', 'Sam', 'I hear you, but I’m not deciding that without the finance answer. We’ll settle it next week.'],
  ['19:35', 'Brian', 'Okay. Next week.'],
  ['21:00', 'Sam', 'Actions. Brian, can you check The Mill for June the second and get back to us by Friday?'],
  ['21:12', 'Brian', 'Yes, by Friday.'],
  ['21:30', 'Sam', 'Jo, you’ll chase legal so the terms really are signed off by May the fifth.'],
  ['21:41', 'Jo', 'I’ll chase them weekly.'],
  ['22:05', 'Sam', 'Priya, the two crash bugs fixed before May the twentieth, so we have time to test.'],
  ['22:15', 'Voice 4', 'That works.'],
  ['22:40', 'Sam', 'And I’ll ask finance about the two thousand by Thursday.'],
  ['23:30', 'Jo', 'One more thing. Who is writing the press kit? Nobody has picked that up.'],
  ['23:48', 'Sam', 'Good question. I don’t know yet. Let’s put it on next week’s agenda.'],
  ['24:20', 'Sam', 'Thanks, everyone.'],
]

const TRANSCRIPT = `[The meeting “Launch planning”, on 2026-04-14, 25 min. Those named in it: Sam, Brian, Jo.]\n\n${SAID.map(([at, who, text]) => `[${at}] ${who}: ${text}`).join('\n')}`

describe.skipIf(!server && !openai)('a meeting’s review with a real model', () => {
  it('makes sense of the whole meeting: what changed, what’s open, who does what', async () => {
    const began = Date.now()
    const reply = await askWhole(backend(), MEETING_REVIEW, TRANSCRIPT)
    const r = parseReview(reply.text)
    console.log(`THE REVIEW (${Math.round((Date.now() - began) / 1000)} s${reply.cut ? ', cut off' : ''})\n${reply.text}\n\nTHE OVERVIEW\n${overviewText({ title: r.title ?? 'Launch planning', length: '25 min', people: ['Sam', 'Brian', 'Jo', 'Priya'], outcomes: r.outcomes, summary: r.summary })}`)
    expect(reply.cut).toBe(false)
    const of = (k: string) => r.outcomes.filter((o) => o.kind === k)
    const MAY12 = /may (the )?(12|twelfth)|12(th)? (of )?may/i
    const JUNE2 = /june (the )?(2|second)\b|2(nd)? (of )?june|06-02/i

    // The summary: there is one, it's prose, and it has the meeting's turn in it (the date moved, and to when).
    expect(r.summary).toBeTruthy()
    expect(r.summary!.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(2)
    expect(r.summary!.length).toBeLessThan(1200)
    expect(r.summary!).toMatch(JUNE2)
    expect(r.summary!).toMatch(/legal|terms|invitation/i)
    // ...and what's still open: the venue.
    expect(r.summary!).toMatch(/venue|mill|riverside|finance|budget/i)

    // What was agreed in the end, not what was agreed first.
    expect(of('decision').some((o) => JUNE2.test(o.text))).toBe(true)
    for (const o of of('decision').filter((x) => MAY12.test(x.text))) expect(o.text).toMatch(JUNE2)
    // The cheaper venue was put forward, never agreed.
    expect(of('decision').some((o) => /riverside/i.test(o.text) && !/if|unless|otherwise|fallback/i.test(o.text))).toBe(false)

    // Who does what, by when.
    const actions = of('action')
    expect(actions.length).toBeGreaterThanOrEqual(4)
    expect(actions.find((a) => /mill|venue/i.test(a.text))?.who).toBe('Brian')
    expect(actions.find((a) => /legal|terms/i.test(a.text))?.who).toBe('Jo')
    expect(actions.find((a) => /crash|bug/i.test(a.text))?.who).toBe('Priya')
    expect(actions.find((a) => /finance/i.test(a.text))?.who).toBe('Sam')
    // What nobody picked up.
    expect(of('question').some((o) => /press kit/i.test(o.text))).toBe(true)

    // The voice the others called Priya.
    const fixed = correctSpeakers(SAID.map(([, who]) => ({ at: 0, who })), r)
    expect(fixed.renames).toContainEqual({ from: 'Voice 4', to: 'Priya' })

    // Ideas from the start of the meeting and from its end.
    expect(r.ideas.length).toBeGreaterThanOrEqual(12)
    expect(r.ideas.some((i) => i.at < 5 * 60_000)).toBe(true)
    expect(r.ideas.some((i) => i.at > 18 * 60_000)).toBe(true)
  }, 900_000)
})
