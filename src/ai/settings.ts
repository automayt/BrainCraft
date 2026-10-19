/** AI settings, kept in this browser: where the assistant's model runs, and which model. */

import { type AiConnection, type AiModel, AI_MODELS, DEFAULT_MODEL } from './assistant'

const KEY = 'braincraft:ai-settings'

/** What the BrainCraft server can run the assistant with. */
export type ServerProvider = 'anthropic' | 'openai' | 'command'

export interface AiSettings {
  /** The BrainCraft server's AI, your own Anthropic key, or your own OpenAI-compatible model server. */
  mode: 'server' | 'key' | 'openai'
  /** Which of the server's providers to use (mode "server"), when it offers more than one. */
  provider?: ServerProvider
  /** Which of the server's command-line agents (provider "command"): "claude", "codex" or "custom". */
  agent?: string
  /** The person's own Anthropic API key (mode "key"). Stored only in this browser. */
  apiKey?: string
  /** The BrainCraft server's AI password, when it has one (mode "server"). */
  password?: string
  /** The Claude model (Anthropic providers). */
  model: AiModel
  /** The model on the server's OpenAI-compatible endpoint, when it offers several. */
  serverModel?: string
  /** Your own OpenAI-compatible server (mode "openai"): its base URL ending in /v1, key, model. */
  openaiBase?: string
  openaiKey?: string
  openaiModel?: string
  /** Describe the tools in the text, for a model served without tool calling. */
  textTools?: boolean
}

const PROVIDERS: ServerProvider[] = ['anthropic', 'openai', 'command']
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export function loadSettings(): AiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AiSettings> | null
    const model = AI_MODELS.some((m) => m.id === raw?.model) ? (raw!.model as AiModel) : DEFAULT_MODEL
    return {
      mode: raw?.mode === 'key' || raw?.mode === 'openai' ? raw.mode : 'server',
      ...(PROVIDERS.includes(raw?.provider as ServerProvider) ? { provider: raw!.provider } : {}),
      ...(typeof raw?.agent === 'string' ? { agent: raw.agent } : {}),
      apiKey: str(raw?.apiKey),
      password: str(raw?.password),
      model,
      serverModel: str(raw?.serverModel),
      openaiBase: str(raw?.openaiBase),
      openaiKey: str(raw?.openaiKey),
      openaiModel: str(raw?.openaiModel),
      textTools: raw?.textTools === true,
    }
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
  /** The server offers some AI. */
  available: boolean
  /** It asks for a password before using it. */
  password: boolean
  /** What it can run the assistant with. */
  providers: ServerProvider[]
  /** Models on its OpenAI-compatible endpoint. */
  openaiModels: string[]
  /** Its OpenAI-compatible model needs the tools described in the text. */
  textTools: boolean
  /** The command-line agent it runs (its program name, e.g. "claude" or "codex"). */
  command?: string
  /** Its command-line agents: Claude Code, Codex, or its own command. */
  agents: { id: string; label: string }[]
  /** Its agents answer only the server's own computer (no AI password or accounts yet). */
  agentsLocal: boolean
}

const NO_AI: ServerAi = { available: false, password: false, providers: [], openaiModels: [], textTools: false, agents: [], agentsLocal: false }

/** What AI the BrainCraft server offers (it says so in /api/health). */
export async function serverAi(server: string | null): Promise<ServerAi> {
  if (!server) return NO_AI
  try {
    const res = await fetch(new URL('api/health', server))
    const h = (await res.json()) as { ai?: boolean; aiPassword?: boolean; aiProviders?: unknown; aiModels?: unknown; aiTextTools?: unknown; aiCommand?: unknown; aiAgents?: unknown; aiAgentsLocal?: unknown }
    // Older servers only said whether they had Claude.
    const providers = Array.isArray(h.aiProviders) ? (h.aiProviders.filter((p) => PROVIDERS.includes(p as ServerProvider)) as ServerProvider[]) : h.ai ? (['anthropic'] as ServerProvider[]) : []
    return {
      available: providers.length > 0,
      password: !!h.aiPassword,
      providers,
      openaiModels: Array.isArray(h.aiModels) ? h.aiModels.filter((m): m is string => typeof m === 'string') : [],
      textTools: h.aiTextTools === true,
      ...(typeof h.aiCommand === 'string' && h.aiCommand ? { command: h.aiCommand } : {}),
      agents: Array.isArray(h.aiAgents)
        ? h.aiAgents.flatMap((a) => (a && typeof a.id === 'string' && typeof a.label === 'string' ? [{ id: a.id, label: a.label }] : []))
        : // Older servers had one agent command.
          typeof h.aiCommand === 'string' && h.aiCommand
          ? [{ id: '', label: h.aiCommand }]
          : [],
      agentsLocal: h.aiAgentsLocal === true,
    }
  } catch {
    return NO_AI
  }
}

/** Which of the server's providers these settings use. */
export const serverProvider = (s: AiSettings, ai: ServerAi): ServerProvider | undefined => (s.provider && ai.providers.includes(s.provider) ? s.provider : ai.providers[0])

/** The connection to use with these settings, or null when not set up yet. */
export function connectionFor(s: AiSettings, server: string | null, ai: ServerAi): AiConnection | null {
  if (s.mode === 'key') return s.apiKey?.trim() ? { kind: 'key', apiKey: s.apiKey.trim() } : null
  if (s.mode === 'openai') {
    const base = s.openaiBase?.trim()
    const model = s.openaiModel?.trim()
    if (!base || !model) return null
    return { kind: 'openai', base, ...(s.openaiKey?.trim() ? { apiKey: s.openaiKey.trim() } : {}), model, textTools: !!s.textTools, label: `${model} (your model server)` }
  }
  if (!server || !ai.available || (ai.password && !s.password)) return null
  const password = s.password ? { password: s.password } : {}
  const provider = serverProvider(s, ai)
  if (provider === 'openai') {
    const model = (s.serverModel && ai.openaiModels.includes(s.serverModel) ? s.serverModel : ai.openaiModels[0]) ?? ''
    return { kind: 'openai', base: new URL('api/ai/openai', server.endsWith('/') ? server : `${server}/`).href, ...password, model, textTools: ai.textTools, label: `${model || 'The model'} on this server` }
  }
  if (provider === 'command') {
    const agent = ai.agents.find((a) => a.id === s.agent) ?? ai.agents[0]
    return { kind: 'command', base: server, ...password, ...(agent?.id ? { agent: agent.id } : {}), label: `${agent?.label ?? ai.command ?? 'The agent'} on this server` }
  }
  return { kind: 'server', base: server, ...password }
}

/** The models an OpenAI-compatible server lists (GET /models), or the reason it couldn't say. */
export async function listModels(base: string, apiKey?: string): Promise<string[] | string> {
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} })
    if (!res.ok) return `It answered ${res.status}.`
    const j = (await res.json()) as { data?: { id?: unknown }[] }
    const ids = (j.data ?? []).flatMap((m) => (typeof m.id === 'string' ? [m.id] : []))
    return ids.length ? ids : 'It lists no models.'
  } catch (err) {
    return `Couldn’t reach it (${(err as Error).message}). Is it running, and does it allow this page’s address (CORS)?`
  }
}
