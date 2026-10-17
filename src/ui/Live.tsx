/** Live collaboration in the interface: who's here, their cursors, and starting or joining a session. */

import { useState } from 'react'
import * as B from '../model/board'
import { toScreen } from '../model/camera'
import { useEditor } from './useEditor'
import { useWorkspace } from './useWorkspace'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

const STATE_LABEL = { connecting: 'Connecting…', live: 'Live', offline: 'Reconnecting…', denied: 'Can’t reach this board' } as const

/** The people here, as avatars; click one to follow their view. */
export function LiveBar({ onOpen }: { onOpen: () => void }) {
  const ws = useWorkspace()
  const live = ws.live
  if (!live) return null
  const peers = [...live.peers.values()]
  return (
    <div className={`live-bar ${live.state}`}>
      <button className="live-state" onMouseDown={(e) => e.preventDefault()} onClick={onOpen} title={`${STATE_LABEL[live.state]}${live.role === 'view' ? ' · view only' : ''}`}>
        <i aria-hidden="true" />
        {live.state === 'live' ? (live.role === 'view' ? 'Viewing' : 'Live') : STATE_LABEL[live.state]}
      </button>
      <div className="avatars">
        {peers.slice(0, 5).map((p) => (
          <button
            key={p.id}
            className={`avatar${live.following === p.id ? ' following' : ''}`}
            style={{ background: p.color }}
            title={live.following === p.id ? `Following ${p.name} — click to stop` : `${p.name}${p.role === 'view' ? ' (viewing)' : ''} — click to follow`}
            aria-label={live.following === p.id ? `Stop following ${p.name}` : `Follow ${p.name}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => live.follow(live.following === p.id ? null : p.id)}
          >
            {initials(p.name)}
          </button>
        ))}
        {peers.length > 5 && <span className="avatar more">+{peers.length - 5}</span>}
      </div>
    </div>
  )
}

/** Other people's cursors and selections, drawn over the board. */
export function PeerLayer() {
  const editor = useEditor()
  if (!editor.peers.size) return null
  const out: React.ReactNode[] = []
  for (const p of editor.peers.values()) {
    for (const id of p.selection) {
      const i = B.getItem(editor.board, id)
      if (!i || editor.hidden.has(id)) continue
      const r = editor.screenRect(i)
      out.push(<div key={`${p.id}s${id}`} className="peer-sel" style={{ left: r.x - 4, top: r.y - 4, width: r.w + 8, height: r.h + 8, borderColor: p.color }} />)
    }
    if (p.cursor) {
      const s = toScreen(editor.camera, p.cursor)
      if (s.x < -20 || s.y < -20 || s.x > editor.viewport.w + 20 || s.y > editor.viewport.h + 20) continue
      out.push(
        <div key={`${p.id}c`} className="peer-cursor" style={{ transform: `translate(${s.x}px, ${s.y}px)` }}>
          <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true">
            <path d="M1 1l6.5 17 2.5-7 7-2.5z" fill={p.color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span style={{ background: p.color }}>{p.name}</span>
        </div>,
      )
    }
  }
  return <div className="peer-layer">{out}</div>
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="share-row">
      <input readOnly value={text} onFocus={(e) => e.target.select()} aria-label={label} />
      <button
        className="primary"
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }}
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** The live part of the share dialog. */
export function LiveSection() {
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [address, setAddress] = useState('')
  const [name, setName] = useState(ws.me.name === 'Guest' ? '' : ws.me.name)
  const info = ws.liveInfo
  const edit = ws.liveLink('edit')
  const view = ws.liveLink('view')

  if (ws.readOnly) return null
  return (
    <section className="live-section">
      <h3>
        {info && <span className="live-dot" aria-hidden="true" />}
        Work on it together, live
      </h3>
      {info ? (
        <>
          <p className="muted">Everyone with a link sees changes as they happen, with cursors and who’s here. Links stay valid; keep the edit link to people you trust.</p>
          {edit && (
            <label className="link-label">
              Can edit
              <Copy text={edit} label="Edit link" />
            </label>
          )}
          {view && (
            <label className="link-label">
              Can view
              <Copy text={view} label="View link" />
            </label>
          )}
          <div className="live-foot">
            <label className="name-row">
              Your name
              <input
                value={name}
                placeholder="Shown to others"
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && ws.setName(name)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </label>
            <button className="danger" onClick={() => void ws.leaveLive()}>
              Stop syncing here
            </button>
          </div>
        </>
      ) : ws.server ? (
        <>
          <p className="muted">
            Shares this board through <strong>{new URL(ws.server).host}</strong>. You’ll get an edit link and a view-only link.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await ws.startLive()
              } catch (err) {
                setError((err as Error).message)
              }
              setBusy(false)
            }}
          >
            {busy ? 'Starting…' : 'Start a live session'}
          </button>
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <>
          <p className="muted">
            Live sessions need a BrainCraft server. Run <code>node braincraft-server.mjs</code> (it also hosts the app), or point this app at one:
          </p>
          <form
            className="share-row"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              setError((await ws.useServer(address)) ? '' : 'No BrainCraft server answered at that address.')
              setBusy(false)
            }}
          >
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://braincraft.example.com" aria-label="Server address" />
            <button className="primary" type="submit" disabled={busy || !address.trim()}>
              Connect
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
  )
}
