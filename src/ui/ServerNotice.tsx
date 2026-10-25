import { useState } from 'react'
import { useWorkspace } from './useWorkspace'

/** The announcement this browser closed; a different one shows again. */
const KEY = 'braincraft.notice-closed'

const closedOne = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** An admin's announcement for everyone signed in to the server, until each person closes it. */
export function ServerNotice() {
  const ws = useWorkspace()
  const [closed, setClosed] = useState(closedOne)
  const notice = ws.account?.notice
  if (!notice || closed === notice) return null
  const close = () => {
    try {
      localStorage.setItem(KEY, notice)
    } catch {
      // Private browsing: it shows again next time.
    }
    setClosed(notice)
  }
  return (
    <div className="whats-new server-notice no-canvas" role="status">
      <span className="whats-new-icon" aria-hidden="true">
        📣
      </span>
      <span className="whats-new-msg">{notice}</span>
      <span className="whats-new-actions">
        <button className="icon-close" aria-label="Close the announcement" onClick={close}>
          ×
        </button>
      </span>
    </div>
  )
}
