/** Flowstate in full screen, for those who ask for it (it starts in the window). */

/** The keyboard lock, where a page may ask for Esc in full screen (Chrome, Edge). */
export const flowKeys = () => (navigator as Navigator & { keyboard?: { lock?: (k: string[]) => Promise<void>; unlock?: () => void } }).keyboard

/**
 * Flowstate in full screen. Browsers keep Esc for leaving full screen; where a page may ask for it,
 * one Esc ends Flowstate too.
 */
export function flowFullScreen(on: boolean) {
  if (on)
    document.documentElement
      .requestFullscreen?.()
      .then(() => flowKeys()?.lock?.(['Escape']))
      .catch(() => {})
  else {
    flowKeys()?.unlock?.()
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }
}
