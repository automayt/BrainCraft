/** One question to the assistant, answered in words: no tools, no conversation kept. */

import { makeBackend } from './assistant'
import { connectionFor, loadSettings, serverAi } from './settings'

export async function askOnce(server: string | null, system: string, question: string, signal?: AbortSignal): Promise<string> {
  const settings = loadSettings()
  const connection = connectionFor(settings, server, await serverAi(server))
  if (!connection) throw new Error('Set up the assistant first: open Ask AI (Ctrl J) and choose where it runs')
  const reply = await makeBackend(connection, settings.model).turn({ system, messages: [{ role: 'user', content: [{ type: 'text', text: question }] }], tools: [] }, () => {}, signal)
  return reply.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('\n')
    .trim()
}
