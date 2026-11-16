/** Text measuring without a browser (servers, the MCP server): close enough for layout. */

import type { Measure } from './mindmap'
import { unmarked } from './textMarks'

export const approxMeasure: Measure = (words, fontSize, weight, maxWidth, hand = false, marks = false) => {
  const text = marks ? unmarked(words) : words
  // Handwriting runs a little wider than the interface's typeface.
  const charW = fontSize * (weight >= 600 ? 0.58 : 0.54) * (hand ? 1.15 : 1)
  let lines = 0
  let widest = 0
  for (const para of text.split('\n')) {
    let line = 0
    for (const word of para.split(/\s+/)) {
      const w = (word.length + 1) * charW
      if (line && maxWidth > 0 && line + w > maxWidth) {
        widest = Math.max(widest, line)
        lines++
        line = 0
      }
      // A word too long for a line breaks wherever it must, over as many lines as it takes.
      if (maxWidth > 0 && w > maxWidth) {
        const whole = Math.ceil(w / maxWidth) - 1
        widest = maxWidth
        lines += whole
        line = w - whole * maxWidth
        continue
      }
      line += w
    }
    widest = Math.max(widest, line)
    lines++
  }
  return { w: Math.ceil(widest), h: Math.ceil(lines * fontSize * 1.3) }
}
