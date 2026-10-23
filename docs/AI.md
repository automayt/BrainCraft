# The AI assistant

Press **Ctrl J** (or **Ask AI**, top right) to chat with an AI model about the
board you're looking at: Claude, a model on your own OpenAI-compatible server
(such as vLLM), or a command-line agent (`claude -p`, `codex exec`) run by
your BrainCraft server.

- It reads the board before answering and knows what you've selected, so
  "these", "this" and "it" mean your selection.
- Objects it mentions are links: click one to fly to it. So are the wiki
  pages and boards it mentions.
- **Point it at things:** in your question, type **@** for an object or
  **[[** for a wiki page or another board. Whatever you link is read and sent
  along with the question, so the assistant has it without looking it up.
- **Your other boards and wikis:** it can list them and read any of them
  (the ones in this browser), not just the open one.
- **Between boards and wikis:** ask it to "make a wiki article from this
  board", "add this to the Trip wiki" or "turn this page into a board", and it
  proposes the change for that other board or wiki, or a new one. The card
  says where it goes; **Apply** (or **Make the wiki**) does it without leaving
  the board you're on, and **Open the wiki** takes you there. A page written
  from a board links back to it and can show its objects. Changes to a shared
  board or wiki go through its server, so everyone in it sees them; undo
  them there (a wiki keeps every page's history).
- **Files:** in a wiki, it can list the files kept with it and read their
  words (PDFs, documents, slides, spreadsheets). **Ask AI about it** in
  **📎 Files** starts it off.
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
- **One conversation, everywhere.** It follows you between boards and
  wikis: plan on a board, open the wiki, say "now write that up", and it
  knows what "that" is. Each message tells it where you are and when you've
  moved; the chat marks each move with the board's or wiki's name. A change
  made on another board shows **Open the board** instead of Apply or Undo,
  which happen there. **History** (the undo list) stays per board.
- **Kept between visits.** On a server with accounts it's kept with your
  account, privately, so it follows you to another computer; otherwise in
  this browser. Pictures aren't kept, and a change still waiting to be
  applied comes back discarded. **New chat** starts over and forgets the
  kept copy.
- **Long conversations stay light,** without pauses. The boards and wikis
  are the memory, so old copies of what it read (board snapshots, pages,
  files, pictures) are left out first, in batches so most requests start the
  same way and the model server can reuse its work. Only if that isn't
  enough is the oldest part summarised, in the background, keeping the last
  dozen exchanges word for word.

This is separate from [connecting an outside AI assistant over MCP](MCP.md),
which suits Claude Desktop, Claude Code or Cursor. Both use the same tools
and [operations](API.md).

## Talking to it

Press **🎙 Talk** and just talk, as you would to a person at the whiteboard.
Nothing needs sending: at each pause, what you said goes to the assistant,
which shapes the board as you speak. Open a new board and say "let's plan the
launch: there's the website, the press release and the party", and it picks
the form (a mind map for ideas around a topic, a flowchart for steps and
decisions, notes, a table, a Kanban board or a timeline), then keeps building
on it as you go on: "add a budget under the party", "no, make that a
flowchart", "move the press release first".

- Talking changes the board straight away, without a preview, so it can
  keep up. Every change is still listed under **History**, to undo. Each
  turn is a single request to the model: it says in a few words what it's
  doing, makes the change, and is done.
- What you said while it was working waits, and goes as one turn when it's
  done. **Go now** sends it without waiting for the pause.
- **Stop talking** ends it (what you were saying still goes).
- The microphone needs the page on https or on this computer (localhost); see
  [HTTPS.md](HTTPS.md).

### Flowstate

**Flowstate** (Ctrl Shift F, **Flowstate** in the panel, **Or talk it
through** on a blank board, or Ctrl K → Flowstate) is talking with nothing
else on screen: the app's bars, tools and panels go away and the board fills
the screen (full screen where the browser allows). Just talk.

- The assistant's few words float at the top middle as it writes them ("Mind
  map of the launch, three branches.") and fade once they've been read; the
  last couple stay, smaller, for context. Dots there mean it's working.
- What you're saying shows faintly at the bottom. Below it, a soft light in
  the brand colours glows along the bottom edge: it breathes slowly while
  it's listening and rises gently as your voice comes in, the only sign
  it's hearing you.
- The board changes as you go: it makes a mind map when you describe one,
  then adds, replaces, removes and rearranges as you carry on ("actually,
  replace the party with a launch dinner"). The camera keeps the whole board
  in view while it's readable, below the words at the top, and goes to what
  changed once the board outgrows the screen.
- The board still works by hand: drag, type and delete as usual, and the
  next turn builds on your version. Ctrl Z undoes the last change.
- **Space** mutes: tap it to mute and tap again to listen, or hold it to
  mute just while it's held (to say something to someone in the room).
  Muting starts the moment you press, and what you'd said before it still
  goes. While muted, the light goes down and a quiet line says so. (In
  Flowstate, pan with the middle button or a scroll; Space is for muting.)
  When talking in the panel, **Mute** is in the talking bar.
- **Esc** (or leaving full screen) ends it, and **Ctrl J** goes from it
  straight to the assistant panel, where the whole conversation is, with an
  **Undo** on every change. Moving the mouse shows a **Leave Flowstate**
  button at the top right.

**Which browser.** Firefox has no speech recognition of its own (only behind
a setting), so for it, and for the best results everywhere, the BrainCraft
server turns speech into words with a speech-to-text model: set
`BRAINCRAFT_TRANSCRIBE_URL` to any OpenAI-compatible transcription endpoint,
such as Whisper served by vLLM. The app then cuts what you say into phrases at
your pauses and sends each as 16 kHz WAV (what Whisper listens at, and a
format every transcription server reads), the same in Firefox, Chrome, Edge
and Safari. Phrases are transcribed side by side and heard in order, and a
turn waits for a phrase that's still being heard. Without it, Chrome, Edge
and Safari use their own recognition (which may send audio to the browser
maker), and Firefox can't talk.

**Words as you speak.** With `BRAINCRAFT_TRANSCRIBE_PREVIEW=1`, the phrase
you're saying is also transcribed about once a second, so your words appear
while you talk, as they do with a browser's own recognition. That's several
times the transcription work, so turn it on when you run the speech-to-text
server yourself, not with a service that charges by the minute.

**Where to run it.** Whisper is small and turns a phrase into words in a
fraction of a second. Running it close to BrainCraft keeps the audio there
and the delay lowest.

```bash
# Whisper on vLLM
vllm serve openai/whisper-large-v3-turbo --port 8001
BRAINCRAFT_TRANSCRIBE_URL=http://localhost:8001/v1 BRAINCRAFT_TRANSCRIBE_MODEL=openai/whisper-large-v3-turbo BRAINCRAFT_TRANSCRIBE_PREVIEW=1 node dist/braincraft-server.mjs
```

| Variable | Meaning |
| --- | --- |
| `BRAINCRAFT_TRANSCRIBE_URL` | An OpenAI-compatible server's address ending in `/v1`, with `/audio/transcriptions` (vLLM with a Whisper model, or a hosted one). |
| `BRAINCRAFT_TRANSCRIBE_MODEL` | Optional. The model to ask (default `whisper-1`). |
| `BRAINCRAFT_TRANSCRIBE_KEY` | Optional. The key that server needs. |
| `BRAINCRAFT_TRANSCRIBE_PREVIEW` | Optional. `1` shows your words while you speak, by transcribing the phrase so far about once a second. |

Who may use it is decided like the rest of the assistant (the AI password, or
signed in with "Use the AI"), with a higher hourly limit since every phrase is
one request (higher still with previews).

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

# Claude Code: nothing to set. If `claude` is installed where the server runs, the
# assistant offers "Claude Code (claude -p)", with whatever account it's signed in to
# (Codex too, if `codex` is installed). BRAINCRAFT_AI_AGENTS=off turns that off.
node dist/braincraft-server.mjs

# Claude Code with your own options, say another model
BRAINCRAFT_AI_COMMAND='claude -p --tools "" --no-session-persistence --model sonnet' node dist/braincraft-server.mjs

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
| `BRAINCRAFT_AI_AGENTS` | Optional. Which installed agents to offer: unset finds Claude Code (`claude`) and Codex (`codex`) on the server's PATH; `claude`, `codex` or `claude,codex` only those; `off` none. |
| `BRAINCRAFT_AI_COMMAND` | A command-line agent of your own to run for each step, with your own options. |
| `BRAINCRAFT_AI_TIMEOUT` | Optional. How long one agent step may take, in seconds (default 300). |
| `BRAINCRAFT_AI_PASSWORD` | Optional. People must enter this password before using any of them. |

### A command-line agent

**Claude Code and Codex are found by themselves:** when `claude` or `codex`
is on the PATH of the computer the server runs on, the assistant's model list
offers **Claude Code (claude -p)** and **Codex (codex exec)**, run as
`claude -p --tools "" --no-session-persistence` and
`codex exec --skip-git-repo-check --sandbox read-only -`. With
`BRAINCRAFT_AI_COMMAND`, the server also offers a command of your own.

The server runs the chosen command for each step of
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

### Your own model in a full agent

An OpenAI-compatible server like vLLM only answers one request at a time;
BrainCraft's assistant runs the loop around it (asking it, running the board
tool it asks for, asking again), with board tools only. For your model inside
a full agent with its own tools, configure Codex to use it as its model
provider (a provider in `~/.codex/config.toml` with `base_url` set to your
vLLM server's `/v1` and `wire_api = "chat"`), then run that Codex as the
agent command above.

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
