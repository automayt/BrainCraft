/**
 * What the board still takes from the pointer over things that otherwise keep it out. A selected
 * table, Kanban or timeline, a text box being typed in and the like are for clicking and typing in
 * (`.no-canvas`), but the board must go on moving under the pointer wherever it is: with the wheel
 * dead and the pan buttons ignored over a large object, there was no way to move off it.
 *
 * - The wheel zooms or moves the board, unless what's under it has more than fits and scrolls
 *   itself (a long Kanban column, a tall text box).
 * - The buttons that move the board (the middle one, the right one, or the left with Space held
 *   or the hand tool out) move it there too, except in a place for typing.
 */

/** A place for typing: its Space and its own presses stay its own. */
export const isTextField = (el: Element) => !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')

/** How an element is styled, as far as scrolling goes. */
type Styled = (el: Element) => { overflowX: string; overflowY: string }

const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll'

/**
 * Whether something between `target` and `root` (the thing keeping the board out) scrolls by
 * itself the way the wheel is turning: it lets its content scroll that way, and has more than
 * fits. At the end of its scroll it still counts, so a list doesn't hand over to the board and
 * zoom it the moment it reaches its last row.
 */
export function scrollsItself(target: Element, root: Element, dx: number, dy: number, styled: Styled = (el) => getComputedStyle(el)): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    const s = styled(el)
    if (dy && scrolls(s.overflowY) && el.scrollHeight > el.clientHeight + 1) return true
    if (dx && scrolls(s.overflowX) && el.scrollWidth > el.clientWidth + 1) return true
    if (el === root) break
  }
  return false
}

/** Whether a wheel over something that keeps the board out is the board's all the same: a pinch always, and anything that doesn't scroll what's under it. */
export function wheelIsBoards(e: { ctrlKey: boolean; metaKey: boolean; deltaX: number; deltaY: number; shiftKey: boolean }, target: Element, root: Element, styled?: Styled): boolean {
  if (e.ctrlKey || e.metaKey) return true
  // Shift turns an up-and-down wheel sideways.
  const sideways = e.shiftKey && !e.deltaX
  return !scrollsItself(target, root, sideways ? e.deltaY : e.deltaX, sideways ? 0 : e.deltaY, styled)
}

/** Whether a press over something that keeps the board out is one that moves the board. */
export function pressMovesBoard(press: { button: number; pointerType: string }, target: Element, held: { space: boolean; hand: boolean }): boolean {
  if (press.pointerType === 'touch') return false
  if (press.button === 1) return true
  if (isTextField(target)) return false
  return press.button === 2 || (press.button === 0 && (held.space || held.hand))
}
