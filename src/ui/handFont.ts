/**
 * Excalifont, the handwriting of hand-drawn objects: the same font files the app ships for
 * Excalidraw (dist/excalidraw/fonts), declared as an ordinary stylesheet so exported pictures can
 * carry it too. The browser fetches it only when something hand-drawn is on screen.
 */

/** Its Latin and Latin Extended parts (other scripts fall back to a system handwriting face). */
export const HAND_FONT_FILES: [file: string, unicodeRange: string][] = [
  [
    'Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2',
    'U+20-7e,U+a0-a3,U+a5-a6,U+a8-ab,U+ad-b1,U+b4,U+b6-b8,U+ba-ff,U+131,U+152-153,U+2bc,U+2c6,U+2da,U+2dc,U+304,U+308,U+2013-2014,U+2018-201a,U+201c-201e,U+2020,U+2022,U+2024-2026,U+2030,U+2039-203a,U+20ac,U+2122,U+2212',
  ],
  ['Excalifont-Regular-be310b9bcd4f1a43f571c46df7809174.woff2', 'U+100-130,U+132-137,U+139-149,U+14c-151,U+154-17e,U+192,U+1fc-1ff,U+218-21b,U+237,U+1e80-1e85,U+1ef2-1ef3,U+2113'],
]

let installed = false

export function installHandFont() {
  if (installed || typeof document === 'undefined') return
  installed = true
  const base = new URL('excalidraw/fonts/Excalifont/', document.baseURI).href
  const style = document.createElement('style')
  style.dataset.font = 'hand'
  style.textContent = HAND_FONT_FILES.map(
    ([file, range]) => `@font-face{font-family:'Excalifont';src:url("${base}${file}") format('woff2');font-display:swap;unicode-range:${range}}`,
  ).join('\n')
  document.head.append(style)
}
