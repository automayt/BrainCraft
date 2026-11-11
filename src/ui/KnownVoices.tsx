/**
 * The voices this server knows by name: naming a voice in a meeting teaches it, so it's known in
 * every meeting after. Each can be forgotten here.
 */

import { useEffect, useState } from 'react'

interface Known {
  name: string
  heard: number
  updated: number
}

export function KnownVoices({ server, password }: { server: string; password?: string }) {
  const [voices, setVoices] = useState<Known[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const call = (method: 'GET' | 'DELETE', query = '') =>
    fetch(new URL(`api/ai/voices${query}`, server.endsWith('/') ? server : `${server}/`), {
      method,
      credentials: 'include',
      headers: { 'x-braincraft': '1', ...(password ? { 'x-braincraft-ai-password': password } : {}) },
    })
  const load = () =>
    call('GET')
      .then(async (r) => {
        const out = (await r.json().catch(() => ({}))) as { voices?: Known[]; error?: string }
        if (!r.ok) throw new Error(out.error ?? `${r.status}`)
        setVoices(Array.isArray(out.voices) ? out.voices : [])
        setProblem(null)
      })
      .catch((err: Error) => setProblem(`Couldn’t list the voices: ${err.message}`))
  useEffect(() => {
    void load()
    // Once per server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, password])
  const forget = (name: string) =>
    void call('DELETE', `?name=${encodeURIComponent(name)}`)
      .then(load)
      .catch(() => setProblem(`Couldn’t forget ${name}`))
  return (
    <div className="ai-voices">
      <h4>Voices this server knows</h4>
      {problem ? (
        <p className="muted">{problem}</p>
      ) : !voices ? (
        <p className="muted">Looking…</p>
      ) : !voices.length ? (
        <p className="muted">None yet. Name a voice in a meeting and it’s known in every meeting after.</p>
      ) : (
        <ul>
          {voices.map((v) => (
            <li key={v.name}>
              <span>{v.name}</span>
              <button type="button" className="link" onClick={() => forget(v.name)} title={`Forget ${v.name}’s voice: they’re a new voice again in the next meeting`}>
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
