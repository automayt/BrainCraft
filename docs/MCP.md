# BrainCraft for AI assistants (MCP)

BrainCraft ships an [MCP](https://modelcontextprotocol.io) server, so Claude
Desktop, Claude Code, Cursor and other MCP clients can read your boards and
build on them.

It works two ways:

- **Live.** The assistant works on the board open in your browser. You watch
  the changes appear, and **Ctrl+Z** undoes each batch.
- **Files.** Pass `file` to any tool and the assistant reads and writes a
  `.braincraft` file directly. No browser needed. This suits Claude Code
  working in a repository.

## Setup

1. **Get the server.** It is one file with no dependencies and needs Node 20
   or later. Download it from the app (**menu → Connect an AI assistant…**),
   or build it yourself with `npm run build` (it ends up in
   `dist/braincraft-mcp.mjs`).
2. **Add it to your assistant.**

   Claude Code:

   ```sh
   claude mcp add braincraft -- node /path/to/braincraft-mcp.mjs
   ```

   Claude Desktop (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "braincraft": { "command": "node", "args": ["/path/to/braincraft-mcp.mjs"] }
     }
   }
   ```

3. **Pair your browser.** Ask the assistant to "connect to BrainCraft". It
   calls `connect_browser` and gives you a link like
   `https://…/BrainCraft/#ai=4319.<token>`. Open it in the browser you use
   for BrainCraft. Pairing is remembered, so you do this once. An **AI** dot
   in the top bar shows the connection.

## Tools

| Tool | What it does |
| --- | --- |
| `read_board` | Title, counts by kind, every object (id, kind, label, position, size, comments) and the lines between them. |
| `get_object` | One object in full: text, comments, and its data (table as CSV, Kanban columns and cards, timeline lanes and entries, mind-map outline). |
| `find` | Searches all text, comments, cells, cards and labels (in a wiki: page titles and text). |
| `list_pages` / `read_page` | A wiki's page tree (ids, titles, who edited each and when), and one page in full: its Markdown, sub-pages and the pages linking to it. |
| `apply_ops` | Creates, connects, updates and deletes objects using the [operations](API.md). All or nothing, and one undo step. |
| `export_mermaid` | Flowcharts as Mermaid source. |
| `list_boards` / `open_board` / `create_board` | The boards in your browser (or `.braincraft` files in the working folder). New boards can start from a template; template `wiki` makes a wiki. |
| `connect_browser` | Connection status and the pairing link. |

Every board tool accepts an optional `file`. Relative paths resolve against
`BRAINCRAFT_DIR`, which defaults to the server's working directory. Only
`.braincraft` files can be read or written (a path without an extension gets one).

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `BRAINCRAFT_URL` | `https://automayt.github.io/BrainCraft/` | Where your BrainCraft is hosted; used for the pairing link. |
| `BRAINCRAFT_PORT` | `4319` | Local port for the browser link (the next free one is used if it's taken). |
| `BRAINCRAFT_DIR` | the working directory | Folder for relative `file` paths and `list_boards` in file mode. |
| `BRAINCRAFT_TOKEN` | a saved random token | Pairing token for the browser link. Normally made once and saved, so pairing survives restarts; set it only to pin a known value. |

## How the live link works, and why it's safe

The server listens on `127.0.0.1` only. The BrainCraft tab opens a
Server-Sent Events stream to it, receives each tool call, runs it on the
board, and posts the result back. Every request must carry the pairing
token, which is random, stored in `~/.braincraft/mcp-token` (readable only
by you), and handed out only through the assistant. Other websites can't
read or change your boards through it. To unpair, click **Disconnect** in
the AI dialog. To revoke a token everywhere, delete that file and restart
the server.
