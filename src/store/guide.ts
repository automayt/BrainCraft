/**
 * The built-in guide: a wiki that explains BrainCraft (and shows its own features off as it does),
 * and a canvas tour it embeds pieces of. The tour is built with the operations API, the same JSON
 * any script or assistant can send, and the guide's API page shows a part of it.
 */

import { applyOps, type Op } from '../api/ops'
import { makeSnap, setSnap } from '../model/embed'
import type { Measure } from '../model/mindmap'
import type { Board, Id } from '../model/types'
import { emptyBoard } from '../model/board'
import { addPage, emptyWiki } from '../model/wiki'
import { SHORTCUTS } from '../ui/shortcuts'

export const GUIDE_TITLE = 'BrainCraft guide'
export const TOUR_TITLE = 'BrainCraft tour'

const FENCE = '```'
const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Where each station of the tour sits: a frame, a little over a screen each, in reading order. */
const W = 1700
const H = 1000
const at = (col: number, row: number, dx = 0, dy = 0) => ({ x: col * (W + 200) + dx, y: row * (H + 200) + dy })

/** The tour's operations, from the first station to the last. */
export function tourOps(now = Date.now()): Op[] {
  const d = (days: number) => iso(now + days * DAY)
  const frame = (ref: string, title: string, col: number, row: number): Op => ({ op: 'createFrame', ref, title, at: at(col, row), w: W, h: H })
  return [
    // 1 · notes, shapes, lines, comments, status, reactions
    frame('basics', '1 · Notes, shapes and lines', 0, 0),
    { op: 'createNote', ref: 'n1', text: 'Double-click me to edit', color: 'yellow', at: at(0, 0, 70, 110) },
    { op: 'createNote', ref: 'n2', text: 'Drag the blue dot on a selected note to connect it', color: 'blue', at: at(0, 0, 370, 110) },
    { op: 'createNote', ref: 'n3', text: 'Right-click anything for what it can do', color: 'green', at: at(0, 0, 670, 110) },
    { op: 'createNote', ref: 'n4', text: 'Status marks show where things stand', color: 'pink', at: at(0, 0, 970, 110) },
    { op: 'connect', from: 'n1', to: 'n2' },
    { op: 'connect', from: 'n2', to: 'n3' },
    { op: 'createShape', ref: 'box', shape: 'rect', text: 'A box', color: 'violet', w: 240, h: 130, at: at(0, 0, 70, 520) },
    { op: 'createShape', ref: 'oval', shape: 'ellipse', text: 'An ellipse', color: 'cyan', w: 240, h: 130, at: at(0, 0, 470, 520) },
    { op: 'connect', from: 'box', to: 'oval', label: 'lines stay attached', style: 'curved' },
    { op: 'createComment', ref: 'note', text: 'A comment block: notes you can put anywhere (C)', at: at(0, 0, 870, 500) },
    { op: 'update', id: 'n4', status: 'doing' },
    { op: 'react', ids: ['n1'], emoji: '👍', by: 'BrainCraft' },
    { op: 'addComment', id: 'n1', text: 'Every object has comments: select it and press Alt+C.', author: 'BrainCraft' },
    { op: 'update', id: 'basics', description: 'Try it: double-click empty space for a new note, drag notes about, and select a few to see the toolbar.' },

    // 2 · mind maps
    frame('mind', '2 · Mind maps', 1, 0),
    {
      op: 'createMindMap',
      ref: 'map',
      at: at(1, 0, 760, 430),
      outline: 'Weekend away\n  Where\n    By the sea\n    In the hills\n  Who\n    Sam\n    Alex\n    Jo\n  Budget\n    Travel\n    Food\n  To do\n    Book a place\n    Pack',
    },
    { op: 'update', id: 'mind', description: 'Try it: select an idea, Tab adds a sub-idea, Enter one below. / folds a branch.' },

    // 3 · flowcharts
    frame('flow', '3 · Flowcharts', 2, 0),
    {
      op: 'createFlowchart',
      ref: 'chart',
      at: at(2, 0, 600, 90),
      mermaid: 'flowchart TD\n  A([New idea]) --> B{Is it clear yet?}\n  B -->|Yes| C[Sketch it out]\n  B -->|No| D[Mind-map it first]\n  D --> B\n  C --> E([Share it])',
    },
    { op: 'update', id: 'flow', description: 'Try it: select "New idea" and press Alt+R to run the flowchart step by step.' },

    // 4 · Kanban and timelines
    frame('plan', '4 · Kanban boards and timelines', 0, 1),
    {
      op: 'createKanban',
      ref: 'kanban',
      title: 'Trip plan',
      at: at(0, 1, 70, 110),
      columns: [
        { title: 'To do', cards: [{ title: 'Book the train', due: d(5) }, 'Pick a place'] },
        { title: 'In progress', cards: [{ title: 'Budget', due: d(2) }] },
        { title: 'Done', cards: ['Choose the dates'] },
      ],
    },
    {
      op: 'createTimeline',
      ref: 'timeline',
      title: 'When',
      at: at(0, 1, 70, 590),
      w: 1160,
      h: 340,
      followKanban: ['kanban'],
      lanes: [{ name: 'Trip', entries: [{ title: 'Away', start: d(14), end: d(16) }, { title: 'Leave', start: d(14) }] }],
    },
    { op: 'update', id: 'plan', description: 'The timeline follows the Kanban board: dated cards show up on it, and dragging them there changes their dates.' },

    // 5 · linked data
    frame('data', '5 · Linked data', 1, 1),
    {
      op: 'createDatabase',
      ref: 'books',
      title: 'Reading list',
      at: at(1, 1, 60, 110),
      views: ['table', 'board'],
      groupBy: 'Status',
      fields: ['Book', { name: 'Status', type: 'select', options: ['To read', 'Reading', 'Read'] }, { name: 'Who', type: 'person' }, { name: 'Pages', type: 'number' }],
      records: [
        { Book: 'A short history', Status: 'Reading', Who: 'Sam', Pages: 320 },
        { Book: 'The garden year', Status: 'To read', Who: 'Alex', Pages: 210 },
        { Book: 'Night trains', Status: 'Read', Who: 'Jo', Pages: 180 },
      ],
    },
    { op: 'update', id: 'data', description: 'One set of records, shown two ways: move a card on the board and its status changes in the table.' },

    // 6 · together
    frame('together', '6 · Deciding together', 2, 1),
    { op: 'createNote', ref: 'pizza', text: 'Pizza', color: 'orange', at: at(2, 1, 70, 330) },
    { op: 'createNote', ref: 'tacos', text: 'Tacos', color: 'yellow', at: at(2, 1, 330, 330) },
    { op: 'createNote', ref: 'curry', text: 'Curry', color: 'red', at: at(2, 1, 590, 330) },
    { op: 'createVote', options: ['pizza', 'tacos', 'curry'], question: 'What’s for dinner?', each: 2 },
    { op: 'createSpinner', ref: 'wheel', options: ['Sam', 'Alex', 'Jo', 'Kim'], at: at(2, 1, 900, 290) },
    { op: 'react', ids: ['tacos'], emoji: '❤️', by: 'BrainCraft' },
    { op: 'update', id: 'together', description: 'Vote with the dots (counts stay hidden until Reveal); Spin the wheel to pick who washes up. In a live session everyone sees the same.' },

    // 7 · code, tables and links
    frame('bits', '7 · Code, tables and links', 0, 2),
    { op: 'createCode', ref: 'code', lang: 'javascript', at: at(0, 2, 70, 110), w: 560, code: "// Paste a fenced block from a chat to get one of these\nconst board = window.BrainCraft\nboard.apply([{ op: 'createNote', text: 'Hello' }])" },
    { op: 'createTable', ref: 'table', title: 'Packing', at: at(0, 2, 700, 110), columns: ['Thing', 'Who'], rows: [['Tent', 'Sam'], ['Stove', 'Alex'], ['Snacks', 'Jo']] },
    { op: 'createLink', ref: 'link', url: 'https://en.wikipedia.org/wiki/Mind_map', at: at(0, 2, 70, 520) },
    { op: 'update', id: 'bits', description: 'Paste spreadsheet cells for a table, a web address for a link card, an image to drop it in.' },

    // 8 · presenting
    frame('show', '8 · Present this board', 1, 2),
    { op: 'createText', ref: 'showText', text: 'Press Shift+P: every frame becomes a slide', fontSize: 40, w: 1100, at: at(1, 2, 80, 140) },
    { op: 'createNote', text: 'L: laser pointer', color: 'violet', at: at(1, 2, 80, 360) },
    { op: 'createNote', text: 'N: speaker notes (the frame’s comments)', color: 'blue', at: at(1, 2, 380, 360) },
    { op: 'createNote', text: 'O: the whole board', color: 'cyan', at: at(1, 2, 680, 360) },
    { op: 'addComment', id: 'show', text: 'These are speaker notes: the frame’s comments show with N while presenting.', author: 'BrainCraft' },
    { op: 'update', id: 'show', description: 'Frames are slides, in reading order: left to right, top to bottom.' },
  ]
}

/** The tour board, and the id of each object a ref named. */
export function tourBoard(measure: Measure, now = Date.now()): { board: Board; spots: Record<string, Id> } {
  const ops = tourOps(now)
  const { board, results } = applyOps(emptyBoard(TOUR_TITLE), ops, { measure, now })
  const spots: Record<string, Id> = {}
  for (const r of results) if (r.ref && r.id !== undefined) spots[r.ref] = r.id
  return { board: { ...board, icon: '🗺️' }, spots }
}

// ----- the wiki ---------------------------------------------------------------------------------------

interface GuidePage {
  title: string
  icon: string
  text: string
  children?: GuidePage[]
}

const cell = (s: string) => s.replace(/\|/g, '\\|')
/** "Ctrl K · Ctrl F" as key caps. */
const keysOf = (k: string) =>
  k
    .split(' · ')
    .map((part) => `\`${part.replace(/`/g, '')}\``)
    .join(' · ')

function shortcutsPage(): string {
  const sections = SHORTCUTS.map(([title, rows]) => `## ${title}\n\n| Keys | What it does |\n| --- | --- |\n${rows.map(([k, what]) => `| ${cell(keysOf(k))} | ${cell(what)} |`).join('\n')}\n`)
  return `Every shortcut, the same list as **Help** (press **?**), which also shows the ones for whatever you're doing.\n\n{{toc}}\n\n${sections.join('\n')}`
}

function pages(key: string, spots: Record<string, Id>, now: number): GuidePage[] {
  const embed = (label: string, ref: string, height = 420) => `![[${label}|${height}]](board:${key}#${spots[ref]})`
  const link = (label: string, ref: string) => `[[${label}]](board:${key}#${spots[ref]})`
  const tour = `[[${TOUR_TITLE}]](board:${key})`
  const soon = iso(now + 30 * DAY)
  const sample = JSON.stringify(
    { ops: tourOps(now).filter((o) => ['n1', 'n2', 'n3'].includes((o as { ref?: string }).ref ?? '') || (o.op === 'connect' && ['n1', 'n2'].includes(String(o.from)))) },
    null,
    1,
  )
  return [
    {
      title: 'Start here',
      icon: '👋',
      text: `BrainCraft is a whiteboard and a wiki for planning things together: brainstorms, trips, projects, clubs.

> [!tip] Two kinds of boards
> A **canvas** is an endless board for notes, mind maps, flowcharts, Kanban boards and more. A **wiki** (like this guide) is pages in a tree, written in Markdown. Both are in **Your boards** (**Ctrl+O**).

## Find your way around

- **Top left:** the board menu: your boards, new, open, save, share, version history, import and export.
- **Top right:** Share, Ask AI, Present, Search, Comments, the theme and Help (**?**).
- **Left:** the tools, grouped: writing, thinking it through, drawing. The last button holds tables, Kanban boards, timelines and more. Hover one to see its key.
- **Ctrl+K** searches everything and runs any command by name. If you only remember one shortcut, make it this one.
- **Right-click** (or press and hold on a touch screen) anything for what it can do.

## Your first five minutes

1. Open the ${tour}: eight frames, one per idea, built for you.
2. Double-click empty space for a sticky note, and type.
3. Press **M**, click, and type a central idea; **Tab** adds the next one.
4. Come back here: **Ctrl+O** lists every board and wiki.
5. Tick the boxes on [[Try it]] as you go.

Nothing leaves your browser unless you share it: boards are kept here, saved as you work.`,
    },
    {
      title: 'The canvas',
      icon: '🎨',
      text: `An endless board. **Scroll** to zoom at the pointer, drag with the **middle button** (or hold **Space**) to move around, and drag on empty space to select. On a trackpad, two fingers move and pinch zooms.

The ${tour} has a frame for each part below. Press **Shift+P** on it to see it as slides.

{{children}}

> [!note] Snapping
> Drag a shape near another and it lines up one step away and connects. Sticky notes snap into tidy rows. Hold **Alt** to place things freely.`,
      children: [
        {
          title: 'Notes, shapes and lines',
          icon: '🟨',
          text: `${embed('Notes, shapes and lines', 'basics', 380)}

- **Sticky notes, text, shapes, frames and a pen** are on the tool rail. With a tool picked, **Enter** puts one in the middle of the view.
- **Lines:** select something and drag its blue dot onto another object. Drop it on empty space for a new linked note. **Double-click a line** to label it.
- **Type to rename:** with one object selected, just start typing.
- **Frames** hold what's inside them and become slides when you present. Right-click one → **Move to its own board** to give a busy part a board of its own, with a card here that opens it.
- **Text fits its shape:** it grows and shrinks with flowchart shapes, rectangles and ellipses; **A−/A+** set a size instead, and **Fit text** goes back.
- **Fit to content** (right-click or **Ctrl+K**) sizes a shape to its text, a frame around what's inside, or a Kanban board, table or database view to show everything. **Same size** makes several shapes alike.
- **Status marks** (*to do*, *in progress*, *waiting*, *undecided*, *done*, *dropped*): pick one on the toolbar. The key along the bottom counts them and filters the board. ${link('This note', 'n4')} has one.
- **Comments:** every object has them (**Alt+C**), plus a description at the top for context. Type **@** to mention someone or another object, and **[[** to link a board. On a server with accounts, the people you mention see it under **Mentions of you** in their account menu.
- **Reactions:** 👍 ❤️ 😂 🎉 🤔 ⭐ from the toolbar.
- **Lock** (**Ctrl+Shift+L**) a background so it can't be moved by accident; **group** (**Ctrl+G**) objects to move them as one.
- **Excalidraw drawings:** right-click empty space → **Excalidraw drawing** for Excalidraw's hand-drawn sketching, right on the board. Double-click a drawing to change it.`,
        },
        {
          title: 'Mind maps',
          icon: '🧠',
          text: `${embed('Mind map', 'mind', 420)}

- Press **M**, click, type the central idea.
- **Tab** adds a sub-idea, **Enter** an idea below, arrows move between ideas, **Alt+↑/↓** reorders, **/** folds a branch.
- Drag an idea onto another to move its branch; **Tidy mind map** (right-click) puts everything back in place.
- **Paste an indented list** and it becomes a map. **Copy outline** does the opposite.
- Mark ideas with a status and a branch counts how many under it are done.`,
        },
        {
          title: 'Flowcharts',
          icon: '🔀',
          text: `${embed('Flowchart', 'flow', 460)}

- Press **D** for the shape panel: Start/End, Process, Decision, Input/Output, Document, Database, Subprocess.
- With a shape selected, **Tab** adds the next step and **Alt+arrow** adds one in that direction (the "No" branch).
- Drag a blue arrow to empty space and BrainCraft suggests the next shape.
- **Mermaid:** paste a Mermaid flowchart to build it, or export one for docs elsewhere. ${link('This one', 'flow')} came from Mermaid.
- **Run it** (**Alt+R**): a flowchart becomes a step-by-step checklist, and each run is kept with its timing.
- **Hand-drawn:** the **Hand-drawn board** switch (the squiggle in the tool rail) draws everything by hand, and everything you add after. Or select a shape and press **✎ Hand-drawn** for just that (the whole flowchart changes, and new steps follow). Or right-click → **Sketch in Excalidraw** for a hand-drawn copy beside it.`,
        },
        {
          title: 'Kanban boards and timelines',
          icon: '🗂',
          text: `${embed('Kanban and timeline', 'plan', 480)}

- **Kanban (K):** drag cards between columns (or **Alt+arrows**). Cards have colours and start and due dates; late ones are flagged. New ones start **Not started, In progress, Completed**; **Templates** in the header swaps the columns, and the **+** after the last column adds one.
- **Timelines (I):** lanes of events and milestones with a "today" line. Drag to reschedule, drag an end to change the length.
- A timeline can **follow Kanban boards**: their dated cards appear on it live, as on ${link('this one', 'timeline')}.
- **Waits for…** links events; **Line up** moves them so none starts too early.
- **Tables (G):** sort, filter, hide rows and columns, or paste cells from a spreadsheet.`,
        },
        {
          title: 'Linked data',
          icon: '🗃',
          text: `${embed('Reading list', 'data', 420)}

A **database (B)** is one set of records shown as many views that stay in sync: a **table**, a **Kanban** board grouped by a choice or person, a **timeline**, a **calendar** or a **gallery**.

- **+ View** adds another view of the same records.
- Click a record to edit every field. Fields can be text, number, date, choice, person or checkbox.
- Each view has its own search, sort, grouping and hidden fields; none of them changes the data.
- **Convert to linked data** (right-click) turns a table, Kanban board or timeline into a database.`,
        },
        {
          title: 'Code, tables, links and pictures',
          icon: '🧩',
          text: `${embed('Code, tables and links', 'bits', 360)}

Paste almost anything:

| Paste | You get |
| --- | --- |
| A list, one idea per line | Sticky notes in a grid (indent it for a mind map) |
| Spreadsheet cells | A table |
| A web address | A link card; YouTube, Vimeo and Spotify play on it |
| A fenced code block | Code with colours, in its language |
| An image | The picture |
| Mermaid | A flowchart |
| Shapes copied in Excalidraw, or an .excalidraw file | An Excalidraw drawing |
| JSON operations | Whatever they describe (see [[The API]]) |`,
        },
        {
          title: 'Presenting',
          icon: '🎬',
          text: `**Present (Shift+P)** turns a board's frames into slides, in reading order, full screen.

- Arrows, Space or a click go forward; number keys jump.
- **L** laser pointer, **N** speaker notes (the frame's comments), **O** the whole board.
- Select a frame first to start there.

Try it on the ${tour}: its eight frames make eight slides.

${embed('Present this board', 'show', 300)}`,
        },
      ],
    },
    {
      title: 'Wikis',
      icon: '📘',
      text: `A wiki is pages in a tree, written in Markdown. It saves, keeps versions, shares live and goes to files just like a canvas. Start one with **Ctrl+O → New wiki**, from a blank page or a template (a trip, moving house, a party, a club handbook).

{{children}}

{{pagetree}}`,
      children: [
        {
          title: 'Writing pages',
          icon: '✍️',
          text: `**Edit** (or double-click the page) shows the Markdown beside how it reads. It saves as you type; **Done** or **Esc** when you're finished, with a note in **What did you change?** if you like.

{{toc}}

## Markdown

{{columns}}
**You write**

${FENCE}markdown
# A heading
**bold**, *italic*, \`code\`
- a list
- [ ] a checklist item
| a | table |
| --- | --- |
| 1 | 2 |
> [!tip] A callout
${FENCE}
{{column}}
**It reads**

**bold**, *italic*, \`code\`
- a list
- [x] a ticked checklist item (tick them while reading)

| a | table |
| --- | --- |
| 1 | 2 |

> [!tip] A callout
> Also \`[!note]\`, \`[!warning]\` and \`[!danger]\`.
{{/columns}}

## The / menu

Type **/** at the start of a line for headings, checklists, tables, code, callouts, a new sub-page, an embed from a board, and every macro.

## Links

- **[[** links another page or a board, like [[Macros]] or the ${tour}. A \`[[Name]]\` no page has yet offers to make it.
- **#** beside a heading copies a link to it; **Copy link** copies the page's.
- Pages list what links to them, and canvas comments can link pages too.

## Pictures of your boards

Type **/** and pick **Embed from a board…**, or right-click an object on a canvas → **Copy embed for a wiki page**. Frames, mind maps, flowcharts and whole boards are drawn as on the canvas; tables and databases show as tables. Every picture in this guide is one, from the ${tour}.

## Files

From the page menu **⋯**: this page or the whole wiki as **Markdown** (a .zip of files for the wiki), as **one web page** with a contents list and pictures of the boards it shows, or **printed** (choose *Save as PDF* to get a PDF), each page on its own sheet. Drop **.md** files on a wiki and each becomes a page.

## Protected pages

**⋯ → Protect page…** keeps a page, and the pages under it, for the people who manage the wiki. On a server with accounts, nobody else can change it.`,
        },
        {
          title: 'Macros',
          icon: '🧰',
          text: `Macros are \`{{name}}\` on a line of their own (or inside a sentence, for the small ones). Type **/** to pick one. A name BrainCraft doesn't know shows in red.

{{expand What this page is made of}}
${FENCE}
{{toc}} · {{children}} · {{pagetree}} · {{tasks}} · {{recent 5}}
{{include "Page title"}}
{{expand Title}} … {{/expand}}
{{columns}} … {{column}} … {{/columns}}
{{status Done}} · {{countdown ${soon}}} · {{today}}
${FENCE}
{{/expand}}

## In a sentence

- Status labels: {{status Booked}} {{status Not booked}} {{status Waiting}} {{status Ideas purple}}. The colour comes from the words, or name one (grey, blue, green, yellow, orange, red, purple).
- A countdown: the next big day is {{countdown ${soon}}}.
- Today is {{today}}.

## On a line of their own

{{columns}}
**\`{{children}}\`** the pages under this one.

**\`{{toc}}\`** this page's headings.

**\`{{pagetree}}\`** every page (\`{{pagetree here}}\`: the ones under this page).
{{column}}
**\`{{tasks}}\`** every unticked checklist item in the wiki, tickable right there (\`{{tasks here}}\`, \`{{tasks all}}\`; \`{{tasks @me}}\` the ones that @mention you).

**\`{{recent 5}}\`** the latest changes.

**\`{{include "Page"}}\`** another page's words, kept in step.
{{/columns}}

## Open tasks in this guide

{{tasks}}

## A page shown inside this one

{{include "Start here"}}`,
        },
        {
          title: 'Page history',
          icon: '🕰',
          text: `Every page keeps its versions: one each time someone finishes writing (with their note), every ten minutes of a long edit, on a rename, and when a version is put back. Ticking a checkbox saves a small one, credited to whoever ticked.

- Click **version N** under the title, or **⋯ → Page history**.
- See **Changes** against any version, **the page then**, and **who wrote what** line by line.
- **Keep for good** any version, add a note, or **Put this version back** (one undo step).
- **Recent changes**, at the foot of the page list, covers the whole wiki:

{{recent 5}}

> [!note] Since you were here
> Opening a wiki after friends wrote in it lists the new and changed pages, and **what changed** shows the lines that are different since you last looked.`,
        },
        {
          title: 'Files',
          icon: '📎',
          text: `A wiki keeps documents too: PDFs, Word documents, slides, spreadsheets, CSV, web pages, text and pictures. Open **📎 Files** at the foot of the page list.

- **Add them:** drop files anywhere on the wiki, or **Add files…**.
- **Find them** by name, or by any word inside them.
- **Read them** right there: PDFs in the browser's own viewer, the rest as text.
- **Make a wiki page** from one: its headings, lists, tables and links come across, with a note saying which file it came from. A long document becomes a contents page with a page for each section.
- **Ask AI about it:** the assistant reads the file and sums it up.

> [!tip] Where they're kept
> On the server when the wiki is shared, so everyone who can open the wiki can open its files; otherwise in this browser.`,
        },
      ],
    },
    {
      title: 'Together',
      icon: '🤝',
      text: `{{toc}}

## Live sessions

On a BrainCraft server, **Share → Start a live session** gives an edit link and a view-only link. Everyone sees changes as they happen, with named cursors, who's here, and **follow** (click someone's picture to see what they see). Undo only takes back your own steps, and work done offline syncs when you're back.

## In the moment

- **E** sends an emote from your cursor; **/** says something next to it.
- **Countdowns:** "Start a 5-minute countdown for everyone" in **Ctrl+K**; everyone sees the same one.
- **Time tracking:** select something and press **Alt+T** to time it; the clock in the top bar has the timesheet.

## Deciding

${embed('Deciding together', 'together', 380)}

- **Vote:** select options and press **Vote**. Everyone spreads their dots; counts stay hidden until **Reveal**.
- **Spinner wheel** (right-click): everyone watches it land on the same answer.
- **Private brainstorm** (right-click empty space): everyone's notes stay hidden from the others until someone presses **Reveal all**, so the first idea doesn't steer the rest.
- **Flip cards:** give a sticky note a back, for quizzes and reveals.

## Catching up

Come back to a board friends changed and a banner says what's new, changed and gone, and who did it; **Show me** highlights it all.

## Comments

Every object has comments and a description (**Alt+C**). Comment blocks (**C**) sit anywhere on the board. **Ctrl+K** searches comments too.`,
    },
    {
      title: 'Ask AI',
      icon: '✨',
      text: `**Ctrl+J** (or **Ask AI**) opens a chat about the board you're on. It reads the board and what you've selected, and links every object it mentions.

- **Changes are previewed, never just made:** new objects outlined in green, removed ones crossed out. **Apply** or **Discard**.
- Every applied change has its own **Undo**, even after other edits.
- Quick actions: Summarise, Find gaps, Decision log; with a selection, Cluster into themes, Make a mind map, Make a flowchart.
- **Sketch to board:** draw a rough chart with the pen, or drop in a photo of a whiteboard, select it and press **✦ To board**.
- The model can be Claude through an API key, your own model server (such as vLLM), or **Claude Code** (\`claude -p\`) or **Codex** (\`codex exec\`) on the computer your BrainCraft server runs on: when they're installed there, they're in the list, signed in as whoever uses them there.

> [!tip] Assistants outside the app
> Claude, Codex, Cursor and other MCP clients can work on your boards too: **menu → Connect an AI assistant…**. See [[The API]].`,
    },
    {
      title: 'Saving, files and sharing',
      icon: '💾',
      text: `- Boards **save as you work**, in this browser. The dot by the title says when.
- **Version history** (board menu) keeps a version every ten minutes and any you name; restore one in one undoable step. On a server, **On the server** has versions everyone shares: one every few hours the board changes, the newest five kept.
- **Ctrl+S** saves a \`.braincraft\` file; open one with **Open file…** or by dropping it on the window.
- **Export** (**Ctrl+Shift+E**): the board or the selection as PNG, SVG or PDF (one page per frame), or the board as Markdown. Right-click a table or database for CSV.
- **A wiki** goes out as Markdown files (a page, or the whole wiki as a .zip), as one web page with its pictures, or printed (save as PDF): page menu **⋯**.
- **Share:** a **snapshot link** packs the whole board into the link (nothing is uploaded; others see it read-only and can keep a copy), or a **live session** on a server.
- The same board open in two tabs stays in step, no server needed.

| Keep it | How |
| --- | --- |
| Just here | Nothing to do: it saves itself |
| As a file | Ctrl+S |
| For a friend to look at | Share → snapshot link |
| To work on together | Share → live session |`,
    },
    {
      title: 'The API',
      icon: '🔌',
      text: `Everything you can draw, a script can make with **operations**: small JSON instructions, applied all at once as one undo step. The ${tour} was built that way. Its first three notes:

${FENCE}json
${sample}
${FENCE}

## Where operations work

| Where | How |
| --- | --- |
| Paste | Paste the JSON onto any board |
| The page | \`window.BrainCraft.apply([...])\` in the browser console |
| HTTP | \`POST /api/boards/{id}/ops\` on a BrainCraft server |
| AI assistants | The \`apply_ops\` tool of the MCP server |

## On a BrainCraft server

The server describes its own API: open **/api/docs** on it to read every route and operation, or give **/api/openapi.json** (OpenAPI 3.1) to an API tool or a client generator. Besides changing boards, scripts can read them: their objects, one object in full, a search, flowcharts as Mermaid, and a wiki's pages with their history.

${FENCE}sh
curl -X POST "https://your-server/api/boards/BOARD/ops" \\
  -H "Authorization: Bearer EDIT_KEY" \\
  -d '{"ops":[{"op":"createComment","text":"Deploy 418 is live"}]}'
${FENCE}

With accounts on, send an API token (account button → **API tokens…**) instead of a key.

## Wiki pages too

${FENCE}json
{ "ops": [
  { "op": "createPage", "title": "Meeting notes", "parent": "Home", "text": "## Decisions\\n- [ ] Book the hall" },
  { "op": "updatePage", "page": "Meeting notes", "append": "- [ ] Send the invites", "note": "Added a task" }
] }
${FENCE}`,
    },
    {
      title: 'Running a server',
      icon: '🖥',
      text: `BrainCraft works with no server at all: it's a page, and boards live in your browser. Run the BrainCraft server for:

- **live sessions** and shared boards,
- **link previews** on link cards,
- the **HTTP API** and its docs at /api/docs,
- an **AI assistant** for everyone, through the server's own key, model server or agent command,
- **accounts**.

${FENCE}sh
node dist/braincraft-server.mjs
${FENCE}

## Accounts

With \`BRAINCRAFT_ACCOUNTS=1\` people sign in. **Admins** manage people and groups; **groups carry permissions** (make boards, share them, use the AI, see everyone); every board has an **owner** and an **Access** list. Sign in with a password or **single sign-on** with any OpenID Connect provider. Admins see an **activity log** of who changed what.

{{expand Where to read more}}
The project's docs folder: SERVER.md (settings and the HTTP API), ACCOUNTS.md (accounts and single sign-on), AI.md (the assistant), MCP.md (AI assistants outside the app) and API.md (every operation).
{{/expand}}`,
    },
    { title: 'Keyboard shortcuts', icon: '⌨️', text: shortcutsPage() },
    {
      title: 'Try it',
      icon: '✅',
      text: `Tick these as you go. Open tasks show on [[Macros]] too, through \`{{tasks}}\`.

## On the canvas
- [ ] Open the ${tour} and press **Shift+P** to flip through it
- [ ] Make a sticky note and connect it to another
- [ ] Start a mind map with **M** and add three ideas with **Tab**
- [ ] Build a flowchart with **D** and **Tab**
- [ ] Give something a status mark
- [ ] Search for "tent" with **Ctrl+K**

## In a wiki
- [ ] Edit this page and add a line
- [ ] Type **/** and add a callout
- [ ] Link to another page with **[[**
- [ ] Open **Page history** and look at what changed

## Together
- [ ] Share a board with a friend
- [ ] Ask AI to summarise a board`,
    },
  ]
}

/** The guide wiki, its pictures pointing at the tour board (`tourKey`, its id in this browser). */
export function guideWiki(tourKey: string, tour: { board: Board; spots: Record<string, Id> }, now = Date.now(), by?: string): Board {
  let b: Board = { ...emptyWiki(GUIDE_TITLE, now), icon: '🧭' }
  const homeId = b.pages![0].id
  // The home page is the one emptyWiki starts with.
  b = { ...b, bodies: b.bodies!.map((x) => (x.id === homeId ? { ...x, text: home(tourKey) } : x)) }
  const add = (list: GuidePage[], parent: string) => {
    for (const p of list) {
      let id: string
      ;[b, id] = addPage(b, { title: p.title, parent, text: p.text, icon: p.icon }, now)
      if (p.children) add(p.children, id)
    }
  }
  add(pages(tourKey, tour.spots, now), homeId)
  b = { ...b, pages: b.pages!.map((p) => (p.id === homeId ? { ...p, icon: '🧭' } : p)) }
  // A copy of each picture, so the guide still shows them shared with friends who lack the tour.
  for (const ref of ['basics', 'mind', 'flow', 'plan', 'data', 'bits', 'show', 'together']) {
    const s = makeSnap(tour.board, tourKey, tour.spots[ref], now, by)
    if (s) b = setSnap(b, s)
  }
  return b
}

function home(tourKey: string) {
  return `# ${GUIDE_TITLE}

> [!tip] New here?
> Start with [[Start here]], then open the [[${TOUR_TITLE}]](board:${tourKey}) beside it. This guide is a wiki like any other: edit it, add to it, share it.

{{children}}

## Ten things worth knowing

1. **Ctrl+K** finds anything and runs any command.
2. **Right-click** shows what something can do.
3. **Double-click** empty space for a sticky note.
4. **M** starts a mind map, **D** a flowchart; **Tab** adds the next idea or step.
5. Paste a list, a spreadsheet, a link, code or Mermaid and it becomes the right thing.
6. **Alt+C** opens an object's comments.
7. **Shift+P** presents the board's frames as slides.
8. **Ctrl+J** asks the AI about the board; it shows changes before making them.
9. **Ctrl+O** lists your boards and wikis.
10. **?** shows every shortcut.`
}
