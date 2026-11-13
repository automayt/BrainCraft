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
- **It builds things the way you would by hand.** It grows a mind map idea
  by idea under the idea you name, adds steps to a flowchart, and changes a
  Kanban board, table or timeline in place, so everything stays laid out,
  coloured by branch and tidy (see [Building things properly](#building-things-properly)).
- One-click actions sit above the message box: Summarise, Find gaps and
  Decision log always, plus Cluster into themes, Make a mind map and Make a
  flowchart when something is selected.
- **Sketch to board:** select a pen drawing or a photo and press **Make into
  objects** (or right-click → Turn sketch into a board). The picture is sent to
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

When a request fails, the panel says why and offers **Try again**, which asks
the same question once more without repeating it in the conversation. A
request that says nothing for ten minutes is dropped as too slow. Press
**Stop** to end one yourself.

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
- In a meeting it can tell who said what, when the server has a speaker
  model: see [Who said what, in a meeting](#who-said-what-in-a-meeting). To
  have it take a meeting's notes rather than build what you ask, see
  [MeetingNotes](#meetingnotes).
- The microphone needs the page on https or on this computer (localhost); see
  [HTTPS.md](HTTPS.md).

### Flowstate

**Flowstate** (Ctrl Shift F, **Flowstate** in the panel, **Or talk it
through** on a blank board, or Ctrl K → Flowstate) is talking with nothing
else on screen: the app's bars, tools and panels fade away and the board has the
window to itself. Just talk.

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
- **Esc** ends it, and **Ctrl J** goes from it straight to the assistant
  panel, where the whole conversation is, with an **Undo** on every change.
  Moving the mouse shows a **Leave Flowstate** button at the top right.
- It stays in the window. For full screen, move the mouse and press **Full
  screen** beside **Leave Flowstate**; leaving full screen carries on in the
  window. In full screen, Firefox and Safari keep the first Esc for leaving
  full screen, so a second Esc leaves Flowstate; Chrome and Edge let one Esc
  do both.
- Say it the way you'd say it to a person: "a mind map called
  infrastructure", "add Jason and Brian off that", "under Jason, workstations
  and desktops", "rename monitoring to monitoring and alerts". Each line
  becomes its own idea in the right place, never more words crammed into one
  box (see [Building things properly](#building-things-properly)).

### MeetingNotes

**MeetingNotes** (**MeetingNotes** in the panel, **Or take notes in a
meeting** on a blank board, or Ctrl K → MeetingNotes) is Flowstate for a
meeting: you're talking to other people, not to the assistant, and it takes
the notes on the board as the meeting goes.

- It writes down every point, proposal, number, date, decision, action item
  and open question, each a complete idea in a few words of its own (never
  "yeah", half a sentence, or words speech to text wasn't sure of), and keeps
  shaping them:
  - the notes themselves are a mind map, with the meeting's subject in the
    middle, a branch for each main concept, topics within those, and the
    points under them, grouped by meaning; a branch with more than about
    seven points is split into topics;
  - what people describe gets drawn as soon as there's enough of it, and
    redrawn as they go on: the steps of a process as a flowchart, who sends
    what to whom as a sequence diagram, dates and phases as a timeline,
    options as a table;
  - decisions, proposals, action items, blockers and open questions go in
    one **Decisions and actions** table, with who and when; a Decision is
    only what was agreed, and what was only put forward is a Proposal.
- With voices told apart (below), each point carries who said it.
- **An agenda first.** On a board with things on it, the assistant starts by
  suggesting an agenda: the things on the board most worth the meeting's
  time, by its own estimate of their priority (open questions, undecided or
  waiting items, work that's stuck, things due soon, risks, what has the most
  votes). When the board has an earlier meeting, the agenda starts with what
  it left unfinished (actions, blockers, open questions, proposals not yet
  agreed), marked "Left from last time". It goes on the board as an
  **Agenda** table, and shows at the top left while you meet; each item gets
  its tick once it's been talked about.
- **Talking to the robot.** Anyone can tell the notes what to do mid-meeting,
  by calling the assistant (robot, assistant, BrainCraft) or with a
  note-taking phrase: "robot, note that the budget is fifty thousand",
  "action item for Brian: book the venue", "strike that", "park this" (it
  goes under a **Parked** branch), "make that a timeline". It does it on the
  board without answering out loud.
- A sign at the top left shows it's listening and for how long. With voices
  told apart, it also has **People**: say how many are in the meeting and it
  never splits them into more voices than that.
- It sends what's said in longer stretches than Flowstate (at a pause of a
  couple of seconds, or every half minute), so each turn has enough to make
  sense of.
- It keeps the sound that comes out of the computer's speakers (the others
  on a call), where talking to the assistant takes it away as an echo.
- **Hearing the call too.** On a call, **Hear the call too** on the sign at
  the top left takes the call's own sound as well as the room, from one of:
  - **a share** (Chrome and Edge): the call's tab with **Also share tab
    audio** ticked, or your whole screen with **Share system audio** ticked;
  - **an input that carries the computer's sound** (every browser, Firefox
    too): an audio interface's loopback, Windows' Stereo Mix, or a virtual
    cable. Those that look like one are listed first. It suits a call in its
    own app, and asks nothing each time.

  The last one used is offered first next time. The microphone then keeps to
  your own voice: echo cancelled, so the call coming out of the speakers
  isn't heard twice, and other voices and noise reduced where the browser or
  computer can (voice isolation; on a Mac, the Voice Isolation mic mode, and
  Voice Focus on Windows computers that have it, do this for every app). The
  browser's echo cancelling only knows what the browser itself plays, so with
  a call in its own app it's voice isolation, or headphones, that keeps the
  call out of the microphone. With the server's speech to text, what the
  microphone hears is put down as yours, by your name, and only the call's
  voices are told apart; with the browser's own recognition (Chrome), both
  are heard as one. Stopping the share, or unplugging the input, goes back to
  the microphone alone. Headphones are surest: then nothing from the call
  reaches the microphone at all.
- **The view stays still.** What the notes add glows briefly where it is
  (a still outline instead, when the computer is set to reduce motion); the
  board only moves by itself when none of the notes are in view yet.
- **Your changes stay yours.** The notes never change what was on the board
  before the meeting, anything locked, or anything someone in the meeting
  changed by hand: they build on it instead, and say so. Every change the
  assistant makes is in its **History**, to take back, and Ctrl Z undoes it.
- **Esc** (or **End meeting**) ends it, and asks what the meeting should
  leave on the board, each ticked at first (it remembers your choice):
  - **Idea collage:** the ideas placed as they fit best, as flowcharts,
    sequence diagrams and timelines;
  - **Kanban:** an **Actions** board with a card for each action item, saying
    who, with its due date when one was said;
  - **Notes:** an overview of what the meeting came to, the decisions and
    actions table, and a mind map of the ideas;
  - **Speaker timeline:** a row for each person, their ideas in the order
    they were said, coloured by topic, with a key to the colours.

  Meanwhile what was still being said goes in. Then everything the meeting
  made goes into one frame with the transcript, and MeetingNotes closes: you
  can carry on. Pressing Esc again (**Leave now**) skips the question and
  keeps everything.
- **The review.** Once the frame is made, the assistant reads the whole
  transcript again, in the background (the frame's **Review** button says
  **Reviewing…** meanwhile), and writes the meeting down once: who really
  spoke, every complete idea (with when, who, what it's about and how much it
  matters), and what the meeting came to. Every view in the frame is made
  from that one record, so they agree:
  - **Overview:** a note with the key updates, what was decided, what was
    proposed but not agreed, each action with its owner ("owner not agreed"
    when nobody took it) and due date, blockers and open questions;
  - the **Decisions and actions** table and the **Actions** board, from the
    same outcomes;
  - the **mind map**, rebuilt from the complete ideas, grouped by concept
    and topic, reading left to right like an outline (fold a branch with its
    − button, or /);
  - the **speaker timeline**.

  The frame is named for what the meeting was about and laid out: the
  overview, transcript, decisions and actions along the top, then the
  timeline, the mind map, and everything else the meeting made. Anything you
  changed by hand or locked (during the meeting or since) is left as it is,
  and the status says which views were kept. **Review again** on the frame
  does it all again, updating the same objects rather than adding copies.
- **Detail.** The frame's **Detail** menu shows the mind map and the speaker
  timeline at **Important** (only what matters most), **Normal** or
  **Verbose** (every idea). A long meeting starts at Important. The
  transcript always keeps every word.
- **Where an idea came from.** Each idea in the mind map and timeline says
  who said it, when, and their words (in its description, Alt C); select it
  and **▶ From 4:05** plays the meeting back from that moment.
- **The transcript** is always kept, as a note in the frame: what people
  said and nothing else, every line with when and who said it, in its
  comments (Alt C). Lines cut at a pause mid-sentence are joined back up.
  Words speech to text wasn't sure of are marked "[unclear: …]". What the
  assistant did along the way is kept apart, in the meeting's record.
- What was on the board before stays as it was, outside the frame. Several
  meetings on one board each get a frame of their own.
- **Space** mutes, as in Flowstate.

**From a recording.** **From a recording…** in the panel (or Ctrl K →
MeetingNotes from a recording) takes the notes from a meeting that's already
happened: choose its audio or video (mp3, m4a, wav, webm, mp4…). The browser
reads its sound and cuts it into phrases at the pauses; each goes to the
server's speech to text like a phrase heard through the microphone, voices and
all, only as fast as the notes keep up. The sign shows how far through it is;
Space pauses. When it's all been read, you're asked what to keep, as at the
end of a meeting. It needs the server's speech to text, and the whole
recording is read into memory, so a few hours at most.

**Watching it again.** A meeting's frame keeps its record: select the frame
and press **▶ Replay** (or Ctrl K → Replay this meeting). The board
goes back to how it was when the meeting started and grows again turn by turn,
with what was said appearing at the bottom as it was said and what the
assistant noted at the top. Play and pause (Space), drag to any moment, and
speed it up (8× at first, up to 32×); Esc closes it. The record is kept as a
file with the board (in its files), so everyone with the board can watch it.

**Hearing it right.** Each phrase goes to speech to text with the names and
terms in use on the board (people's names, and words written as names of
things, such as product names and acronyms) and what was said just before,
so names and terms come out spelled as you write them. A pause of about a
second ends a phrase in a meeting (a breath mid-sentence doesn't), and what
speech to text makes up over silence ("Thanks for watching!") is left out.

### Guided

**Guided** (**Guide me** in the panel, **Or be asked questions** on a blank
board, or Ctrl K → Guided) is Flowstate turned round: the assistant asks the
questions. It starts with one (on an empty board, what you'd like to think
through), shows the question it's asking large at the top, and as you answer:

- puts what you said on the board, as when you talk to it;
- maps the questions worth answering next as ideas ending in "?", marked
  *undecided*, under what they're about; once you've answered one, it's
  marked *done* with your answer under it;
- asks about what's missing, unclear, risky or taken for granted: who it's
  for, what happens if…, how you'll know it worked, what comes first.

Ask it for something instead and it does it, then carries on asking. Esc (or
**Stop**) leaves.

### Who said what, in a meeting

With a speaker-recognition model on the server, BrainCraft tells voices apart
while you talk, so in a meeting the assistant knows who said what and puts
each person's ideas down as theirs.

- Each phrase is matched to the voices heard so far in that conversation:
  Voice 1, Voice 2 and so on, in the order people first speak. A new voice
  counts once it's been heard twice, so a cough or two people at once don't
  make one; until then the phrase is "not sure who".
- Voices that turn out to sound alike are put together, keeping the earlier
  number (and any name either was given), and the assistant is told.
- Once a second voice is heard, a **Voices** strip appears (in Flowstate,
  above the words at the bottom; in the panel, in the talking bar). Click a
  voice to name it ("Sam"). The assistant hears the name, uses it from then on,
  and changes the voice to the name on what it already made. Giving a voice a
  name another voice has makes them one person.
- **A named voice is remembered.** The server keeps what it sounds like under
  that name, and from then on knows that voice in every meeting, named from
  the start: the voice is who someone is. It learns them better each time
  they're heard. Naming a voice again with another name takes back what was
  taught to the old one. The assistant's settings list the voices the server
  knows, each with **Forget**.
- The assistant gets each line with who said it ("[Sam] let's move it to
  May"), and puts the person on the idea, shown as the people an idea is
  assigned to. It goes by who said the line.
- **Worked out from what's said.** When the conversation makes it clear who a
  voice is (someone says "thanks, Sam" and Voice 2 answers, or someone
  introduces themselves), the assistant names that voice for the meeting. It
  isn't remembered by the server, as nobody named it. At the end, the review
  reads the whole transcript and names voices and lines it can tell from
  what's around them, everywhere in the meeting.
- **One correction, everywhere.** **People** on a meeting's frame (or Ctrl K
  → People in this meeting) lists who spoke; renaming one changes the name
  on everything in the frame, in the transcript and in the meeting's record,
  and a voice the server remembers is known by the new name from then on.
- Talking on your own, nothing changes: one voice is just you.
- It needs to hear everyone: a laptop in a meeting room, or a call on the
  computer's speakers. With headphones on a call, use **Hear the call too**,
  so the call's voices are heard as well as yours.
- In MeetingNotes, setting **People** keeps it to that many voices, the
  surest way to stop one person turning into two.
- Short phrases ("yeah, and the budget") are the hardest to place: one under
  about a second never starts a new voice, and goes to the nearest one already
  heard. Two people talking over each other land on whoever's louder.

**Turning it on (server):** the model runs inside the BrainCraft server, on
the processor, through the sherpa-onnx library; there's nothing else to run.

1. `npm install` installs the library (`sherpa-onnx-node`, an optional
   dependency, with ready-built files for Windows, Linux and macOS).
2. Download a speaker-recognition model from the sherpa-onnx project's GitHub
   releases (the "speaker-recongition-models" release; its spelling), for
   example `wespeaker_en_voxceleb_resnet34_LM.onnx` (about 26 MB).
3. Set `BRAINCRAFT_SPEAKER_MODEL` to that file and restart. The log says if it
   couldn't be loaded; `/api/health` says `"voices": true` when it's on.

It works alongside speech to text (`BRAINCRAFT_TRANSCRIBE_URL`), which it needs.
`BRAINCRAFT_SPEAKER_THRESHOLD` (default 0.72) is how alike a phrase must be
to a voice to count as it: raise it if different people are taken for one,
lower it if one person keeps turning into several. A speaker model rates
everyone fairly alike: with the model above, two different people's phrases
score about 0.5 and two of the same person's about 0.78, through a call's
sound too, so the default sits between. A different model may need its own
setting. (Until it was measured, the default was 0.35, and almost everyone
was heard as one person; if you set it low then, leave it unset now.)

With accounts, admins can change this in the app instead: **Admin →
Meetings** has a slider for each of how alike a phrase must be to be
someone's, how alike two voices must grow to be put together as one person
(default 0.85), and how alike a voice must be to someone remembered from an
earlier meeting to be given their name (default 0.9). They apply from the
next phrase, are kept across restarts, go in the activity log, and **Use the
server's own** goes back to the environment's or built-in values.

### Building things properly

Spoken turns change the board straight away, so what the assistant makes has
to be right the first time. It builds with the same pieces you use by hand:

| To change | It uses | So that |
| --- | --- | --- |
| A mind map | `createMindMap` (even with just the topic), then `addIdeas` under the idea you name, `moveIdea`, or `setMindMap` to reorganise the whole map | Every idea is its own node, hanging off its parent, coloured by branch and laid out automatically |
| A flowchart | `createFlowchart`, then `addSteps` after a step (one call per branch of a decision, labelled Yes / No), or `setFlowchart` to restructure | Steps are real flowchart shapes, sized for their words and joined in order |
| A Kanban board, table or timeline | `setKanban`, `setTable`, `setTimeline` with the new content | Cards, rows and entries already there keep their dates, colours and links |

It sees what's in each Kanban board, table and timeline as it reads the
board, so it can change one in the same turn.

**Checks before anything is applied.** A change that would make a mess goes
back to the assistant once, with a note on how to do it properly, before you
see it:

- lines drawn to or between mind-map ideas (ideas hang off their parent);
- several ideas crammed into one;
- a mind map or flowchart faked out of plain boxes and lines (loose boxes
  and lines on purpose are still possible);
- something dropped on top of what's already there.

It's sent back at most once per turn, so it can never get stuck: a second
attempt goes ahead as it is. This applies to typed requests too.

**Trying your own model on spoken turns.** `src/ai/spoken.eval.test.ts`
plays whole conversations through the assistant as Flowstate does: a mind
map built and renamed over six turns, a flowchart with a decision, and a
Kanban board whose card moves. It then checks the board for real structure,
no lines between ideas, one idea per node and nothing piled up. It prints
what was said and answered, and how often a change was sent back to tidy. It
uses the model for real, so it's skipped in `npm run check`. Run it against
a BrainCraft server whose agent command is the model to try:

```bash
# A scratch server whose agent is the model under test (here Claude Code's small model)
PORT=4193 BRAINCRAFT_DATA=./scratch-data BRAINCRAFT_AI_AGENTS=off \
BRAINCRAFT_AI_COMMAND='claude -p --tools "" --no-session-persistence --model haiku' node dist/braincraft-server.mjs
# Then, in another terminal
BRAINCRAFT_EVAL_SERVER=http://localhost:4193 BRAINCRAFT_EVAL_AGENT=custom npx vitest run src/ai/spoken.eval.test.ts --silent=false
```

To try a model on an OpenAI-compatible server, point
`BRAINCRAFT_AI_COMMAND` at a small script that sends the prompt it's given
(on standard input) to that server and prints the answer.

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
