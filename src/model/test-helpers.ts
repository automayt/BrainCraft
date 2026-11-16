import type { Measure } from './mindmap'
import { unmarked } from './textMarks'

/** Deterministic text measurement for tests: fixed-width glyphs, no wrapping. An object's words are measured as drawn, without their marks. */
export const fakeMeasure: Measure = (words, fontSize, _weight, _maxWidth, _hand, marks) => {
  const text = marks ? unmarked(words) : words
  return {
    w: text.length * fontSize * 0.5,
    h: text.split('\n').length * fontSize * 1.3,
  }
}
