/** In a meeting: the voices heard so far, each named with a click ("Voice 2" → "Sam"). */

import { useState } from 'react'
import type { HeardVoice } from './useTalk'
import { personColor } from './TimeTracking'

export function VoiceNames({ voices, onName }: { voices: readonly HeardVoice[]; onName: (n: number, name: string) => void }) {
  const [naming, setNaming] = useState<number | null>(null)
  // One voice is just you: nothing to tell apart yet.
  if (voices.length < 2) return null
  return (
    <div className="voice-names" role="group" aria-label="Who’s talking">
      <span className="voice-names-label">Voices</span>
      {voices.map((v) =>
        naming === v.n ? (
          <input
            key={v.n}
            autoFocus
            className="voice-name-input"
            aria-label={`Name ${v.name}`}
            defaultValue={/^Voice \d+$/.test(v.name) ? '' : v.name}
            placeholder={`Who is ${v.name}?`}
            maxLength={40}
            onBlur={(e) => {
              setNaming(null)
              onName(v.n, e.target.value)
            }}
            onKeyDown={(e) => {
              // Space mutes in Flowstate, but not while a name is typed.
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                ;(e.target as HTMLInputElement).value = ''
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
        ) : (
          <button key={v.n} type="button" className="voice-name" title={`Name ${v.name}`} onClick={() => setNaming(v.n)}>
            <i style={{ background: personColor(v.name) }} aria-hidden="true" />
            {v.name}
          </button>
        ),
      )}
    </div>
  )
}
