/** In a meeting: the voices heard so far, each named with a click ("Voice 2" → "Sam"). */

import { useState } from 'react'
import { unnamedVoice } from '../model/meeting'
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
            defaultValue={unnamedVoice(v.name) ? '' : v.name}
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
          <button
            key={v.n}
            type="button"
            className={`voice-name${v.guessed ? ' guessed' : ''}`}
            title={v.guessed ? `${v.name} was worked out from what was said. Click to put it right, or to say it is right (Enter).` : `Name ${v.name}`}
            aria-label={v.guessed ? `${v.name}, worked out from what was said: name this voice` : `Name ${v.name}`}
            onClick={() => setNaming(v.n)}
          >
            <i style={{ background: personColor(v.name) }} aria-hidden="true" />
            {v.name}
            {v.guessed && <span className="voice-guess" aria-hidden="true">?</span>}
          </button>
        ),
      )}
    </div>
  )
}
