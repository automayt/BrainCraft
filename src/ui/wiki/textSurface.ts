import { caretPoint } from '../caretPoint'

/** What writing a page needs from the text being written, in either way of writing it. */
export interface TextSurface {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  setSelectionRange(from: number, to: number): void
  focus(options?: FocusOptions): void
  /** Where the caret is on screen. */
  caretBox(): { top: number; left: number; height: number }
}

/** Where a click on the reading page landed: the line of the block it hit, and where on screen. */
export interface PageSpot {
  line: number
  x: number
  /** The block's top on screen, and how far into it the click was. */
  top: number
  y: number
}

/** The Markdown box as a surface. */
export function textareaSurface(el: HTMLTextAreaElement): TextSurface {
  return {
    get value() {
      return el.value
    },
    get selectionStart() {
      return el.selectionStart
    },
    get selectionEnd() {
      return el.selectionEnd
    },
    setSelectionRange: (from, to) => el.setSelectionRange(from, to),
    focus: (options) => el.focus(options),
    caretBox() {
      const c = caretPoint(el)
      const box = el.getBoundingClientRect()
      return { top: box.top + Math.min(Math.max(c.top, 0), el.clientHeight - c.height), left: box.left + c.left, height: c.height }
    },
  }
}
