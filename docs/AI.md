# The AI assistant

Press **Ctrl J** (or **Ask AI**, top right) to chat with an AI model about the
board you're looking at: Claude, a model on your own OpenAI-compatible server
(such as vLLM), or a command-line agent (`claude -p`, `codex exec`) run by
your BrainCraft server.

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
- **Sketch to board:** select a pen drawing or a photo and press **✦ To
  board** (or right-click → Turn sketch into a board). The picture is sent to
  Claude, which proposes flowcharts, mind maps, notes, tables or Kanban boards
  beside it, as a preview.
- Other parts of the app can ask the assistant too: the "Since you were
  here" banner's **Summarise with AI** opens the panel and asks.
- **New chat** starts over. Each board has its own conversation while the
  tab is open.

This is separate from [connecting an outside AI assistant over MCP](MCP.md),
which suits Claude Desktop, Claude Code or Cursor. Both use the same tools
and [operations](API.md).

## Connecting it

Open the panel's settings (the gear icon). There are three ways:

1. **Through your BrainCraft server.** If its owner set up AI (see below), the
   assistant just works for everyone using it, and no key reaches anyone's
   browser. The **Model** list shows what the server offers: Claude models,
   the models on its model server, and its command-line agent. If the server
   has an AI password, enter it once.
2. **With your own Anthropic API key.** Paste a key from
   [console.anthropic.com](https://console.anthropic.com/settings/keys). It is
   stored only in this browser (local storage) and sent only to Anthropic.
   Anyone with access to this browser profile can read it, so don't do this
   on a shared computer.
3. **With your own model server.** Any server with an OpenAI-compatible API,
   reached straight from your browser: enter its address ending in `/v1`
   (for vLLM on this computer, `http://localhost:8000/v1`), a key if it needs
   one, and the model (**Find models** asks the server). The server has to
   allow BrainCraft's address: start vLLM with
   `--allowed-origins '["https://automayt.github.io"]'` (or your BrainCraft
   server's address).

### Models without tool calling

The assistant reads and changes the board through tools. vLLM serves tool
calls when started with `--enable-auto-tool-choice --tool-call-parser <parser>`
(the parser that suits the model, e.g. `hermes` for Qwen):

```sh
vllm serve Qwen/Qwen3-32B --enable-auto-tool-choice --tool-call-parser hermes --allowed-origins '["*"]'
```

For a model served without tool calling, tick **Describe the tools in the
text** (or set `BRAINCRAFT_AI_TEXT_TOOLS=1` on the BrainCraft server): the
tools are explained in the prompt, and the model asks for one by writing a
small `tool` block, which BrainCraft runs and answers. Command-line agents
always work this way. Pictures (sketch to board) need a model that can see
them; agents don't get them.

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

A BrainCraft server can offer any of these, alone or together; people pick in
the panel's Model list.

```sh
# Claude, paid from your Anthropic key
ANTHROPIC_API_KEY=sk-ant-... node dist/braincraft-server.mjs

# a vLLM (or other OpenAI-compatible) server
OPENAI_BASE_URL=http://localhost:8000/v1 node dist/braincraft-server.mjs

# Claude Code, with whatever account it's signed in to (its own tools turned off)
BRAINCRAFT_AI_COMMAND='claude -p --tools "" --no-session-persistence' node dist/braincraft-server.mjs

# Codex, with whatever model and account it's configured with (prompt read from standard input)
BRAINCRAFT_AI_COMMAND='codex exec --skip-git-repo-check --sandbox read-only -' node dist/braincraft-server.mjs
```

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude for everyone using the server, paid from this key. |
| `ANTHROPIC_BASE_URL` | Optional. An API gateway to send Claude requests through instead of `https://api.anthropic.com`. |
| `OPENAI_BASE_URL` | An OpenAI-compatible server (its address ending in `/v1`), such as vLLM. |
| `OPENAI_API_KEY` | Optional. The key that server needs. |
| `OPENAI_MODEL` | Optional. The model(s) to offer, comma-separated; without it, whatever the server lists at `/models`. |
| `BRAINCRAFT_AI_TEXT_TOOLS` | Optional. `1` when that model is served without tool calling (see above). |
| `BRAINCRAFT_AI_COMMAND` | A command-line agent to run for each step, such as `claude -p` or `codex exec`. |
| `BRAINCRAFT_AI_TIMEOUT` | Optional. How long one agent step may take, in seconds (default 300). |
| `BRAINCRAFT_AI_PASSWORD` | Optional. People must enter this password before using any of them. |

### A command-line agent

With `BRAINCRAFT_AI_COMMAND`, the server runs that command for each step of
the conversation: the whole conversation goes to its standard input as text
(with the tools described in it), and whatever it prints is the answer. That
means:

- It uses the agent's own sign-in and settings: `claude -p` your Claude Code
  account and model (add `--model sonnet` to pick one), `codex exec` whatever
  `~/.codex/config.toml` says. No API key goes into BrainCraft.
- Each step starts the agent afresh, so it's slower than an API (a question
  that reads the board and proposes changes takes a few steps).
- **The agent runs on the server's machine, as the server's user.** Turn off
  its own tools where you can (`--tools ""` for Claude Code, a read-only
  sandbox for Codex). BrainCraft runs it in an empty scratch folder, two at a
  time at most, stops it after the timeout or 2 MB of output, and kills it if
  the person stops the request. Without `BRAINCRAFT_AI_PASSWORD` it only
  answers requests from the server's own machine; set a password to offer it
  to friends.

### What the server allows

The app calls `POST /api/ai/v1/messages` (Claude),
`POST /api/ai/openai/chat/completions` (the model server) or
`POST /api/ai/command` (the agent) on the server, which adds any key and
passes the reply back. To keep the keys from being used for anything else,
the server:

- forwards only the Messages API, and only for the three models above, or
  only chat completions with function tools and the models it offers;
- caps `max_tokens` at 32,000 and refuses server-side tools (web search and
  the like);
- with a password set, refuses requests without it; without one, allows
  each address 120 requests an hour.

### Cost and safety

- **Anyone who can open your server can spend your key** unless you set
  `BRAINCRAFT_AI_PASSWORD`. On the public internet, set one, and set a
  monthly spend limit for the key in the Anthropic Console.
- One question usually takes two to four requests (reading the board, then
  proposing or answering). Each request re-sends the conversation so far, but
  it's cached: repeated parts are billed at a tenth of the price or less. The
  message box footer shows the chat's tokens and how much came from cache.
- Claude reads the board as one short line per object. Boards over 250
  objects are summarised (the selection, frames, mind-map roots, widgets and
  what's on screen), and Claude reads other parts by area or searches, so a
  2,000-object board costs about 5k tokens to read rather than 80k.
- Boards are sent to the model you picked when you use the assistant, and
  only then: to Anthropic, to your model server, or to the agent (and on to
  whatever service it uses).
