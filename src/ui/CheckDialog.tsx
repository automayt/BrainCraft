/**
 * Check board: what makes the board look messy or hard to follow (objects on top of each other,
 * empty notes, strays far from everything, flowcharts that don't flow, several ideas in one), each
 * with Go to and, where it's safe, a one-click fix. See model/boardCheck.ts.
 */

import { useRef } from 'react'
import { checkBoard } from '../model/boardCheck'
import { useDialog } from './useDialog'
import { useEditor } from './useEditor'
import { useEscape } from './useEscape'

export function CheckDialog({ onClose }: { onClose: () => void }) {
  useEscape(onClose)
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  const editor = useEditor()
  // Checked again on every change, so a fix (or an undo) shows at once.
  const problems = checkBoard(editor.board)
  const fixable = problems.filter((p) => p.fix).length
  const ro = editor.readOnly

  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal check-board" role="dialog" aria-modal="true" aria-label="Check board">
        <header>
          <h2>Check board</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="check-body">
          {!problems.length ? (
            <p className="check-clear">Nothing to tidy: nothing on top of anything, no empty notes, no strays, and every flowchart flows.</p>
          ) : (
            <>
              <p className="muted">
                {problems.length === 1 ? 'One thing' : `${problems.length} things`} to look at{fixable && !ro ? `; ${fixable === problems.length ? (fixable === 1 ? 'it has' : 'all have') : `${fixable} have`} a fix` : ''}. Every fix can be undone.
              </p>
              <ul className="check-list">
                {problems.map((p) => (
                  <li key={p.key}>
                    <span className="check-text">{p.text}</span>
                    <span className="check-actions">
                      <button
                        className="link"
                        onClick={() => {
                          onClose()
                          editor.focusObject(p.ids[0])
                        }}
                      >
                        Go to
                      </button>
                      {p.fix && !ro && <button onClick={() => editor.fixProblem(p)}>{p.fix}</button>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {fixable > 1 && !ro && (
          <footer className="check-foot">
            <button className="primary" onClick={() => editor.fixAllProblems()}>
              Fix all {fixable}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
