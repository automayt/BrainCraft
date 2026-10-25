/**
 * Every operation as a JSON Schema, for the server's OpenAPI description (`/api/openapi.json`)
 * and anything else that wants to check a batch before sending it. Kept beside `ops.ts`; a test
 * makes sure each operation there has a schema here.
 */

import type { Op } from './ops'

type Schema = Record<string, unknown>

const str = (description?: string): Schema => ({ type: 'string', ...(description ? { description } : {}) })
const num = (description?: string): Schema => ({ type: 'number', ...(description ? { description } : {}) })
const bool = (description?: string): Schema => ({ type: 'boolean', ...(description ? { description } : {}) })
const list = (items: Schema, description?: string): Schema => ({ type: 'array', items, ...(description ? { description } : {}) })
const oneOf = (...s: Schema[]): Schema => ({ oneOf: s })
const ref = oneOf(num('An object id'), str('The "ref" of an object made earlier in the batch'))
const day = str('A date, YYYY-MM-DD')
const color = str('Hex ("#aad2fa") or a palette name: yellow, orange, red, pink, violet, blue, cyan, green, gray, white')
const pageRef = str('A page id, a "ref" from earlier in the batch, or an exact page title')

const placed: Record<string, Schema> = {
  ref: str('A name later operations in the batch can use in place of this object’s id'),
  at: { type: 'object', properties: { x: num(), y: num() }, required: ['x', 'y'], description: 'Top-left corner on the board; leave out to place it in free space' },
}
const size: Record<string, Schema> = { w: num('Width'), h: num('Height') }

interface OpSchema {
  summary: string
  properties: Record<string, Schema>
  required?: string[]
}

export const OP_SCHEMAS: Record<Op['op'], OpSchema> = {
  createNote: { summary: 'A sticky note', properties: { text: str(), color, ...size, ...placed }, required: ['text'] },
  createText: { summary: 'Free text', properties: { text: str(), fontSize: num('Default 28'), w: num(), ...placed }, required: ['text'] },
  createShape: { summary: 'A rectangle or ellipse', properties: { shape: { enum: ['rect', 'ellipse'] }, text: str(), color, ...size, ...placed } },
  createComment: { summary: 'A comment block on the board, timestamped', properties: { text: str(), ...placed }, required: ['text'] },
  createFrame: { summary: 'A titled area, sent behind what it holds', properties: { title: str(), around: list(ref, 'Objects to enclose'), ...size, ...placed }, required: ['title'] },
  createMindMap: {
    summary: 'A mind map, laid out automatically',
    properties: {
      outline: str('An indented list, two spaces per level (Markdown bullets are fine); one line is just the central idea'),
      tree: { type: 'object', description: '{"text", "children": [...]}, instead of an outline' },
      ...placed,
    },
  },
  addIdeas: {
    summary: 'Adds ideas to a mind map under an idea; laid out automatically',
    properties: {
      parent: ref,
      ideas: oneOf(str('One idea per line; indent two spaces for ideas under the line above'), list(oneOf(str(), { type: 'object', description: '{"text", "children": [...]}' }))),
      ref: placed.ref,
    },
    required: ['parent', 'ideas'],
  },
  moveIdea: { summary: 'Moves a mind-map idea (with its branch) under another idea', properties: { id: ref, parent: ref }, required: ['id', 'parent'] },
  setMindMap: {
    summary: 'Rewrites the whole mind map an idea belongs to, in place (ideas whose words stay are kept)',
    properties: { id: ref, outline: str('The new map as an indented list'), tree: { type: 'object', description: '{"text", "children": [...]}' }, branch: bool('Just this idea’s branch, not the whole map') },
    required: ['id'],
  },
  createFlowchart: { summary: 'A flowchart from Mermaid, laid out automatically', properties: { mermaid: str('A Mermaid flowchart (flowchart TD …)'), ...placed }, required: ['mermaid'] },
  addSteps: {
    summary: 'Adds a chain of connected steps after a flowchart step',
    properties: {
      after: ref,
      steps: list(oneOf(str(), { type: 'object', properties: { text: str(), shape: { enum: ['process', 'decision', 'start', 'end', 'terminator', 'io', 'data', 'document', 'database', 'subprocess', 'subroutine'] }, label: str('Words on the line into it, like "Yes"') }, required: ['text'] })),
      direction: { enum: ['down', 'right', 'up', 'left'] },
      ref: placed.ref,
    },
    required: ['after', 'steps'],
  },
  setFlowchart: { summary: 'Replaces the whole flowchart a step belongs to, where it is', properties: { id: ref, mermaid: str('The new flowchart in Mermaid') }, required: ['id', 'mermaid'] },
  createTable: { summary: 'A table', properties: { title: str(), columns: list(str()), rows: list(list(oneOf(str(), num()))), ...placed }, required: ['columns'] },
  createKanban: {
    summary: 'A Kanban board (default columns: To do, In progress, Done)',
    properties: {
      title: str(),
      columns: list({
        type: 'object',
        properties: { title: str(), cards: list(oneOf(str(), { type: 'object', properties: { title: str(), start: day, due: day, color }, required: ['title'] })) },
        required: ['title'],
      }),
      ...placed,
    },
  },
  createTimeline: {
    summary: 'A timeline of lanes; an entry without an end is a milestone',
    properties: {
      title: str(),
      lanes: list({
        type: 'object',
        properties: { name: str(), entries: list({ type: 'object', properties: { title: str(), start: day, end: day, color }, required: ['title', 'start'] }) },
        required: ['name'],
      }),
      followKanban: list(ref, 'Kanban boards whose dated cards show live in their own lane'),
      ...size,
      ...placed,
    },
  },
  setKanban: {
    summary: 'Replaces a Kanban board’s columns and cards; cards already there keep their dates and colours',
    properties: {
      id: ref,
      title: str(),
      columns: list({
        type: 'object',
        properties: { title: str(), cards: list(oneOf(str(), { type: 'object', properties: { title: str(), start: day, due: day, color }, required: ['title'] })) },
        required: ['title'],
      }),
    },
    required: ['id', 'columns'],
  },
  setTable: { summary: 'Replaces a table’s columns and rows', properties: { id: ref, title: str(), columns: list(str()), rows: list(list(oneOf(str(), num()))) }, required: ['id', 'columns'] },
  setTimeline: {
    summary: 'Replaces a timeline’s lanes and entries; entries already there keep what waits on them',
    properties: {
      id: ref,
      title: str(),
      lanes: list({
        type: 'object',
        properties: { name: str(), entries: list({ type: 'object', properties: { title: str(), start: day, end: day, color }, required: ['title', 'start'] }) },
        required: ['name'],
      }),
    },
    required: ['id', 'lanes'],
  },
  createImage: { summary: 'An image', properties: { src: str('A data:image/… or https:// address'), ...size, ...placed }, required: ['src'] },
  createLink: { summary: 'A link card; YouTube, Vimeo and Spotify play on it', properties: { url: str('One http(s) address'), ...size, ...placed }, required: ['url'] },
  createSpinner: { summary: 'A spinner wheel everyone sees land on the same answer', properties: { options: list(str(), 'Two or more'), ...placed }, required: ['options'] },
  createCode: { summary: 'A code block with syntax colouring', properties: { code: str(), lang: str('Guessed when left out'), ...size, ...placed }, required: ['code'] },
  connect: {
    summary: 'A line between two objects',
    properties: {
      from: ref,
      to: ref,
      label: str(),
      style: { enum: ['straight', 'elbow', 'curved'] },
      arrows: { enum: ['end', 'both', 'none'] },
      dashed: bool(),
      ref: placed.ref,
      freeform: bool('Loose boxes and lines on purpose (not a mind map or flowchart)'),
    },
    required: ['from', 'to'],
  },
  update: {
    summary: 'Changes an object',
    properties: {
      id: ref,
      text: str(),
      description: str('Free text shown above its comments'),
      color,
      x: num(),
      y: num(),
      ...size,
      locked: bool(),
      status: { enum: ['todo', 'doing', 'waiting', 'undecided', 'done', 'dropped', 'none'], description: '"none" clears it' },
      sketch: bool('Drawn by hand: wobbly outlines and handwriting (shapes, flowchart shapes, notes, text, frames, mind maps)'),
      linkTo: {
        description: 'Where the object leads when clicked: a web address, a wiki page {"board": key, "page": id, "heading"?: anchor}, a board {"board": key}, or an object {"item": id, "board"?: key}; null removes it',
        anyOf: [{ type: 'string' }, { type: 'object' }, { type: 'null' }],
      },
    },
    required: ['id'],
  },
  delete: { summary: 'Deletes objects (a mind-map idea takes its branch)', properties: { ids: list(ref) }, required: ['ids'] },
  addComment: { summary: 'A timestamped comment on an object; @[Label](#id) mentions another object, @[Name](user:) a person by name', properties: { id: ref, text: str(), author: str() }, required: ['id', 'text'] },
  createDatabase: {
    summary: 'One set of records shown as linked views that stay in sync',
    properties: {
      title: str(),
      fields: list(oneOf(str(), { type: 'object', properties: { name: str(), type: { enum: ['text', 'number', 'date', 'select', 'person', 'checkbox'] }, options: list(str()) }, required: ['name'] }), 'Types are guessed from the values when not given; the first field is each record’s title'),
      records: list({ type: 'object', description: 'Values by field name' }),
      views: list({ enum: ['table', 'board', 'timeline', 'calendar', 'gallery', 'form'] }),
      groupBy: str('A choice or person field, for the board view'),
      ...placed,
    },
  },
  addField: {
    summary: 'Adds a field to a database: plain, a formula, a relation to another database, or a rollup of a relation',
    properties: {
      id: ref,
      field: {
        type: 'object',
        properties: {
          name: str(),
          type: { enum: ['text', 'number', 'date', 'select', 'person', 'checkbox', 'relation', 'rollup', 'formula'] },
          options: list(str()),
          formula: str('For a formula: fields in braces, e.g. {Price} * {Qty}'),
          to: oneOf(str('For a relation: the database it links to, by name'), num('or one of its views')),
          relation: str('For a rollup: the relation field it sums up'),
          field: str('For a rollup: the linked records’ field (left out to count them)'),
          fn: { enum: ['count', 'filled', 'sum', 'average', 'min', 'max', 'earliest', 'latest', 'percentDone', 'list'] },
        },
        required: ['name'],
      },
    },
    required: ['id', 'field'],
  },
  addAutomation: {
    summary: 'A rule on a database: when a record is added, or a field changes (to a value), set fields of that record',
    properties: {
      id: ref,
      when: { type: 'object', description: '{"added": true}, or {"field": name, "to"?: value} (left out: any change)' },
      set: list({ type: 'object', properties: { field: str(), value: { description: 'A value, "today" (a date field), or null for empty' } }, required: ['field'] }),
    },
    required: ['id', 'when', 'set'],
  },
  setForm: {
    summary: 'Makes a database view a form (each answer a new record) and sets it up',
    properties: {
      id: ref,
      title: str('Above the questions (default: the database name)'),
      intro: str('Words under the title: what it is for'),
      thanks: str('Shown after answering'),
      ask: list(str('A field name'), 'The fields it asks, in database order (default: every field a form can ask)'),
      required: list(str('A field name'), 'Fields that need an answer'),
      shared: { type: 'boolean', description: 'Anyone with the link can answer without opening the board' },
    },
    required: ['id'],
  },
  addRecords: { summary: 'Adds records to a database', properties: { id: ref, records: list({ type: 'object' }) }, required: ['id', 'records'] },
  updateRecord: { summary: 'Sets fields of one record by name (null or "" clears one), and/or its page', properties: { id: ref, record: str('A record id or title'), values: { type: 'object' }, body: str('The record’s page, in Markdown: notes, a checklist, a spec ("" removes it)') }, required: ['id', 'record'] },
  deleteRecords: { summary: 'Deletes records', properties: { id: ref, records: list(str('A record id or title')) }, required: ['id', 'records'] },
  react: { summary: 'An emoji reaction on objects', properties: { ids: list(ref), emoji: str(), by: str('Default "AI"') }, required: ['ids', 'emoji'] },
  createVote: { summary: 'A dot vote over objects; counts stay hidden until revealed', properties: { options: list(ref), question: str(), each: num('Votes per person'), ref: placed.ref }, required: ['options'] },
  createPage: {
    summary: 'A wiki page (wikis only)',
    properties: { title: str(), parent: pageRef, before: pageRef, text: str('Markdown'), icon: str('An emoji'), ref: str('A name later operations can use for this page'), note: str('Kept with its first version') },
    required: ['title'],
  },
  updatePage: {
    summary: 'Changes a wiki page; its history keeps a version from before and after',
    properties: {
      page: pageRef,
      title: str(),
      text: str('Replaces the Markdown'),
      append: str('Adds a line at the end'),
      icon: oneOf(str(), { type: 'null' }),
      note: str('What changed'),
      protected: bool('Only people who manage the wiki may change the page (and the pages under it); with accounts, only they may set this'),
    },
    required: ['page'],
  },
  movePage: { summary: 'Moves a wiki page with its sub-pages', properties: { page: pageRef, parent: oneOf(pageRef, { type: 'null' }), before: pageRef }, required: ['page'] },
  deletePage: { summary: 'Moves a wiki page and its sub-pages to the trash', properties: { page: pageRef }, required: ['page'] },
}

/** One operation as a schema, with its "op" fixed. */
export function opSchema(name: Op['op']): Schema {
  const s = OP_SCHEMAS[name]
  return {
    type: 'object',
    title: name,
    description: s.summary,
    properties: { op: { const: name }, ...s.properties },
    required: ['op', ...(s.required ?? [])],
  }
}
