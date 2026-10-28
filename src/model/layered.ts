/**
 * Layers for a flowchart laid out automatically. Each step sits in its rank's layer; a link that
 * skips layers gets a narrow lane in each one it passes, so its line has a clear way through; the
 * order within each layer is swept to cut crossings; and steps line up with what they connect to,
 * so a chain runs straight.
 */

export interface LayerNode {
  key: string
  /** Its size across the layers (width when they run down the page). */
  span: number
  /** Its size along them. */
  depth: number
}

export interface LayerEdge {
  from: string
  to: string
}

export const NODE_GAP = 50
export const RANK_GAP = 70
/** A lane for a link passing through a layer. */
const LANE = 24
const LANE_GAP = 16

interface Entry {
  key: string
  span: number
  real: boolean
}

/** Centres for each node: `across` its layer and `along` the layers, from `along` 0. */
export function layered(nodes: LayerNode[], edges: LayerEdge[], rank: Map<string, number>): Map<string, { across: number; along: number }> {
  const layers: Entry[][] = []
  for (const n of nodes) (layers[rank.get(n.key) ?? 0] ??= []).push({ key: n.key, span: n.span, real: true })
  for (let r = 0; r < layers.length; r++) layers[r] ??= []

  // Links between neighbouring layers, through a lane in each layer a long one passes.
  const up = new Map<string, string[]>()
  const down = new Map<string, string[]>()
  const link = (hi: string, lo: string) => {
    ;(down.get(hi) ?? down.set(hi, []).get(hi)!).push(lo)
    ;(up.get(lo) ?? up.set(lo, []).get(lo)!).push(hi)
  }
  edges.forEach((e, n) => {
    const ra = rank.get(e.from)
    const rz = rank.get(e.to)
    if (ra === undefined || rz === undefined || ra === rz) return
    // A link back up is laid out as if it ran down; its line goes around (see orthoRoute).
    const [top, bottom, r0, r1] = ra < rz ? [e.from, e.to, ra, rz] : [e.to, e.from, rz, ra]
    let prev = top
    for (let r = r0 + 1; r < r1; r++) {
      const lane = `\u0000${n}:${r}`
      layers[r].push({ key: lane, span: LANE, real: false })
      link(prev, lane)
      prev = lane
    }
    link(prev, bottom)
  })

  // Order: sweep down and up by the average place of each one's neighbours, keeping the order with
  // the fewest crossings.
  const place = new Map<string, number>()
  const index = () => layers.forEach((layer) => layer.forEach((e, k) => place.set(e.key, k)))
  index()
  const crossings = () => {
    let n = 0
    for (let r = 0; r + 1 < layers.length; r++) {
      const pairs = layers[r].flatMap((e) => (down.get(e.key) ?? []).map((lo) => [place.get(e.key)!, place.get(lo)!] as const))
      for (let p = 0; p < pairs.length; p++) for (let q = p + 1; q < pairs.length; q++) if ((pairs[p][0] - pairs[q][0]) * (pairs[p][1] - pairs[q][1]) < 0) n++
    }
    return n
  }
  const mean = (keys: string[] | undefined, own: number) => (keys?.length ? keys.reduce((s, k) => s + place.get(k)!, 0) / keys.length : own)
  let best = layers.map((l) => [...l])
  let fewest = crossings()
  for (let sweep = 0; sweep < 8 && fewest > 0; sweep++) {
    const downward = sweep % 2 === 0
    const order = downward ? layers.map((_, r) => r).slice(1) : layers.map((_, r) => r).slice(0, -1).reverse()
    for (const r of order) {
      const by = downward ? up : down
      layers[r] = layers[r].map((e, k) => [e, mean(by.get(e.key), k)] as const).sort((p, q) => p[1] - q[1]).map(([e]) => e)
      layers[r].forEach((e, k) => place.set(e.key, k))
    }
    const n = crossings()
    if (n < fewest) {
      fewest = n
      best = layers.map((l) => [...l])
    }
  }
  layers.splice(0, layers.length, ...best)
  index()

  // Across: start packed, then pull each one towards the average of its neighbours, keeping the
  // order and the gaps.
  const x = new Map<string, number>()
  for (const layer of layers) {
    let at = 0
    layer.forEach((e, k) => {
      if (k) at += gapBetween(layer[k - 1], e)
      x.set(e.key, at)
    })
    const mid = at / 2
    for (const e of layer) x.set(e.key, x.get(e.key)! - mid)
  }
  const realKeys = new Set(nodes.map((n) => n.key))
  for (let pass = 0; pass < 8; pass++) {
    const downward = pass % 2 === 0
    const order = downward ? layers.map((_, r) => r).slice(1) : layers.map((_, r) => r).slice(0, -1).reverse()
    for (const r of order) {
      const by = downward ? up : down
      const layer = layers[r]
      const want = layer.map((e) => {
        // A step lines up with the steps it links to; lanes for passing lines move aside for them.
        const all = by.get(e.key) ?? []
        const steps = e.real ? all.filter((k) => realKeys.has(k)) : all
        const ns = steps.length ? steps : all
        return ns.length ? ns.reduce((s, k) => s + x.get(k)!, 0) / ns.length : x.get(e.key)!
      })
      const at = placeLayer(layer, want, (e) => (e.real ? 1000 : 0) + (up.get(e.key)?.length ?? 0) + (down.get(e.key)?.length ?? 0))
      layer.forEach((e, k) => x.set(e.key, at[k]))
    }
  }

  // Centred across, and the layers one after another along.
  const real = layers.flat().filter((e) => e.real)
  const lo = Math.min(...real.map((e) => x.get(e.key)! - e.span / 2))
  const hi = Math.max(...real.map((e) => x.get(e.key)! + e.span / 2))
  const shift = (lo + hi) / 2
  const depthOf = new Map(nodes.map((n) => [n.key, n.depth]))
  const out = new Map<string, { across: number; along: number }>()
  let along = 0
  for (const layer of layers) {
    const depth = Math.max(0, ...layer.filter((e) => e.real).map((e) => depthOf.get(e.key)!))
    for (const e of layer) if (e.real) out.set(e.key, { across: x.get(e.key)! - shift, along: along + depth / 2 })
    along += depth + RANK_GAP
  }
  return out
}

/**
 * Places a layer's entries as near where they want to be as their order and gaps allow, the most
 * important first: each goes where it wants, kept clear of those already placed (with room for the
 * ones between).
 */
function placeLayer(layer: Entry[], want: number[], weight: (e: Entry) => number): number[] {
  const at: (number | undefined)[] = layer.map(() => undefined)
  const order = layer.map((_, k) => k).sort((p, q) => weight(layer[q]) - weight(layer[p]) || p - q)
  for (const k of order) {
    let lo = -Infinity
    let hi = Infinity
    let room = 0
    for (let j = k - 1; j >= 0; j--) {
      room += gapBetween(layer[j], layer[j + 1])
      if (at[j] !== undefined) {
        lo = at[j]! + room
        break
      }
    }
    room = 0
    for (let j = k + 1; j < layer.length; j++) {
      room += gapBetween(layer[j - 1], layer[j])
      if (at[j] !== undefined) {
        hi = at[j]! - room
        break
      }
    }
    at[k] = Math.min(Math.max(want[k], lo), hi)
  }
  return at as number[]
}

function gapBetween(a: Entry, b: Entry): number {
  return (a.span + b.span) / 2 + (a.real && b.real ? NODE_GAP : LANE_GAP)
}
