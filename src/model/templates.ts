/** Starting points for new boards, written in the same operation language as the API. */

import { type Op, applyOps } from '../api/ops'
import { emptyBoard } from './board'
import type { Measure } from './mindmap'
import type { Board } from './types'

export interface Template {
  id: string
  label: string
  hint: string
  title: string
  ops: Op[]
}

const iso = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export const TEMPLATES: Template[] = [
  { id: 'blank', label: 'Blank board', hint: 'An empty canvas', title: 'Untitled board', ops: [] },
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    hint: 'A mind map ready to grow',
    title: 'Brainstorm',
    ops: [{ op: 'createMindMap', outline: 'Big idea\n  Why\n  Who for\n  How\n  Risks', at: { x: 0, y: 0 } }],
  },
  {
    id: 'process',
    label: 'Process map',
    hint: 'A flowchart with a decision',
    title: 'Process',
    ops: [
      {
        op: 'createFlowchart',
        mermaid: 'flowchart TD\n  A([Request comes in]) --> B[Review it]\n  B --> C{Approved?}\n  C -->|Yes| D[Do the work]\n  C -->|No| E[Explain why]\n  D --> F([Done])\n  E --> F',
        at: { x: 0, y: 0 },
      },
    ],
  },
  {
    id: 'sprint',
    label: 'Sprint plan',
    hint: 'Kanban with a linked timeline',
    title: 'Sprint plan',
    ops: [
      {
        op: 'createKanban',
        ref: 'board',
        title: 'Sprint',
        at: { x: 0, y: 0 },
        columns: [
          { title: 'To do', cards: [{ title: 'Write the spec', due: iso(3) }, { title: 'Design review', start: iso(4), due: iso(6) }] },
          { title: 'In progress', cards: [{ title: 'Prototype', start: iso(-2), due: iso(2) }] },
          { title: 'Done', cards: ['Kick-off'] },
        ],
      },
      { op: 'createTimeline', title: 'Schedule', followKanban: ['board'], at: { x: 0, y: 540 }, lanes: [{ name: 'Milestones', entries: [{ title: 'Demo day', start: iso(10) }] }] },
    ],
  },
  {
    id: 'retro',
    label: 'Retrospective',
    hint: 'Went well, to improve, actions',
    title: 'Retrospective',
    ops: [
      { op: 'createNote', ref: 'a', text: 'What went well?', color: 'green', at: { x: 0, y: 80 }, w: 260, h: 140 },
      { op: 'createNote', ref: 'b', text: 'What could be better?', color: 'orange', at: { x: 340, y: 80 }, w: 260, h: 140 },
      { op: 'createNote', ref: 'c', text: 'What will we try next?', color: 'blue', at: { x: 680, y: 80 }, w: 260, h: 140 },
      { op: 'createFrame', title: 'Retrospective', around: ['a', 'b', 'c'] },
      { op: 'createTable', title: 'Actions', columns: ['Action', 'Owner', 'Due'], rows: [['', '', '']], at: { x: 0, y: 420 } },
    ],
  },
]

export function boardFromTemplate(t: Template, measure: Measure): Board {
  return applyOps(emptyBoard(t.title), t.ops, { measure }).board
}
