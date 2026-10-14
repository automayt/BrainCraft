# BrainCraft

An infinite whiteboard for brainstorming, inspired by Miro. It is a free, native
desktop app written in Rust with [egui](https://github.com/emilk/egui).

![BrainCraft](docs/screenshot.png)

## Features

- **Infinite canvas** with a dot grid. You can pan, zoom from 5% to 800%, zoom to fit, and use a clickable minimap.
- **Sticky notes, text, rectangles, ellipses and frames**, all with editable text.
- **Connectors**: drag the blue dot on a selected item onto another item to link
  them. Drop it on empty space to create a new linked note, which grows a mind map.
- **Freehand pen** with a choice of ink colors and stroke widths.
- **Frames** group content: moving a frame moves everything inside it.
- **Selection**: click, shift-click, marquee drag or select all. Resize from the
  corner handles, and use a floating toolbar for color, text size, layer order,
  duplicate and delete.
- **Copy, cut, paste and duplicate**. Connectors between copied items are kept.
- **Undo and redo** for every change.
- **Save and open** boards as readable JSON (`*.braincraft.json`).

## Running

```sh
cargo run --release                       # opens the welcome board
cargo run --release -- my.braincraft.json # opens (or creates) a board file
```

If wgpu can't find a graphics adapter (for example in VMs or remote desktops),
switch to the OpenGL renderer:

```sh
BRAINCRAFT_RENDERER=glow cargo run --release
```

On Linux you need the usual windowing libraries: `libxkbcommon-x11`, plus
Wayland or X11.

## Shortcuts

| Key | Action |
| --- | --- |
| `V` `H` `N` `T` `R` `O` `L` `P` `F` | Select, hand, sticky note, text, rectangle, ellipse, connector, pen, frame |
| Scroll / middle-drag / Space-drag | Pan |
| Ctrl + scroll, pinch | Zoom |
| Shift + 1 | Zoom to fit the board or selection |
| Double-click | Edit text (on empty canvas: new sticky note) |
| Enter / Esc | Edit selected / deselect |
| Arrows (+ Shift) | Nudge by 1 (10) |
| Ctrl + C / X / V / D | Copy, cut, paste, duplicate |
| Ctrl + A | Select all |
| Ctrl + Z / Ctrl + Shift + Z | Undo / redo |
| Ctrl + S | Save |
| Delete | Delete selection |

Press `?` in the app to see the full list.

## Code layout

| Module | Purpose |
| --- | --- |
| `board` | The document model: items, connectors, hit testing, z-order, copy/paste, JSON |
| `history` | Snapshot-based undo/redo |
| `camera` | World ↔ screen transform, zooming around a point, fit to content |
| `geom` | Geometry helpers (segment distance, shape outlines) |
| `app` | The egui UI: toolbars, canvas interaction and painting |

The model has no UI dependencies beyond egui's math types, so it is unit-tested
headlessly with `cargo test`.

## License

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT), at your option.
