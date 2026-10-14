/** A short random id for things inside objects (notes, rows, cards…). */
export function uid(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}
