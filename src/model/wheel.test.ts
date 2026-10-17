import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { emptyBoard, getItem, updateItem } from './board'
import { fakeMeasure } from './test-helpers'
import { newWheel, sliceColor, SPIN_MS, spinWheel, wheelAngle, wheelOptions } from './wheel'

/** The slice under the pointer (at the top) for a wheel turned `angle` degrees. */
const underPointer = (angle: number, n: number) => Math.floor((((-angle % 360) + 360) % 360) / (360 / n))

describe('spinner wheel', () => {
  it('takes its options from the card’s lines', () => {
    let [b, id] = newWheel(emptyBoard(), { x: 0, y: 0 }, ['Pizza', ' ', 'Tacos', 'Curry'])
    expect(wheelOptions(getItem(b, id)!)).toEqual(['Pizza', 'Tacos', 'Curry'])
    b = updateItem(b, id, (i) => ({ ...i, text: '- Alex\n- Sam\n\n1. Jo' }))
    expect(wheelOptions(getItem(b, id)!)).toEqual(['Alex', 'Sam', 'Jo'])
    ;[b, id] = newWheel(emptyBoard(), { x: 0, y: 0 })
    expect(wheelOptions(getItem(b, id)!)).toHaveLength(4)
  })

  it('lands on the answer it picked, every time', () => {
    for (let seed = 0; seed < 50; seed++) {
      let s = seed + 1
      const random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
      const n = 2 + (seed % 7)
      let [b, id] = newWheel(emptyBoard(), { x: 0, y: 0 }, Array.from({ length: n }, (_, k) => `o${k}`))
      b = spinWheel(b, id, 1000, random)
      b = spinWheel(b, id, 9000, random)
      const spin = getItem(b, id)!.wheel!.spin!
      expect(spin.to).toBeGreaterThan(spin.from + 360 * 4)
      const end = wheelAngle(spin, spin.at + SPIN_MS)
      expect(end.done).toBe(true)
      expect(underPointer(end.angle, n)).toBe(spin.result)
    }
  })

  it('eases from where it was to where it stops', () => {
    const spin = { at: 0, from: 100, to: 2000, result: 0 }
    expect(wheelAngle(spin, -50)).toEqual({ angle: 100, done: false })
    const mid = wheelAngle(spin, SPIN_MS / 2)
    expect(mid.angle).toBeGreaterThan(1050)
    expect(wheelAngle(spin, SPIN_MS * 2)).toEqual({ angle: 2000, done: true })
  })

  it('never colours neighbouring slices alike', () => {
    for (let n = 2; n < 20; n++)
      for (let k = 0; k < n; k++) expect(sliceColor(k, n), `${k}/${n}`).not.toBe(sliceColor((k + 1) % n, n))
  })

  it('can be made by an operation', () => {
    const out = applyOps(emptyBoard(), [{ op: 'createSpinner', options: ['Yes', 'No'] }], { measure: fakeMeasure })
    expect(wheelOptions(getItem(out.board, out.results[0].id!)!)).toEqual(['Yes', 'No'])
    expect(() => applyOps(emptyBoard(), [{ op: 'createSpinner', options: ['Only'] }], { measure: fakeMeasure })).toThrow('two or more')
  })
})
