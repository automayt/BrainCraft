import { Component, type ReactNode } from 'react'

/**
 * If something on the board can't be drawn, say so and keep the rest of the
 * app working (the board list, undo, other boards), instead of a blank page.
 */
export class BoardErrorBoundary extends Component<{ children: ReactNode; onUndo: () => void; onBoards: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('BrainCraft could not draw the board:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const retry = () => this.setState({ error: null })
    return (
      <div className="board-error no-canvas" role="alert">
        <h2>Something on this board couldn’t be drawn</h2>
        <p className="muted">Your work is still saved. Undoing the last change often fixes it, or open another board.</p>
        <div className="board-error-actions">
          <button
            className="primary"
            onClick={() => {
              this.props.onUndo()
              retry()
            }}
          >
            Undo and try again
          </button>
          <button onClick={retry}>Try again</button>
          <button onClick={this.props.onBoards}>Your boards</button>
        </div>
      </div>
    )
  }
}
