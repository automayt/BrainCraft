import type { Board } from './types'

const LIMIT = 200

/** Undo/redo over immutable board snapshots. */
export class History {
  private undoStack: Board[] = []
  private redoStack: Board[] = []

  /** Records `before` as an undo step if the board has changed since. */
  commit(before: Board, now: Board): boolean {
    if (before === now) return false
    this.undoStack.push(before)
    if (this.undoStack.length > LIMIT) this.undoStack.shift()
    this.redoStack = []
    return true
  }

  undo(now: Board): Board | null {
    const prev = this.undoStack.pop()
    if (!prev) return null
    this.redoStack.push(now)
    return prev
  }

  redo(now: Board): Board | null {
    const next = this.redoStack.pop()
    if (!next) return null
    this.undoStack.push(now)
    return next
  }

  get canUndo() {
    return this.undoStack.length > 0
  }

  get canRedo() {
    return this.redoStack.length > 0
  }

  clear() {
    this.undoStack = []
    this.redoStack = []
  }
}
