/**
 * AI settings kept with your account, on a server with accounts: which model, which of the
 * server's choices, your own model server's address. They follow you to another browser, and to
 * the same server at another address (a browser keeps its own settings per address, so a server
 * moved from http to https, or reached by another name, used to start again from nothing).
 *
 * Keys and passwords are never sent: they stay in the browser they were typed in.
 */

import { call } from '../store/account'
import { type AiSettings, hasSettings, loadSettings, readSettings, saveSettings } from './settings'

const SECRETS = ['apiKey', 'openaiKey', 'password'] as const

/** The settings without anything secret: what's kept with the account. */
export function choicesOf(s: AiSettings): Omit<AiSettings, (typeof SECRETS)[number]> {
  const { apiKey: _a, openaiKey: _o, password: _p, ...rest } = s
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Omit<AiSettings, (typeof SECRETS)[number]>
}

/** The account's settings brought into this browser: its choices, with this browser's own keys and passwords. */
export function withKept(here: AiSettings, kept: unknown): AiSettings {
  const k = kept && typeof kept === 'object' ? (kept as Record<string, unknown>) : {}
  return readSettings({ ...k, apiKey: here.apiKey, openaiKey: here.openaiKey, password: here.password })
}

/** Which is to be used: the account's (newer, or this browser has none), this browser's (newer: the account gets it), or neither needs anything. */
export function newer(here: AiSettings, saved: boolean, kept: { at?: number } | null): 'kept' | 'here' | 'same' {
  if (!kept) return saved ? 'here' : 'same'
  if (!saved) return 'kept'
  const [h, k] = [here.at ?? 0, kept.at ?? 0]
  return k > h ? 'kept' : h > k ? 'here' : 'same'
}

const send = (server: string, s: AiSettings) => call(server, 'api/assistant/settings', 'PUT', choicesOf(s))

/**
 * This browser's settings, made the same as the account's: whichever was changed last wins. With
 * no account (or a server that can't be reached), this browser's own, as they are.
 */
export async function syncSettings(server: string | null): Promise<AiSettings> {
  if (!server) return loadSettings()
  let kept: { at?: number } | null
  try {
    kept = (await call<{ settings: { at?: number } | null }>(server, 'api/assistant/settings')).settings ?? null
  } catch {
    // Not signed in, no accounts here, or it can't be reached: nothing to go by but this browser.
    return loadSettings()
  }
  // Read now, not before asking: what was changed here meanwhile is the newer.
  const here = loadSettings()
  const which = newer(here, hasSettings(), kept)
  if (which === 'kept') {
    const next = withKept(here, kept)
    saveSettings(next)
    return next
  }
  if (which === 'here') void send(server, here).catch(() => {})
  return here
}

/** This browser's settings; the account's when it has none of its own yet (a new browser, or the server at a new address). */
export const settingsHere = async (server: string | null): Promise<AiSettings> => (hasSettings() ? loadSettings() : syncSettings(server))

let waiting: ReturnType<typeof setTimeout> | undefined
let latest: { server: string; s: AiSettings } | null = null

/** Keeps a change with the account, shortly: typing in a box changes them a letter at a time. */
export function keepSettings(server: string, s: AiSettings, wait = 700) {
  latest = { server, s }
  if (waiting !== undefined) clearTimeout(waiting)
  waiting = setTimeout(() => {
    waiting = undefined
    const now = latest
    latest = null
    if (now) void send(now.server, now.s).catch(() => {})
  }, wait)
}
