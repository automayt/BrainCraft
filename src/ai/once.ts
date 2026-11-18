/** One question to the assistant, answered in words: no tools, no conversation kept. */

import { makeBackend } from './assistant'
import type { Backend, Message } from './backends'
import { connectionFor, reviewSettings, serverAi } from './settings'
import { settingsHere } from './settingsStore'

/** How often an answer that ran out of room is carried on before what there is has to do. */
const CARRY_ON = 4

const words = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] })

/**
 * A question answered whole. A model stops when its answer reaches its limit, and a long answer
 * (a long meeting's review) would be cut off there with nothing to say so: the end of the meeting
 * would be missing. So an answer that ran out of room is carried on from its last whole line,
 * until it's finished. `cut` says whether it still wasn't after that.
 */
export async function askWhole(backend: Backend, system: string, question: string, signal?: AbortSignal): Promise<{ text: string; cut: boolean }> {
  const messages: Message[] = [words(question)]
  const parts: string[] = []
  for (let go = 0; ; go++) {
    const reply = await backend.turn({ system, messages, tools: [] }, () => {}, signal)
    const text = reply.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('\n')
      .trim()
    if (reply.stop !== 'max_tokens') return { text: [...parts, text].join('\n').trim(), cut: false }
    // All its room went before it wrote a word (a model that thinks first): asking again would go the same way.
    if (!text && !parts.length) throw new Error('the model ran out of room before it wrote anything: one that thinks before it answers needs a larger answer limit, or its thinking turned off')
    if (go >= CARRY_ON || !text) return { text: [...parts, text].join('\n').trim(), cut: true }
    // The last line may be half written: it's written again, whole.
    const lines = text.split('\n')
    const kept = lines.length > 1 ? lines.slice(0, -1).join('\n').trimEnd() : text
    const last = kept.split('\n').pop() ?? ''
    parts.push(kept)
    messages.push({ role: 'assistant', content: [{ type: 'text', text: kept }] })
    messages.push(
      words(
        lines.length > 1
          ? `Your answer was cut off: it ran out of room. Carry on from the line after this one, in the same form, and finish it. Don't repeat anything already written, and add no remarks.\n\n${last}`
          : 'Your answer was cut off: it ran out of room. Carry on exactly where it stopped and finish it. Don’t repeat anything already written, and add no remarks.',
      ),
    )
  }
}

/**
 * Asks whatever the assistant is set to run on. `use: 'review'` asks what's chosen for reviewing
 * meetings instead (see AiSettings.review), and `cut` is told when the answer was still unfinished.
 */
export async function askOnce(server: string | null, system: string, question: string, signal?: AbortSignal, o: { use?: 'review'; cut?: () => void } = {}): Promise<string> {
  const ai = await serverAi(server)
  const saved = await settingsHere(server)
  const settings = o.use === 'review' ? reviewSettings(saved, ai) : saved
  const connection = connectionFor(settings, server, ai)
  if (!connection) throw new Error('Set up the assistant first: open Ask AI (Ctrl J) and choose where it runs')
  const reply = await askWhole(makeBackend(connection, settings.model), system, question, signal)
  if (reply.cut) o.cut?.()
  return reply.text
}
