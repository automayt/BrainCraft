/** Colour themes. The palette lives in CSS custom properties keyed by `data-theme` on <html>. */

export type Theme = 'dark' | 'light' | 'wall-dark' | 'wall-light' | 'hc-dark' | 'hc-light'

export const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'dark', label: 'Dark', hint: 'The default' },
  { id: 'light', label: 'Light', hint: 'For bright rooms and printing' },
  { id: 'wall-dark', label: 'Wall dark', hint: 'Green-grey graphite, warmer text' },
  { id: 'wall-light', label: 'Wall light', hint: 'Pale sage, softer than white' },
  { id: 'hc-dark', label: 'High contrast dark', hint: 'White on black, thicker lines' },
  { id: 'hc-light', label: 'High contrast light', hint: 'Black on white, thicker lines' },
]

const KEY = 'braincraft:theme'

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    if (THEMES.some((x) => x.id === t)) return t as Theme
  } catch {
    // Storage blocked: fall back to the default.
  }
  return 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme.endsWith('light') ? 'light' : 'dark'
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Not remembered, but still applied.
  }
}
