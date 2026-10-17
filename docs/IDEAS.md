# Ideas

What to build next, roughly in order. Each idea says why it matters for a
small group of friends using BrainCraft together. Ticked ones are built.

## Next up

- [x] **Status marks.** Mark any object (a mind-map idea, a sticky, a card) as
  *to do*, *in progress*, *waiting*, *undecided*, *done* or *dropped*. Each
  status has its own colour and icon, the board shows a key, and a filter
  dims everything except one status. A mind-map branch shows how many of its
  ideas are done. People already fake this by colouring text and drawing a
  legend by hand; this makes it one click, searchable and readable by the AI.
- [x] **Private brainstorm.** Everyone writes sticky notes that only they can
  read; others see blank cards until the host reveals them all at once. Stops
  the first idea from steering everyone else. Same idea as hidden votes.
- [x] **Spinner wheel.** Put names or options on a wheel and spin it; everyone
  in the live session sees the same spin land on the same answer. For "who
  picks the film" and "which task first".
- [x] **Flip cards.** A card with a front and a back; click to flip. Good for
  quizzes, reveals and "answer on the back" games.
- [x] **Board icons.** Pick an emoji for each board; it shows in the board list,
  the tab title and wiki-links, so boards are easy to tell apart.
- [x] **Many stickies at once.** Type or paste a list, one idea per line, and
  get a tidy grid of sticky notes (pasting a list today makes a mind map).
- [x] **Code blocks.** Code with syntax highlighting and a language label, for
  friends who share snippets.

## From the review (October 2026)

- [ ] **Say who you are when you join.** The first time someone opens a live
  link, a small card asks what friends should call them (and a colour), and
  a "you" chip in the top bar changes it later. Stops boards full of "Guest".
- [ ] **Friend templates** that show off what's new: "Project together" (a
  parts database with calendar and gallery views, a timeline with "waits
  for", link cards), "Plan a trip", "Decide together" (brainstorm, vote,
  wheel) and "Quiz night" (flip cards).
- [ ] **Totals and money** in databases: sums in table footers and board
  columns, a money field, and an optional "paid by" that shows who has put in
  what.
- [ ] **Undo what a friend deleted:** the server keeps hourly snapshots of
  each shared board (and one before any big deletion), shown in version
  history for everyone.
- [ ] **Checklists inside things:** a tick-list in a sticky, card or record,
  shown as "3/7" like mind-map progress; pasting "- [ ]" lines makes one.
- [ ] **Mention people:** @ in a comment also offers people seen on the board,
  and "Since you were here" opens with "For you: 2 mentions".
- [ ] **This week:** a small panel on opening a board with what's due, overdue
  or waiting, from Kanban cards, records and timeline events.
- [ ] **Plan it with AI** on an empty board: describe the project and the
  assistant proposes a database, timeline and Kanban as a preview.
- [ ] **A tidier selection toolbar:** one colour button that opens the
  swatches, and a "More" menu for the less common actions.
- [ ] **Status badges stay with their object** (an object on top hides the
  badges of what's under it).

## From the second review (October 2026)

- [ ] **Undo and AI changes merge field by field.** Undoing your own move, or
  applying an AI proposal made a minute ago, replaces the whole object, so a
  friend's text edit to it in the meantime is lost. Patches should carry
  only the fields that changed.
- [ ] **Undo says what it undid** ("Undid: move branch") and pans to the change
  when it's off-screen.
- [ ] **Widgets act on the first click:** "Next month", a Kanban card or a
  table cell work even before the widget is selected, and selecting it no
  longer adds a tab strip that shifts the content.
- [ ] **Present overview with slide numbers:** the overview numbers the frames,
  marks the current one, and clicking a frame jumps to it.
- [ ] **New timeline events open for renaming**, and the "+" add-child handle
  on a mind idea no longer sits on top of its first child.
- [ ] **Imported flowcharts land in free space** rather than on top of what's
  in the middle of the view.
- [ ] **Phone width with the comments panel open:** hide the status key, and
  keep A− and A+ together when the toolbar wraps.
- [ ] **A screen reader can follow the board:** the canvas announces what's
  selected, the search palette works as a combobox, every input has a label,
  and errors use role="alert".
- [ ] **Eraser** in the pen panel, a way to hide the minimap, and export
  options for "just what's on screen" and a light or transparent background.
- [ ] **Vote commands in Ctrl K**, a "Many stickies" mode of its own in the
  import dialog, and the flowchart menu listing every shape.
- [ ] **AI quick actions:** one-click "Summarise", "Group these" and "Turn into
  a plan" on a selection.
- [ ] **A welcome board that feels like friends**, not a product tour.

## From the earlier list

- [x] **More database views:** calendar and gallery.
- [ ] **Chart view** of a database (bars or a pie by a choice field).
- [ ] **Tools for AI in the browser (WebMCP):** register BrainCraft's operations
  with the browser, so an AI-enabled browser can read and build on the open
  board directly, with no separate MCP server to set up.
- [x] **Timeline dependencies:** "this can't start until that ends", with
  arrows and a warning when dates clash.
- [ ] **Shared space on the server:** a friend group's boards listed behind one
  space key, and images stored on the server instead of inside boards.
- [ ] **Phone capture:** install BrainCraft on a phone, share a photo, link or
  note to it, and it lands on an Inbox board.
- [x] **Who changed it:** "Since you were here" says who made each change.

## Built

- [x] **Wiki-links and backlinks** between objects and boards.
- [x] **Link cards** with previews; YouTube, Vimeo and Spotify play in place.
