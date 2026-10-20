# Ideas

What to build next, roughly in order. Each idea says why it matters for a
small group of friends using BrainCraft together. Ticked ones are built.

## Wikis

A wiki is a board with `kind: 'wiki'` and pages instead of a canvas, so it
saves, versions, syncs and shares like any board. Built in phases:

- [x] **Phase 1: wiki spaces.** New wiki from Your boards; a page tree (drag
  or Alt+Shift+arrows to nest and reorder); Markdown with a live preview
  (headings with anchors, lists, checklists you can tick, tables, code,
  quotes, callouts, `{{children}}`, `{{toc}}`); `[[` links between pages and
  to boards, "new page" links, copyable page and heading links, "Linked
  from"; a trash; typing undoes as one step per burst; tab sync and live sync
  through the server.
- [x] **Phase 2: links everywhere.** Page links in canvas comments and
  descriptions (and wiki pages in the `[[` picker); web links to pages,
  headings and objects (`#open=KEY&page=…`) that open in a new or open tab
  and turn into named links when pasted into pages and comments; backlinks
  both ways; page cards on the canvas and a page preview panel; Ctrl+K over
  pages; `createPage`/`updatePage`/`movePage`/`deletePage` operations and
  `list_pages`/`read_page` tools for AI assistants and MCP.
- [ ] **Later for links:** an `@` picker in pages that finds objects on every
  board (today: Copy link to this object, then paste). (Invite links that open
  a page are built: Copy link in a live session.)
- [x] **Phase 3: embeds.** `![[Label]](board:KEY#ID)` shows a frame, mind map,
  flowchart, timeline or whole board inside a page, drawn by the real board
  renderer, with Open on board and Expand; tables, Kanban boards and database
  views as real tables; snapshots kept in the wiki for friends who don't have
  the board (every hidden brainstorm note blanked, big pictures left out,
  unused copies dropped); Copy embed on the canvas; a `/` menu with an embed
  picker; wiki templates (trip, move, party, club).
- [ ] **Later for embeds:** live embeds of boards in a live session that isn't
  open here (a background view-only connection), editing table and database
  embeds in place, and query blocks (open tasks across boards).
- [x] **Phase 4: robustness.** A line-by-line merge, so two friends typing on
  one page (or an AI change arriving after you typed) keep everyone's words;
  page history with diffs and putting one page back; "Since you were here"
  for pages; Ctrl+K search across wikis; Markdown files in and out (a page as
  .md, a whole wiki as a .zip of .md files, .md files dropped in as pages).
- [x] **Versions and macros.** Page versions kept in the wiki and shared
  live (saved on finishing writing, with a "what did you change?" note, on
  renames, restores and AI changes); history with changes against any
  version, the page then, who wrote each line, milestones and notes; Recent
  changes across the wiki; `page_history` and `read_page` with a version for
  AI assistants. Macros: page tree, open tasks you can tick, recent changes,
  another page shown in place, expandable sections, columns, status labels,
  countdowns and today's date.
- [ ] **Later for robustness:** the merge on the server too (today it happens
  in each browser as text arrives), history for page moves, and importing a
  .zip of Markdown back as a page tree.
### From the review (2026-10-18, versions and macros)

- [ ] **Put lines back from a diff:** a button on removed lines in Changes,
  Recent changes and What changed, since friends rarely want a whole old page,
  just the paragraph someone deleted.
- [ ] **Change a status by clicking it while reading:** pick a new label from
  a small menu, saved as a version with who did it.
- [ ] **"Changed since we agreed":** mark a version as the agreed plan and the
  page shows how many lines changed since, with the diff.
- [ ] **"Did you mean…?" for macro typos,** with a one-click fix in the red mark.
- [ ] **`{{decisions}}`:** collects lines starting "Decided:" from every page,
  with who and when from the versions.
- [ ] **`{{statuses}}`:** "4 booked · 2 waiting · 1 not booked" across the wiki.
- [ ] **"You last saw version 12"** in page history, and comparing with it.
- [ ] **Quick-note chips beside Done on phones** ("dates", "typo", "ideas").
- [ ] **A page picker for Show another page,** and next/previous change buttons
  in What changed.
- [ ] **Filters in Recent changes** ("others' changes only", "this page and
  below"), each row opening that version in the page's history.
- [ ] **Who wrote each task in `{{tasks}}`,** and `{{tasks @me}}`.
- [ ] **A drop zone overlay** ("Drop .md files to add pages") while dragging
  files over a wiki, and importing a .zip of Markdown.

- [ ] **More macros:** `{{rsvp}}`, `{{expenses}}` from a table's "Paid by"
  column, `{{board KEY}}` thumbnails, `{{children depth=2}}`, and per-page
  labels with `{{labelled camping}}` lists.

### From the review (2026-10-18)

Ideas from the wiki review, roughly by value for a small group against effort:

- [ ] **Who's on this page:** friends' colour dots beside pages in the list
  and "Sam is editing" in the page header, from the live presence that
  already exists.
- [ ] **Owners and dates on checklist items:** `- [ ] Book van @Sam
  2026-11-02` shows a person and a date, flags overdue items, and Ctrl+K gets
  "My tasks".
- [ ] **Comments on a page** (or on one heading), reusing the canvas comments
  panel, so friends can discuss without editing the text.
- [ ] **RSVP block:** `{{rsvp}}` shows Going / Maybe / No for each person,
  synced live, for the party and club templates.
- [ ] **Expense split:** a budget table's "Paid by" column feeds a "who owes
  whom" summary for trips and moves.
- [x] **Countdown:** `{{countdown 2026-12-20}}` shows "23 days to go".
- [ ] **Turn a canvas selection into a page:** right-click stickies or a mind
  map → "Make a wiki page" as a checklist or outline, linked back.
- [ ] **Duplicate a page** with its sub-pages, or "New page like this" for
  Day 2, Day 3 and meeting notes.
- [ ] **Print a page** cleanly (no page list, embeds full width) for
  itineraries and packing lists.
- [ ] **Share one page read-only** as a link holding just that page and its
  embeds, for people outside the group.
- [ ] **Fill table cells while reading,** so a budget or guest list doesn't
  mean editing pipes; tick checklists in the page preview beside a board.
- [ ] **Embeds you can explore:** pan and zoom in Expand, a Fit / 100% switch,
  thumbnails in the embed picker, and picking a flowchart shape offers the
  whole flowchart.
- [ ] **Friendlier links while writing:** show `[[Page]](page:…)` and embed
  lines as named chips in the editor instead of ids, and a sticky phone bar
  with Done, `[[`, `/` and a checklist button.
- [ ] **Page icons** picked in the app (today only templates and the API set
  them), and asking for the wiki's name when making a blank one.

## Accounts (October 2026)

- [x] **Accounts on a server** (`BRAINCRAFT_ACCOUNTS=1`): admins and users,
  groups that carry permissions, a setup screen or `BRAINCRAFT_ADMINS` for the
  first admin, and set-your-password links instead of email.
- [x] **Boards with owners and access lists** (view, edit, manage, for people
  or groups); boards from before accounts wait for an admin to give them an
  owner.
- [x] **Single sign-on** with any OpenID Connect provider, groups from the
  provider, and a pretend provider for trying it locally and in tests.
- [x] **API tokens** for scripts.
- [ ] The MCP server signing in with an API token (the HTTP API already takes
  them).
- [ ] "People and groups…" in the command palette for admins.
- [ ] Clear this browser's copies of server boards when signing out, as an
  option for shared computers.
- [x] **An activity log** of admins' changes, sign-ins, access changes, tokens
  and admins opening boards not shared with them, with before and after,
  filters, a download, and a hash chain that shows hand edits.
- [ ] Email for set-your-password links, when a mail server is set up.

## Excalidraw on the canvas (October 2026)

- [x] **Excalidraw drawings** as objects on the board: drawn in Excalidraw full
  screen, kept as a picture plus its scene, reopened with a double-click,
  pasted from Excalidraw or dropped as `.excalidraw` files, downloaded back.
- [ ] An operation (and MCP tool) to make a drawing from Excalidraw elements,
  drawn by the app when the board next opens.
- [ ] Two people in one drawing at once (today the later Done wins).
- [x] **The hand-drawn look for BrainCraft's own objects:** rough.js outlines,
  hatched fills and Excalifont handwriting, per object; flowcharts switch
  whole and grow hand-drawn.
- [x] **Sketch in Excalidraw:** a flowchart drawn again by Excalidraw, beside
  it.
- [ ] Hand-drawn arrowheads and table/Kanban/timeline frames.
- [ ] A board-wide default, so new objects start hand-drawn.

## Guide and API docs (October 2026)

- [x] **A built-in guide**: a wiki explaining the app, with a tour board built
  by operations, live embeds, macros shown working, every shortcut, and a
  try-it checklist; made on a first visit, and from Help or Ctrl+K.
- [x] **The HTTP API documents itself** (`/api/docs`, `/api/openapi.json`),
  and reads boards and wiki pages, not just whole boards.
- [ ] The guide in other languages.
- [ ] Refresh an old copy of the guide when a new version of BrainCraft
  changes it (today it's made once; delete it and open it again for the new
  one).
- [ ] An MCP tool that reads the server's OpenAPI description, so assistants
  can use a remote server without the browser.

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
  get a tidy grid of sticky notes (an indented list still makes a mind map).
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
- [ ] **More vote commands in Ctrl K** (reveal, end and sort; starting a vote
  is already there), a "Many stickies" mode of its own in the
  import dialog, and the flowchart menu listing every shape.
- [ ] **AI quick actions on the selection toolbar:** one-click "Summarise",
  "Group these" and "Turn into a plan" next to the selection (the AI panel
  already has its own one-click actions).
- [ ] **A welcome board that feels like friends**, not a product tour.

## From the third review (October 2026)

- [ ] **A "⋯ More" menu on the selection toolbar.** A single sticky gets a
  bar nearly 1000px wide; keep colour, size, status, comments and delete, and
  move lock, front and back, flip and duplicate into the menu, so it never
  needs a scrollbar or wraps to four rows on a phone.
- [ ] **One record of the screen's busy areas** (tool rail, shape panel,
  minimap, side panels, banners) that the toolbar, keep-in-view, the hint
  bar and the pickers all read, instead of each keeping its own numbers.
- [ ] **One bottom dock** stacking the hint, messages and the status key.
- [ ] **Live: all-or-nothing big changes.** A change sent in parts can be half
  refused; the server could take grouped parts together or not at all.
- [ ] **Live: the server says which change it applied last**, so a reconnect
  never has to guess what to send again.
- [ ] **QR code in the share dialog**, so friends in the same room join by
  pointing a phone.
- [ ] **"I'll take it":** put a person on a sticky, card or record (an avatar
  chip), with a "Mine" filter. For chores, packing lists, who brings what.
- [ ] **Find a date:** each friend taps the days they can make it; the best
  days light up and can become a timeline event.
- [ ] **Add to my calendar:** dated cards, records and events as a calendar
  file or a subscription link.
- [ ] **Copy an update for the group chat:** "Since you were here" or the
  statuses as a short plain-text summary.
- [ ] **Countdown:** give a board a big day; the top bar and board list show
  "12 days to go".
- [ ] **Place cards:** an address or map link becomes a card with the place
  name and a small map, for trips and moves.
- [ ] **A new edit link** (the old one stops working), or links that expire
  after the trip.
- [ ] **Viewers who join in a little:** view-link friends can react, vote and
  spin, and "Ask to edit" pings the editors.
- [ ] **Photo wall:** dropping several photos lays them out in a captioned grid.
- [ ] **Help with a search box**, and shortcuts marked "with nothing
  selected" where that matters.

## From the fourth review (October 2026)

- [ ] **The server offers its network address:** the health check reports
  the computer's LAN address, so the share dialog can hand out links that
  work for friends (today it only warns about localhost).
- [ ] **An "Undo" button in messages** ("Deleted…", "Revealed…"), since
  phones have no Ctrl Z.
- [ ] **Invite through the phone's share sheet**, with a ready-made line:
  board name, edit or view, what to do.
- [ ] **A note for friends who join:** one line from the host shown once to
  anyone arriving by link.
- [ ] **"Bring everyone here"** and presenting to the room: every live friend
  follows you, and slide changes reach everyone.
- [ ] **Quick poll:** a question and its options in one box makes the option
  cards and the dot vote together.
- [ ] **"I'm done" in a private brainstorm**, so the card shows "3 of 5 done".
- [ ] **Reactions on comments**, so friends can agree without a "+1" reply.
- [ ] **A readable version preview** (full size, pan and zoom) before
  restoring, a summary of what changed, and autosaves grouped by day.
- [ ] **"Who added it" view:** tint each sticky with its author's colour.
- [ ] **Touch wording on the welcome board** and touch versions of the hints.
- [ ] **Timer:** any length ("7m"), a chime for everyone, and a place in the
  right-click menu.
- [ ] **Presenting:** numbered, clickable slides in the overview, swipes on
  phones, and quieter vote and spin controls on slides.
- [ ] **New dot-vote cards and the toolbar keep clear of things:** the card
  finds free space instead of covering frame titles, and the toolbar never
  covers a big widget's own header.
- [ ] **Calendar:** a per-day list behind "+N more", and adding a record from
  the keyboard.
- [ ] **Server housekeeping:** write rooms to disk without blocking, cap a
  board's size in bytes, and throttle presence messages.
- [ ] **Live: a reorder sent just before a drop** is replayed by its order
  among the objects it knew, not lost when anyone else added something.
- [ ] **A drag cut off by a reconnect** stays undoable as one step.
- [ ] **Landscape phones:** the phone layout (tools at the bottom) for any
  screen under about 450px tall.

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
