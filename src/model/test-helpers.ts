import type { Measure } from './mindmap'

/** Deterministic text measurement for tests: fixed-width glyphs, no wrapping. */
export const fakeMeasure: Measure = (text, fontSize) => ({
  w: text.length * fontSize * 0.5,
  h: text.split('\n').length * fontSize * 1.3,
})
