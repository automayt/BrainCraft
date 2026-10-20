import { hasSketch, sketchToBoard } from './sketch'
import { VIEW_TYPES } from '../model/dataset'
import { copyImage } from './ExportImage'
/** Everything the app can do, by name: shared by the command palette and menus. */

import { type Editor, TOOLS } from '../editor/Editor'
import { KIND_LABELS } from '../model/types'
import { isWiki } from '../model/wiki'
import { canSketch } from '../model/sketch'
import { sketchIt } from './excalidraw/sketchIt'
import { canHaveStatus, STATUSES, statusCounts } from '../model/status'
import { THEMES } from './theme'
import type { Ui } from './uiContext'
import { appName } from '../store/brand'

export interface Command {
  id: string
  label: string
  group: string
  keys?: string
  /** Extra words to match on. */
  aliases?: string
  run: () => void
}

const TOOL_VERBS: Record<string, string> = {
  select: 'Select tool',
  hand: 'Hand tool (pan)',
  sticky: 'Add sticky note',
  text: 'Add text',
  rect: 'Add rectangle',
  ellipse: 'Add ellipse',
  mind: 'Start a mind map',
  flow: 'Add flowchart shape',
  comment: 'Add comment block',
  table: 'Add table',
  kanban: 'Add Kanban board',
  timeline: 'Add timeline',
  data: 'Add database (table, Kanban, timeline, calendar and gallery views)',
  connector: 'Connect objects',
  pen: 'Draw with the pen',
  frame: 'Add frame',
}

export function commands(editor: Editor, ui: Ui): Command[] {
  const list: Command[] = [
    ...TOOLS.map((t) => ({
      id: `tool:${t.tool}`,
      label: TOOL_VERBS[t.tool] ?? t.label,
      group: t.tool === 'select' || t.tool === 'hand' || t.tool === 'connector' || t.tool === 'pen' ? 'Tools' : 'Create',
      keys: t.key.toUpperCase(),
      aliases: `${t.label} new insert create`,
      // Chosen from the palette, a creating tool places its object straight away (in the middle of the view).
      run: () => {
        editor.setTool(t.tool)
        editor.placeHere()
      },
    })),
    { id: 'emote', label: 'Send an emote', group: 'Together', keys: 'E', aliases: 'emoji react party celebrate live', run: () => editor.openEmotePicker() },
    { id: 'chat', label: 'Say something by your cursor', group: 'Together', keys: '/', aliases: 'cursor chat message talk live', run: () => editor.setChatting(true) },
    ...[1, 3, 5, 10].map((m) => ({ id: `timer-${m}`, label: `Start a ${m}-minute timer`, group: 'Together', aliases: 'timer countdown timebox clock brainstorm', run: () => editor.startTimer(m * 60) })),
    { id: 'wheel', label: editor.selection.size > 1 ? 'Spin a wheel between these' : 'Add a spinner wheel', group: 'Together', aliases: 'wheel spinner spin random pick choose decide lottery raffle who', run: () => editor.addWheel() },
    { id: 'brainstorm', label: 'Start a private brainstorm', group: 'Together', aliases: 'brainstorm private hidden secret blind ideas reveal anonymous sticky', run: () => editor.startBrainstorm() },
    ...(editor.timer ? [{ id: 'timer-stop', label: 'Stop the timer', group: 'Together', aliases: 'timer stop cancel', run: () => editor.startTimer(null) }] : []),
    { id: 'export-image', label: 'Export: image, PDF or Markdown…', group: 'Board', keys: 'Ctrl Shift E', aliases: 'png svg pdf picture screenshot download save handout print markdown md text', run: ui.openExport },
    { id: 'copy-image', label: editor.selection.size ? 'Copy selection as image' : 'Copy board as image', group: 'Board', aliases: 'png picture screenshot clipboard share chat', run: () => void copyImage(editor, editor.selection.size ? new Set(editor.selection) : undefined) },
    { id: 'image', label: 'Add image…', group: 'Create', aliases: 'picture photo upload insert', run: ui.openImage },
    { id: 'undo', label: 'Undo', group: 'Edit', keys: 'Ctrl Z', run: () => editor.undo() },
    { id: 'redo', label: 'Redo', group: 'Edit', keys: 'Ctrl Shift Z', run: () => editor.redo() },
    { id: 'select-all', label: 'Select all', group: 'Edit', keys: 'Ctrl A', run: () => editor.selectAll() },
    { id: 'comments', label: 'Show comments', group: 'Edit', keys: 'Alt C', aliases: 'notes work notes panel', run: () => editor.toggleNotes(true) },
    { id: 'present', label: 'Present', group: 'View', keys: 'Shift P', aliases: 'slides slideshow presentation fullscreen frames deck', run: ui.present },
    { id: 'zoom-in', label: 'Zoom in', group: 'View', run: () => editor.zoomBy(1.25) },
    { id: 'zoom-out', label: 'Zoom out', group: 'View', run: () => editor.zoomBy(1 / 1.25) },
    { id: 'zoom-100', label: 'Zoom to 100%', group: 'View', aliases: 'actual size reset', run: () => editor.setZoom(1) },
    { id: 'zoom-fit', label: 'Zoom to fit', group: 'View', keys: 'Shift 1', aliases: 'everything overview', run: () => editor.zoomToFit() },
    ...THEMES.map((t) => ({
      id: `theme:${t.id}`,
      label: `Theme: ${t.label}`,
      group: 'View',
      aliases: 'appearance colour color mode accessibility contrast',
      run: () => ui.setTheme(t.id),
    })),
    { id: 'boards', label: 'Your boards…', group: 'Board', keys: 'Ctrl O', aliases: 'switch open library all recent', run: ui.openBoards },
    { id: 'new', label: 'New board', group: 'Board', aliases: 'blank create', run: ui.newBoard },
    { id: 'open', label: 'Open board file…', group: 'Board', aliases: 'load import json braincraft', run: ui.openFile },
    { id: 'save', label: 'Save to file', group: 'Board', keys: 'Ctrl S', aliases: 'export json braincraft disk', run: () => ui.saveFile() },
    { id: 'save-as', label: 'Save as…', group: 'Board', keys: 'Ctrl Shift S', aliases: 'export file copy', run: () => ui.saveFile(true) },
    { id: 'download', label: 'Download a copy (.braincraft file)', group: 'Board', aliases: 'save export json file', run: ui.download },
    { id: 'share', label: 'Share…', group: 'Board', aliases: 'link url send view publish live collaborate together invite team realtime', run: ui.openShare },
    { id: 'assistant', label: 'Ask AI about this board', group: 'Board', keys: 'Ctrl J', aliases: 'assistant claude vllm codex model chat ai summarise cluster', run: ui.toggleAssistant },
    { id: 'ai', label: 'Connect an AI assistant…', group: 'Board', aliases: 'mcp claude codex cursor llm agent pair', run: ui.openAi },
    { id: 'versions', label: 'Version history…', group: 'Board', aliases: 'restore backup undo older snapshot time', run: ui.openVersions },
    { id: 'sketch-board', label: 'Hand-drawn look for the whole board', group: 'Board', aliases: 'sketch hand drawn rough sketchy excalidraw style pencil handwriting whiteboard', run: () => editor.setSketch(true, editor.board.items.map((i) => i.id)) },
    { id: 'clean-board', label: 'Clean lines for the whole board', group: 'Board', aliases: 'sketch hand drawn rough clean tidy neat style', run: () => editor.setSketch(false, editor.board.items.map((i) => i.id)) },
    { id: 'excalidraw', label: 'Add an Excalidraw drawing', group: 'Create', aliases: 'excalidraw draw drawing sketch hand-drawn diagram whiteboard doodle', run: () => editor.openDrawing() },
    { id: 'code', label: 'Add code block', group: 'Create', aliases: 'code snippet programming syntax monospace script', run: () => editor.addCode() },
    { id: 'many-notes', label: 'Add many sticky notes (one per line)…', group: 'Create', aliases: 'bulk stickies list lines paste many notes several', run: ui.openImport },
    { id: 'import', label: 'Import Mermaid, outline or JSON…', group: 'Board', aliases: 'paste api operations ai', run: ui.openImport },
    { id: 'export', label: 'Export as Mermaid…', group: 'Board', aliases: 'flowchart copy', run: () => ui.openImport('export') },
    { id: 'help', label: 'Help and shortcuts', group: 'Help', keys: '?', aliases: 'hotkeys keys keyboard shortcuts touch help', run: ui.openHelp },
    { id: 'credits', label: 'Credits and open-source licences', group: 'Help', aliases: 'credits licences licenses open source about thanks attribution notices', run: ui.openCredits },
    { id: 'guide', label: `Open the ${appName()} guide`, group: 'Help', aliases: 'guide manual docs documentation tutorial learn how tour introduction help api', run: ui.openGuide },
  ]
  if (hasSketch(editor))
    list.push({ id: 'sketch', label: 'Turn sketch into a board (AI)', group: 'Selection', aliases: 'sketch drawing photo picture napkin whiteboard ocr recognise convert ai', run: () => void sketchToBoard(editor) })
  if (editor.selection.size) {
    const locked = editor.selectedItems.every((i) => i.locked)
    list.push({ id: 'lock', label: locked ? 'Unlock' : 'Lock (can’t be moved or changed by accident)', group: 'Selection', keys: 'Ctrl Shift L', aliases: 'lock pin freeze background fix unlock', run: () => editor.setLocked(!locked) })
  }
  if (editor.selectedItems.some((i) => canSketch(i.kind)))
    list.push({ id: 'sketch', label: editor.selectionSketched ? 'Clean lines for the selection' : 'Hand-drawn look for the selection', group: 'Selection', aliases: 'sketch hand drawn rough sketchy excalidraw style pencil handwriting clean', run: () => editor.setSketch(!editor.selectionSketched) })
  const flow = editor.selectedItems.find((i) => i.kind === 'flow')
  if (flow && !editor.readOnly) list.push({ id: 'sketch-flowchart', label: 'Sketch this flowchart in Excalidraw', group: 'Selection', aliases: 'excalidraw sketch hand drawn flowchart drawing mermaid', run: () => void sketchIt(editor, flow.id) })
  if (editor.selection.size > 1) list.push({ id: 'group', label: 'Group', group: 'Selection', keys: 'Ctrl G', aliases: 'group combine together', run: () => editor.group() })
  if (editor.selectedItems.some((i) => i.group)) list.push({ id: 'ungroup', label: 'Ungroup', group: 'Selection', keys: 'Ctrl Shift G', aliases: 'ungroup separate split', run: () => editor.ungroup() })
  if (editor.selection.size > 1 && !editor.selectedItems.some((i) => i.poll || i.kind === 'frame'))
    list.push({ id: 'start-vote', label: 'Start a dot vote on the selection', group: 'Selection', aliases: 'vote poll dot voting choose pick decide favourite', run: () => editor.startVote() })
  if (editor.selection.size)
    for (const emoji of ['👍', '❤️', '🎉'])
      list.push({ id: `react-${emoji}`, label: `React ${emoji}`, group: 'Selection', aliases: 'react reaction emoji like love', run: () => editor.toggleReaction(emoji) })
  if (editor.selectedItems.some((i) => canHaveStatus(i.kind))) {
    for (const st of STATUSES)
      list.push({ id: `status-${st.id}`, label: `Mark as ${st.label.toLowerCase()}`, group: 'Selection', aliases: 'status mark progress state tick done finished complete todo task', run: () => editor.markStatus(st.id) })
    if (editor.selectedItems.some((i) => i.status)) list.push({ id: 'status-none', label: 'No status (clear it)', group: 'Selection', aliases: 'status remove unmark', run: () => editor.markStatus(null) })
  }
  if (editor.selectedItems.some((i) => i.kind === 'sticky')) {
    const cards = editor.selectedItems.filter((i) => typeof i.back === 'string')
    if (cards.length) {
      list.push({ id: 'flip', label: 'Flip card over', group: 'Selection', aliases: 'flip turn over reveal back answer quiz', run: () => editor.flipCards() })
      list.push({ id: 'flip-off', label: 'Remove the back (plain sticky note)', group: 'Selection', aliases: 'flip card back remove', run: () => editor.setFlipCards(false) })
    } else list.push({ id: 'flip-on', label: 'Make a flip card (add a back)', group: 'Selection', aliases: 'flip card back quiz reveal answer two sided', run: () => editor.setFlipCards(true) })
  }
  for (const { info } of statusCounts(editor.board))
    list.push({ id: `show-${info.id}`, label: `Show only what's ${info.label.toLowerCase()}`, group: 'View', aliases: 'filter status highlight focus', run: () => editor.setStatusFilter(info.id) })
  if (editor.statusFilter) list.push({ id: 'show-all', label: 'Show everything (clear status filter)', group: 'View', aliases: 'filter status clear reset', run: () => editor.setStatusFilter(null) })
  if (editor.single?.kind === 'mind') {
    const id = editor.single.id
    list.push({ id: 'tidy-mind', label: 'Tidy mind map', group: 'Mind map', aliases: 'reset layout arrange auto align clean', run: () => editor.tidyMindMap(id) })
    if (editor.board.items.some((i) => i.parent === id))
      list.push({
        id: 'collapse-mind',
        label: editor.single.collapsed ? 'Expand branch' : 'Collapse branch',
        group: 'Mind map',
        keys: '/',
        aliases: 'collapse expand fold unfold hide show children branch',
        run: () => editor.toggleCollapsed(id),
      })
  }
  if (editor.single?.kind === 'flow') {
    const id = editor.single.id
    list.push(
      { id: 'run', label: 'Run flowchart', group: 'Flowchart', keys: 'Alt R', aliases: 'runbook checklist procedure walk steps play', run: () => editor.startRun(id) },
      { id: 'run-here', label: 'Run from this step', group: 'Flowchart', aliases: 'runbook checklist procedure walk', run: () => editor.startRun(id, true) },
      { id: 'run-history', label: 'Run history', group: 'Flowchart', aliases: 'runbook runs log audit past', run: () => ui.openRuns(id) },
    )
  }
  const single = editor.single
  if (single && (single.kind === 'table' || single.kind === 'kanban' || single.kind === 'timeline')) {
    list.push({ id: 'to-data', label: 'Convert to linked data', group: 'Data', aliases: 'database dataset records views sync link', run: () => editor.convertToData(single.id) })
  }
  if (single?.kind === 'data') {
    for (const { type: t, label } of VIEW_TYPES)
      list.push({ id: `view-${t}`, label: `Add a ${label.toLowerCase()} view of this data`, group: 'Data', aliases: 'database linked view kanban gantt', run: () => editor.addDataView(single.id, t) })
  }
  if (editor.selection.size > 1) {
    for (const [how, label] of [['left', 'Align left'], ['center', 'Align centres'], ['right', 'Align right'], ['top', 'Align tops'], ['middle', 'Align middles'], ['bottom', 'Align bottoms']] as const)
      list.push({ id: `align-${how}`, label, group: 'Arrange', aliases: 'line up arrange', run: () => editor.align(how) })
    if (editor.selection.size > 2) {
      list.push(
        { id: 'distribute-x', label: 'Distribute horizontally', group: 'Arrange', aliases: 'space evenly spacing', run: () => editor.distribute('x') },
        { id: 'distribute-y', label: 'Distribute vertically', group: 'Arrange', aliases: 'space evenly spacing', run: () => editor.distribute('y') },
      )
    }
    if (editor.selectedItems.every((i) => i.kind === 'mind')) list.push({ id: 'group-ideas', label: 'Group ideas under a new idea', group: 'Mind map', keys: 'Ctrl G', aliases: 'cluster branch', run: () => editor.groupIdeas() })
  }
  if (editor.selection.size) {
    list.push(
      { id: 'duplicate', label: 'Duplicate selection', group: 'Edit', keys: 'Ctrl D', run: () => editor.duplicate() },
      { id: 'delete', label: 'Delete selection', group: 'Edit', keys: 'Del', aliases: 'remove', run: () => editor.deleteSelection() },
      { id: 'front', label: 'Bring to front', group: 'Edit', run: () => editor.bringToFront() },
      { id: 'back', label: 'Send to back', group: 'Edit', run: () => editor.sendToBack() },
    )
  }
  // A wiki has no canvas: its own commands, and the board-wide ones that make sense for it.
  if (isWiki(editor.board)) {
    const page = editor.currentPage
    const look: Command[] = [
      ...(page ? [{ id: 'page-history', label: `Page history of “${page.title || 'Untitled'}”…`, group: 'Wiki', aliases: 'history versions undo restore older changes who wrote page', run: () => editor.openWikiPanel('history') }] : []),
      { id: 'recent', label: 'Recent changes in this wiki…', group: 'Wiki', aliases: 'history latest changed edits activity log', run: () => editor.openWikiPanel('recent') },
    ]
    const wiki: Command[] = editor.readOnly
      ? look
      : [
          ...look,
          { id: 'page-import', label: 'Add Markdown files as pages…', group: 'Wiki', aliases: 'import md markdown files upload', run: () => editor.openWikiPanel('import') },
          { id: 'page-new', label: 'New page', group: 'Wiki', aliases: 'add create wiki page', run: () => editor.addWikiPage() },
          ...(page ? [{ id: 'page-sub', label: `New page under “${page.title || 'Untitled'}”`, group: 'Wiki', aliases: 'add child sub wiki page', run: () => editor.addWikiPage({ parent: page.id }) }] : []),
          ...(page ? [{ id: 'page-trash', label: `Move “${page.title || 'Untitled'}” to the trash`, group: 'Wiki', aliases: 'delete remove wiki page', run: () => editor.trashPage(page.id) }] : []),
        ]
    const board = list
      .filter((c) => (c.group === 'Board' || c.group === 'Help') && !CANVAS_IDS.has(c.id) && (!editor.readOnly || !EDIT_IDS.has(c.id)))
      // Told apart from a page's own history: this one takes every page back.
      .map((c) => (c.id === 'versions' ? { ...c, label: 'Wiki version history (every page)…', aliases: 'restore backup whole wiki all pages snapshot autosave' } : c))
    return [...wiki, ...board]
  }
  // A board that can't be changed (a snapshot link, the view link, a presentation) offers looking, not editing.
  if (editor.readOnly) return list.filter((c) => (LOOK_GROUPS.has(c.group) && !EDIT_IDS.has(c.id)) || LOOK_IDS.has(c.id) || (!editor.running && RUN_IDS.has(c.id)))
  return list
}

const LOOK_GROUPS = new Set(['Board', 'View', 'Help'])
/** Board commands that only mean something on a canvas. */
const CANVAS_IDS = new Set(['export-image', 'copy-image', 'import', 'export'])
const EDIT_IDS = new Set(['versions', 'import'])
const LOOK_IDS = new Set(['emote', 'chat', 'select-all', 'comments', 'run-history'])
/** Runs work on boards that can't be changed (nothing is recorded); not while one is under way. */
const RUN_IDS = new Set(['run', 'run-here'])

/** Commands whose label, group or aliases contain every word of `query`, best first. */
export function matchCommands(list: Command[], query: string): Command[] {
  const words = query.toLowerCase().replace(/^>/, '').split(/\s+/).filter(Boolean)
  if (!words.length) return list
  return list
    .map((c) => {
      const label = c.label.toLowerCase()
      const hay = `${label} ${c.group.toLowerCase()} ${(c.aliases ?? '').toLowerCase()}`
      if (!words.every((w) => hay.includes(w))) return null
      const score = (label.startsWith(words[0]) ? 3 : 0) + (label.includes(words[0]) ? 2 : 0) - label.length / 100
      return { c, score }
    })
    .filter((x): x is { c: Command; score: number } => !!x)
    .sort((a, z) => z.score - a.score)
    .map((x) => x.c)
}

export const kindLabel = (k: keyof typeof KIND_LABELS) => KIND_LABELS[k]
