/**
 * Ctrl B and Ctrl I, for bold and italic. Wherever words are typed these keys belong to the words,
 * never to the browser (Firefox opens its bookmarks on Ctrl B and the page's details on Ctrl I).
 */

import type { Mark } from '../model/textMarks'

/** Ctrl B or Ctrl I (Cmd on a Mac), and nothing else held: which mark it's for. */
export function markKey(ev: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): Mark | null {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return null
  const k = ev.key.toLowerCase()
  return k === 'b' || k === 'i' ? k : null
}

/** Whether words are typed here: a text box or a line of text (not a tick box, a slider or a button). */
export function takesWords(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.tagName) return false
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true
  return el.tagName === 'INPUT' && /^(text|search|url|email|tel|password|number|)$/.test((el as HTMLInputElement).type ?? '')
}

/**
 * Keeps Ctrl B and Ctrl I from the browser while words are being typed, wherever that is: a title, a
 * cell, a search box. It only stops the browser's own action; what the key does to the words is up
 * to the box (bold in a note or on a page, nothing in a title). The page editor is left alone: it
 * takes these keys itself, and wouldn't if they came already stopped.
 */
export function keepMarkKeys(ev: KeyboardEvent) {
  if (!markKey(ev) || !takesWords(ev.target)) return
  if ((ev.target as Element).closest?.('.cm-editor')) return
  ev.preventDefault()
}

/**
 * Changes a text box's words to `next.text` the way typing would, so the box's own Ctrl Z takes it
 * back, then selects `from`..`to`. Only what differs is typed over.
 */
export function retype(ta: HTMLTextAreaElement, next: { text: string; from: number; to: number }, set: (text: string) => void) {
  const was = ta.value
  if (was !== next.text) {
    const most = Math.min(was.length, next.text.length)
    let a = 0
    while (a < most && was[a] === next.text[a]) a++
    let z = 0
    while (z < most - a && was[was.length - 1 - z] === next.text[next.text.length - 1 - z]) z++
    const insert = next.text.slice(a, next.text.length - z)
    ta.setSelectionRange(a, was.length - z)
    // The browser's own way of typing into a box keeps its undo history; where it's refused, set the words.
    const typed = insert ? document.execCommand('insertText', false, insert) : document.execCommand('delete')
    if (!typed || ta.value !== next.text) {
      ta.value = next.text
      set(next.text)
    }
  }
  ta.setSelectionRange(next.from, next.to)
}
