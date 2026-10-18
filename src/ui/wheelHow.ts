/**
 * What a wheel event should do to the board. A mouse wheel zooms at the pointer; a trackpad's
 * two-finger swipe moves the board (pinching zooms); Shift, or a sideways swipe, moves it too.
 */

export type WheelHow = 'pinch' | 'pan' | 'zoom'

export interface WheelLike {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  timeStamp: number
  /** The older wheel field browsers still send: whole notches (120) from a mouse. */
  wheelDeltaY?: number
}

/** Remembered between events: one burst of scrolling is one device. */
export interface WheelMemo {
  last: number
  pad: boolean
}

/** A gap this long starts a new burst. */
const BURST_MS = 250

export function newWheelMemo(): WheelMemo {
  return { last: -Infinity, pad: false }
}

/** Whether the first event of a burst looks like a trackpad rather than a mouse wheel. */
export function looksLikeTrackpad(e: WheelLike): boolean {
  if (e.deltaMode !== 0) return false
  if (e.deltaX !== 0) return true
  // Trackpads send pixels that the old field mirrors (×3); a mouse sends whole notches there.
  if (e.wheelDeltaY) return e.wheelDeltaY === -3 * e.deltaY
  return !Number.isInteger(e.deltaY) && Math.abs(e.deltaY) < 50
}

export function wheelHow(e: WheelLike, memo: WheelMemo): WheelHow {
  if (e.ctrlKey || e.metaKey) return 'pinch'
  if (e.timeStamp - memo.last > BURST_MS) memo.pad = looksLikeTrackpad(e)
  memo.last = e.timeStamp
  return e.shiftKey || memo.pad || Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 'pan' : 'zoom'
}
