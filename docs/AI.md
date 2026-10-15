# The AI assistant

Press **Ctrl J** (or **Ask AI**, top right) to chat with Claude about the
board you're looking at.

- It reads the board before answering and knows what you've selected, so
  "these", "this" and "it" mean your selection.
- Objects it mentions are links: click one to fly to it.
- It never changes the board on its own. It **proposes** changes, which
  appear on the board as a preview: new and changed objects are outlined in
  green, removed ones are crossed out in red. Hover a proposal card to see
  it again. **Apply** makes it one undo step; **Discard** drops it.
- **History** lists every applied change. Each has its own **Undo** and
  **Redo**, which take back just that change even after you've made other
  edits. The history is saved with the board (the latest 50 changes).
- One-click actions sit above the message box: Summarise, Find gaps and
  Decision log always, plus Cluster into themes, Make a mind map and Make a
  flowchart when something is selected.
- **New chat** starts over. Each board has its own conversation while the
  tab is open.

This is separate from [connecting an outside AI assistant over MCP](MCP.md),
which suits Claude Desktop, Claude Code or Cursor. Both use the same tools
and [operations](API.md).

## Connecting it

Open the panel's settings (the gear icon). There are two ways:

1. **Through your BrainCraft server.** If the server has an Anthropic API
   key (see below), the assistant just works for everyone using it, and the
   key never reaches anyone's browser. If the server has an AI password,
   enter it once.
2. **With your own Anthropic API key.** Paste a key from
   [console.anthropic.com](https://console.anthropic.com/settings/keys). It is
   stored only in this browser (local storage) and sent only to Anthropic.
   Anyone with access to this browser profile can read it, so don't do this
   on a shared computer.

### Models

| Model | Good for |
| --- | --- |
| Claude Opus 5.5 (default) | The best results: restructuring boards, building flowcharts and mind maps. |
| Claude Sonnet 5.5 | Faster and cheaper; fine for most questions and smaller changes. |
| Claude Haiku 5.5 | Quick answers and summaries at the lowest cost. |

On Opus and Sonnet, requests use Anthropic's server-side fallbacks: if a
request is declined for safety reasons, it is retried on a fallback model
instead of failing.

## Turning it on for a server

```sh
ANTHROPIC_API_KEY=sk-ant-... node dist/braincraft-server.mjs
```

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Turns on the assistant for everyone using the server, paid from this key. |
| `BRAINCRAFT_AI_PASSWORD` | Optional. People must enter this password before using the assistant. |
| `ANTHROPIC_BASE_URL` | Optional. An API gateway to send requests through instead of `https://api.anthropic.com`. |

The app calls `POST /api/ai/v1/messages` on the server, which adds the key
and streams Anthropic's reply back. To keep the key from being used for
anything else, the server:

- forwards only the Messages API, and only for the three models above;
- caps `max_tokens` at 32,000 and refuses server-side tools (web search and
  the like);
- with a password set, refuses requests without it; without one, allows
  each address 120 requests an hour.

### Cost and safety

- **Anyone who can open your server can spend your key** unless you set
  `BRAINCRAFT_AI_PASSWORD`. On the public internet, set one, and set a
  monthly spend limit for the key in the Anthropic Console.
- One question usually takes two to four requests (reading the board, then
  proposing or answering). Big boards make bigger requests: the whole board
  outline is sent when Claude reads it.
- Boards are sent to Anthropic when you use the assistant, and only then.
