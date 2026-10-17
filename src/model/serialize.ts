import { addItem, connect, emptyBoard, newItem, type Clip } from './board'
import { addStep, flowItem } from './flowchart'
import { addChild, createMap } from './mindmap'
import { type Board, type Dataset, FILLS, FORMAT_VERSION, type Item } from './types'

export function toJson(b: Board): string {
  return JSON.stringify(b, null, 2)
}

const KINDS = new Set(['sticky', 'rect', 'ellipse', 'text', 'frame', 'pen', 'mind', 'flow', 'comment', 'image', 'table', 'kanban', 'timeline', 'data', 'link', 'code'])

function isItem(x: unknown): x is Item {
  const i = x as Item
  return (
    typeof i === 'object' &&
    i !== null &&
    typeof i.id === 'number' &&
    KINDS.has(i.kind) &&
    [i.x, i.y, i.w, i.h, i.fontSize].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    typeof i.color === 'string' &&
    typeof i.text === 'string' &&
    (i.kind !== 'link' || typeof i.link?.url === 'string')
  )
}

function isDataset(x: unknown): x is Dataset {
  const d = x as Dataset
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof d.id === 'string' &&
    typeof d.name === 'string' &&
    Array.isArray(d.fields) &&
    d.fields.length > 0 &&
    d.fields.every((f) => f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.type === 'string') &&
    Array.isArray(d.records) &&
    d.records.every((r) => r && typeof r.id === 'string' && typeof r.values === 'object' && r.values !== null)
  )
}

/** Parses a saved board, dropping anything malformed and repairing ids. Throws on non-boards. */
export function fromJson(json: string): Board {
  const raw = JSON.parse(json) as Partial<Board>
  if (!raw || !Array.isArray(raw.items) || !Array.isArray(raw.connectors)) throw new Error('Not a BrainCraft board')
  const items = raw.items.filter(isItem)
  const ids = new Set(items.map((i) => i.id))
  // Mind-map nodes whose parent is missing become roots.
  for (const i of items) {
    if (i.parent !== undefined && !ids.has(i.parent)) {
      delete i.parent
      delete i.side
    }
  }
  const connectors = raw.connectors.filter(
    (c) => c && typeof c.id === 'number' && ids.has(c.from) && ids.has(c.to) && typeof c.color === 'string',
  )
  const datasets = Array.isArray(raw.datasets) ? raw.datasets.filter(isDataset) : []
  // A view whose dataset is missing has nothing to show.
  const known = new Set(datasets.map((d) => d.id))
  const kept = items.filter((i) => i.kind !== 'data' || (i.view && known.has(i.view.dataset)))
  const keptIds = new Set(kept.map((i) => i.id))
  const maxId = Math.max(0, ...items.map((i) => i.id), ...connectors.map((c) => c.id))
  return {
    version: FORMAT_VERSION,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled board',
    ...(typeof raw.icon === 'string' && raw.icon && raw.icon.length <= 16 ? { icon: raw.icon } : {}),
    items: kept,
    connectors: connectors.filter((c) => keptIds.has(c.from) && keptIds.has(c.to)),
    nextId: Math.max(typeof raw.nextId === 'number' ? raw.nextId : 0, maxId + 1),
    ...(datasets.length ? { datasets } : {}),
  }
}

const CLIP_TAG = 'braincraft/clip'

export function clipToText(clip: Clip): string {
  return JSON.stringify({ type: CLIP_TAG, ...clip })
}

export function clipFromText(text: string): Clip | null {
  try {
    const raw = JSON.parse(text)
    if (raw?.type !== CLIP_TAG || !Array.isArray(raw.items)) return null
    const items = (raw.items as unknown[]).filter(isItem)
    const datasets = Array.isArray(raw.datasets) ? (raw.datasets as unknown[]).filter(isDataset) : []
    return { items, connectors: Array.isArray(raw.connectors) ? raw.connectors : [], ...(datasets.length ? { datasets } : {}) }
  } catch {
    return null
  }
}

/** The board shown on first visit. */
export function welcomeBoard(): Board {
  let b = emptyBoard('Welcome to BrainCraft')
  let id: number
  ;[b] = addItem(b, newItem('frame', { x: -60, y: -40, w: 1180, h: 660 }, { text: 'Welcome to BrainCraft' }))
  ;[b] = addItem(
    b,
    newItem('text', { x: 0, y: 0, w: 760, h: 48 }, { text: 'Brainstorm on an infinite canvas', fontSize: 34 }),
  )
  const notes: [string, number][] = [
    ['Pick a tool on the left, or right-click anywhere', 0],
    ['Double-click anything to edit its text', 5],
    ['Ctrl K searches everything and runs any command', 7],
    ['Press M for a mind map or D for a flowchart — then Tab adds the next idea', 3],
  ]
  const ids: number[] = []
  notes.forEach(([text, color], n) => {
    ;[b, id] = addItem(b, newItem('sticky', { x: n * 260, y: 110, w: 220, h: 220 }, { text, color: FILLS[color][1] }))
    ids.push(id)
  })
  for (let k = 1; k < ids.length; k++) [b] = connect(b, ids[k - 1], ids[k])

  // A small mind map to the right of the frame.
  let root: number
  ;[b, root] = createMap(b, { x: 1700, y: 290 }, 'Product launch')
  const branches: [string, string[]][] = [
    ['Audience', ['Early adopters', 'Teams']],
    ['Channels', ['Blog post', 'Social', 'Newsletter']],
    ['Risks', ['Timeline', 'Scope creep']],
    ['Success', ['Sign-ups', 'Retention']],
  ]
  for (const [text, leaves] of branches) {
    let branch: number
    ;[b, branch] = addChild(b, root, undefined, text)
    for (const leaf of leaves) [b] = addChild(b, branch, undefined, leaf)
  }

  // A small flowchart below the mind map.
  const text = (id: number | null, t: string) => {
    b = { ...b, items: b.items.map((i) => (i.id === id ? { ...i, text: t } : i)) }
  }
  const label = (to: number | null, t: string) => {
    b = { ...b, connectors: b.connectors.map((c) => (c.to === to ? { ...c, label: t } : c)) }
  }
  let start: number, ask: number | null, yes: number | null, no: number | null, done: number | null
  ;[b, start] = addItem(b, flowItem('terminator', { x: 1700, y: 760 }))
  text(start, 'New idea')
  ;[b, ask] = addStep(b, start, 'down', 'decision')
  text(ask, 'Is it clear yet?')
  ;[b, yes] = addStep(b, ask!, 'down')
  text(yes, 'Sketch it out')
  label(yes, 'Yes')
  ;[b, no] = addStep(b, ask!, 'right')
  text(no, 'Mind-map it first')
  label(no, 'No')
  ;[b, done] = addStep(b, yes!, 'down', 'terminator')
  text(done, 'Share with the team')
  return b
}
