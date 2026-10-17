/**
 * Copies text: through the clipboard where the browser allows it (HTTPS or localhost), else the
 * old way, through a selected field. Returns whether it worked, so nobody is told "Copied" when
 * nothing was.
 */
export async function copyText(text: string, field?: HTMLInputElement | HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused (no permission, or the page isn't focused): try the old way.
  }
  try {
    const el = field ?? document.createElement('textarea')
    if (!field) {
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.append(el)
    }
    el.select()
    const ok = document.execCommand('copy')
    if (!field) el.remove()
    return ok
  } catch {
    return false
  }
}

/** Whether a link only works on the computer that made it (localhost and friends). */
export function isLocalAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '::1' || host.startsWith('127.')
  } catch {
    return false
  }
}
