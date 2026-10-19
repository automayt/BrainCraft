import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentsFromEnv, findProgram } from './aiAgents'

describe('command-line agents the server finds', () => {
  it('finds a program on the PATH, with Windows extensions', () => {
    const files = new Set([join('/opt/bin', 'claude'), join('C:\tools', 'codex.CMD')])
    const exists = (p: string) => files.has(p)
    expect(findProgram('claude', { PATH: '/usr/bin:/opt/bin' }, 'linux', exists)).toBe(join('/opt/bin', 'claude'))
    expect(findProgram('codex', { PATH: 'C:\Windows;C:\tools', PATHEXT: '.EXE;.CMD' }, 'win32', exists)).toBe(join('C:\tools', 'codex.CMD'))
    expect(findProgram('codex', { PATH: '/usr/bin' }, 'linux', exists)).toBeNull()
  })

  it('offers what is installed, only what BRAINCRAFT_AI_AGENTS names, or nothing when it says off', () => {
    const both = (p: string) => `/bin/${p}`
    const onlyClaude = (p: string) => (p === 'claude' ? '/bin/claude' : null)
    expect(agentsFromEnv({}, both).map((a) => a.id)).toEqual(['claude', 'codex'])
    expect(agentsFromEnv({}, onlyClaude).map((a) => a.id)).toEqual(['claude'])
    expect(agentsFromEnv({ BRAINCRAFT_AI_AGENTS: 'codex' }, both).map((a) => a.id)).toEqual(['codex'])
    expect(agentsFromEnv({ BRAINCRAFT_AI_AGENTS: 'codex' }, onlyClaude)).toEqual([])
    expect(agentsFromEnv({ BRAINCRAFT_AI_AGENTS: 'off' }, both)).toEqual([])
    // Claude Code runs with its own tools off and nothing saved: the assistant drives the board.
    expect(agentsFromEnv({}, both)[0].command).toBe('claude -p --tools "" --no-session-persistence')
  })
})
