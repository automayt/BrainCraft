# Hosting BrainCraft with live collaboration

BrainCraft works as a plain static site. On its own, every board lives in the
visitor's browser. Run the **BrainCraft server** as well to get:

- **Live sessions.** Several people edit the same board at once. They see
  each other's cursors and selections, who's here, and can follow someone's
  view.
- **Shared boards.** The server stores them, so links keep working.
- **The HTTP API.** Scripts and services can read boards and change them
  with the [operations](API.md).

The server is one Node script with no install step. It serves the app too,
so one process is all you need.

## Run it

```sh
npm run build                       # builds the app and dist/braincraft-server.mjs
node dist/braincraft-server.mjs     # http://localhost:8080
```

Or with Docker:

```sh
docker build -t braincraft .
docker run -p 8080:8080 -v braincraft-data:/data braincraft
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on. |
| `HOST` | `0.0.0.0` | Address to listen on. |
| `BRAINCRAFT_DATA` | `./braincraft-data` | Where boards are stored, one JSON file each. Back this folder up. |
| `BRAINCRAFT_STATIC` | the script's folder | The built app to serve. |
| `ANTHROPIC_API_KEY` | — | Turns on the in-app AI assistant (Claude) for everyone using this server, paid from this key. See [AI.md](AI.md). |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | — | Turns on the assistant with an OpenAI-compatible server such as vLLM. See [AI.md](AI.md). |
| `BRAINCRAFT_AI_TEXT_TOOLS` | off | `1` when that model is served without tool calling. |
| `BRAINCRAFT_AI_AGENTS` | found | Claude Code (`claude -p`) and Codex (`codex exec`) are offered to the assistant when installed on this computer; `claude`, `codex` or `off` to choose. Only this machine may use them unless a password is set or accounts are on. See [AI.md](AI.md). |
| `BRAINCRAFT_AI_COMMAND`, `BRAINCRAFT_AI_TIMEOUT` | — | A command-line agent of your own, run per step (timeout in seconds, default 300); same rule about other machines. |
| `BRAINCRAFT_AI_PASSWORD` | — | With AI set up: people must enter this password before using the assistant. |
| `BRAINCRAFT_TRANSCRIBE_URL`, `BRAINCRAFT_TRANSCRIBE_MODEL`, `BRAINCRAFT_TRANSCRIBE_KEY` | — | Speech to text for talking to the assistant in any browser (Firefox needs it): an OpenAI-compatible `/v1` address such as Whisper on vLLM, the model (default `whisper-1`) and its key. See [AI.md](AI.md#talking-to-it). |
| `BRAINCRAFT_TRANSCRIBE_PREVIEW` | off | `1`: words appear while you speak (the phrase so far is transcribed about once a second; best with a model on your own GPU). |
| `BRAINCRAFT_ACCOUNTS` | off | `1`: people sign in, groups carry permissions, boards have owners and access lists, and share links stop working. See [ACCOUNTS.md](ACCOUNTS.md). |
| `BRAINCRAFT_ADMINS` | — | Emails that are always admins (with accounts on). |
| `BRAINCRAFT_PUBLIC_URL` | — | The server's public address, for sign-in links, secure cookies and the single sign-on redirect URI. |
| `BRAINCRAFT_ALLOWED_ORIGINS` | — | Other origins allowed to call the API with a signed-in cookie. |
| `BRAINCRAFT_OIDC_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_NAME`, `_SCOPES`, `_GROUPS_CLAIM`, `_ALLOWED_DOMAINS` | — | Single sign-on with any OpenID Connect provider. See [ACCOUNTS.md](ACCOUNTS.md). |
| `BRAINCRAFT_DEV_IDP` | off | `1`: a pretend sign-in provider at `/dev-idp` for trying single sign-on locally (localhost only). |
| `BRAINCRAFT_APP_NAME` | BrainCraft | What the app is called: the tab, the top of the app, the sign-in screen. With accounts, admins can change it in **Admin… → Branding**. |
| `BRAINCRAFT_MAX_FILE_MB` | 50 | The biggest file a wiki can keep. |
| `BRAINCRAFT_MAX_BOARD_FILES_MB` | 1024 | All of one board's files together. |
| `BRAINCRAFT_TLS_CERT`, `BRAINCRAFT_TLS_KEY` | — | PEM files of a certificate and its key: the server speaks HTTPS itself, and picks up a renewed certificate within the hour. See [HTTPS.md](HTTPS.md). |
| `BRAINCRAFT_TRUST_PROXY` | off | Set to `1` behind an HTTPS proxy so per-visitor limits (link previews) use the visitor's address from `X-Forwarded-For`. Leave off when the server faces the internet directly. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Where to send AI requests, for an API gateway. |

Put it behind your usual HTTPS proxy (Caddy, nginx, a cloud load balancer).
WebSockets must be allowed through on `/api/boards/*/live`.

## Sharing and permissions

Boards are shared by link, the way "anyone with the link" works in Google
Docs:

- **Share → Start a live session** uploads the open board and gives you two
  links. The **edit** link lets people change the board. The **view** link
  lets them watch it live: they can't change it, but they can follow
  people, send emotes, chat by their cursor, read comments, search, export,
  and make their own copy.
- Links made on **localhost** only work on that computer. To invite
  friends, open BrainCraft by the computer's network address (such as
  `http://192.168.1.20:8080`) or a public address, and share from there.
- Each link holds a long random key. Nobody can list or guess boards. Keep
  edit links to people you trust; anyone you give one to can pass it on.
- Each person's browser keeps its own copy of shared boards in its board
  library. Boards reconnect when reopened, and work done offline is sent
  when the connection comes back.
- **Leave the live session (keep my copy)** turns the copy in your browser back into a normal
  board. The server copy stays for everyone else.

Without accounts, names shown to others are set in the share dialog or in the
comments panel (the same name), and aren't verified. With
`BRAINCRAFT_ACCOUNTS=1`, people sign in, boards have owners and access lists,
and names are the accounts' names: see [ACCOUNTS.md](ACCOUNTS.md).

## How edits merge

Changes travel as small patches: one per object, line, dataset record or
board title. If two people change *different* things, both changes stay. If
they change *the same* object at the same moment, the server's order
decides and the later edit wins, the same for everyone. Undo only takes back
your own steps, never other people's.

Each browser gets its own block of object ids from the server, so two people
never create objects that clash.

## HTTP API

**The server documents its own API:** open `/api/docs` on it for every route
and operation, or give `/api/openapi.json` (OpenAPI 3.1) to an API tool, a
client generator or an AI agent. Both describe the server as it runs: with or
without accounts, and only the AI routes that are switched on.

All board routes take the board's key, either as `Authorization: Bearer <key>`
or as `?key=<key>`. With accounts on, they take a signed-in session or an API
token instead (see [ACCOUNTS.md](ACCOUNTS.md)), and the accounts routes are
listed in `/api/docs`.

| Request | Key | Does |
| --- | --- | --- |
| `GET /api/health` | — | `{"ok": true, "name": "braincraft", "version", "ai", "aiPassword", "previews"}` |
| `GET /api/unfurl?url=…` | — | A link card's preview: `{"url", "title"?, "description"?, "image"?, "site"}`, or 422 with `{"error"}`. See below. |
| `POST /api/boards` with optional `{"board": …}` | — | Creates a shared board and returns `{"id", "editKey", "viewKey"}` |
| `GET /api/boards/{id}` | edit or view | `{"id", "role", "version", "board", "people"}` |
| `POST /api/boards/{id}/ops` with `{"ops": […]}` | edit | Applies [operations](API.md) as one change and returns `{"version", "results"}`. Everyone connected sees it immediately. |
| `GET /api/boards/{id}/objects?kind=` | edit or view | The title, counts by kind, every object (id, kind, label, position, size, comments, status) and the lines between them; for a wiki, its pages. |
| `GET /api/boards/{id}/objects/{objectId}` | edit or view | One object in full: text, description, comments and data (a table as CSV, Kanban cards, timeline lanes, a mind map's outline, a database view's records). |
| `GET /api/boards/{id}/search?q=` | edit or view | Matches in text, comments, cells, cards and labels (in a wiki, pages), each with a snippet. |
| `GET /api/boards/{id}/mermaid?ids=` | edit or view | The flowcharts (or just those objects) as Mermaid, as plain text. |
| `GET /api/boards/{id}/pages` | edit or view | A wiki's page tree, with who edited each page and when. |
| `GET /api/boards/{id}/pages/{page}?version=` | edit or view | One page by id or exact title (URL-encoded): its Markdown, place, sub-pages and backlinks; with `version`, that saved version. |
| `GET /api/boards/{id}/pages/{page}/history` | edit or view | The page's saved versions, newest first. |
| `POST /api/boards/{id}/pages` with `{"title", "parent"?, "before"?, "text"?, "icon"?, "note"?}` | edit | Adds a page; answers with it (201). |
| `PUT /api/boards/{id}/pages/{page}` with `{"title"?, "text"?, "append"?, "icon"?, "note"?, "protected"?}` | edit | Changes a page, keeping a version from before and after; `protected` is for people who manage the wiki. |
| `POST /api/boards/{id}/pages/{page}/move` with `{"parent"?, "before"?}` | edit | Moves a page with its sub-pages (`"parent": null` for the top). |
| `DELETE /api/boards/{id}/pages/{page}` | edit | Moves a page and its sub-pages to the trash. |
| `GET /api/boards/{id}/pages/{page}/export?format=md\|html` | edit or view | One page as a Markdown file or a web page. |
| `GET /api/boards/{id}/export?format=json\|md\|html\|zip` | edit or view | The whole board as a file: `json` (a `.braincraft` file) or `md` for any board; a wiki also as `html` (one printable web page with a contents list) or `zip` (a Markdown file per page). |
| `GET /api/docs` · `GET /api/openapi.json` | — | This API, as a page and as OpenAPI 3.1. |
| `GET /api/boards/{id}/files/{file}` | edit or view | A file kept with the board (PDFs, pictures and plain text open in place; `?download=1` to save it). |
| `GET /api/boards/{id}/files/{file}/text` | edit or view | The words read out of it, as Markdown. |
| `PUT /api/boards/{id}/files/{file}` (and `…/text`) | edit | Keeps a file's bytes (the body, with its Content-Type) or its words. Files are stored under `BRAINCRAFT_DATA/files/`. |
| `DELETE /api/boards/{id}/files/{file}` | edit | Deletes a file's bytes and words. |
| `GET /api/boards/{id}/people` | edit or view (accounts) | Who can open the board, to @mention: names and ids (emails for people who may see everyone). |
| `GET /api/mentions` | signed in (accounts) | Where you're @mentioned on the boards you can open: board, object or page, who wrote it, when, and the words around it. |
| `GET /api/boards/{id}/live` (WebSocket) | edit or view | The live session the app uses. |
| `POST /api/ai/v1/messages` | AI password, if set | The assistant's proxy to the Anthropic Messages API (only with `ANTHROPIC_API_KEY`; see [AI.md](AI.md)). |
| `POST /api/ai/openai/chat/completions` | AI password, if set | The assistant's proxy to an OpenAI-compatible server (only with `OPENAI_BASE_URL`). |
| `POST /api/ai/transcribe?lang=` | AI password, if set | Turns a recording (the body: `audio/wav`, as the app sends, or `audio/webm`, `audio/ogg`, `audio/mp4`…) into words: `{"text"}` (only with `BRAINCRAFT_TRANSCRIBE_URL`). |
| `POST /api/ai/command?agent=` | AI password, or this machine | Runs one of the server's agents once (`claude`, `codex` or `custom`, as `/api/health` lists in `aiAgents`) with `{"prompt"}` on its input; answers `{"text"}`. |

Example: post a status update onto a team board from a CI job.

```sh
curl -X POST "https://braincraft.example.com/api/boards/$BOARD/ops" \
  -H "Authorization: Bearer $EDIT_KEY" \
  -d '{"ops":[{"op":"createComment","text":"Deploy 418 is live ✅"}]}'
```

### Link previews

When someone pastes a web address, the app asks `/api/unfurl` for the page's
title, description and picture. The server fetches the page itself, so it is
careful about what it will fetch:

- only `http` and `https` addresses on the standard ports, without a user
  name or password in them;
- every address the name resolves to must be on the public internet (no
  private, loopback, link-local or other reserved ranges, including IPv6
  forms that carry an IPv4 address), and the connection goes to the address
  that was checked, so the name can't be re-pointed between the check and the
  fetch;
- redirects are followed at most four times, each checked the same way;
- it gives up on a quiet site after 5 seconds and on the whole fetch after 8,
  reads at most 2 MB, and only reads HTML;
- at most 8 pages are fetched at once, and several people asking for the same
  page share one fetch;
- only the preview comes back, never the page; answers are cached for an hour
  (failures for five minutes), and each visitor gets 60 previews a minute.

Pictures on cards load straight from the page's own site in each viewer's
browser.

`POST /api/boards` is open to anyone who can reach the server. If yours is on
the public internet, limit it at your proxy, for example with basic auth or
an IP allow-list on that route.
