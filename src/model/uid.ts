/**
 * A short random id for things inside objects (notes, rows, cards…). Twelve hex digits: with eight,
 * a sheet of ten thousand rows had about one chance in a hundred of two rows getting the same one.
 */
export function uid(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 12)
  return (Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10)).slice(0, 12).padEnd(12, '0')
}
