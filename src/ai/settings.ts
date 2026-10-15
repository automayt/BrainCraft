/** AI settings, kept in this browser: how to reach Claude and which model to use. */

import { type AiConnection, type AiModel, AI_MODELS, DEFAULT_MODEL } from './assistant'

const KEY = 'braincraft:ai-settings'

export interface AiSettings {
  mode: 'server' | 'key'
  /** The person's own Anthropic API key (mode "key"). Stored only in this browser. */
  apiKey?: string
  /** The BrainCraft server's AI password, when it has one (mode "server"). */
  password?: string
  model: AiModel
}

export function loadSettings(): AiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AiSettings> | null
    const model = AI_MODELS.some((m) => m.id === raw?.model) ? (raw!.model as AiModel) : DEFAULT_MODEL
    return { mode: raw?.mode === 'key' ? 'key' : 'server', apiKey: raw?.apiKey, password: raw?.password, model }
  } catch {
    return { mode: 'server', model: DEFAULT_MODEL }
  }
}

export function saveSettings(s: AiSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Settings just won't be remembered.
  }
}

export interface ServerAi {
  /** The server has an API key configured. */
  available: boolean
  /** It asks for a password before using it. */
  password: boolean
}

/** Whether the BrainCraft server offers AI (it says so in /api/health). */
export async function serverAi(server: string | null): Promise<ServerAi> {
  if (!server) return { available: false, password: false }
  try {
    const res = await fetch(new URL('api/health', server))
    const h = (await res.json()) as { ai?: boolean; aiPassword?: boolean }
    return { available: !!h.ai, password: !!h.aiPassword }
  } catch {
    return { available: false, password: false }
  }
}

/** The connection to use with these settings, or null when not set up yet. */
export function connectionFor(s: AiSettings, server: string | null, ai: ServerAi): AiConnection | null {
  if (s.mode === 'key') return s.apiKey?.trim() ? { kind: 'key', apiKey: s.apiKey.trim() } : null
  if (!server || !ai.available || (ai.password && !s.password)) return null
  return { kind: 'server', base: server, ...(s.password ? { password: s.password } : {}) }
}
