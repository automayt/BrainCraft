import { approxMeasure } from '../model/approxMeasure'
import type { Measure } from '../model/mindmap'
import { textRuns } from '../model/textMarks'

export const FONT_FAMILY = '"Inter Variable", Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif'
export const LINE_HEIGHT = 1.3
/** The handwriting of hand-drawn objects (as `.hand` in styles.css). */
export const HAND_FAMILY = "Excalifont, 'Comic Shanns', 'Segoe Print', 'Bradley Hand', cursive"

let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, { w: number; h: number }>()

/** A word, in the stretches it's drawn in: all one way, unless a mark begins or ends inside it. */
type Word = { text: string; font: string }[]

/** The paragraphs of `text` as words. With `marks`, bold and italic words in their own faces, the marks gone. */
function wordsOf(text: string, marks: boolean, font: (b: boolean, i: boolean) => string): Word[][] {
  const plain = font(false, false)
  if (!marks) return text.split('\n').map((para) => para.split(' ').map((w) => [{ text: w, font: plain }]))
  const paras: Word[][] = []
  let para: Word[] = [[]]
  for (const r of textRuns(text)) {
    const face = font(!!r.b, !!r.i)
    r.text.split('\n').forEach((part, k) => {
      if (k) {
        paras.push(para)
        para = [[]]
      }
      part.split(' ').forEach((w, j) => {
        if (j) para.push([])
        if (w) para[para.length - 1].push({ text: w, font: face })
      })
    })
  }
  paras.push(para)
  return paras
}

/** Measures wrapped text with a canvas, matching how `.mind-text` lays it out. */
export const measureText: Measure = (text, fontSize, weight, maxWidth, hand = false, marks = false) => {
  // Only words with marks in them are worth reading for marks.
  const rich = marks && text.includes('*')
  const key = `${hand ? 'h' : ''}${rich ? 'm' : ''}${fontSize}|${weight}|${maxWidth}|${text}`
  const hit = cache.get(key)
  if (hit) return hit
  // Drawn without a browser (a picture made on the server): close enough.
  if (typeof document === 'undefined') return approxMeasure(text, fontSize, weight, maxWidth, hand, marks)
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return { w: text.length * fontSize * 0.55, h: fontSize * LINE_HEIGHT }
  const c = ctx
  const family = hand ? HAND_FAMILY : FONT_FAMILY
  const font = (b: boolean, i: boolean) => `${i ? 'italic ' : ''}${b ? Math.max(weight, 700) : weight} ${fontSize}px ${family}`
  const width = (s: string, face: string) => {
    if (c.font !== face) c.font = face
    return c.measureText(s).width
  }
  c.font = font(false, false)
  const space = c.measureText(' ').width
  let widest = 0
  let lines = 0
  for (const para of wordsOf(text, rich, font)) {
    let line = 0
    lines++
    for (const word of para) {
      const w = word.reduce((sum, part) => sum + width(part.text, part.font), 0)
      if (w > maxWidth && maxWidth > 0) {
        // A word too long for a line starts a new one and breaks wherever it must (overflow-wrap: anywhere).
        if (line > 0) {
          widest = Math.max(widest, line)
          lines++
        }
        line = 0
        for (const part of word) {
          for (const ch of part.text) {
            const cw = width(ch, part.font)
            if (line > 0 && line + cw > maxWidth) {
              widest = Math.max(widest, line)
              lines++
              line = cw
            } else line += cw
          }
        }
        continue
      }
      if (line > 0 && line + space + w > maxWidth) {
        widest = Math.max(widest, line)
        lines++
        line = w
      } else {
        line += (line > 0 ? space : 0) + w
      }
    }
    widest = Math.max(widest, line)
  }
  // Long unbroken words wrap in the DOM too, so never report more than the cap.
  const out = { w: Math.min(maxWidth, widest) + 2, h: lines * fontSize * LINE_HEIGHT }
  if (cache.size > 5000) cache.clear()
  cache.set(key, out)
  return out
}

export function clearMeasureCache() {
  cache.clear()
}
