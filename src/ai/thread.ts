/**
 * Keeping one long conversation with the assistant light, without interrupting it.
 *
 * The boards and wikis are the memory: what's on them can always be read again. So old copies of
 * what was read (board snapshots sent with spoken turns, pages, files, linked content, pictures) are
 * dropped first, in batches so most requests keep the same beginning (which model servers reuse
 * rather than read again). Only when that isn't enough is the oldest part summarised, in the
 * background, keeping the latest exchanges word for word. Pure functions over the messages.
 */

import type Anthropic from '@anthropic-ai/sdk'

export type Message = Anthropic.Beta.BetaMessageParam
type Block = Exclude<Message['content'], string>[number]

/** About how big the conversation is, in characters (a token is about four). */
export const sizeOf = (messages: readonly Message[]) => JSON.stringify(messages).length

/** The indices of the person's messages: user messages with words in them (not only tool results). */
export function personIndices(messages: readonly Message[]): number[] {
  const out: number[] = []
  messages.forEach((m, i) => {
    if (m.role !== 'user') return
    if (typeof m.content === 'string' || m.content.some((b) => b.type === 'text')) out.push(i)
  })
  return out
}

const BOARD_START = '\n\n[The board now:]\n'
const SAID = '\n\nThey said: '
const LINKED = '\n\n[What the message links to, read for you:]'
/** The long instructions sent with each spoken turn; older copies shrink to a mark. */
const LIVE = /\[Live: the person is talking to you[^\]]*\]/

/** Old words: the board snapshot, what was linked and the live instructions left out. */
function lighterText(t: string): string {
  let out = t
  const b = out.indexOf(BOARD_START)
  const s = b >= 0 ? out.indexOf(SAID, b) : -1
  if (b >= 0 && s > b) out = `${out.slice(0, b)}\n\n[The board then: left out, it has changed since]${out.slice(s)}`
  const l = out.indexOf(LINKED)
  if (l >= 0) out = `${out.slice(0, l)}\n\n[What it linked to was read here; left out]`
  return out.replace(LIVE, '[Live: spoken]')
}

/** A result longer than this, from before the latest exchanges, is left out (it can be read again). */
const BIG_RESULT = 600

function lighterBlock(b: Block): Block {
  if (b.type === 'text') return { ...b, text: lighterText(b.text) }
  if (b.type === 'image') return { type: 'text', text: '[A picture was sent here.]' }
  if (b.type === 'tool_result') {
    const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')
    if (text.length <= BIG_RESULT) return b
    return { ...b, content: `[${text.length.toLocaleString('en')} characters read here earlier; left out to save room. Read it again if you need it.]` }
  }
  if (b.type === 'tool_use' && (b.name === 'propose_changes' || b.name === 'propose_elsewhere')) {
    const input = (b.input ?? {}) as { summary?: unknown; ops?: unknown[] }
    const n = Array.isArray(input.ops) ? input.ops.length : 0
    if (JSON.stringify(input).length <= BIG_RESULT) return b
    return { ...b, input: { summary: input.summary, ops: [], left_out: `${n} operations, left out to save room` } }
  }
  return b
}

/**
 * Leaves out what was read before the last `keep` exchanges: board snapshots, pages, files, linked
 * content, pictures, and the operations of changes already made. What was said stays.
 */
export function dropStale(messages: readonly Message[], keep: number): Message[] {
  const people = personIndices(messages)
  if (people.length <= keep) return [...messages]
  const cut = people[people.length - keep]
  return messages.map((m, i) => (i >= cut || typeof m.content === 'string' ? m : { ...m, content: m.content.map(lighterBlock) } as Message))
}

export interface Budget {
  /** Past this size (characters), stale reads are dropped. */
  drop: number
  /** Past this, after dropping, the oldest part is summarised. */
  summarise: number
  /** Exchanges kept whole when dropping. */
  keepWhole: number
  /** Exchanges kept word for word when summarising. */
  keepWords: number
}

export const BUDGET: Budget = { drop: 90_000, summarise: 160_000, keepWhole: 3, keepWords: 12 }

/** The conversation as plain text, for summarising (results shortened). */
export function transcript(messages: readonly Message[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const who = m.role === 'user' ? 'Person' : 'Assistant'
    if (typeof m.content === 'string') {
      lines.push(`${who}: ${m.content}`)
      continue
    }
    for (const b of m.content) {
      if (b.type === 'text') lines.push(`${who}: ${lighterText(b.text)}`)
      else if (b.type === 'tool_use') {
        const input = (b.input ?? {}) as { summary?: string }
        lines.push(`(Assistant used ${b.name}${input.summary ? `: ${input.summary}` : ''})`)
      } else if (b.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')
        lines.push(`(Result: ${text.slice(0, 300)}${text.length > 300 ? '…' : ''})`)
      }
    }
  }
  return lines.join('\n')
}

export const SUMMARY_SYSTEM = `You keep the memory of a conversation between a person and the assistant in BrainCraft (boards and wikis). Summarise the earlier part of their conversation you're given, for the assistant to carry on from: what the person is working on and why, decisions and preferences they stated, what was made or changed on which board or wiki, and anything still open. Be specific (names, numbers, titles) and brief: a few short paragraphs or bullets. Leave out what's on the boards themselves; that can be read again.`

/**
 * Replaces everything before `firstKept` (a message still in `messages`) with `summary`, put at
 * the start of that message; results for tool calls no longer there are dropped. Unchanged when
 * `firstKept` is gone.
 */
export function withSummary(messages: readonly Message[], firstKept: Message, summary: string): Message[] {
  const at = messages.indexOf(firstKept)
  if (at < 0) return [...messages]
  const head = firstKept.content
  const rest = typeof head === 'string' ? [{ type: 'text' as const, text: head }] : head.filter((b) => b.type !== 'tool_result')
  return [{ role: 'user', content: [{ type: 'text', text: `[Earlier in this conversation, summarised:]\n${summary.trim()}` }, ...rest] }, ...messages.slice(at + 1)]
}

/** Where to cut for a summary: the person message starting the last `keep` exchanges, if there are more. */
export function summaryCut(messages: readonly Message[], keep: number): number | null {
  const people = personIndices(messages)
  return people.length > keep ? people[people.length - keep] : null
}
