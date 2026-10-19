/**
 * Command-line agents the server can run for the assistant without being told how: Claude Code
 * (`claude -p`) and Codex (`codex exec`), found on the server's PATH. Each runs with its own sign-in
 * and settings, so whoever is signed in to Claude Code on the server's computer is who pays.
 *
 * BRAINCRAFT_AI_AGENTS chooses: unset finds whichever are installed; `claude`, `codex` or
 * `claude,codex` offers only those (when installed); `off` offers none. BRAINCRAFT_AI_COMMAND
 * stays the way to run anything else.
 */

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface AgentPreset {
  id: 'claude' | 'codex'
  /** How the app names it. */
  label: string
  program: string
  /**
   * The command line. The assistant drives the board itself (its tools are described in the
   * prompt), so the agent's own tools are switched off or kept read-only, and nothing is saved.
   */
  command: string
}

export const AGENT_PRESETS: AgentPreset[] = [
  { id: 'claude', label: 'Claude Code (claude -p)', program: 'claude', command: 'claude -p --tools "" --no-session-persistence' },
  { id: 'codex', label: 'Codex (codex exec)', program: 'codex', command: 'codex exec --skip-git-repo-check --sandbox read-only -' },
]

const isFile = (p: string) => {
  try {
    return existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
}

/** Where `program` is on the PATH, or null. */
export function findProgram(program: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = isFile): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean).concat('') : ['']
  for (const dir of dirs) for (const ext of exts) if (exists(join(dir, program + ext))) return join(dir, program + ext)
  return null
}

/** The agents to offer, by BRAINCRAFT_AI_AGENTS and what's installed. */
export function agentsFromEnv(env: NodeJS.ProcessEnv = process.env, find: (program: string) => string | null = (p) => findProgram(p, env)): AgentPreset[] {
  const want = (env.BRAINCRAFT_AI_AGENTS ?? '').trim().toLowerCase()
  if (/^(off|none|0|false|no)$/.test(want)) return []
  const named = want ? want.split(/[\s,]+/).filter(Boolean) : null
  return AGENT_PRESETS.filter((a) => (!named || named.includes(a.id)) && find(a.program) !== null)
}
