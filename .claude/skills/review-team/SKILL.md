---
name: review-team
description: Spin up a three-agent review team for BrainCraft (a UX/UI reviewer who uses the app in the browser, a code and testing reviewer, and a product, docs and accessibility reviewer), then merge their findings, fix what's clear, verify, commit and push. Use when asked for a review team, another review round, "3 agents for UI/UX and testing", or a sweep for fixes, inconsistencies and new ideas.
---

# BrainCraft review team

Three reviewers work in parallel and **only read**; you (the lead) merge what
they find, fix it, verify it and ship it. The last round found about 60 issues,
including crash bugs and privacy leaks the unit tests had missed, so take every
step seriously.

## 1. Get ready (lead)

1. `git fetch && git status -sb` on `claude/artcraft-changes-rrr5nd`. Pull if
   behind. Note the commit to review from: by default the last review commit
   (`git log --oneline --grep="Review fixes" -1`), or the start of the session.
2. `npm run check` and `npm run build` must pass before anyone starts.
3. Start a preview for the UX reviewer **on a spare port** (the owner runs their
   own server on 8080, so never use that port). Write `.claude/launch.json`:

   ```json
   { "version": "0.0.1", "configurations": [
     { "name": "review", "runtimeExecutable": "npx",
       "runtimeArgs": ["vite", "preview", "--port", "4180", "--strictPort"], "port": 4180 } ] }
   ```

   Then call `preview_start` with name `review` and note the tab id. (For
   server features such as live sessions and link previews, run
   `node dist/braincraft-server.mjs` with `PORT` set to a spare port and
   `BRAINCRAFT_DATA` pointing at a scratch folder.)
4. Don't rebuild `dist/` while the UX reviewer is working: they're testing that build.

## 2. Launch the team (lead)

Send all three `Agent` calls **in one message**, with `subagent_type`
`general-purpose`. They run in the background, so wait for their reports.
Every brief must say:

- **Read-only.** No file edits, no builds, no git commands that change
  anything.
- Only the UX reviewer may use the browser pane. Three agents sharing one pane
  get in each other's way.
- What has changed since the last review: paste
  `git log --oneline <from>..HEAD` into each brief.
- The report format: up to 25 findings, most important first, each with
  severity, `file:line`, what was seen, a concrete failure scenario and a
  suggested fix. Mark anything not checked as "unverified".
- Describe ideas in plain words and never name other whiteboard products.

### Reviewer 1: UX and UI (browser)

Uses the running app like a person would: the preview URL and tab id,
`window.BrainCraft.apply([...ops])` to make content quickly, and
`window.BrainCraft.editor` for camera and selection. Focus:

- the features changed since the last review;
- floating UI overlapping: the selection toolbar, status key, hint bar, zoom
  bar, minimap, comments panel and toasts;
- crowded toolbars, wording and capitalisation;
- dark and light themes, and phone width (`resize_window` mobile, then back to
  desktop);
- empty states, discoverability, the help panel against real behaviour, and
  accessibility names.

Pane tips to pass on:

- The pane may not repaint, and camera fly-to animations may not run, until a
  screenshot is taken. Call `focusObject` again after a screenshot.
- A hidden pane reports a 0×0 window, so set `resize_window` to 1280×720 first.
- Screenshots are scaled (a 1280-wide page comes back 800 wide), so convert
  coordinates.

### Reviewer 2: code and testing

Reads the diff since the last review. Allowed to run read-only checks:
`npx vitest run`, a throwaway probe test **in its own scratchpad** (never in
the repo), and git log, diff and show. Focus:

- correctness and edge cases, and how features interact (private brainstorm
  masking against export, copy, search, AI and catch-up; undo and redo; live
  sync);
- untrusted board data from share links or live peers: anything that can crash
  every viewer, XSS, and new fields that `src/model/sanitize.ts` must check;
- server safety in `server/` (SSRF, time and size limits, rate limits);
- performance (`Editor.apply` runs on every drag frame; avoid full-board passes
  per render);
- the kinds lists that must stay in step: `serialize.ts` KINDS, `KIND_LABELS`,
  `itemKindLabel`, the Mermaid exclusions, SelectionToolbar `plain`, the
  SearchPalette filters;
- **test gaps**: list the untested risky logic and sketch the tests that should
  exist.

### Reviewer 3: product, docs and accessibility

Reads README.md, `docs/*.md` (especially IDEAS.md) and the UI entry points
(Chrome.tsx, commands.ts, ContextMenu.tsx, SelectionToolbar.tsx, the help
panel's `SHORTCUTS`, templates). Focus:

- docs against code: missing, stale or wrong entries;
- shortcut conflicts, and the same thing named differently in different places;
- what trips up a non-technical friend joining a board, including on phones;
- what friends planning a project together would want;
- **up to 10 new ideas**, ranked by value for a small friend group against
  effort, skipping ones already in IDEAS.md.

## 3. Merge, then fix (lead)

1. As each report arrives, check its claims against the code before acting.
   Reviewers make mistakes: last time one called the context menu inaccessible
   when it wasn't, and another flagged a deliberate design choice as a bug. Say
   which findings you're not fixing and why.
2. Fix in risk order: crashes and security, then privacy leaks, then wrong
   data, then robustness, then layout and UX, then wording and docs.
3. Add tests for every risky fix (vitest, next to the code). Put a regression
   test in place, then check it **fails without the fix**: temporarily revert
   the line, or the test may be proving nothing.
4. Bigger ideas go into `docs/IDEAS.md` under a dated "From the review"
   heading, not into this round.

## 4. Verify and ship (lead)

1. Run `npm run check` (typecheck, lint, tests) and `npm run build`.
2. Rebuild, reload the preview, and confirm the UI fixes in the browser.
   Measure with `getBoundingClientRect` where overlaps were reported.
3. Run `git grep -i miro -- . ':!package-lock.json'`. It must find **nothing**:
   Miro is inspiration only and is never named in code, UI, docs or commits.
4. Commit with a plain-English summary and bullets, ending with the
   attribution lines the harness gives. Never put model names in commits or
   code. Stage by path or `git add -A -- . ':!.claude/launch.json'`, so the
   temporary `launch.json` stays out of commits and this skill stays in. `git pull --rebase`, then
   push. Never open a pull request unless asked.
5. Stop the preview server, reset any viewport emulation, and delete
   `.claude/launch.json`.
6. Report to the owner: what was fixed (grouped by severity), what was left and
   why, and what was added to IDEAS.md. Remind them to restart their 8080
   server if anything in `server/` changed.

## Editing on this machine (Windows, CRLF files)

- **Never put a regex or backslash escapes inside a shell-quoted script.** Bash
  and node `-e` quoting ate `\d`, `\n`, `\.` and backticks several times last
  round. Use the Edit tool for anything with backslashes. For multi-file scripts,
  write the script to a file with a quoted heredoc and run it with `node`.
- Inside node, `/tmp/...` resolves to `E:\tmp`. Pass the scratchpad's real
  Windows path instead.
- Working files are CRLF, and some edited ones become LF. Match `\r\n` or `\n`
  when replacing text from a script; git normalises on commit, so the warnings
  are harmless.
