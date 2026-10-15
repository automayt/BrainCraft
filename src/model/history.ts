import type { Board } from './types'

const LIMIT = 200

/** One undoable step: the board just before and just after it. */
export interface Step {
  before: Board
  after: Board
}

/**
 * Undo/redo over immutable board snapshots. Each step keeps both ends, so the editor can undo
 * a step by its changes alone (leaving other people's edits in a live session alone).
 */
export class History {
  private undoStack: Step[] = []
  private redoStack: Step[] = []

  /** Records a step from `before` to `now`, if the board changed. */
  commit(before: Board, now: Board): boolean {
    if (before === now) return false
    this.undoStack.push({ before, after: now })
    if (this.undoStack.length > LIMIT) this.undoStack.shift()
    this.redoStack = []
    return true
  }

  undo(): Step | null {
    const step = this.undoStack.pop()
    if (!step) return null
    this.redoStack.push(step)
    return step
  }

  redo(): Step | null {
    const step = this.redoStack.pop()
    if (!step) return null
    this.undoStack.push(step)
    return step
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
