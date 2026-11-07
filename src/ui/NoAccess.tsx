/** A link to a board you can't open: ask for it. Says nothing about whether the board exists. */

import { useState } from 'react'
import { Dialog } from './Boards'
import { useWorkspace } from './useWorkspace'

export function NoAccess({ board, onHome }: { board: string; onHome: () => void }) {
  const ws = useWorkspace()
  const [note, setNote] = useState('')
  const [asked, setAsked] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const ask = async () => {
    setProblem(null)
    const failed = await ws.askForAccess(board, note)
    if (failed) setProblem(failed)
    else setAsked(true)
  }
  return (
    <Dialog label="No access to this board" onClose={onHome} className="account-dialog no-access">
      <header>
        <h2>You don’t have access to this</h2>
      </header>
      {asked ? (
        <>
          <p>Asked. If it’s there to share, whoever manages it gets your request in their inbox. When they say yes, it opens here.</p>
          <div className="account-actions">
            <button className="primary" onClick={onHome}>
              Your boards
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">It isn’t shared with you, or it’s gone. You can ask whoever manages it to let you in.</p>
          {problem && <p className="signin-error">{problem}</p>}
          <label>
            A note for them <small className="muted">(optional)</small>
            <textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="account-actions">
            <button onClick={onHome}>Your boards</button>
            <button className="primary" onClick={() => void ask()}>
              Ask for access
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
