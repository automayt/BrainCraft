import { hasSketch, sketchToBoard } from './sketch'
import { copyImage } from './ExportImage'
/** Everything the app can do, by name: shared by the command palette and menus. */

import { type Editor, TOOLS } from '../editor/Editor'
import { KIND_LABELS } from '../model/types'
import { THEMES } from './theme'
import type { Ui } from './uiContext'

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
  data: 'Add database (linked table, board and timeline)',
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
    ...(editor.timer ? [{ id: 'timer-stop', label: 'Stop the timer', group: 'Together', aliases: 'timer stop cancel', run: () => editor.startTimer(null) }] : []),
    { id: 'export-image', label: 'Export image or PDF…', group: 'Board', keys: 'Ctrl Shift E', aliases: 'png svg pdf picture screenshot download save handout print', run: ui.openExport },
    { id: 'copy-image', label: editor.selection.size ? 'Copy selection as image' : 'Copy board as image', group: 'Board', aliases: 'png picture screenshot clipboard share chat', run: () => void copyImage(editor, editor.selection.size ? new Set(editor.selection) : undefined) },
    { id: 'image', label: 'Add image…', group: 'Create', aliases: 'picture photo upload insert', run: ui.openImage },
    { id: 'undo', label: 'Undo', group: 'Edit', keys: 'Ctrl Z', run: () => editor.undo() },
    { id: 'redo', label: 'Redo', group: 'Edit', keys: 'Ctrl Shift Z', run: () => editor.redo() },
    { id: 'select-all', label: 'Select all', group: 'Edit', keys: 'Ctrl A', run: () => editor.selectAll() },
    { id: 'comments', label: 'Show comments', group: 'Edit', keys: 'Shift C', aliases: 'notes work notes panel', run: () => editor.toggleNotes(true) },
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
    { id: 'download', label: 'Download a copy', group: 'Board', aliases: 'save export json file', run: ui.download },
    { id: 'share', label: 'Share…', group: 'Board', aliases: 'link url send view publish live collaborate together invite team realtime', run: ui.openShare },
    { id: 'assistant', label: 'Ask AI about this board', group: 'Board', keys: 'Ctrl J', aliases: 'assistant claude chat ai summarise cluster', run: ui.toggleAssistant },
    { id: 'ai', label: 'Connect an AI assistant…', group: 'Board', aliases: 'mcp claude cursor chatgpt llm agent pair', run: ui.openAi },
    { id: 'versions', label: 'Version history…', group: 'Board', aliases: 'restore backup undo older snapshot time', run: ui.openVersions },
    { id: 'import', label: 'Import Mermaid, outline or JSON…', group: 'Board', aliases: 'paste api operations ai', run: ui.openImport },
    { id: 'export', label: 'Export as Mermaid…', group: 'Board', aliases: 'flowchart copy', run: ui.openImport },
    { id: 'help', label: 'Keyboard shortcuts', group: 'Help', keys: '?', aliases: 'hotkeys keys help', run: ui.openHelp },
  ]
  if (hasSketch(editor))
    list.push({ id: 'sketch', label: 'Turn sketch into a board (AI)', group: 'Selection', aliases: 'sketch drawing photo picture napkin whiteboard ocr recognise convert ai', run: () => void sketchToBoard(editor) })
  if (editor.selection.size) {
    const locked = editor.selectedItems.every((i) => i.locked)
    list.push({ id: 'lock', label: locked ? 'Unlock' : 'Lock (can’t be moved or changed by accident)', group: 'Selection', keys: 'Ctrl Shift L', aliases: 'lock pin freeze background fix unlock', run: () => editor.setLocked(!locked) })
  }
  if (editor.selection.size > 1) list.push({ id: 'group', label: 'Group', group: 'Selection', keys: 'Ctrl G', aliases: 'group combine together', run: () => editor.group() })
  if (editor.selectedItems.some((i) => i.group)) list.push({ id: 'ungroup', label: 'Ungroup', group: 'Selection', keys: 'Ctrl Shift G', aliases: 'ungroup separate split', run: () => editor.ungroup() })
  if (editor.selection.size > 1 && !editor.selectedItems.some((i) => i.poll || i.kind === 'frame'))
    list.push({ id: 'start-vote', label: 'Start a dot vote on the selection', group: 'Selection', aliases: 'vote poll dot voting choose pick decide favourite', run: () => editor.startVote() })
  if (editor.selection.size)
    for (const emoji of ['👍', '❤️', '🎉'])
      list.push({ id: `react-${emoji}`, label: `React ${emoji}`, group: 'Selection', aliases: 'react reaction emoji like love', run: () => editor.toggleReaction(emoji) })
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
      { id: 'run', label: 'Run flowchart', group: 'Flowchart', keys: 'Shift R', aliases: 'runbook checklist procedure walk steps play', run: () => editor.startRun(id) },
      { id: 'run-here', label: 'Run from this step', group: 'Flowchart', aliases: 'runbook checklist procedure walk', run: () => editor.startRun(id, true) },
      { id: 'run-history', label: 'Run history', group: 'Flowchart', aliases: 'runbook runs log audit past', run: () => ui.openRuns(id) },
    )
  }
  const single = editor.single
  if (single && (single.kind === 'table' || single.kind === 'kanban' || single.kind === 'timeline')) {
    list.push({ id: 'to-data', label: 'Convert to linked data', group: 'Data', aliases: 'database dataset records views sync link', run: () => editor.convertToData(single.id) })
  }
  if (single?.kind === 'data') {
    for (const t of ['table', 'board', 'timeline'] as const)
      list.push({ id: `view-${t}`, label: `Add a ${t} view of this data`, group: 'Data', aliases: 'database linked view kanban gantt', run: () => editor.addDataView(single.id, t) })
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
  return list
}

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
