import { useState } from 'react'
import { itemsWithin } from '../model/board'
import { HEAVY_BOARD } from '../model/subBoard'
import { useEditor } from './useEditor'
import { useWorkspace } from './useWorkspace'

const DISMISSED = 'braincraft-heavy-dismissed:'

function dismissed(board: string | null): boolean {
  try {
    return !!board && sessionStorage.getItem(DISMISSED + board) === '1'
  } catch {
    return false
  }
}

/**
 * On a board with thousands of objects: it may feel slow, so suggest moving parts of it to boards
 * of their own (a frame at a time).
 */
export function HeavyBoard() {
  const editor = useEditor()
  const ws = useWorkspace()
  const [hidden, setHidden] = useState(() => dismissed(ws.boardId))
  const board = editor.board
  const count = board.items.length
  if (hidden || editor.readOnly || count < HEAVY_BOARD || dismissed(ws.boardId)) return null
  const hasFrames = board.items.some((i) => i.kind === 'frame')
  // The frame holding the most, found when asked for.
  const busiest = () =>
    board.items
      .filter((i) => i.kind === 'frame')
      .map((f) => ({ f, n: itemsWithin(board, f, new Set()).size }))
      .sort((p, q) => q.n - p.n)[0]?.f
  const close = () => {
    try {
      if (ws.boardId) sessionStorage.setItem(DISMISSED + ws.boardId, '1')
    } catch {
      // Not kept: it's back next time.
    }
    setHidden(true)
  }
  return (
    <div className="viewer-banner heavy-banner island no-canvas" role="status">
      <span>
        <strong>{count.toLocaleString()} objects</strong> · a board this busy can feel slow.{' '}
        {hasFrames ? 'Move parts to boards of their own: right-click a frame → Move to its own board.' : 'Put related parts in frames, then move a frame to a board of its own (right-click it).'}
      </span>
      {hasFrames && (
        <button
          onClick={() => {
            const f = busiest()
            if (!f) return
            editor.select([f.id])
            editor.focusObject(f.id)
          }}
        >
          Show the busiest frame
        </button>
      )}
      <button onClick={close}>Not now</button>
    </div>
  )
}
