/**
 * Credits: the open-source projects BrainCraft is built with, and their licences. The list is what
 * the build actually ships (dist/credits.json, written by vite.licenses.ts); the full licence texts
 * are in THIRD_PARTY_NOTICES.txt beside the app.
 */

import { useEffect, useRef, useState } from 'react'
import { useDialog } from './useDialog'
import { useEscape } from './useEscape'

interface Credit {
  name: string
  version: string
  license: string
  author?: string
  homepage?: string
}

/** The projects people meet in BrainCraft, and what each one does in it. */
const FEATURED: [match: RegExp, what: string][] = [
  [/^@excalidraw\/excalidraw$/, 'The drawing editor for Excalidraw drawings'],
  [/^roughjs$/, 'The hand-drawn look of shapes, flowcharts and lines'],
  [/^Excalifont \(font\)$/, 'The handwriting on hand-drawn objects'],
  [/^@excalidraw\/mermaid-to-excalidraw$/, 'Sketching flowcharts in Excalidraw'],
  [/^mermaid$/, 'Reading flowcharts for those sketches'],
  [/^react$/, 'The interface'],
  [/^@fontsource-variable\/inter$/, 'Inter, the interface’s typeface'],
  [/^@fontsource-variable\/literata$/, 'Literata, the typeface wiki pages are read in'],
  [/^@anthropic-ai\/sdk$/, 'Talking to Claude for the assistant'],
  [/^ws$/, 'Live sessions on the BrainCraft server'],
]

export function CreditsDialog({ onClose }: { onClose: () => void }) {
  useEscape(onClose)
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  const [credits, setCredits] = useState<Credit[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch(new URL('credits.json', document.baseURI))
      .then((r) => (r.ok ? (r.json() as Promise<Credit[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setCredits, () => setFailed(true))
  }, [])

  const featured = FEATURED.flatMap(([re, what]) => {
    const c = credits?.find((x) => re.test(x.name))
    return c ? [{ ...c, what }] : []
  })
  const rest = (credits ?? []).filter((c) => !featured.some((f) => f.name === c.name))
  const link = (c: Credit) => (c.homepage?.startsWith('https://') ? c.homepage : undefined)

  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal credits" role="dialog" aria-modal="true" aria-label="Credits">
        <header>
          <h2>Credits</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="credits-body">
          <p>
            BrainCraft is built with open-source projects. Thank you to everyone who made them. Each is used under its own licence; the{' '}
            <a href={new URL('THIRD_PARTY_NOTICES.txt', document.baseURI).href} target="_blank" rel="noreferrer">
              full licence texts
            </a>{' '}
            ship with the app.
          </p>
          {failed && <p className="muted">The list is made when BrainCraft is built; this copy doesn’t have it (a development server, say).</p>}
          {!credits && !failed && <p className="muted">Loading…</p>}
          {featured.length > 0 && (
            <ul className="credits-featured">
              {featured.map((c) => (
                <li key={c.name}>
                  <strong>{link(c) ? <a href={link(c)} target="_blank" rel="noreferrer">{c.name.replace(/ \(font\)$/, '')}</a> : c.name.replace(/ \(font\)$/, '')}</strong>
                  <span className="muted"> · {c.license}</span>
                  <br />
                  <small>{c.what}</small>
                </li>
              ))}
            </ul>
          )}
          {rest.length > 0 && (
            <details className="credits-rest">
              <summary>And {rest.length} more they’re built on</summary>
              <ul>
                {rest.map((c) => (
                  <li key={`${c.name}@${c.version}`}>
                    {link(c) ? (
                      <a href={link(c)} target="_blank" rel="noreferrer">
                        {c.name}
                      </a>
                    ) : (
                      c.name
                    )}{' '}
                    <small className="muted">
                      {c.version} · {c.license}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="muted small">BrainCraft itself is open source too, under the Apache License 2.0 or the MIT licence, whichever you choose.</p>
        </div>
      </div>
    </div>
  )
}
