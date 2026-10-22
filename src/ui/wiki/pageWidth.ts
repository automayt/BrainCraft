/**
 * How wide a wiki page reads, chosen by each reader (kept in this browser, for every wiki): a
 * narrow column for long reading, wider for tables and boards shown on the page, or the whole window.
 */

export const PAGE_WIDTHS = [
  { id: 'narrow', label: 'Narrow', css: '680px' },
  { id: 'normal', label: 'Normal', css: '860px' },
  { id: 'wide', label: 'Wide', css: '1180px' },
  { id: 'full', label: 'Full width', css: 'none' },
] as const

export type PageWidth = (typeof PAGE_WIDTHS)[number]['id']

const KEY = 'braincraft:wiki-width'

export function loadPageWidth(): PageWidth {
  try {
    const v = localStorage.getItem(KEY)
    return PAGE_WIDTHS.some((w) => w.id === v) ? (v as PageWidth) : 'normal'
  } catch {
    return 'normal'
  }
}

/** Shows pages at `w` (and remembers it). */
export function applyPageWidth(w: PageWidth, save = true) {
  const css = PAGE_WIDTHS.find((x) => x.id === w)?.css ?? '860px'
  document.documentElement.style.setProperty('--wiki-width', css)
  if (!save) return
  try {
    localStorage.setItem(KEY, w)
  } catch {
    // Private browsing: it's the usual width next time.
  }
}
