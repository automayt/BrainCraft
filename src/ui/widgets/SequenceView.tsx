import { type KeyboardEvent, type PointerEvent, useContext, useEffect, useRef, useState } from 'react'
import * as SQ from '../../model/sequence'
import { FILLS, type Item, type SequenceBoxKind, type SequenceData, type SequenceStep, TEXT_ON_FILL } from '../../model/types'
import { EditorContext } from '../useEditor'

type Style = SequenceStep['style']

/** Where the keyboard is in a diagram being written: a step (or the next one, at the end) and its arrow. */
interface Cursor {
  row: number
  /** With Shift ↑ ↓: the other end of a run of steps (for a box around them). */
  anchor: number | null
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
const NOTE_FILL = FILLS[0][1]

/** The slash commands, typed into the message box. */
export const COMMANDS: { name: string; does: string }[] = [
  ...SQ.BOX_KINDS.map((k) => ({ name: k, does: `A ${k} box around the message (Shift ↑ ↓ for several); words after it label it` })),
  { name: 'else', does: 'A divider above this message, in an alt, par or critical box' },
  { name: 'unbox', does: 'Takes away the box around this message' },
  { name: 'unelse', does: 'Takes away the divider above this message' },
  { name: 'note', does: 'A note over the lanes the arrow spans' },
  { name: 'actor', does: 'Draws the lane the arrow points at as a person' },
  { name: 'number', does: 'Numbers the messages (again: not)' },
]

/** Words over an arrow or in a box, one line, cut short with … when too long. */
function Label({ x, y, w, h, text, className = '', color }: { x: number; y: number; w: number; h: number; text: string; className?: string; color?: string }) {
  return (
    <foreignObject x={x} y={y} width={Math.max(1, w)} height={h}>
      <div className={`seq-label ${className}`} style={color ? { color } : undefined}>
        {text}
      </div>
    </foreignObject>
  )
}

function Arrowhead({ x, y, dir, open }: { x: number; y: number; dir: 1 | -1; open: boolean }) {
  const d = `M${x - dir * 11} ${y - 6} L${x} ${y} L${x - dir * 11} ${y + 6}`
  return open ? <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" /> : <path d={`${d} Z`} strokeWidth={1.5} strokeLinejoin="round" className="seq-fill" />
}

/** Where a note over lanes `a` to `b` goes, across. */
const noteSpan = (x: number, a: number, b: number) => {
  const [l, r] = a <= b ? [a, b] : [b, a]
  return { x1: x + SQ.laneX(l) - 76, x2: x + SQ.laneX(r) + 76 }
}

/** One message: a line between lanes (or a loop back to the same one), its arrowhead and its words; or a note. */
function Step({ x, y, data, step, k, ghost = false }: { x: number; y: number; data: SequenceData; step: Pick<SequenceStep, 'from' | 'to' | 'style' | 'text'>; k: number; ghost?: boolean }) {
  const a = SQ.laneIndex(data, step.from)
  const b = step.to === NEW ? data.lanes.length : SQ.laneIndex(data, step.to)
  if (a < 0 || b < 0) return null
  const cls = `seq-step${ghost ? ' ghost' : ''}`
  if (SQ.isNote(step)) {
    const { x1, x2 } = noteSpan(x, a, b)
    return (
      <g className={cls}>
        <rect x={x1} y={y - 19} width={x2 - x1} height={38} rx={4} className="seq-note" style={ghost ? undefined : { fill: NOTE_FILL }} />
        {!ghost && <Label x={x1 + 8} y={y - 12} w={x2 - x1 - 16} h={24} text={step.text} color={TEXT_ON_FILL} />}
      </g>
    )
  }
  const x1 = x + SQ.laneX(a)
  const x2 = x + SQ.laneX(b)
  const number = data.numbered && !ghost ? `${data.steps.slice(0, k + 1).filter((s) => !SQ.isNote(s)).length}. ` : ''
  const label = `${number}${step.text}`
  const dashed = step.style === 'reply' ? '7 5' : undefined
  const open = !!step.style
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

/** A box's left and right edges: around the lanes its messages touch, a little narrower for each box it's in. */
function boxEdges(item: Item, b: { a: number; z: number; depth: number }) {
  const inset = Math.min(40, b.depth * 10)
  return { x1: Math.max(item.x + 4, item.x + SQ.laneX(b.a) - 84 + inset), x2: Math.min(item.x + item.w - 4, item.x + SQ.laneX(b.z) + 84 - inset) }
}

/**
 * A sequence diagram on the board: lanes with their names in boxes and dashed lines down, messages
 * as arrows top to bottom, notes, boxes around runs of messages, and bars where a lane is busy
 * answering a call. While it's being written (Enter, double-click, or just typing on it) a box
 * under the last message takes the next one, all from the keyboard.
 */
export function SequenceView({ item, composing }: { item: Item; composing: boolean }) {
  const d = item.sequence!
  const { x, y, h } = item
  const layout = SQ.sequenceLayout(d)
  const bottom = y + h - SQ.FOOT / 2
  return (
    <g className={`sequence${item.sketch ? ' hand' : ''}`}>
      {/* Clickable all over, like any object. */}
      <rect x={x} y={y} width={item.w} height={h} className={`seq-area${composing ? ' composing' : ''}`} rx={10} />
      {item.text && <Label x={x + 8} y={y + 6} w={item.w - 16} h={28} text={item.text} className="left seq-title" />}
      {(d.boxes ?? []).map((b) => {
        const at = layout.boxes.get(b.id)
        if (!at) return null
        const { x1, x2 } = boxEdges(item, at)
        const top = y + at.top
        const tagW = 14 + b.kind.length * 8
        return (
          <g key={b.id} className="seq-box">
            <rect x={x1} y={top} width={x2 - x1} height={at.bottom - at.top} rx={4} />
            <path d={`M${x1} ${top} h ${tagW} v 14 l -7 8 h ${-(tagW - 7)} Z`} className="seq-tag" />
            <Label x={x1 + 4} y={top} w={tagW - 8} h={22} text={b.kind} className="left seq-tag-text" />
            {b.label && <Label x={x1 + tagW + 8} y={top} w={x2 - x1 - tagW - 16} h={22} text={`[${b.label}]`} className="left seq-cond" />}
          </g>
        )
      })}
      {layout.elses.map((e, k) => {
        const at = layout.boxes.get(e.box)
        if (!at) return null
        const { x1, x2 } = boxEdges(item, at)
        return (
          <g key={k} className="seq-box">
            <line x1={x1} y1={y + e.y + 2} x2={x2} y2={y + e.y + 2} strokeDasharray="6 4" />
            {e.label && <Label x={x1 + 8} y={y + e.y + 3} w={x2 - x1 - 16} h={22} text={`[${e.label}]`} className="left seq-cond" />}
          </g>
        )
      })}
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
      {SQ.activations(d).map((a, k) => {
        const lane = SQ.laneIndex(d, a.lane)
        if (lane < 0) return null
        return <rect key={k} x={x + SQ.laneX(lane) - 5 + a.depth * 5} y={y + layout.rows[a.from]} width={10} height={layout.rows[a.to] - layout.rows[a.from]} className="seq-busy" />
      })}
      {d.steps.map((s, k) => (
        <Step key={s.id} x={x} y={y + layout.rows[k]} data={d} step={s} k={k} />
      ))}
      {composing && <Composer item={item} />}
    </g>
  )
}

function Composer({ item }: { item: Item }) {
  const editor = useContext(EditorContext)!
  const d = item.sequence!
  const layout = SQ.sequenceLayout(d)
  const input = useRef<HTMLInputElement>(null)
  const draft = useRef<Cursor | null>(null)
  const [c, setC] = useState<Cursor>(() => ({ row: d.steps.length, anchor: null, ...fresh(d), text: editor.composing?.seed ?? '' }))
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [c.row, c.naming])

  const lanes = d.lanes.map((l) => l.id)
  const update = (f: (s: SequenceData) => SequenceData, title?: string) => editor.updateSequence(item.id, f, title)
  const row = Math.min(c.row, d.steps.length)
  const isNew = row >= d.steps.length
  // A peer may have changed the diagram: the cursor stays on something that's there.
  const from = lanes.includes(c.from) ? c.from : (lanes[0] ?? '')
  const to = c.to === NEW || lanes.includes(c.to) ? c.to : (lanes[1] ?? lanes[0] ?? '')
  const range = c.anchor === null ? null : ([Math.min(c.anchor, row), Math.max(c.anchor, row)] as const)
  const command = c.text.startsWith('/') && !c.naming ? c.text.slice(1).split(/\s/)[0].toLowerCase() : null

  /** The cursor for step `r` (its own arrow and words), or for the next step after the end. */
  const at = (r: number, data = d): Cursor => {
    const s = data.steps[r]
    // The next step: what was being written there, or (with nothing written) a fresh suggestion.
    if (!s) return draft.current?.text ? { ...draft.current, row: data.steps.length, anchor: null } : { row: data.steps.length, anchor: null, ...fresh(data), text: '' }
    return { row: r, anchor: null, from: s.from, to: s.to, style: s.style, styleChosen: true, text: s.text, naming: null }
  }
  /** Keeps what was typed in an earlier step; the next step's words wait in the draft. */
  const leave = () => {
    if (isNew) {
      draft.current = c
      return
    }
    const s = d.steps[row]
    if (s && !command && (s.text !== c.text || s.from !== from || s.to !== to || s.style !== c.style) && to !== NEW)
      update((data) => SQ.updateStep(data, s.id, (x) => ({ id: x.id, from, to, text: c.text, ...(c.style ? { style: c.style } : {}) })))
  }
  const go = (r: number, extend = false) => {
    const target = Math.max(0, Math.min(r, d.steps.length))
    if (extend) {
      // A run of steps for a box: from where Shift was first held to here (steps only, not the next one).
      const last = d.steps.length - 1
      if (last < 0) return
      return setC({ ...c, anchor: c.anchor ?? Math.min(row, last), row: Math.min(target, last) })
    }
    leave()
    setC(at(target))
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
  /** Clicking a lane's box: the arrow goes to it (with Shift, comes from it). */
  const pickLane = (id: string, shift: boolean) => setC(shift ? { ...c, from: id } : { ...c, to: id, naming: null, ...(c.styleChosen ? {} : { style: undefined }) })

  /** A slash command, typed into the box. False when it isn't one. */
  const run = (cmd: string, rest: string): boolean => {
    const steps = d.steps
    const here = range ?? ([Math.min(row, steps.length - 1), Math.min(row, steps.length - 1)] as const)
    const say = (m: string) => editor.setStatus(m)
    if ((SQ.BOX_KINDS as string[]).includes(cmd)) {
      if (!steps.length) return (say('Write a message first, then put a box around it'), true)
      const kind = cmd as SequenceBoxKind
      const there = SQ.boxOver(d, here[0], here[1])
      if (!there && SQ.crossesBox(d, here[0], here[1])) return (say('Boxes go inside each other, not across: pick messages all inside the other box, or all of it'), true)
      if (there) update((data) => SQ.updateBox(data, there.id, (b) => ({ ...b, kind, label: rest })))
      else update((data) => SQ.addBox(data, kind, rest, here[0], here[1]).data)
      return true
    }
    if (cmd === 'else' || cmd === 'and' || cmd === 'option') {
      const box = isNew ? undefined : SQ.boxesAround(d, row).find((b) => SQ.canDivide(b.kind) && b.first !== steps[row].id)
      if (!box) return (say('Go to a message inside an alt, par or critical box (not its first) to divide it there'), true)
      update((data) => SQ.setDivider(data, box.id, steps[row].id, rest))
      return true
    }
    if (cmd === 'unelse') {
      const box = isNew ? undefined : SQ.boxesAround(d, row).find((b) => b.elses?.some((e) => e.before === steps[row].id))
      if (box) update((data) => SQ.setDivider(data, box.id, steps[row].id, null))
      return true
    }
    if (cmd === 'unbox') {
      const box = steps.length ? SQ.boxesAround(d, here[0])[0] : undefined
      if (box) update((data) => SQ.removeBox(data, box.id))
      else say('There’s no box around this message')
      return true
    }
    if (cmd === 'actor' && to !== NEW) {
      const lane = d.lanes.find((l) => l.id === to)
      if (lane) update((data) => SQ.setActor(data, lane.id, !lane.actor))
      return true
    }
    if (cmd === 'number') {
      update((data) => (data.numbered ? { ...data, numbered: undefined } : { ...data, numbered: true }))
      return true
    }
    if (cmd === 'note') {
      addOrSave({ style: 'note', text: rest })
      return true
    }
    say(`No /${cmd}: try ${COMMANDS.map((x) => `/${x.name}`).join(', ')}`)
    return true
  }

  /** Adds the next step (or saves this one) and moves on. */
  const addOrSave = (over: Partial<Pick<SequenceStep, 'style' | 'text'>> = {}) => {
    if (to === NEW || !from) return
    const style = 'style' in over ? over.style : c.style
    const text = (over.text ?? c.text).trim()
    if (isNew) {
      let next = d
      update((data) => {
        next = SQ.addStep(data, { from, to, text, ...(style ? { style } : {}) }).data
        return next
      })
      draft.current = null
      return setC({ row: next.steps.length, anchor: null, ...fresh(next), text: '' })
    }
    const s = d.steps[row]
    update((data) => SQ.updateStep(data, s.id, (x) => ({ id: x.id, from, to, text, ...(style ? { style } : {}) })))
    setC(at(row + 1))
  }

  const enter = () => {
    if (c.naming === 'new') {
      let id = ''
      update((data) => {
        const made = SQ.addLane(data, c.text)
        id = made.id
        return made.data
      })
      return setC({ ...(draft.current ?? c), anchor: null, to: id, naming: null, text: draft.current?.text ?? '' })
    }
    if (c.naming === 'rename') {
      const lane = d.lanes.find((l) => l.id === to)
      if (lane && !c.text.trim()) {
        const used = d.steps.filter((s) => s.from === lane.id || s.to === lane.id).length
        if (!used || window.confirm(`Take ${lane.name || 'this lane'} out, with its ${used} message${used === 1 ? '' : 's'}?`)) update((data) => SQ.removeLane(data, lane.id))
      } else if (lane) update((data) => SQ.renameLane(data, lane.id, c.text.trim()))
      return setC({ ...(draft.current ?? at(row)), naming: null })
    }
    if (command !== null) {
      run(command, c.text.slice(1 + command.length).trim())
      // The message keeps its own words; the command is used up.
      return setC({ ...(isNew ? { ...c, text: draft.current?.text ?? '' } : at(row)), anchor: null })
    }
    addOrSave()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const k = e.key
    let handled = true
    if (k === 'Enter') enter()
    else if (k === 'Escape') {
      if (c.naming) setC({ ...(draft.current ?? at(row)), naming: null })
      else if (c.anchor !== null) setC({ ...c, anchor: null })
      else if (command !== null) setC({ ...c, text: '' })
      else {
        leave()
        editor.stopComposing()
      }
    } else if (k === 'Tab' && command !== null) {
      // Finishes the command's name.
      const match = COMMANDS.find((x) => x.name.startsWith(command))
      if (match) setC({ ...c, text: `/${match.name} ` })
    } else if (k === 'Tab' && !c.naming) {
      const i = SQ.STYLES.indexOf(c.style)
      const n = SQ.STYLES.length
      setC({ ...c, style: SQ.STYLES[(i + (e.shiftKey ? n - 1 : 1)) % n], styleChosen: true })
    } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.altKey && !c.naming) {
      if (to !== NEW) update((data) => SQ.moveLane(data, to, k === 'ArrowLeft' ? -1 : 1))
    } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && (!c.text || e.shiftKey || c.naming === 'new') && c.naming !== 'rename' && command === null) {
      // With words typed, plain arrows move the caret; Shift moves who sends it.
      point(k === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 'from' : 'to')
    } else if ((k === 'ArrowUp' || k === 'ArrowDown') && e.altKey && !isNew) {
      const s = d.steps[row]
      const by = k === 'ArrowUp' ? -1 : 1
      leave()
      update((data) => SQ.moveStep(data, s.id, by))
      setC({ ...c, row: Math.max(0, Math.min(d.steps.length - 1, row + by)), anchor: null })
    } else if ((k === 'ArrowUp' || k === 'ArrowDown') && !c.naming) go(row + (k === 'ArrowUp' ? -1 : 1), e.shiftKey)
    else if (k === 'F2' && to !== NEW) {
      if (isNew) draft.current = c
      setC({ ...c, naming: 'rename', text: d.lanes.find((l) => l.id === to)?.name ?? '' })
    } else if (k === 'Backspace' && !c.text && !isNew && !c.naming) {
      const s = d.steps[row]
      update((data) => SQ.removeStep(data, s.id))
      setC(at(Math.max(0, row - 1), SQ.removeStep(d, s.id)))
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z' && !c.text) {
      if (e.shiftKey) editor.redo()
      else editor.undo()
    } else handled = false
    // Everything typed here stays here (the board's own keys wait until Esc).
    e.stopPropagation()
    if (handled) e.preventDefault()
  }

  // Clicks inside the diagram while writing: lanes pick the arrow's ends, rows go to a message.
  const keep = (e: PointerEvent, f: () => void) => {
    e.stopPropagation()
    e.preventDefault()
    f()
  }

  // The arrow being written: on the step it changes, or below the last.
  const rowY = item.y + layout.rows[row]
  const a = Math.max(0, lanes.indexOf(from))
  const b = to === NEW ? lanes.length : Math.max(0, lanes.indexOf(to))
  const note = c.style === 'note'
  const left = item.x + SQ.laneX(Math.min(a, b))
  const span = Math.max(SQ.LANE_W * 1.1, Math.abs(b - a) * SQ.LANE_W - 16)
  const boxX = a === b && !note ? left + 54 : left + (Math.abs(b - a) * SQ.LANE_W - span) / 2
  const boxY = note ? rowY - 14 : rowY - 30
  const placeholder =
    c.naming === 'new'
      ? 'Who is this? Type a name, Enter'
      : c.naming === 'rename'
        ? 'New name (empty takes it out), Enter'
        : range
          ? `${range[1] - range[0] + 1} messages: /loop, /alt, /opt… to box them`
          : `${SQ.styleLabel(c.style)}: what’s ${note ? 'noted' : 'sent'}? Enter ${isNew ? 'adds it' : 'saves'} · / for boxes`
  const shown = command !== null ? COMMANDS.filter((x) => x.name.startsWith(command)) : []
  return (
    <g className="seq-composer">
      {/* Rows to click (Shift: a run of them), under everything else. */}
      {layout.rows.map((ry, r) => (
        <rect key={r} x={item.x} y={item.y + ry - SQ.ROW_H * 0.6} width={item.w} height={SQ.ROW_H} className="seq-hit" onPointerDown={(e) => keep(e, () => go(r, e.shiftKey && r < d.steps.length))} />
      ))}
      {range && (
        <rect
          x={item.x + 4}
          y={item.y + layout.rows[range[0]] - SQ.ROW_H * 0.6}
          width={item.w - 8}
          height={layout.rows[range[1]] - layout.rows[range[0]] + SQ.ROW_H}
          rx={8}
          className="seq-row-on"
        />
      )}
      {!isNew && !range && <rect x={item.x + 4} y={rowY - SQ.ROW_H * 0.6} width={item.w - 8} height={SQ.ROW_H} rx={8} className="seq-row-on" />}
      {d.lanes.map((l, k) => (
        <rect
          key={l.id}
          x={item.x + SQ.laneX(k) - (SQ.LANE_W - 36) / 2}
          y={item.y + SQ.TOP}
          width={SQ.LANE_W - 36}
          height={SQ.HEAD_H - 8}
          rx={8}
          className={`seq-pick${l.id === to ? ' to' : ''}${l.id === from ? ' from' : ''}`}
          onPointerDown={(e) => keep(e, () => pickLane(l.id, e.shiftKey))}
        >
          <title>{`Click: send to ${l.name} · Shift-click: send from ${l.name}`}</title>
        </rect>
      ))}
      {to === NEW && (
        <g className="seq-new-lane">
          <rect x={item.x + SQ.laneX(lanes.length) - (SQ.LANE_W - 36) / 2} y={item.y + SQ.TOP} width={SQ.LANE_W - 36} height={SQ.HEAD_H - 8} rx={8} />
          <Label x={item.x + SQ.laneX(lanes.length) - 70} y={item.y + SQ.TOP + 4} w={140} h={SQ.HEAD_H - 16} text={c.text || 'New lane'} className="seq-name" />
        </g>
      )}
      {c.naming === 'rename' && b < lanes.length && (
        <rect x={item.x + SQ.laneX(b) - (SQ.LANE_W - 28) / 2} y={item.y + SQ.TOP - 4} width={SQ.LANE_W - 28} height={SQ.HEAD_H} rx={10} className="seq-rename" />
      )}
      {!c.naming && !range && <Step x={item.x} y={rowY} data={d} step={{ from, to, style: c.style, text: '' }} k={row} ghost />}
      <foreignObject x={boxX} y={range ? item.y + layout.rows[range[1]] - 30 : boxY} width={span} height={28 + (shown.length ? 8 + shown.length * 22 : 0)}>
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
        {shown.length > 0 && (
          <div className="seq-commands no-canvas" role="listbox" aria-label="Commands">
            {shown.map((x, k) => (
              <div key={x.name} role="option" aria-selected={k === 0} className={k === 0 ? 'on' : ''}>
                <b>/{x.name}</b> <span>{x.does}</span>
              </div>
            ))}
          </div>
        )}
      </foreignObject>
    </g>
  )
}

/** The next step's arrow, as suggested from what came before. */
function fresh(d: SequenceData): Omit<Cursor, 'row' | 'text' | 'anchor'> {
  const n = SQ.nextStep(d)
  return { from: n.from, to: n.to, style: n.style, styleChosen: false, naming: null }
}
