/** Colour themes. The palette lives in CSS custom properties keyed by `data-theme` on <html>. */

export type Theme = 'dark' | 'light' | 'hc-dark' | 'hc-light'

export const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'dark', label: 'Dark', hint: 'Easy on the eyes (default)' },
  { id: 'light', label: 'Light', hint: 'Bright and airy' },
  { id: 'hc-dark', label: 'High contrast dark', hint: 'Maximum contrast on black' },
  { id: 'hc-light', label: 'High contrast light', hint: 'Maximum contrast on white' },
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
