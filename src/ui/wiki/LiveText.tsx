/**
 * Writing a page where it's read: the Markdown is the text being edited, drawn the way the page
 * reads. Marks step aside as you type (see model/pageMarks.ts) and come back with the caret in
 * them; tables, code and macros are drawn until the caret goes in; links are named chips. Nothing
 * is translated, so what's stored is exactly what was typed.
 */

import { history, historyKeymap, standardKeymap } from '@codemirror/commands'
import { EditorSelection, EditorState, type Range, StateField, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Block } from '../../model/markdown'
import { type PageMarks, pageMarks } from '../../model/pageMarks'
import { Markdown, type MarkdownActions } from './Markdown'
import type { PageSpot, TextSurface } from './textSurface'

class Chip extends WidgetType {
  label: string
  constructor(label: string) {
    super()
    this.label = label
  }
  eq(other: Chip) {
    return other.label === this.label
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'lv-chip'
    el.textContent = this.label
    return el
  }
}

class Bullet extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'lv-bullet'
    el.textContent = '•'
    return el
  }
}

/** A checklist box: ticking it changes the `[ ]` in its line. */
class Tick extends WidgetType {
  on: boolean
  constructor(on: boolean) {
    super()
    this.on = on
  }
  eq(other: Tick) {
    return other.on === this.on
  }
  toDOM(view: EditorView) {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.className = 'lv-tick'
    el.checked = this.on
    el.setAttribute('aria-label', this.on ? 'Done' : 'To do')
    el.addEventListener('change', () => {
      const at = view.posAtDOM(el)
      const box = view.state.doc.sliceString(at, at + 12).indexOf('[')
      if (box >= 0) view.dispatch({ changes: { from: at + box + 1, to: at + box + 2, insert: this.on ? ' ' : 'x' } })
    })
    return el
  }
  ignoreEvent() {
    return true
  }
}

/** The React side of the blocks: each draws into an element the editor placed. */
interface Slots {
  add(el: HTMLElement, block: Block): void
  remove(el: HTMLElement): void
}

class Drawn extends WidgetType {
  source: string
  block: Block
  fixed: boolean
  slots: Slots
  constructor(source: string, block: Block, fixed: boolean, slots: Slots) {
    super()
    this.source = source
    this.block = block
    this.fixed = fixed
    this.slots = slots
  }
  // The line counts: a tick inside must change the right one.
  eq(other: Drawn) {
    return other.source === this.source && other.block.line === this.block.line
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'lv-block'
    this.slots.add(el, this.block)
    return el
  }
  destroy(el: HTMLElement) {
    this.slots.remove(el)
  }
  get estimatedHeight() {
    return 60
  }
  // A press on a table or some code goes in to its Markdown; links, boxes and embeds keep their own.
  ignoreEvent(e: Event) {
    return this.fixed || !!(e.target as Element).closest?.('a, button, input, select, textarea, summary, label')
  }
}

const HIDE = Decoration.replace({})
const LOOKS = { b: 'lv-b', i: 'lv-i', s: 'lv-s', code: 'lv-code', a: 'lv-a' } as const
const WORDS = Object.fromEntries(Object.entries(LOOKS).map(([k, v]) => [k, Decoration.mark({ class: v })])) as Record<keyof typeof LOOKS, Decoration>
const lineLook = (look: string) => Decoration.line({ class: `lv-${look}` })

/** The decorations for where the caret is now. */
function decorate(doc: Text, selection: EditorSelection, marks: PageMarks, slots: Slots) {
  const carets = selection.ranges.filter((r) => r.empty).map((r) => r.head)
  const has = (a: number, b: number) => carets.some((c) => c >= a && c <= b)
  const out: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []
  // Lines of a block showing its Markdown look like Markdown, not like the page.
  const open: [number, number][] = []
  for (const b of marks.blocks) {
    if (!b.fixed && selection.ranges.some((r) => r.from <= b.to && r.to >= b.from)) {
      open.push([b.from, b.to])
      for (let n = doc.lineAt(b.from).number; n <= doc.lineAt(b.to).number; n++) out.push(lineLook('source').range(doc.line(n).from))
      continue
    }
    const drawn = Decoration.replace({ widget: new Drawn(doc.sliceString(b.from, b.to), b.block, b.fixed, slots), block: true })
    out.push(drawn.range(b.from, b.to))
    if (b.fixed) atomic.push(drawn.range(b.from, b.to))
  }
  for (const l of marks.lines) if (l.look !== 'gap' || !has(l.at, l.at)) out.push(lineLook(l.look).range(l.at))
  for (const w of marks.words) if (w.to > w.from) out.push(WORDS[w.look].range(w.from, w.to))
  for (const h of marks.hides) if (!has(h.show[0], h.show[1])) out.push(HIDE.range(h.from, h.to))
  for (const c of marks.chips) {
    const chip = Decoration.replace({ widget: new Chip(c.label) })
    out.push(chip.range(c.from, c.to))
    atomic.push(chip.range(c.from, c.to))
  }
  for (const b of marks.bullets) {
    const mark = Decoration.replace({ widget: b.task === undefined ? new Bullet() : new Tick(b.task) })
    out.push(mark.range(b.from, b.to))
    atomic.push(mark.range(b.from, b.to))
  }
  return { decorations: Decoration.set(out, true), atomic: Decoration.set(atomic, true) }
}

function marksField(slots: Slots) {
  const look = (doc: Text, selection: EditorSelection, marks = pageMarks(doc.toString())) => ({ marks, ...decorate(doc, selection, marks, slots) })
  return StateField.define<{ marks: PageMarks; decorations: DecorationSet; atomic: DecorationSet }>({
    create: (state) => look(state.doc, state.selection),
    update(value, tr) {
      if (tr.docChanged) return look(tr.newDoc, tr.newSelection)
      return tr.selection ? look(tr.newDoc, tr.newSelection, value.marks) : value
    },
    provide: (f) => [EditorView.decorations.from(f, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(f).atomic)],
  })
}

export interface LiveTextProps {
  value: string
  label: string
  actions: MarkdownActions
  /** Where a click on the page landed, to start writing there. */
  start?: PageSpot
  surface: RefObject<TextSurface | null>
  /** The open picker and its current choice, for screen readers. */
  picker?: { list: string; option: string }
  onChange: (value: string) => void
  /** The caret moved, or the text under it changed. */
  onCaret: () => void
  onKey: (e: KeyboardEvent) => void
  onPaste: (e: ClipboardEvent) => void
  onDrop: (e: DragEvent) => void
  onBlur: () => void
}

export default function LiveText(props: LiveTextProps) {
  const { value, actions, picker } = props
  const box = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  /** The text as last passed up: only a change from elsewhere comes back down. */
  const known = useRef(value)
  const now = useRef(props)
  now.current = props
  const [slots, setSlots] = useState(() => new Map<HTMLElement, Block>())

  useLayoutEffect(() => {
    const place: Slots = {
      add: (el, block) => setSlots((m) => new Map(m).set(el, block)),
      remove: (el) =>
        setSlots((m) => {
          const next = new Map(m)
          next.delete(el)
          return next
        }),
    }
    const v = new EditorView({
      parent: box.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          // Offsets match the stored text exactly, whatever line ends it has.
          EditorState.lineSeparator.of('\n'),
          EditorView.domEventHandlers({
            keydown: (e) => {
              now.current.onKey(e)
              return e.defaultPrevented
            },
            paste: (e) => {
              now.current.onPaste(e)
              return e.defaultPrevented
            },
            drop: (e) => {
              now.current.onDrop(e)
              return e.defaultPrevented
            },
            blur: () => now.current.onBlur(),
          }),
          history(),
          keymap.of([...historyKeymap, ...standardKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': props.label, role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true', autocapitalize: 'sentences', 'aria-autocomplete': 'list' }),
          marksField(place),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const text = u.state.doc.toString()
              if (text !== known.current) {
                known.current = text
                now.current.onChange(text)
              }
            }
            if (u.docChanged || u.selectionSet) now.current.onCaret()
          }),
        ],
      }),
    })
    view.current = v
    const clamp = (n: number) => Math.max(0, Math.min(n, v.state.doc.length))
    now.current.surface.current = {
      get value() {
        return v.state.doc.toString()
      },
      get selectionStart() {
        return v.state.selection.main.from
      },
      get selectionEnd() {
        return v.state.selection.main.to
      },
      setSelectionRange: (from, to) => v.dispatch({ selection: { anchor: clamp(from), head: clamp(to) }, scrollIntoView: true }),
      focus: () => v.focus(),
      caretBox() {
        const c = v.coordsAtPos(v.state.selection.main.head)
        const r = v.contentDOM.getBoundingClientRect()
        return c ? { top: c.top, left: c.left, height: c.bottom - c.top } : { top: r.top, left: r.left, height: 24 }
      },
    }
    // Clicked on the page: the block stays where it was on screen, and the caret goes where the click
    // was. At the end of the line first, where the marks are out of the way, so nothing moves.
    const { start } = now.current
    if (start) {
      const line = v.state.doc.line(Math.min(start.line + 1, v.state.doc.lines))
      const scroller = box.current!.closest('.wiki-main')?.getBoundingClientRect().top ?? 0
      v.dispatch({ selection: EditorSelection.cursor(line.to), effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: start.top - scroller }) })
      // Once the editor has measured its lines.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (view.current !== v) return
          // A short page can't scroll to keep it in place, so this goes by where the line is now.
          const at = v.posAtCoords({ x: start.x, y: (v.coordsAtPos(line.from)?.top ?? start.top) + start.y })
          if (at !== null) v.dispatch({ selection: EditorSelection.cursor(at) })
        }),
      )
    }
    v.focus()
    return () => {
      now.current.surface.current = null
      view.current = null
      v.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A change from elsewhere: a friend's, or a tool of the page's own (Ctrl B, the / menu).
  useEffect(() => {
    const v = view.current
    if (!v || value === known.current) return
    known.current = value
    const was = v.state.doc.toString()
    if (was === value) return
    const most = Math.min(was.length, value.length)
    let a = 0
    while (a < most && was[a] === value[a]) a++
    let z = 0
    while (z < most - a && was[was.length - 1 - z] === value[value.length - 1 - z]) z++
    v.dispatch({ changes: { from: a, to: was.length - z, insert: value.slice(a, value.length - z) } })
  }, [value])

  useEffect(() => {
    const el = view.current?.contentDOM
    if (!el) return
    if (picker) {
      el.setAttribute('aria-controls', picker.list)
      el.setAttribute('aria-activedescendant', picker.option)
    } else {
      el.removeAttribute('aria-controls')
      el.removeAttribute('aria-activedescendant')
    }
  }, [picker?.list, picker?.option])

  // Drawn blocks change height once React has filled them.
  useEffect(() => view.current?.requestMeasure(), [slots])

  return (
    <div ref={box} className="live-text">
      {[...slots].map(([el, block]) =>
        createPortal(<Markdown blocks={[block]} actions={actions} />, el),
      )}
    </div>
  )
}
