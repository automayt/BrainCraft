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

  /**
   * Folds a change into the last step when nothing came between (`before` is where that step
   * ended): a burst of typing on a page undoes as one step, not one per letter.
   */
  amend(before: Board, now: Board): boolean {
    const last = this.undoStack.at(-1)
    if (!last || last.after !== before) return this.commit(before, now)
    if (before === now) return false
    last.after = now
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
