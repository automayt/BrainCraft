/**
 * The tools an AI assistant gets (through MCP): definitions plus one runner.
 * The same runner works on the live board in a browser and on a .braincraft file on disk;
 * only the host behind it differs.
 */

import { TEMPLATES } from '../model/templates'
import { WIKI_TEMPLATES } from '../model/wikiTemplates'
import type { Board, Id, Kind } from '../model/types'
import { KIND_LABELS } from '../model/types'
import { type Op, type OpResult, opsFromText } from './ops'
import { describeBoard, findObjects, getObject, getPage, listPages, mermaidOf, pageHistory, pageVersion } from './queries'
import { isWiki } from '../model/wiki'

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
createMindMap {outline: "Root\\n  Child\\n    Grandchild"} or {tree: {text, children: [...]}} — laid out and coloured automatically; one line ("Topic") is a map with just its central idea
addIdeas {parent: idea id, ideas: "Jason\\n  Workstations\\nBrian"} — adds ideas under an idea (each line one idea; indented lines go under the line above); laid out and coloured automatically. Also a list: ["Jason", {"text": "Brian", "children": ["Servers"]}]
moveIdea {id, parent} — moves an idea and its branch under another idea · setMindMap {id: any idea in it, outline} — rewrites the whole map to this outline in place, for a big reorganisation (ideas whose words stay keep their identity and colour)
createFlowchart {mermaid: "flowchart TD\\n  A([Start]) --> B{Ok?}\\n  B -->|Yes| C[Do it]"} — laid out automatically; shapes [ ] process, { } decision, ([ ]) start/end, [/ /] input/output, [( )] database, [[ ]] subprocess
addSteps {after: step id, steps: [text | {text, shape?: process|decision|start|end|io|database|document|subprocess, label?}], direction?: down|right|up|left} — a chain of connected steps after a step, each sized for its words; for a decision, one addSteps per branch with label "Yes" / "No" · setFlowchart {id: any step in it, mermaid} — replaces the whole flowchart where it is
createTable {columns: [names], rows?: [[cells]], title?}
createKanban {title?, columns?: [{title, cards: [text | {title, start?, due?, color?}]}]}
createTimeline {title?, lanes?: [{name, entries: [{title, start, end?, color?}]}], followKanban?: [kanban ids/refs]} — an entry without end is a milestone; followed Kanban boards show their dated cards live
setKanban {id, title?, columns} · setTable {id, title?, columns, rows?} · setTimeline {id, title?, lanes} — a widget's whole new content, the same fields as creating it (the board lists what's in each now); cards, rows and entries already there keep their details (matched by title, or a row by its first cell)
createImage {src: https or data URL, w?, h?}
createCode {code, lang?} — a code block with syntax colouring (javascript, typescript, python, rust, go, c, sql, shell, css, json; guessed when left out)
createSpinner {options: [text, …]} — a spinner wheel card; anyone can spin it and everyone sees the same answer
createLink {url, w?, h?} — a card for a web page: its title, description and picture fill in when the app is connected to a BrainCraft server; YouTube, Vimeo and Spotify links play on the card
connect {from, to, label?, style?: straight|elbow|curved, arrows?: end|both|none, dashed?, freeform?} — freeform: true when loose boxes and lines are really wanted (not for mind maps or flowcharts)
update {id, text?, description?, color?, x?, y?, w?, h?, locked?, status?, sketch?, linkTo?} — linkTo makes the object lead somewhere when clicked: a wiki page {"board": WIKI_KEY, "page": PAGE_ID, "heading"?: anchor} (or {"page": ID} in this wiki), another board {"board": KEY}, an object {"item": ID} (with "board" for another board's), or a web address as a string; null removes it. sketch: true draws it by hand (wobbly outline, handwriting); description is free text shown above an object's comments; locked objects can't be moved or changed by accident; status marks where it stands: todo, doing, waiting, undecided, done, dropped, or none to clear (not on frames, drawings or data widgets)
delete {ids: [...]} — deleting a mind-map idea deletes its branch
addComment {id, text, author?} — a timestamped comment on an object; mention another object with @[Label](#id). In comments and descriptions, [[Name]] links to the board or object called Name (boards first)
createDatabase {title, fields?: [name | {name, type: text|number|date|select|person|checkbox, options?}], records?: [{FieldName: value}], views?: [table|board|timeline|calendar|gallery], groupBy?} — one set of records shown as linked views that stay in sync (a board groups by a select/person field; a timeline uses the first two date fields; a calendar puts records on their first date field's days; a gallery shows cards, with a picture from any field holding an image address). Types are guessed from values when not given. The first field is the record title.
react {ids: [...], emoji: "👍", by?} — an emoji reaction on objects (by defaults to "AI")
createVote {options: [ids/refs], question?, each?} — a dot vote: a card above the options; each person spreads "each" votes (default about a third of the options, 1–5), counts hidden until someone reveals them
addField {id: any view, field: {name, type, …}} — a field for an existing database. Besides text|number|date|select|person|checkbox, fields can be: formula {formula: "{Price} * {Qty}"} (fields in braces; + - * / %, = != < > <= >=, and/or/not, if(test, a, b), round(x, n), min, max, empty(x), daysUntil({Due}), days(from, to), addDays(date, n), today()); relation {to: "Other database name"} linking each record to records there (give a record's links as their titles, a list or "A, B"); rollup {relation: "Relation field", field?: "Their field", fn: count|filled|sum|average|min|max|earliest|latest|percentDone|list}. Formulas and rollups are worked out, never set. createDatabase takes the same field specs.
addRecords {id: any view, records: [{FieldName: value}]} · updateRecord {id: view, record: record id or title, values?: {FieldName: value or null}, body?: Markdown} — body is the record's page (notes, a checklist, a spec), shown under its fields when opened · deleteRecords {id: view, records: [ids or titles]}

Build things the way BrainCraft builds them, so they look right and lay themselves out:
- Ideas around a topic are a mind map (createMindMap), never boxes joined by lines. Grow one with addIdeas under the right idea: "add Jason and Brian off infrastructure" is addIdeas {parent: <infrastructure's id>, ideas: "Jason\\nBrian"}. One idea per idea, never several lines in one; ideas hang off their parent, so draw no lines between them. Rename with update {id, text}; delete takes an idea's branch.
- Steps and decisions are a flowchart (createFlowchart), grown with addSteps, never shapes and lines placed by hand.
- To change a Kanban board, table or timeline, send its new content with setKanban, setTable or setTimeline.
- Change what's there instead of making a second copy or starting again; restructure a whole map or chart with setMindMap or setFlowchart. Leave out "at" unless asked: new things go into free space.
- A proposal that makes a mess (lines between ideas, several ideas in one, a tree of plain boxes and lines, something on top of something else) comes back once to be tidied.

Wikis (boards of pages instead of a canvas; only these ops work on them). "page", "parent" and "before" take a page id, a "ref" from earlier in the batch, or an exact page title:
createPage {title, parent?, before?, text?, icon?, ref?} — a page (under "parent", before "before" or last), its text in Markdown
updatePage {page, title?, text?, append?, icon?, note?, protected?} — "text" replaces the page's Markdown, "append" adds to the end; "note" says what changed (kept in the page's history); "protected": true lets only the wiki's managers change it and the pages under it
movePage {page, parent?: page or null for the top, before?} · deletePage {page} — moves it (and its sub-pages) to the trash
Page Markdown: # headings, - lists, - [ ] checklists, | tables |, \`\`\` code, > quotes, > [!tip] / [!note] / [!warning] / [!danger] callouts, macros on a line of their own: {{children}} sub-pages, {{toc}} headings, {{pagetree}} (or {{pagetree here}}), {{tasks}} open checklist items (or {{tasks here}}, {{tasks all}} with ticked ones), {{recent 5}} (at most 50), {{include "Page title"}}, {{expand Title}} … {{/expand}}, {{columns}} … {{column}} … {{/columns}}; inside sentences {{status Done green}} (colours: grey, blue, green, yellow, orange, red, purple; without one it picks from the words), {{countdown 2026-12-20}}, {{today}}. Link a page with [[Title]](page:ID) (or [[Title]] by name), a heading with [[Title › Heading]](page:ID#anchor), a page in another wiki with [[Title]](board:KEY/page:ID), an object on a canvas board with [[Label]](board:KEY#ID). A line ![[Label]](board:KEY#ID) on its own shows that object inside the page (![[Label]](board:KEY) a whole board; ![[Label|420]](board:KEY#ID) sets its height in pixels); ![[Label|text]](board:KEY#ID) shows it as text kept in step with the board (a mind map as bullets, a Kanban board as checklists, a table or database as a table, a timeline as dated lists), which is how to put those in a page.`

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
    name: 'list_pages',
    title: 'List wiki pages',
    description: 'A wiki’s pages as a tree: each page’s id, title, when and by whom it was last edited, how long it is, and its sub-pages; plus the trash.',
    inputSchema: { type: 'object', properties: { ...fileProp } },
    readOnly: true,
  },
  {
    name: 'read_page',
    title: 'Read wiki page',
    description: 'One wiki page in full: where it sits, its Markdown, its sub-pages and the pages that link to it. "page" is its id or exact title. With "version" (a number from page_history), that saved version instead.',
    inputSchema: { type: 'object', properties: { page: { type: 'string' }, version: { type: 'number' }, ...fileProp }, required: ['page'] },
    readOnly: true,
  },
  {
    name: 'page_history',
    title: 'Wiki page history',
    description: 'A wiki page’s saved versions, newest first: number, when, who, the writer’s note, lines added and removed, renames and milestones. Read one with read_page and "version"; put one back with updatePage and its text.',
    inputSchema: { type: 'object', properties: { page: { type: 'string' }, ...fileProp }, required: ['page'] },
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
    description: `Creates a new board and opens it. Optional template: ${[...TEMPLATES, ...WIKI_TEMPLATES].map((t) => `${t.id} (${t.hint.toLowerCase()})`).join(', ')}. The wiki ones make a wiki (pages in a tree, written in Markdown). In file mode, pass "file" as the new file's path.`,
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, template: { type: 'string', enum: [...TEMPLATES, ...WIKI_TEMPLATES].map((t) => t.id) }, ...fileProp },
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
    case 'list_pages': {
      const b = host.board()
      if (!isWiki(b)) throw new ToolError('This board isn’t a wiki. Open one with open_board, or make one with create_board and template "wiki".')
      return { where: host.where(), ...listPages(b) }
    }
    case 'read_page': {
      const b = host.board()
      if (!isWiki(b)) throw new ToolError('This board isn’t a wiki.')
      const ref = str(args.page, 'page')
      const p = typeof args.version === 'number' ? pageVersion(b, ref, args.version) : getPage(b, ref)
      if (!p) throw new ToolError(`No page "${String(args.page)}" in this wiki. Call list_pages for the ids.`)
      if (typeof p === 'string') throw new ToolError(p)
      return p
    }
    case 'page_history': {
      const b = host.board()
      if (!isWiki(b)) throw new ToolError('This board isn’t a wiki.')
      const h = pageHistory(b, str(args.page, 'page'))
      if (!h) throw new ToolError(`No page "${String(args.page)}" in this wiki. Call list_pages for the ids.`)
      return h
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
