import { describe, expect, it } from 'vitest'
import { keepMarkKeys, markKey, takesWords } from './markKeys'

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })
/** An element, as far as these keys look at one. */
const el = (tagName: string, more: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, closest: () => null, ...more }) as unknown as EventTarget
/** A key press on `target`: whether the browser's own action was stopped. */
const stopped = (target: EventTarget | null, k: ReturnType<typeof key>) => {
  let prevented = false
  keepMarkKeys({ ...k, target, preventDefault: () => (prevented = true) } as unknown as KeyboardEvent)
  return prevented
}

describe('Ctrl B and Ctrl I', () => {
  it('are bold and italic, with Ctrl or (on a Mac) Cmd', () => {
    expect(markKey(key('b', { ctrlKey: true }))).toBe('b')
    expect(markKey(key('B', { ctrlKey: true }))).toBe('b')
    expect(markKey(key('i', { metaKey: true }))).toBe('i')
  })

  it('are nothing with another key held, or by themselves', () => {
    expect(markKey(key('b'))).toBeNull()
    expect(markKey(key('b', { ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(markKey(key('i', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(markKey(key('u', { ctrlKey: true }))).toBeNull()
  })

  it('know where words are typed', () => {
    expect(takesWords(el('TEXTAREA'))).toBe(true)
    expect(takesWords(el('INPUT', { type: 'text' }))).toBe(true)
    expect(takesWords(el('INPUT', { type: 'search' }))).toBe(true)
    expect(takesWords(el('DIV', { isContentEditable: true }))).toBe(true)
    expect(takesWords(el('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(takesWords(el('INPUT', { type: 'range' }))).toBe(false)
    expect(takesWords(el('BUTTON'))).toBe(false)
    expect(takesWords(el('BODY'))).toBe(false)
    expect(takesWords(null)).toBe(false)
  })

  it('never reach the browser while words are being typed', () => {
    expect(stopped(el('TEXTAREA'), key('b', { ctrlKey: true }))).toBe(true)
    expect(stopped(el('INPUT', { type: 'text' }), key('i', { ctrlKey: true }))).toBe(true)
    expect(stopped(el('TEXTAREA'), key('b', { metaKey: true }))).toBe(true)
  })

  it('are left alone anywhere else, and so are other keys', () => {
    expect(stopped(el('BODY'), key('b', { ctrlKey: true }))).toBe(false)
    expect(stopped(el('BUTTON'), key('b', { ctrlKey: true }))).toBe(false)
    expect(stopped(el('TEXTAREA'), key('b'))).toBe(false)
    expect(stopped(el('TEXTAREA'), key('d', { ctrlKey: true }))).toBe(false)
    expect(stopped(el('TEXTAREA'), key('b', { ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('are left to the page editor, which takes them itself', () => {
    const inEditor = el('DIV', { isContentEditable: true, closest: (q: string) => (q === '.cm-editor' ? {} : null) })
    expect(stopped(inEditor, key('b', { ctrlKey: true }))).toBe(false)
  })
})
