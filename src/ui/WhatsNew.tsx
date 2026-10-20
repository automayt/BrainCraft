import { useState } from 'react'
import { GUIDE_TITLE } from '../store/guide'
import { useUi } from './uiContext'
import { useWorkspace } from './useWorkspace'
import { appName } from '../store/brand'

/** Which announcement this browser has seen; a new value shows the banner again once. */
const KEY = 'braincraft.news'
const NEWS = 'guide-wikis-2026-10'

const seenAlready = () => {
  try {
    return localStorage.getItem(KEY) === NEWS
  } catch {
    return true
  }
}

/**
 * Says once, in each browser, where the newer parts live: the guide, wikis, and the API reference
 * on a server. Nothing on the board changes until someone picks something.
 */
export function WhatsNew() {
  const ws = useWorkspace()
  const ui = useUi()
  const [seen, setSeen] = useState(seenAlready)
  if (seen || ws.readOnly || ws.viewOnly) return null
  const done = () => {
    try {
      localStorage.setItem(KEY, NEWS)
    } catch {
      // Private browsing: it shows again next time, which is fine.
    }
    setSeen(true)
  }
  const fresh = ws.boards.some((b) => b.kind === 'wiki' && b.title === GUIDE_TITLE)
  return (
    <div className="whats-new no-canvas" role="status">
      <span className="whats-new-icon" aria-hidden="true">
        📘
      </span>
      <span className="whats-new-msg">
        {fresh ? (
          <>
            <strong>New here?</strong> The {appName()} guide shows every part of the app, with a tour board to try things on.
          </>
        ) : (
          <>
            <strong>New in {appName()}:</strong> wikis (pages to write together), a guide to every feature, and{ws.server ? ' an API reference at /api/docs' : ' a documented API'}.
          </>
        )}
      </span>
      <span className="whats-new-actions">
        <button
          className="primary"
          onClick={() => {
            done()
            ui.openGuide()
          }}
        >
          Open the guide
        </button>
        <button
          onClick={() => {
            done()
            void ws.newWiki()
          }}
        >
          Start a wiki
        </button>
        <button className="icon-close" aria-label="Dismiss" onClick={done}>
          ×
        </button>
      </span>
    </div>
  )
}
