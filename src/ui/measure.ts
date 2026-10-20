import type { Measure } from '../model/mindmap'

export const FONT_FAMILY = '"Inter Variable", Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif'
export const LINE_HEIGHT = 1.3
/** The handwriting of hand-drawn objects (as `.hand` in styles.css). */
export const HAND_FAMILY = "Excalifont, 'Comic Shanns', 'Segoe Print', 'Bradley Hand', cursive"

let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, { w: number; h: number }>()

/** Measures wrapped text with a canvas, matching how `.mind-text` lays it out. */
export const measureText: Measure = (text, fontSize, weight, maxWidth, hand = false) => {
  const key = `${hand ? 'h' : ''}${fontSize}|${weight}|${maxWidth}|${text}`
  const hit = cache.get(key)
  if (hit) return hit
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return { w: text.length * fontSize * 0.55, h: fontSize * LINE_HEIGHT }
  ctx.font = `${weight} ${fontSize}px ${hand ? HAND_FAMILY : FONT_FAMILY}`
  const space = ctx.measureText(' ').width
  let widest = 0
  let lines = 0
  for (const para of text.split('\n')) {
    let line = 0
    lines++
    for (const word of para.split(' ')) {
      const w = ctx.measureText(word).width
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
