import { useEffect, useMemo, useRef, useState } from 'react'
import { askOnce } from '../ai/once'
import { connectionFor, loadSettings, serverAi } from '../ai/settings'
import { type Plan, parseTopics, planByFrame, planByKind, TOPIC_SYSTEM, topicPrompt, topicUnits, unitsOf } from '../model/divide'
import { Dialog } from './Boards'
import { useEditor } from './useEditor'
import { useWorkspace } from './useWorkspace'

type Mode = 'frame' | 'kind' | 'topic'

const count = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

/**
 * "Divide into child boards": parts of a crowded board go to boards of their own, by frame, by kind
 * of object, or by topic (the assistant suggests them). Shows what each child board gets, to rename
 * or leave out, before anything moves.
 */
export function DivideDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  const ws = useWorkspace()
  // The board as it was when the dialog opened.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const units = useMemo(() => unitsOf(editor.board), [])
  const byFrame = useMemo(() => planByFrame(units), [units])
  const byKind = useMemo(() => planByKind(units), [units])
  const [mode, setMode] = useState<Mode>(byFrame.groups.length > 1 ? 'frame' : 'kind')
  const [topics, setTopics] = useState<Plan | null>(null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Per plan: titles as edited, and which groups are left out.
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [off, setOff] = useState<Set<string>>(new Set())
  const abort = useRef<AbortController | null>(null)

  const plan = mode === 'frame' ? byFrame : mode === 'kind' ? byKind : topics
  const slot = (k: number) => `${mode}:${k}`
  const chosen = plan ? plan.groups.flatMap((g, k) => (off.has(slot(k)) ? [] : [{ ...g, title: (titles[slot(k)] ?? g.title).trim() || g.title }])) : []
  const objects = (us: { ids: unknown[] }[]) => us.reduce((n, u) => n + u.ids.length, 0)
  const staying = plan ? objects(plan.stays) + plan.groups.reduce((n, g, k) => n + (off.has(slot(k)) ? objects(g.units) : 0), 0) : 0

  const ask = async () => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setAsking(true)
    setError('')
    try {
      const sent = topicUnits(units)
      const reply = await askOnce(ws.server, TOPIC_SYSTEM, topicPrompt(sent, editor.viewBoard, editor.board.title), ctl.signal)
      const found = parseTopics(reply, sent)
      if (!found) throw new Error('The assistant’s answer couldn’t be read. Try again.')
      setTopics(found)
      setOff(new Set([...off].filter((k) => !k.startsWith('topic:'))))
    } catch (err) {
      if (!ctl.signal.aborted) setError((err as Error).message)
    } finally {
      if (abort.current === ctl) setAsking(false)
    }
  }

  const choose = (m: Mode) => {
    setMode(m)
    setError('')
  }
  // Whether there's an assistant to ask, checked when the dialog opens.
  const [ai, setAi] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void serverAi(ws.server).then((s) => live && setAi(!!connectionFor(loadSettings(), ws.server, s)))
    return () => {
      live = false
    }
  }, [ws.server])

  const close = () => {
    abort.current?.abort()
    onClose()
  }

  const go = async () => {
    if (!chosen.length) return
    setBusy(true)
    const { made, cards, kept } = await ws.divideBoard(chosen)
    setBusy(false)
    if (!made) return setError(kept.length ? 'Everything changed while it was being moved, so it all stays here.' : 'No child boards were made.')
    onClose()
    // The cards for the new boards, in view.
    editor.select(cards)
    editor.zoomToFit()
    editor.setStatus(
      `Made ${count(made, 'child board')}. Each card here opens one; Undo brings the objects back (the new boards stay in Your boards).${kept.length ? ` ${kept.join(', ')} changed meanwhile, so ${kept.length === 1 ? 'it stays' : 'they stay'} here too.` : ''}`,
    )
  }

  const MODES: { id: Mode; label: string; hint: string; disabled?: string }[] = [
    { id: 'frame', label: 'By frame', hint: 'Each frame and what’s in it gets a board of its own.', disabled: byFrame.groups.length ? undefined : 'There are no frames with anything in them.' },
    { id: 'kind', label: 'By kind of object', hint: 'Flowcharts together, mind maps together, notes together…', disabled: byKind.groups.length ? undefined : 'There isn’t enough of any one kind.' },
    {
      id: 'topic',
      label: 'By topic, with AI',
      hint: 'The assistant reads the words on the board and suggests topics. Nothing moves until you say so.',
      disabled: ai === false ? 'Set up the assistant first (Ask AI, Ctrl J).' : undefined,
    },
  ]

  return (
    <Dialog label="Divide into child boards" onClose={close} className="divide-board">
      <header>
        <h2>Divide into child boards</h2>
        <button className="icon-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </header>
      <div className="divide-body">
        <p className="muted">
          Parts of this board move to boards of their own. A card here opens each one, and each has a way back. {count(editor.board.items.length, 'object')} on this board now.
        </p>
        <div className="divide-modes" role="radiogroup" aria-label="How to divide">
          {MODES.map((m) => (
            <label key={m.id} className={`divide-mode${mode === m.id ? ' on' : ''}${m.disabled ? ' disabled' : ''}`}>
              <input type="radio" name="divide-mode" checked={mode === m.id} disabled={!!m.disabled || busy} onChange={() => choose(m.id)} />
              <span>
                <strong>{m.label}</strong>
                <small>{m.disabled ?? m.hint}</small>
              </span>
            </label>
          ))}
        </div>
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
        {mode === 'topic' && !topics && (
          <p className="divide-ask">
            <button className="primary" disabled={asking} onClick={() => void ask()}>
              {asking ? 'Asking the assistant…' : 'Suggest topics'}
            </button>
            <small className="muted">Sends the words on this board to the assistant.</small>
          </p>
        )}
        {plan && (
          <>
            <ul className="divide-list">
              {plan.groups.map((g, k) => {
                const id = slot(k)
                const on = !off.has(id)
                const sample = g.units
                  .map((u) => u.title)
                  .filter((t) => t && t !== g.title)
                  .slice(0, 4)
                return (
                  <li key={id} className={on ? '' : 'off'}>
                    <input
                      type="checkbox"
                      checked={on}
                      aria-label={`Make a child board of ${titles[id] ?? g.title}`}
                      onChange={() => {
                        const next = new Set(off)
                        if (on) next.add(id)
                        else next.delete(id)
                        setOff(next)
                      }}
                    />
                    <span className="divide-what">
                      <input aria-label={`Name for the child board of ${g.title}`} value={titles[id] ?? g.title} disabled={!on} onChange={(e) => setTitles({ ...titles, [id]: e.target.value })} />
                      <small className="muted">
                        {count(objects(g.units), 'object')}
                        {sample.length ? `: ${sample.join(', ')}${g.units.length > sample.length ? '…' : ''}` : ''}
                      </small>
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="muted">{staying ? `${count(staying, 'object')} stay on this board.` : 'Nothing else stays: this board becomes the cards that open each part.'}</p>
          </>
        )}
      </div>
      <footer className="check-foot divide-foot">
        {mode === 'topic' && topics && (
          <button disabled={asking || busy} onClick={() => void ask()}>
            Suggest again
          </button>
        )}
        <button onClick={close}>Cancel</button>
        <button className="primary" disabled={!chosen.length || busy || asking} onClick={() => void go()}>
          {busy ? 'Making boards…' : chosen.length ? `Make ${count(chosen.length, 'child board')}` : 'Make child boards'}
        </button>
      </footer>
    </Dialog>
  )
}
