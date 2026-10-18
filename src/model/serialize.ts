import { addItem, connect, emptyBoard, newItem, type Clip } from './board'
import { addStep, flowItem } from './flowchart'
import { addChild, createMap } from './mindmap'
import { MAX_ID, cleanBody, cleanConnector, cleanDataset, cleanIcon, cleanItem, cleanPage, cleanSnap } from './sanitize'
import { type Board, type Connector, type Dataset, FILLS, FORMAT_VERSION, type Item, type Page, type PageBody, type Snap } from './types'
import { MAX_PAGES, MAX_SNAPS } from './wiki'

export function toJson(b: Board): string {
  return JSON.stringify(b, null, 2)
}

/** Parses a saved board, dropping anything malformed and repairing ids. Throws on non-boards. */
export function fromJson(json: string): Board {
  const raw = JSON.parse(json) as Partial<Board>
  if (!raw || !Array.isArray(raw.items) || !Array.isArray(raw.connectors)) throw new Error('Not a BrainCraft board')
  // Every field is checked: a bad one never reaches the screen. Duplicate ids keep the first.
  const ids = new Set<number>()
  const items = raw.items.map(cleanItem).filter((i): i is Item => !!i && !ids.has(i.id) && !!ids.add(i.id))
  // Mind-map nodes whose parent is missing become roots.
  for (const i of items) {
    if (i.parent !== undefined && !ids.has(i.parent)) {
      delete i.parent
      delete i.side
    }
  }
  const connectors = raw.connectors.map(cleanConnector).filter((c): c is Connector => !!c && ids.has(c.from) && ids.has(c.to))
  const datasets = Array.isArray(raw.datasets) ? raw.datasets.map(cleanDataset).filter((d): d is Dataset => !!d) : []
  // A view whose dataset is missing has nothing to show.
  const known = new Set(datasets.map((d) => d.id))
  const kept = items.filter((i) => i.kind !== 'data' || (i.view && known.has(i.view.dataset)))
  const keptIds = new Set(kept.map((i) => i.id))
  // A loop, not Math.max(...ids): spreading a very big board overflows the call stack.
  let maxId = 0
  for (const o of [...items, ...connectors]) if (o.id > maxId) maxId = o.id
  // Wiki pages: the first of any repeated id, parents that exist, words only for pages that do.
  const wiki = raw.kind === 'wiki'
  const pageIds = new Set<string>()
  const pages = (Array.isArray(raw.pages) ? raw.pages.map(cleanPage) : [])
    .filter((p): p is Page => !!p && !pageIds.has(p.id) && !!pageIds.add(p.id))
    .slice(0, MAX_PAGES)
  const knownPages = new Set(pages.map((p) => p.id))
  for (const p of pages) if (p.parent !== undefined && !knownPages.has(p.parent)) delete p.parent
  const bodyIds = new Set<string>()
  const bodies = (Array.isArray(raw.bodies) ? raw.bodies.map(cleanBody) : []).filter(
    (x): x is PageBody => !!x && knownPages.has(x.id) && !bodyIds.has(x.id) && !!bodyIds.add(x.id),
  )
  const snapKeys = new Set<string>()
  const snaps = (wiki && Array.isArray(raw.snaps) ? raw.snaps.slice(0, MAX_SNAPS).map(cleanSnap) : []).filter(
    (s): s is Snap => !!s && !snapKeys.has(s.key) && !!snapKeys.add(s.key),
  )
  return {
    version: FORMAT_VERSION,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled board',
    ...(cleanIcon(raw.icon) ? { icon: cleanIcon(raw.icon) } : {}),
    items: kept,
    connectors: connectors.filter((c) => keptIds.has(c.from) && keptIds.has(c.to)),
    // Ids are whole numbers: a nextId like 2.5 or 1e309 would give new objects ids a reload drops.
    nextId: Math.max(Number.isSafeInteger(raw.nextId) && (raw.nextId as number) <= MAX_ID ? (raw.nextId as number) : 0, maxId + 1),
    ...(datasets.length ? { datasets } : {}),
    ...(wiki ? { kind: 'wiki' as const } : {}),
    // Only a wiki keeps pages: a board that smuggles some in loses them on load.
    ...(wiki ? { pages, bodies } : {}),
    ...(snaps.length ? { snaps } : {}),
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
    // Pasted clips are checked like any other board data.
    const items = (raw.items as unknown[]).map(cleanItem).filter((i): i is Item => !!i)
    const datasets = Array.isArray(raw.datasets) ? (raw.datasets as unknown[]).map(cleanDataset).filter((d): d is Dataset => !!d) : []
    const connectors = Array.isArray(raw.connectors) ? (raw.connectors as unknown[]).map(cleanConnector).filter((c): c is Connector => !!c) : []
    return { items, connectors, ...(datasets.length ? { datasets } : {}) }
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
