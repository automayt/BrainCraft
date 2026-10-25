/**
 * Which features boards use, for the admin's usage page: for each feature, how many boards and
 * wikis use it and how much of it there is. Counted from what's on the boards, so it needs no
 * tracking of what anyone did. Pure functions.
 */

import type { Board } from './types'
import { isWiki, pageOrder, pageText } from './wiki'

export const FEATURES = {
  // Canvas
  sticky: ['Canvas', 'Sticky notes'],
  shape: ['Canvas', 'Shapes'],
  text: ['Canvas', 'Text'],
  frame: ['Canvas', 'Frames'],
  pen: ['Canvas', 'Drawings'],
  sketch: ['Canvas', 'Hand-drawn style'],
  image: ['Canvas', 'Images'],
  link: ['Canvas', 'Link cards'],
  code: ['Canvas', 'Code blocks'],
  connector: ['Canvas', 'Lines between objects'],
  // Diagrams and planning
  mind: ['Diagrams', 'Mind maps'],
  flow: ['Diagrams', 'Flowcharts'],
  run: ['Diagrams', 'Flowchart runs'],
  table: ['Diagrams', 'Tables'],
  kanban: ['Diagrams', 'Kanban boards'],
  timeline: ['Diagrams', 'Timelines'],
  status: ['Diagrams', 'Statuses on objects'],
  // Databases
  database: ['Databases', 'Databases'],
  record: ['Databases', 'Records'],
  recordPage: ['Databases', 'Record pages'],
  formula: ['Databases', 'Formulas'],
  relation: ['Databases', 'Relations'],
  rollup: ['Databases', 'Rollups'],
  automation: ['Databases', 'Automations'],
  form: ['Databases', 'Forms'],
  sharedForm: ['Databases', 'Forms shared by link'],
  // Working together
  comment: ['Together', 'Comments'],
  reaction: ['Together', 'Reactions'],
  vote: ['Together', 'Dot votes'],
  brainstorm: ['Together', 'Private brainstorms'],
  flip: ['Together', 'Flip cards'],
  spinner: ['Together', 'Spinner wheels'],
  // Wikis
  page: ['Wikis', 'Pages'],
  checklist: ['Wikis', 'Checklists'],
  embed: ['Wikis', 'Board embeds'],
  synced: ['Wikis', 'Synced sections'],
  button: ['Wikis', 'Template buttons'],
  macro: ['Wikis', 'Other macros'],
} as const satisfies Record<string, readonly [string, string]>

export type Feature = keyof typeof FEATURES

/** How much of each feature one board holds (features it doesn't use are left out). */
export function featuresOf(b: Board): Partial<Record<Feature, number>> {
  const n: Partial<Record<Feature, number>> = {}
  const add = (f: Feature, k = 1) => {
    if (k > 0) n[f] = (n[f] ?? 0) + k
  }
  for (const i of b.items) {
    switch (i.kind) {
      case 'sticky':
        add(i.back !== undefined ? 'flip' : 'sticky')
        break
      case 'rect':
      case 'ellipse':
        add('shape')
        break
      case 'mind':
        // A mind map is its central idea.
        if (i.parent === undefined) add('mind')
        break
      case 'flow':
        add('flow')
        break
      case 'comment':
        if (i.poll) add('vote')
        else if (i.brainstorm) add('brainstorm')
        else if (i.wheel) add('spinner')
        break
      case 'data':
        if (i.view?.type === 'form') {
          add('form')
          if (i.view.form?.shared) add('sharedForm')
        }
        break
      case 'text':
      case 'frame':
      case 'pen':
      case 'image':
      case 'link':
      case 'code':
      case 'table':
      case 'kanban':
      case 'timeline':
        add(i.kind)
        break
    }
    if (i.sketch) add('sketch')
    if (i.status) add('status')
    add('comment', i.notes?.length ?? 0)
    add('run', i.runs?.length ?? 0)
    add('reaction', Object.values(i.reactions ?? {}).reduce((s, who) => s + who.length, 0))
  }
  add('connector', b.connectors.length)
  for (const ds of b.datasets ?? []) {
    add('database')
    add('record', ds.records.length)
    add('recordPage', ds.records.filter((r) => r.body?.trim()).length)
    add('formula', ds.fields.filter((f) => f.type === 'formula').length)
    add('relation', ds.fields.filter((f) => f.type === 'relation').length)
    add('rollup', ds.fields.filter((f) => f.type === 'rollup').length)
    add('automation', ds.automations?.length ?? 0)
  }
  if (isWiki(b))
    for (const p of pageOrder(b)) {
      add('page')
      const text = pageText(b, p.id)
      if (/^\s*[-*] \[[ xX]\]/m.test(text)) add('checklist')
      add('embed', text.match(/\]\(board:/g)?.length ?? 0)
      const macros = [...text.matchAll(/\{\{\s*([a-z]+)/gi)].map((m) => m[1].toLowerCase())
      add('synced', macros.filter((m) => m === 'synced').length)
      add('button', macros.filter((m) => m === 'button').length)
      add('macro', macros.filter((m) => m !== 'synced' && m !== 'button').length)
    }
  return n
}

export interface FeatureRow {
  feature: Feature
  group: string
  label: string
  /** Boards and wikis using it. */
  boards: number
  /** How much of it there is, across them. */
  total: number
}

/** Every feature across many boards, most widely used first (unused ones last, with zeros). */
export function tallyFeatures(boards: Iterable<Board>): { boards: number; wikis: number; rows: FeatureRow[] } {
  const rows = new Map<Feature, FeatureRow>(
    (Object.keys(FEATURES) as Feature[]).map((f) => [f, { feature: f, group: FEATURES[f][0], label: FEATURES[f][1], boards: 0, total: 0 }]),
  )
  let canvases = 0
  let wikis = 0
  for (const b of boards) {
    if (isWiki(b)) wikis++
    else canvases++
    for (const [f, k] of Object.entries(featuresOf(b)) as [Feature, number][]) {
      const r = rows.get(f)!
      r.boards++
      r.total += k
    }
  }
  return { boards: canvases, wikis, rows: [...rows.values()].sort((a, z) => z.boards - a.boards || z.total - a.total) }
}
