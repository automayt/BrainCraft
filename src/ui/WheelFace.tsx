import { useEffect, useState } from 'react'
import type { Item } from '../model/types'
import { sliceColor, spinStart, wheelAngle, wheelOptions } from '../model/wheel'

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The wheel itself, turning to wherever its latest spin says, in the box given. */
export function WheelFace({ item, box }: { item: Item; box: { x: number; y: number; w: number; h: number } }) {
  const spin = item.wheel?.spin
  const [now, setNow] = useState(() => Date.now())
  // Animate only while a spin is running; then sit still.
  useEffect(() => {
    if (!spin) return
    const start = spinStart(spin)
    if (wheelAngle(spin, Date.now(), start).done) return
    let frame = 0
    const tick = () => {
      const t = Date.now()
      setNow(t)
      if (!wheelAngle(spin, t, start).done) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [spin])

  const options = wheelOptions(item)
  const n = Math.max(1, options.length)
  const r = Math.max(10, Math.min(box.w, box.h) / 2 - 12)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2 + 6
  const { angle, done } = wheelAngle(spin, now, spin ? spinStart(spin) : 0)
  const seg = 360 / n
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180
  const at = (deg: number, rr = r) => `${cx + rr * Math.cos(rad(deg))} ${cy + rr * Math.sin(rad(deg))}`
  // Slices get narrower with more options; long labels get smaller (down to 9px) before being cut.
  const maxFont = Math.max(9, Math.min(16, (r * 1.4) / Math.max(4, n)))
  const room = r * 0.86 - 8
  const fontFor = (label: string) => Math.max(10, Math.min(maxFont, room / (label.length * 0.5)))
  const winner = spin && done ? spin.result : -1
  // Once the wheel stops, labels on its left half turn round so they read left to right.
  const flip = (mid: number) => done && (((mid + angle) % 360) + 360) % 360 > 180

  return (
    <g className="wheel">
      <g transform={`rotate(${angle} ${cx} ${cy})`}>
        {options.length < 2 ? (
          <circle cx={cx} cy={cy} r={r} style={{ fill: sliceColor(0, 1) }} />
        ) : (
          options.map((label, k) => {
            const a0 = k * seg
            const a1 = (k + 1) * seg
            const mid = a0 + seg / 2
            return (
              <g key={k} className={k === winner ? 'wheel-slice won' : 'wheel-slice'}>
                <path d={`M${cx} ${cy}L${at(a0)}A${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${at(a1)}Z`} style={{ fill: sliceColor(k, n) }} />
                <text
                  x={cx}
                  y={cy - r + 12}
                  transform={`rotate(${mid} ${cx} ${cy}) rotate(${flip(mid) ? 90 : -90} ${cx} ${cy - r + 12})`}
                  fontSize={fontFor(label)}
                  textAnchor={flip(mid) ? 'start' : 'end'}
                  dominantBaseline="middle"
                >
                  {clip(label, Math.floor(room / (fontFor(label) * 0.5)))}
                </text>
              </g>
            )
          })
        )}
      </g>
      <circle cx={cx} cy={cy} r={r} className="wheel-rim" />
      <circle cx={cx} cy={cy} r={Math.max(6, r * 0.09)} className="wheel-hub" />
      <path d={`M${cx - 11} ${cy - r - 14}L${cx + 11} ${cy - r - 14}L${cx} ${cy - r + 8}Z`} className="wheel-pointer" />
    </g>
  )
}
