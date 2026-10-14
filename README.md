# BrainCraft

An infinite whiteboard and mind-mapping tool for brainstorming.
It runs entirely in the browser as a static site, so you can host it anywhere.

![BrainCraft whiteboard](docs/screenshot.png)

## Features

### Mind maps

![A mind map in BrainCraft](docs/mind-map.png)

- Press **M** and click to start a map, then type your central idea.
- **Tab** adds a child idea and **Enter** adds the next sibling, so you can
  brainstorm without touching the mouse. An idea you leave empty is discarded.
- Branches lay themselves out on both sides of the central idea. Each main
  branch gets its own color, and its sub-ideas share it.
- Use the **arrow keys** to move between ideas and **Alt + ↑/↓** to reorder them.
- **Drag an idea onto another** to move the whole branch. Drag a main branch
  across the center to switch sides.
- **Collapse** a branch with **C** or with the toggle next to it.
- **Paste an indented list** (Markdown bullets, numbered lists, headings or
  plain indentation) to turn it into a map. **Copy outline** does the reverse.

### Flowcharts

![A flowchart in BrainCraft](docs/flowchart.png)

- Press **D** (or pick the flowchart tool) and choose a symbol: Start/End,
  Process, Decision, Input/Output, Document, Database or Subprocess.
- With a shape selected, **Tab** adds the next connected step in the direction
  the flow is going. **Alt + arrow** adds one in that direction, e.g. the
  "No" branch of a decision. While you're typing in a shape, **Tab** finishes
  it and moves on to the next step.
- Selected shapes show **blue arrows** on each side. Click one to add a step
  that way, or drag it onto another shape (or onto empty space) to connect.
- New steps line up and space themselves automatically, sliding past shapes
  already in the way. Dragged shapes snap into line with their neighbors;
  hold **Alt** to move freely.
- Lines attach to the middle of a side and stay attached as you move things.
  Choose straight, right-angled or curved lines and which ends get arrows.
  **Double-click a line** to label it ("Yes", "No").
- Change a shape's symbol from the toolbar at any time.

- **Drag a blue arrow to empty space** and BrainCraft suggests the next
  shape, with a description of each. The order follows what this board uses
  most after that kind of shape, then the usual conventions. Press **1–7** to
  pick.
- **Mermaid:** paste a Mermaid flowchart (or use **Import / Export**) to build
  it, laid out automatically. Export any flowchart back to Mermaid for docs,
  GitHub or Notion.

A hint bar at the bottom of the canvas shows the shortcuts that apply to
whatever you have selected.

### Tables, Kanban boards and timelines

These become interactive once selected; drag them by their title strip.

- **Tables (G)**, or paste cells copied from Excel or Google Sheets. Edit
  cells inline (Enter moves down and adds a row at the end). Click a header to
  sort (numbers sort naturally). Filter by column. Hide rows and columns and
  bring them back. Insert and delete rows and columns, and copy as CSV.
- **Kanban boards (K):** drag cards between columns. Press Enter to keep
  adding cards. Cards have colors and start/due dates, and overdue cards are
  flagged.
- **Timelines (I):** lanes of events and milestones on a time axis that
  scales itself, with a "today" line. Drag to reschedule, drag the ends to
  change the length, double-click to add, and zoom and pan. A timeline can
  **follow Kanban boards**: their dated cards appear live in their own lane,
  overdue ones are flagged, and dragging a card on the timeline reschedules it
  on the board.

### Comments and search

- **Every object has comments.** Select it and press **Shift+C** (or click
  *Comment*) to open the panel on the right. Notes are timestamped, show who
  wrote them, and can be deleted. Type **@** to mention another object; the
  mention links to it, and the other object lists it under "Mentioned in".
  With nothing selected, the panel shows every comment on the board.
- **Comment blocks (C)** are notes you can place anywhere on the board.
- **Ctrl+K** searches everything: text, comments, table cells, Kanban cards,
  timeline events and line labels, filtered by type. With an empty query it
  lists every object, so it doubles as the object lookup.

### API for scripts and AI

Boards can be built from JSON operations: paste them, call
`window.BrainCraft.apply([...])`, or later post them to the hosted API. See
[docs/API.md](docs/API.md), which includes a ready-made prompt for AI
assistants.

### Whiteboard

### Whiteboard

- An infinite canvas with a dot grid. Pan, zoom from 5% to 800%, zoom to fit,
  use the minimap, or pinch on touch screens.
- Sticky notes, text, rectangles, ellipses, frames and a freehand pen.
- **Connectors**: drag the blue dot on a selected item onto another item.
  Drop it on empty space to create a new linked note.
- Frames carry their contents when you move them.
- Select with a click, shift-click or a drag box. Resize from the corners,
  and use the floating toolbar for color, text size, layer order, duplicate
  and delete.
- Copy, cut and paste work through the system clipboard. Plain text you
  paste becomes a sticky note. **Paste or drop images** to add them.
- Undo and redo.
- Boards autosave in your browser. **Download** saves a `.braincraft.json`
  file and **Open…** loads one.

Press **?** in the app to see every shortcut.

## Development

Requires Node 20 or later.

```sh
npm install
npm run dev      # dev server at http://localhost:5173
npm run check    # typecheck, lint and unit tests
npm run build    # production build in dist/
```

## Hosting

`npm run build` produces a fully static `dist/` folder with relative asset
paths. Serve it from any static host, at the domain root or under a sub-path:

- **GitHub Pages**: the included workflow (`.github/workflows/ci.yml`) tests,
  builds and deploys `main`. Enable it under *Settings → Pages → Source:
  GitHub Actions*.
- **Netlify / Cloudflare Pages / Vercel**: set the build command to
  `npm run build` and the output directory to `dist`.
- **Anything else**: copy `dist/` to any web server.

There's no backend yet. Each board lives in the visitor's browser (images
included, so very image-heavy boards can hit the browser's storage limit)
until they download it.

## Code layout

| Path | Purpose |
| --- | --- |
| `src/model/` | The document: items, connectors, hit testing, copy/paste, mind maps, flowcharts and Mermaid, tables, Kanban boards, timelines, comments, search, undo history, serialization. Pure functions over immutable data. |
| `src/api/` | The operations API (`window.BrainCraft`, pasted JSON). |
| `src/editor/Editor.ts` | Tools, selection, gestures and keyboard commands. Framework-independent and unit-tested. |
| `src/ui/` | React components: SVG canvas, toolbars, text editing, comments panel, search, dialogs, and the table/Kanban/timeline views. |

## License

Licensed under either the [Apache License 2.0](LICENSE-APACHE) or the
[MIT license](LICENSE-MIT), at your option.
