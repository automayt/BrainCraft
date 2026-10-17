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
| `ANTHROPIC_API_KEY` | — | Turns on the in-app AI assistant for everyone using this server, paid from this key. See [AI.md](AI.md). |
| `BRAINCRAFT_AI_PASSWORD` | — | With a key set: people must enter this password before using the assistant. |
| `BRAINCRAFT_TRUST_PROXY` | off | Set to `1` behind an HTTPS proxy so per-visitor limits (link previews) use the visitor's address from `X-Forwarded-For`. Leave off when the server faces the internet directly. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Where to send AI requests, for an API gateway. |

Put it behind your usual HTTPS proxy (Caddy, nginx, a cloud load balancer).
WebSockets must be allowed through on `/api/boards/*/live`.

## Sharing and permissions

Boards are shared by link, the way "anyone with the link" works in Google
Docs:

- **Share → Start a live session** uploads the open board and gives you two
  links. The **edit** link lets people change the board. The **view** link
  lets them watch it live, but nothing they do is saved.
- Each link holds a long random key. Nobody can list or guess boards. Keep
  edit links to people you trust; anyone you give one to can pass it on.
- Each person's browser keeps its own copy of shared boards in its board
  library. Boards reconnect when reopened, and work done offline is sent
  when the connection comes back.
- **Leave the live session (keep my copy)** turns the copy in your browser back into a normal
  board. The server copy stays for everyone else.

There are no user accounts yet. Names shown to others are set in the share
dialog and aren't verified.

## How edits merge

Changes travel as small patches: one per object, line, dataset record or
board title. If two people change *different* things, both changes stay. If
they change *the same* object at the same moment, the server's order
decides and the later edit wins, the same for everyone. Undo only takes back
your own steps, never other people's.

Each browser gets its own block of object ids from the server, so two people
never create objects that clash.

## HTTP API

All board routes take the board's key, either as `Authorization: Bearer <key>`
or as `?key=<key>`.

| Request | Key | Does |
| --- | --- | --- |
| `GET /api/health` | — | `{"ok": true, "name": "braincraft", "version", "ai", "aiPassword", "previews"}` |
| `GET /api/unfurl?url=…` | — | A link card's preview: `{"url", "title"?, "description"?, "image"?, "site"}`, or 422 with `{"error"}`. See below. |
| `POST /api/boards` with optional `{"board": …}` | — | Creates a shared board and returns `{"id", "editKey", "viewKey"}` |
| `GET /api/boards/{id}` | edit or view | `{"id", "role", "version", "board", "people"}` |
| `POST /api/boards/{id}/ops` with `{"ops": […]}` | edit | Applies [operations](API.md) as one change and returns `{"version", "results"}`. Everyone connected sees it immediately. |
| `GET /api/boards/{id}/live` (WebSocket) | edit or view | The live session the app uses. |
| `POST /api/ai/v1/messages` | AI password, if set | The assistant's proxy to the Anthropic Messages API (only with `ANTHROPIC_API_KEY`; see [AI.md](AI.md)). |

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
