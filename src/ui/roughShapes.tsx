/**
 * The hand-drawn look: shapes, flowchart symbols and lines drawn with rough.js (what Excalidraw
 * draws with), wobbly outlines and pencil-hatched fills. Each object gets its own seed from its id,
 * so its wobble stays the same from frame to frame, in every browser and in exported pictures.
 */

import { RoughGenerator } from 'roughjs/bin/generator'
import type { PathInfo } from 'roughjs/bin/core'

const gen = new RoughGenerator()

export interface RoughStyle {
  /** Outline colour (a colour or a CSS variable). */
  stroke: string
  /** Fill colour; left out for an outline only. */
  fill?: string
  strokeWidth?: number
  /** Which wobble: the object's id. */
  seed: number
  dashed?: boolean
  /** The pencil hatch over a coloured fill; a darker shade of the fill reads best. */
  hatch?: string
}

export type RoughGeom = { kind: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number } | { kind: 'path'; d: string; closed?: boolean }

/** Drawn outlines are cached: the same shape, size and seed always draw the same. */
const cache = new Map<string, PathInfo[]>()
const CACHE_MAX = 4000

// rough.js wants plain colours: these stand for the outline and the fill, put back when drawing
// (so CSS variables work too).
const STROKE = 'rgb(1, 2, 3)'
const FILL = 'rgb(4, 5, 6)'
const BASE = 'rgb(7, 8, 9)'

/** White and near-white fills stay solid (paper); colours get a pencil hatch. */
const solidFill = (fill: string) => /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]/i.test(fill) || /^#fff(fff)?$/i.test(fill) || fill.startsWith('var(')

export function roughPaths(g: RoughGeom, s: RoughStyle): PathInfo[] {
  const key = `${g.kind === 'path' ? g.d : `${g.kind}${Math.round(g.x)},${Math.round(g.y)},${Math.round(g.w)},${Math.round(g.h)}`}|${s.fill ?? ''}|${s.strokeWidth ?? 2}|${s.seed}|${s.dashed ? 1 : 0}`
  const hit = cache.get(key)
  if (hit) return hit
  const opts = {
    seed: (Math.abs(Math.round(s.seed)) % 2_000_000_000) + 1,
    roughness: 1.1,
    bowing: 1,
    stroke: STROKE,
    strokeWidth: s.strokeWidth ?? 2,
    ...(s.fill ? { fill: FILL, fillStyle: solidFill(s.fill) ? 'solid' : 'hachure', hachureGap: 6, fillWeight: 1.2, hachureAngle: -41 } : {}),
    ...(s.dashed ? { strokeLineDash: [8, 6] } : {}),
    // Long lines would wobble too much at the same roughness.
    preserveVertices: g.kind === 'path',
  }
  const draw = (o: typeof opts) =>
    g.kind === 'path' ? gen.path(g.d, g.closed === false ? { ...o, fill: undefined } : o) : g.kind === 'rect' ? gen.rectangle(g.x, g.y, g.w, g.h, o) : gen.ellipse(g.x + g.w / 2, g.y + g.h / 2, g.w, g.h, o)
  // A hatched fill goes over a solid one of the same colour, so words on it read on any board.
  const base = s.fill && !solidFill(s.fill) ? gen.toPaths(draw({ ...opts, fillStyle: 'solid', stroke: 'none' } as typeof opts)).filter((p) => p.fill && p.fill !== 'none').map((p) => ({ ...p, fill: BASE })) : []
  const out = [...base, ...gen.toPaths(draw(opts))]
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, out)
  return out
}

/** A hand-drawn shape as SVG paths; the fill (solid or a pencil hatch) first, the outline on top. */
export function Rough({ geom, style, className }: { geom: RoughGeom; style: RoughStyle; className?: string }) {
  const back = (c: string | undefined) => (c === STROKE ? style.stroke : c === BASE ? (style.fill ?? 'none') : c === FILL ? (style.hatch ?? style.fill ?? 'none') : 'none')
  return (
    <g className={className}>
      {roughPaths(geom, style).map((p, k) => (
        <path key={k} d={p.d} style={{ stroke: back(p.stroke), fill: back(p.fill) }} strokeWidth={p.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </g>
  )
}
