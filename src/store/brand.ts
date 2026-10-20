/**
 * What the app is called: BrainCraft, unless the server it comes from is set up with another name
 * (an admin's choice, or BRAINCRAFT_APP_NAME). It shows in the tab, at the top of the app, on the
 * sign-in screen and wherever the app talks about itself. Kept in this browser too, so the right
 * name shows before the server has answered.
 */

export const DEFAULT_APP_NAME = 'BrainCraft'
const KEY = 'braincraft:app-name'

function stored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

let name = stored() || DEFAULT_APP_NAME

/** The app's name here. */
export const appName = () => name

/** Takes the server's name for the app (an empty one means the usual name). */
export function setAppName(next: string | null | undefined) {
  name = next?.trim() || DEFAULT_APP_NAME
  try {
    if (name === DEFAULT_APP_NAME) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, name)
  } catch {
    // Private browsing: it's asked for again next time.
  }
}

/** Asks a server what the app is called there; null when it doesn't say (or can't be reached). */
export async function fetchAppName(server: string | null): Promise<string | null> {
  if (!server) return null
  try {
    const health = (await fetch(new URL('api/health', server.endsWith('/') ? server : `${server}/`)).then((r) => r.json())) as { appName?: unknown }
    return typeof health.appName === 'string' ? health.appName : null
  } catch {
    return null
  }
}
