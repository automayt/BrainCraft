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

/**
 * Whether an error is a piece of the app that couldn't be fetched: almost always because the app
 * was updated on the server since this tab opened, so the piece this tab knows about is gone.
 */
export const isStaleApp = (err: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch|ChunkLoadError|MIME type/i.test(String((err as Error)?.message ?? err))

/**
 * Around a part of the app that loads on first use (the drawing editor, the assistant): if it can't
 * load or breaks, say so and let the rest of the app carry on, instead of a blank page.
 */
export class PartBoundary extends Component<{ children: ReactNode; what: string; onClose: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`BrainCraft could not open ${this.props.what}:`, error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isStaleApp(error)
    const close = () => {
      this.setState({ error: null })
      this.props.onClose()
    }
    return (
      <div className="modal-backdrop no-canvas" role="presentation">
        <div className="modal part-error" role="alertdialog" aria-modal="true" aria-label={stale ? 'A new version is ready' : `Couldn’t open ${this.props.what}`}>
          <h2>{stale ? 'A new version is ready' : `Couldn’t open ${this.props.what}`}</h2>
          <p className="muted">
            {stale
              ? `The app was updated since this tab was opened, so ${this.props.what} needs a reload. Your work is saved.`
              : `Something went wrong (${error.message}). Your work is saved; try again, or reload the page.`}
          </p>
          <div className="board-error-actions">
            <button className="primary" onClick={() => location.reload()}>
              Reload
            </button>
            <button onClick={close}>{stale ? 'Not now' : 'Close'}</button>
          </div>
        </div>
      </div>
    )
  }
}
