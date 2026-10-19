# BrainCraft design

What BrainCraft is for, how it should look and read, what a review in
October 2026 found, and the plan that follows from it.

## The subject

BrainCraft is where friends and small teams plan things together: a trip, a
move, a party, a club, a project. Its two surfaces are a **canvas** (sticky
notes, mind maps, flowcharts, Kanban boards) and a **wiki** (pages to write
down what was decided). The world it borrows from is the one on a kitchen
table during planning: paper notes, index cards, a notebook, a marker.

Two jobs shape the design:

- **On the canvas, the content is the colour.** Sticky notes, branches and
  status marks carry the colour; the chrome around them stays quiet, dark
  and out of the way.
- **In the wiki, the page is for reading.** It should read like a well-set
  notebook, not like a settings screen.

## Tokens

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--canvas` | `#0d0f13` | `#f3f4f7` | The board and the page behind everything |
| `--surface` | `#15181e` | `#ffffff` | Floating bars, panels, dialogs |
| `--text` | `#eceef4` | `#14161c` | Words |
| `--muted` | `#9ba2b4` | `#5f6676` | Secondary words, labels |
| `--accent` | `#8f97ff` | `#5a5af0` | Selection, focus, the one primary action |

Two typefaces, each with one job:

- **Inter** for the interface: bars, menus, dialogs, labels, canvas text.
- **Literata** for reading: a wiki page's title and words. It's a book face
  made for long reading on screens, sturdy on a dark page, with optical
  sizes, so large titles get finer detail and small text stays open.

Type scale for a wiki page (The Elements of Typographic Style's progression,
rounded): body 17px with a 1.7 line height; headings in Inter at 17 / 21 / 26
for h4 / h3 / h2, so headings and text are clearly two voices; the page title
in Literata at 38px. Text lines stay under 70 characters; tables, code,
columns and embedded boards may use the page's full width, all aligned on the
same left edge.

## Principles

1. **One voice for reading, one for doing.** Serif for what people wrote,
   sans for what the app says.
2. **Structure carries meaning.** A border, a number or a label is there
   because it tells you something; no decoration that doesn't.
3. **Labels are sentence case.** No tracked-out capitals, anywhere.
4. **Your work first.** Where a screen lists your things and offers new ones,
   your things come first; offers are compact.
5. **Motion answers people.** Things move when someone opened, moved or
   changed something, not on their own.

## Review findings (October 2026)

What was checked: the canvas, Your boards, a wiki page, Help and the share
dialog, in dark and light themes, at desktop width.

- **Your boards hides your boards.** Eleven template cards fill the first
  screen; the boards you came to reopen start below the fold. *Fix now.*
- **Wiki pages read like the interface.** The same 15.5px Inter as every
  button, at about 95 characters a line. *Fix now:* Literata, 17px, under 70
  characters.
- **Tracked-out capitals** in sixteen places (status labels, panel headings,
  search groups, table heads, the AI proposal kind…). *Fix now:* sentence
  case, with weight and colour doing the work.
- **The colours are the generic product palette** (indigo accent, violet to
  magenta logo gradient on near-black): competent but anonymous. *Next
  phase:* an accent drawn from the board itself (see below).
- **Every container is the same rounded card** (template, board, group,
  dialog section), so nothing signals what matters most. *Next phase,* with
  the colours.
- **Help is a wall of shortcuts.** *Next phase:* lead with the guide and the
  five things worth knowing, shortcuts below.

## Plan

**Phase A — reading and finding (now)**

1. Your boards: your boards and wikis first, newest first; starting something
   new is a compact row below.
2. Wiki pages: Literata for title and text, the scale above, under 70
   characters a line.
3. Sentence case for every label.

**Phase B — identity (done)**

1. **Sticky-note yellow** is BrainCraft's own colour (`--brand`, with
   `--on-brand` ink for text on it): the logo, now a sticky note with its corner
   turned up and a mind map drawn on it, and the one main action in a dialog.
   Selection, focus and links keep a separate **ballpoint blue** (`--accent`),
   because the canvas is full of pastel notes and selection must stand out on
   all of them. The violet-to-magenta gradients are gone; the wordmark is plain
   text, so the mark carries the colour.
2. **Your things are cards; offers are not:** your boards keep their cards,
   while "start something new" is a lighter list that only shows a card on
   hover.
3. **Help starts with the guide** and five essentials, before every shortcut.

**Phase C — the canvas chrome**

1. A quieter top bar *(started)*: Present is an ordinary button now, so the
   yellow is the logo's and the dialogs' alone.
2. The tool rail in labelled groups (write, draw, structure, data), with the
   rarely used tools behind one button. *Next: try it with people first;
   moving tools changes habits.*
