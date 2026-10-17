/**
 * The tools an AI assistant gets (through MCP): definitions plus one runner.
 * The same runner works on the live board in a browser and on a .braincraft file on disk;
 * only the host behind it differs.
 */

import { TEMPLATES } from '../model/templates'
import type { Board, Id, Kind } from '../model/types'
import { KIND_LABELS } from '../model/types'
import { type Op, type OpResult, opsFromText } from './ops'
import { describeBoard, findObjects, getObject, mermaidOf } from './queries'

export interface BoardInfo {
  id: string
  title: string
  updated?: string
  objects?: number
  current?: boolean
}

/** Where the tools act: a live browser tab or a file. */
export interface ToolHost {
  /** Human description, e.g. `the board "Q4 plan" open in your browser`. */
  where(): string
  board(): Board
  /** Applies operations as one step; throws (changing nothing) when one is invalid. */
  apply(ops: Op[]): OpResult[] | Promise<OpResult[]>
  listBoards(): Promise<BoardInfo[]>
  openBoard(idOrTitle: string): Promise<BoardInfo>
  createBoard(title: string, template?: string): Promise<BoardInfo>
}

export const OPS_GUIDE = `Operations are JSON objects with an "op" field, applied as one all-or-nothing batch (one undo step).
Any create op takes "ref": "name" so later ops in the batch can use that name in place of an id, and "at": {"x","y"} for its top-left corner (omit to place it in free space to the right of everything).
Colours: hex or yellow, orange, red, pink, violet, blue, cyan, green, gray, white. Dates: YYYY-MM-DD.

createNote {text, color?, w?, h?} — sticky note
createText {text, fontSize?, w?} — free text
createShape {shape?: rect|ellipse, text?, color?, w?, h?}
createComment {text} — comment block on the board
createFrame {title, around?: [ids/refs]} or {title, w, h} — a titled area
createMindMap {outline: "Root\\n  Child\\n    Grandchild"} or {tree: {text, children: [...]}} — laid out automatically
createFlowchart {mermaid: "flowchart TD\\n  A([Start]) --> B{Ok?}\\n  B -->|Yes| C[Do it]"} — laid out automatically; shapes [ ] process, { } decision, ([ ]) start/end, [/ /] input/output, [( )] database, [[ ]] subprocess
createTable {columns: [names], rows?: [[cells]], title?}
createKanban {title?, columns?: [{title, cards: [text | {title, start?, due?, color?}]}]}
createTimeline {title?, lanes?: [{name, entries: [{title, start, end?, color?}]}], followKanban?: [kanban ids/refs]} — an entry without end is a milestone; followed Kanban boards show their dated cards live
createImage {src: https or data URL, w?, h?}
connect {from, to, label?, style?: straight|elbow|curved, arrows?: end|both|none, dashed?}
update {id, text?, description?, color?, x?, y?, w?, h?} — description is free text shown above an object's comments
delete {ids: [...]} — deleting a mind-map idea deletes its branch
addComment {id, text, author?} — a timestamped work note on an object; mention another object with @[Label](#id)
createDatabase {title, fields?: [name | {name, type: text|number|date|select|person|checkbox, options?}], records?: [{FieldName: value}], views?: [table|board|timeline], groupBy?} — one set of records shown as linked views that stay in sync (a board groups by a select/person field; a timeline uses the first two date fields). Types are guessed from values when not given. The first field is the record title.
react {ids: [...], emoji: "👍", by?} — an emoji reaction on objects (by defaults to "AI")
createVote {options: [ids/refs], question?, each?} — a dot vote: a card above the options; each person spreads "each" votes (default about a third of the options, 1–5), counts hidden until someone reveals them
addRecords {id: any view, records: [{FieldName: value}]} · updateRecord {id: view, record: record id or title, values: {FieldName: value or null}} · deleteRecords {id: view, records: [ids or titles]}`

const fileProp = {
  file: {
    type: 'string',
    description: 'Optional path to a .braincraft file to work on directly. Leave out to use the board open in the browser.',
  },
}

export interface ToolDef {
  name: string
  title: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  readOnly?: boolean
}

const KINDS = Object.keys(KIND_LABELS) as Kind[]

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'read_board',
    title: 'Read board',
    description:
      'Describes the board: its title, how many of each kind of object it has, every object (id, kind, label, position, size, comment count) and the lines between them. Call this first.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: KINDS, description: 'Only list objects of this kind' }, ...fileProp } },
    readOnly: true,
  },
  {
    name: 'get_object',
    title: 'Get object',
    description:
      'One object in full: its text, its comments, and its data (a table as CSV, a Kanban board\'s columns and cards, a timeline\'s lanes and entries, a mind map\'s outline, or the recorded runs of a flowchart that starts at this shape).',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, ...fileProp }, required: ['id'] },
    readOnly: true,
  },
  {
    name: 'find',
    title: 'Search board',
    description: 'Searches all text on the board: objects, comments, table cells, Kanban cards, timeline entries and line labels.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, ...fileProp }, required: ['query'] },
    readOnly: true,
  },
  {
    name: 'apply_ops',
    title: 'Change board',
    description: `Creates, connects, updates or deletes objects on the board.\n\n${OPS_GUIDE}`,
    inputSchema: {
      type: 'object',
      properties: { ops: { type: 'array', items: { type: 'object' }, description: 'The operations, in order' }, ...fileProp },
      required: ['ops'],
    },
  },
  {
    name: 'export_mermaid',
    title: 'Export Mermaid',
    description: 'The board\'s flowcharts (or just the listed objects) as Mermaid flowchart source.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'number' } }, ...fileProp } },
    readOnly: true,
  },
  {
    name: 'list_boards',
    title: 'List boards',
    description: 'Every board saved in the browser (or every .braincraft file in the working folder when no browser is connected).',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
  },
  {
    name: 'open_board',
    title: 'Open board',
    description: 'Switches the browser to another board, by id or by (part of) its title.',
    inputSchema: { type: 'object', properties: { board: { type: 'string' } }, required: ['board'] },
  },
  {
    name: 'create_board',
    title: 'Create board',
    description: `Creates a new board and opens it. Optional template: ${TEMPLATES.map((t) => `${t.id} (${t.hint.toLowerCase()})`).join(', ')}. In file mode, pass "file" as the new file's path.`,
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, template: { type: 'string', enum: TEMPLATES.map((t) => t.id) }, ...fileProp },
      required: ['title'],
    },
  },
]

export class ToolError extends Error {}

const str = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(`"${name}" must be a non-empty string`)
  return v
}

function opsArg(v: unknown): Op[] {
  // Assistants sometimes send the batch as a JSON string; accept that too.
  if (typeof v === 'string') {
    const ops = opsFromText(v)
    if (ops) return ops
  }
  if (Array.isArray(v) && v.every((o) => o && typeof o === 'object' && typeof (o as Op).op === 'string')) return v as Op[]
  throw new ToolError('"ops" must be a list of operations, each with an "op" field')
}

/** Runs one tool against a host; the result is plain JSON for the assistant. */
export async function runTool(host: ToolHost, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (name) {
    case 'read_board':
      return { where: host.where(), ...describeBoard(host.board(), args.kind as Kind | undefined) }
    case 'get_object': {
      const o = getObject(host.board(), Number(args.id) as Id)
      if (!o) throw new ToolError(`No object with id ${String(args.id)}`)
      return o
    }
    case 'find':
      return findObjects(host.board(), str(args.query, 'query'))
    case 'apply_ops': {
      const results = await host.apply(opsArg(args.ops))
      return { where: host.where(), results }
    }
    case 'export_mermaid': {
      const ids = Array.isArray(args.ids) ? (args.ids as number[]) : undefined
      return mermaidOf(host.board(), ids) || 'There are no flowcharts on this board.'
    }
    case 'list_boards':
      return host.listBoards()
    case 'open_board':
      return host.openBoard(str(args.board, 'board'))
    case 'create_board':
      return host.createBoard(str(args.title, 'title'), typeof args.template === 'string' ? args.template : undefined)
    default:
      throw new ToolError(`Unknown tool "${name}"`)
  }
}

/** Finds a board by exact id, then exact title, then part of a title. */
export function pickBoard<T extends { id: string; title: string }>(boards: T[], q: string): T {
  const lower = q.toLowerCase()
  const hit =
    boards.find((b) => b.id === q) ?? boards.find((b) => b.title.toLowerCase() === lower) ?? boards.find((b) => b.title.toLowerCase().includes(lower))
  if (!hit) throw new ToolError(`No board matches "${q}". Boards: ${boards.map((b) => `"${b.title}"`).join(', ') || 'none'}`)
  return hit
}
