/**
 * Where the caret of a textarea is, in pixels from the textarea's top-left corner (scrolling
 * allowed for), measured with a hidden copy that wraps the text the same way.
 */
const COPIED = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'tabSize',
  'textTransform',
  'wordSpacing',
] as const

export function caretPoint(el: HTMLTextAreaElement, at = el.selectionStart): { top: number; left: number; height: number } {
  const style = getComputedStyle(el)
  const copy = document.createElement('div')
  for (const k of COPIED) copy.style[k] = style[k]
  copy.style.position = 'absolute'
  copy.style.visibility = 'hidden'
  copy.style.whiteSpace = 'pre-wrap'
  copy.style.overflowWrap = 'break-word'
  copy.style.top = '0'
  copy.style.left = '-9999px'
  copy.textContent = el.value.slice(0, at)
  const mark = document.createElement('span')
  mark.textContent = el.value.slice(at, at + 1) || '.'
  copy.appendChild(mark)
  document.body.appendChild(copy)
  const height = Number.parseFloat(style.lineHeight) || mark.offsetHeight
  const point = { top: mark.offsetTop - el.scrollTop, left: mark.offsetLeft - el.scrollLeft, height }
  copy.remove()
  return point
}
