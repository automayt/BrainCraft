# BrainCraft

An infinite whiteboard and mind-mapping tool for brainstorming, inspired by Miro.
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
  paste becomes a sticky note.
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

There's no backend. Each board lives in the visitor's browser until they
download it.

## Code layout

| Path | Purpose |
| --- | --- |
| `src/model/` | The document: items, connectors, hit testing, copy/paste, mind-map tree operations and layout, undo history, camera, serialization. Pure functions over immutable data. |
| `src/editor/Editor.ts` | Tools, selection, gestures and keyboard commands. Framework-independent and unit-tested. |
| `src/ui/` | React components: SVG canvas, toolbars, text editing, minimap. |

## License

Licensed under either the [Apache License 2.0](LICENSE-APACHE) or the
[MIT license](LICENSE-MIT), at your option.
