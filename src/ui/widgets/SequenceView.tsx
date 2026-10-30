import { type KeyboardEvent, useContext, useEffect, useRef, useState } from 'react'
import * as SQ from '../../model/sequence'
import type { Item, SequenceData, SequenceStep } from '../../model/types'
import { EditorContext } from '../useEditor'

type Style = SequenceStep['style']

/** Where the keyboard is in a diagram being written: a step (or the next one, at the end) and its arrow. */
interface Cursor {
  row: number
  from: string
  to: string
  style: Style
  /** Tab picked the style: moving the arrow keeps it. */
  styleChosen: boolean
  text: string
  /** Naming a new lane (the arrow points past the last one), or renaming the lane it points at. */
  naming: 'new' | 'rename' | null
}

const NEW = '#new'

/** Words over an arrow or in a box, one line, cut short with … when too long. */
function Label({ x, y, w, h, text, className = '' }: { x: number; y: number; w: number; h: number; text: string; className?: string }) {
  return (
    <foreignObject x={x} y={y} width={Math.max(1, w)} height={h}>
      <div className={`seq-label ${className}`}>{text}</div>
    </foreignObject>
  )
}

function Arrowhead({ x, y, dir, open }: { x: number; y: number; dir: 1 | -1; open: boolean }) {
  const d = `M${x - dir * 11} ${y - 6} L${x} ${y} L${x - dir * 11} ${y + 6}`
  return open ? <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" /> : <path d={`${d} Z`} strokeWidth={1.5} strokeLinejoin="round" className="seq-fill" />
}

/** One message: a line between lanes (or a loop back to the same one), its arrowhead and its words. */
function Step({ x, y, data, step, k, ghost = false }: { x: number; y: number; data: SequenceData; step: Pick<SequenceStep, 'from' | 'to' | 'style' | 'text'>; k: number; ghost?: boolean }) {
  const a = SQ.laneIndex(data, step.from)
  const b = step.to === NEW ? data.lanes.length : SQ.laneIndex(data, step.to)
  if (a < 0 || b < 0) return null
  const x1 = x + SQ.laneX(a)
  const x2 = x + SQ.laneX(b)
  const label = `${data.numbered && !ghost ? `${k + 1}. ` : ''}${step.text}`
  const dashed = step.style === 'reply' ? '7 5' : undefined
  const open = !!step.style
  const cls = `seq-step${ghost ? ' ghost' : ''}`
  if (a === b) {
    return (
      <g className={cls}>
        <path d={`M${x1} ${y - 12} h 46 v 24 h -44`} fill="none" strokeWidth={2} strokeDasharray={dashed} />
        <Arrowhead x={x1 + 2} y={y + 12} dir={-1} open={open} />
        {!ghost && <Label x={x1 + 54} y={y - 12} w={SQ.LANE_W - 70} h={24} text={label} className="left" />}
      </g>
    )
  }
  const dir = x2 > x1 ? 1 : -1
  return (
    <g className={cls}>
      <line x1={x1} y1={y} x2={x2 - dir * 2} y2={y} strokeWidth={2} strokeDasharray={dashed} />
      <Arrowhead x={x2 - dir * 2} y={y} dir={dir} open={open} />
      {!ghost && <Label x={Math.min(x1, x2) + 8} y={y - 27} w={Math.abs(x2 - x1) - 16} h={24} text={label} />}
    </g>
  )
}

/**
 * A sequence diagram on the board: lanes with their names in boxes and dashed lines down, and
 * messages as arrows, top to bottom. While it's being written (Enter, double-click, or just typing
 * on it) a box under the last message takes the next one, all from the keyboard.
 */
export function SequenceView({ item, composing }: { item: Item; composing: boolean }) {
  const d = item.sequence!
  const { x, y, h } = item
  const bottom = y + h - SQ.FOOT / 2
  return (
    <g className={`sequence${item.sketch ? ' hand' : ''}`}>
      {/* Clickable all over, like any object. */}
      <rect x={x} y={y} width={item.w} height={h} className={`seq-area${composing ? ' composing' : ''}`} rx={10} />
      {item.text && <Label x={x + 8} y={y + 6} w={item.w - 16} h={28} text={item.text} className="left seq-title" />}
      {d.lanes.map((l, k) => {
        const cx = x + SQ.laneX(k)
        const bw = SQ.LANE_W - 36
        return (
          <g key={l.id} className="seq-lane">
            <line x1={cx} y1={y + SQ.TOP + SQ.HEAD_H - 8} x2={cx} y2={bottom} className="seq-life" strokeDasharray="6 6" />
            <rect x={cx - bw / 2} y={y + SQ.TOP} width={bw} height={SQ.HEAD_H - 8} rx={l.actor ? 20 : 8} className="seq-head" />
            <Label x={cx - bw / 2 + 6} y={y + SQ.TOP + 4} w={bw - 12} h={SQ.HEAD_H - 16} text={`${l.actor ? '👤 ' : ''}${l.name}`} className="seq-name" />
          </g>
        )
      })}
      {d.steps.map((s, k) => (
        <Step key={s.id} x={x} y={y + SQ.rowY(k)} data={d} step={s} k={k} />
      ))}
      {composing && <Composer item={item} />}
    </g>
  )
}

function Composer({ item }: { item: Item }) {
  const editor = useContext(EditorContext)!
  const d = item.sequence!
  const input = useRef<HTMLInputElement>(null)
  const draft = useRef<Cursor | null>(null)
  const [c, setC] = useState<Cursor>(() => ({ row: d.steps.length, ...fresh(d), text: editor.composing?.seed ?? '' }))
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [c.row, c.naming])

  const lanes = d.lanes.map((l) => l.id)
  const update = (f: (s: SequenceData) => SequenceData, title?: string) => editor.updateSequence(item.id, f, title)
  const isNew = c.row >= d.steps.length
  // A peer may have changed the diagram: the cursor stays on something that's there.
  const from = lanes.includes(c.from) ? c.from : (lanes[0] ?? '')
  const to = c.to === NEW || lanes.includes(c.to) ? c.to : (lanes[1] ?? lanes[0] ?? '')

  /** The cursor for step `row` (its own arrow and words), or for the next step after the end. */
  const at = (row: number, data = d): Cursor => {
    const s = data.steps[row]
    // The next step: what was being written there, or (with nothing written) a fresh suggestion.
    if (!s) return draft.current?.text && row >= data.steps.length ? { ...draft.current, row: data.steps.length } : { row: data.steps.length, ...fresh(data), text: '' }
    return { row, from: s.from, to: s.to, style: s.style, styleChosen: true, text: s.text, naming: null }
  }
  /** Keeps what was typed in an earlier step; the next step's words wait in the draft. */
  const leave = () => {
    if (isNew) {
      draft.current = c
      return
    }
    const s = d.steps[c.row]
    if (s && (s.text !== c.text || s.from !== from || s.to !== to || s.style !== c.style) && to !== NEW)
      update((data) => SQ.updateStep(data, s.id, (x) => ({ ...x, from, to, text: c.text, ...(c.style ? { style: c.style } : { style: undefined }) })))
  }
  const go = (row: number) => {
    leave()
    setC(at(Math.max(0, Math.min(row, d.steps.length))))
  }
  const point = (dir: -1 | 1, which: 'from' | 'to') => {
    if (which === 'from') {
      const k = Math.max(0, Math.min(lanes.length - 1, lanes.indexOf(from) + dir))
      return setC({ ...c, from: lanes[k] })
    }
    // One past the last lane is a new one, to name.
    const k = Math.max(0, Math.min(lanes.length, (to === NEW ? lanes.length : lanes.indexOf(to)) + dir))
    const next = k === lanes.length ? NEW : lanes[k]
    setC({ ...c, to: next, naming: next === NEW ? 'new' : null, ...(c.styleChosen ? {} : { style: undefined }), text: next === NEW || c.naming ? '' : c.text })
  }

  const enter = () => {
    if (c.naming === 'new') {
      let id = ''
      update((data) => {
        const made = SQ.addLane(data, c.text)
        id = made.id
        return made.data
      })
      return setC({ ...(draft.current ?? c), to: id, naming: null, text: draft.current?.text ?? '' })
    }
    if (c.naming === 'rename') {
      const lane = d.lanes.find((l) => l.id === to)
      if (lane && !c.text.trim()) {
        const used = d.steps.filter((s) => s.from === lane.id || s.to === lane.id).length
        if (!used || window.confirm(`Take ${lane.name || 'this lane'} out, with its ${used} message${used === 1 ? '' : 's'}?`)) update((data) => SQ.removeLane(data, lane.id))
      } else if (lane) update((data) => SQ.renameLane(data, lane.id, c.text.trim()))
      return setC({ ...(draft.current ?? at(c.row)), naming: null })
    }
    if (to === NEW || !from) return
    if (isNew) {
      let next = d
      update((data) => {
        next = SQ.addStep(data, { from, to, text: c.text.trim(), ...(c.style ? { style: c.style } : {}) }).data
        return next
      })
      draft.current = null
      return setC({ row: next.steps.length, ...fresh(next), text: '' })
    }
    go(c.row + 1)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const k = e.key
    let handled = true
    if (k === 'Enter') enter()
    else if (k === 'Escape') {
      if (c.naming) setC({ ...(draft.current ?? at(c.row)), naming: null })
      else {
        leave()
        editor.stopComposing()
      }
    } else if (k === 'Tab' && !c.naming) {
      const i = SQ.STYLES.indexOf(c.style)
      const n = SQ.STYLES.length
      setC({ ...c, style: SQ.STYLES[(i + (e.shiftKey ? n - 1 : 1)) % n], styleChosen: true })
    } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.altKey && !c.naming) {
      if (to !== NEW) update((data) => SQ.moveLane(data, to, k === 'ArrowLeft' ? -1 : 1))
    } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && (!c.text || e.shiftKey || c.naming === 'new') && c.naming !== 'rename') {
      // With words typed, plain arrows move the caret; Shift moves who sends it.
      point(k === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 'from' : 'to')
    } else if ((k === 'ArrowUp' || k === 'ArrowDown') && e.altKey && !isNew) {
      const s = d.steps[c.row]
      const by = k === 'ArrowUp' ? -1 : 1
      leave()
      update((data) => SQ.moveStep(data, s.id, by))
      setC({ ...c, row: Math.max(0, Math.min(d.steps.length - 1, c.row + by)) })
    } else if ((k === 'ArrowUp' || k === 'ArrowDown') && !c.naming) go(c.row + (k === 'ArrowUp' ? -1 : 1))
    else if (k === 'F2' && to !== NEW) {
      if (isNew) draft.current = c
      setC({ ...c, naming: 'rename', text: d.lanes.find((l) => l.id === to)?.name ?? '' })
    } else if (k === 'Backspace' && !c.text && !isNew && !c.naming) {
      const s = d.steps[c.row]
      update((data) => SQ.removeStep(data, s.id))
      setC(at(Math.max(0, c.row - 1), SQ.removeStep(d, s.id)))
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z' && !c.text) {
      if (e.shiftKey) editor.redo()
      else editor.undo()
    } else handled = false
    // Everything typed here stays here (the board's own keys wait until Esc).
    e.stopPropagation()
    if (handled) e.preventDefault()
  }

  // The arrow being written: under the step it changes, or below the last.
  const rowY = item.y + SQ.rowY(c.row)
  const a = Math.max(0, lanes.indexOf(from))
  const b = to === NEW ? lanes.length : Math.max(0, lanes.indexOf(to))
  const left = item.x + SQ.laneX(Math.min(a, b))
  const span = Math.max(SQ.LANE_W * 1.1, Math.abs(b - a) * SQ.LANE_W - 16)
  const boxX = a === b ? left + 54 : left + (Math.abs(b - a) * SQ.LANE_W - span) / 2
  const placeholder =
    c.naming === 'new' ? 'Who is this? Type a name, Enter' : c.naming === 'rename' ? 'New name (empty takes it out), Enter' : `${SQ.styleLabel(c.style)}: what’s sent? Enter ${isNew ? 'adds it' : 'saves'}`
  return (
    <g className="seq-composer">
      {!isNew && <rect x={item.x + 4} y={rowY - SQ.ROW_H * 0.6} width={item.w - 8} height={SQ.ROW_H} rx={8} className="seq-row-on" />}
      {to === NEW && (
        <g className="seq-new-lane">
          <rect x={item.x + SQ.laneX(lanes.length) - (SQ.LANE_W - 36) / 2} y={item.y + SQ.TOP} width={SQ.LANE_W - 36} height={SQ.HEAD_H - 8} rx={8} />
          <Label x={item.x + SQ.laneX(lanes.length) - 70} y={item.y + SQ.TOP + 4} w={140} h={SQ.HEAD_H - 16} text={c.text || 'New lane'} className="seq-name" />
        </g>
      )}
      {c.naming === 'rename' && b < lanes.length && (
        <rect x={item.x + SQ.laneX(b) - (SQ.LANE_W - 28) / 2} y={item.y + SQ.TOP - 4} width={SQ.LANE_W - 28} height={SQ.HEAD_H} rx={10} className="seq-rename" />
      )}
      {!c.naming && <Step x={item.x} y={rowY} data={d} step={{ from, to, style: c.style, text: '' }} k={c.row} ghost />}
      <foreignObject x={boxX} y={rowY - 30} width={span} height={28}>
        <input
          ref={input}
          className="seq-input no-canvas"
          value={c.text}
          aria-label={placeholder}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setC({ ...c, text: e.target.value })}
          onKeyDown={onKey}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            // Clicking elsewhere puts the pen down (what was typed in an earlier step is kept).
            if (e.relatedTarget && (e.currentTarget.closest('.sequence')?.contains(e.relatedTarget as Node) ?? false)) return
            leave()
            editor.stopComposing()
          }}
        />
      </foreignObject>
    </g>
  )
}

/** The next step's arrow, as suggested from what came before. */
function fresh(d: SequenceData): Omit<Cursor, 'row' | 'text'> {
  const n = SQ.nextStep(d)
  return { from: n.from, to: n.to, style: n.style, styleChosen: false, naming: null }
}
