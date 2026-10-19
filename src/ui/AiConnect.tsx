/** Pairing this tab with the BrainCraft MCP server, so AI assistants can work on the board. */

import { useRef, useState } from 'react'
import { useDialog } from './useDialog'
import { type Bridge, DEFAULT_PORT, parsePairing } from '../api/bridge'
import { useEscape } from './useEscape'
import { copyText } from './copyText'

const STATE_LABEL = { off: 'Not connected', connecting: 'Connecting…', connected: 'Connected', lost: 'Reconnecting… (is the MCP server running?)' } as const

function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="snippet">
      <div className="snippet-head">
        <span>{label}</span>
        <button
          className="link"
          onClick={async () => {
            const ok = await copyText(code)
            setCopied(ok)
            if (ok) setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  )
}

export function AiDialog({ bridge, onClose }: { bridge: Bridge; onClose: () => void }) {
  useEscape(onClose)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialog(dialogRef)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const script = new URL('braincraft-mcp.mjs', location.href).href
  const path = '/path/to/braincraft-mcp.mjs'
  const appUrl = location.href.split('#')[0]
  const env = appUrl.startsWith('https://automayt.github.io/') ? '' : ` -e BRAINCRAFT_URL=${appUrl}`
  const desktop = JSON.stringify(
    { mcpServers: { braincraft: { command: 'node', args: [path], ...(env ? { env: { BRAINCRAFT_URL: appUrl } } : {}) } } },
    null,
    2,
  )

  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ai-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Connect an AI assistant" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
        <header>
          <h2>Connect an AI assistant</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="ai-body">
          <p className="muted">
            Claude, Codex, Cursor and other MCP clients can read this board and build on it: mind maps, flowcharts, Kanban cards, comments. Everything they do is one undo step
            away.
          </p>
          <ol className="ai-steps">
            <li>
              <strong>Get the server.</strong> One file, no install:{' '}
              <a href={script} download>
                braincraft-mcp.mjs
              </a>{' '}
              (needs Node 20 or later).
            </li>
            <li>
              <strong>Add it to your assistant.</strong>
              <Snippet label="Claude Code" code={`claude mcp add braincraft${env} -- node ${path}`} />
              <Snippet label="Claude Desktop · claude_desktop_config.json" code={desktop} />
            </li>
            <li>
              <strong>Pair this browser.</strong> Ask the assistant to “connect to BrainCraft”; it gives you a link to open. Or paste the link or token here:
              <form
                className="ai-pair"
                onSubmit={(e) => {
                  e.preventDefault()
                  const p = parsePairing(text)
                  if (!p) return setError('That doesn’t look like a BrainCraft pairing link or token.')
                  setError('')
                  setText('')
                  bridge.connect(p)
                }}
              >
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`…#ai=${DEFAULT_PORT}.yourtoken`} aria-label="Pairing link or token" />
                <button className="primary" type="submit" disabled={!text.trim()}>
                  Pair
                </button>
              </form>
              {error && <p className="error">{error}</p>}
            </li>
          </ol>
          <div className={`ai-status ${bridge.state}`}>
            <i aria-hidden="true" />
            <span>
              <strong>{STATE_LABEL[bridge.state]}</strong>
              {bridge.pairing && <small className="muted"> · port {bridge.pairing.port}{bridge.calls ? ` · ${bridge.calls} request${bridge.calls === 1 ? '' : 's'} so far` : ''}</small>}
            </span>
            {bridge.state !== 'off' && (
              <button className="danger" onClick={() => bridge.disconnect()}>
                Disconnect
              </button>
            )}
          </div>
          <p className="muted small">
            No assistant handy? The server also works on .braincraft files directly; pass <code>file</code> to any tool.
          </p>
        </div>
      </div>
    </div>
  )
}

/** A small chip in the top bar while an assistant is (or was) connected. */
export function AiChip({ bridge, onClick }: { bridge: Bridge; onClick: () => void }) {
  if (bridge.state === 'off') return null
  return (
    <button
      className={`ai-chip ${bridge.state}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={STATE_LABEL[bridge.state]}
      aria-label={`AI assistant: ${STATE_LABEL[bridge.state]}`}
    >
      <i aria-hidden="true" />
      AI
    </button>
  )
}
