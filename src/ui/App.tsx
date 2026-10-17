import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BrainCraftAPI } from '../api/api'
import { Bridge, pairingFromHash } from '../api/bridge'
import { AiDialog } from './AiConnect'
import { Presenter } from './Present'
import { RunPanel, RunsDialog } from './RunPanel'
import { Editor } from '../editor/Editor'
import * as B from '../model/board'
import { emptyBoard } from '../model/board'
import { FILE_EXT, Workspace } from '../store/workspace'
import { BoardsDialog, ReadOnlyBanner, ShareDialog, VersionsDialog } from './Boards'
import { Canvas } from './Canvas'
import { BottomLeft, Help, ToolRail, Toast, TopLeft, TopRight } from './Chrome'
import { ContextMenu } from './ContextMenu'
import { type Theme, applyTheme, storedTheme } from './theme'
import { type ContextMenuState, type Ui, UiContext } from './uiContext'
import { imageFiles, readImage } from './images'
import { ImportExport } from './ImportExport'
import { NotesPanel } from './NotesPanel'
import { BoardErrorBoundary } from './ErrorBoundary'
import { watchLinkPreviews } from './linkPreviews'
import { LazyAiPanel } from './lazyAi'
import { ExportDialog } from './ExportImage'
import { SearchPalette } from './SearchPalette'
import { clearMeasureCache, measureText } from './measure'
import { EditorContext } from './useEditor'
import { WorkspaceContext, useWorkspace } from './useWorkspace'

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

const isBoardFile = (f: File) => /\.(braincraft|json)$/i.test(f.name)

type Dialog = 'help' | 'import' | 'boards' | 'versions' | 'share' | 'ai' | 'export' | null

/** Opens the board library first, then the app. */
export function Root() {
  const [ws, setWs] = useState<Workspace | null>(null)
  useEffect(() => {
    let live = true
    void Workspace.start(new Editor(emptyBoard(), measureText)).then((w) => live && setWs(w))
    return () => {
      live = false
    }
  }, [])
  if (!ws) return <div className="app loading" aria-busy="true" />
  return (
    <WorkspaceContext.Provider value={ws}>
      <App ws={ws} />
    </WorkspaceContext.Provider>
  )
}

function App({ ws }: { ws: Workspace }) {
  useWorkspace()
  const editor = ws.editor
  // Re-render only when the panels or modes that shape the layout change, not on every editor update.
  useSyncExternalStore(editor.subscribe, () => `${editor.notesOpen}|${!!editor.presenting}|${!!editor.running}|${!!editor.pendingAiPrompt}`)
  const [theme, setThemeState] = useState<Theme>(storedTheme)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [importTab, setImportTab] = useState<'import' | 'export'>('import')
  const [runsFor, setRunsFor] = useState<number | null>(null)
  const [bridge] = useState(() => new Bridge(ws))
  const [, setBridgeVersion] = useState(0)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [assistant, setAssistant] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const ui: Ui = {
    theme,
    setTheme: (t) => {
      applyTheme(t)
      setThemeState(t)
    },
    openHelp: () => setDialog('help'),
    openImport: (tab?: unknown) => {
      setImportTab(tab === 'export' ? 'export' : 'import')
      setDialog('import')
    },
    openFile: () => {
      void ws.pickFile().then((picked) => picked || fileInput.current?.click())
    },
    openImage: () => imageInput.current?.click(),
    download: () => ws.download(),
    saveFile: (saveAs) => void ws.saveFile(saveAs),
    newBoard: () => void ws.newBoard(),
    openBoards: () => setDialog('boards'),
    openVersions: () => setDialog('versions'),
    openShare: () => setDialog('share'),
    openAi: () => setDialog('ai'),
    openExport: () => setDialog('export'),
    assistant,
    toggleAssistant: () => {
      if (!assistant && editor.notesOpen) editor.toggleNotes()
      setAssistant(!assistant)
    },
    openRuns: (id) => setRunsFor(id),
    present: () => {
      setDialog(null)
      setMenu(null)
      if (!editor.startPresenting()) return
      // Full screen where allowed; leaving full screen (Esc in most browsers) ends the presentation.
      document.documentElement.requestFullscreen?.().catch(() => {})
    },
    ai: bridge,
    menu,
    openMenu: setMenu,
    closeMenu: () => setMenu(null),
  }
  const uiRef = useRef(ui)
  uiRef.current = ui

  // Something elsewhere asked the assistant a question: open it (it picks the question up).
  useEffect(() => {
    if (editor.pendingAiPrompt && !assistant) {
      if (editor.notesOpen) editor.toggleNotes(false)
      setAssistant(true)
    }
  }, [editor, editor.pendingAiPrompt, assistant])

  // Link cards get their title and picture from the server, when there is one.
  useEffect(() => watchLinkPreviews(editor, () => ws.server, ws.subscribe), [editor, ws])

  // The comments panel and the assistant share the right edge; framing keeps clear of them.
  useEffect(() => {
    if (editor.notesOpen) setAssistant(false)
  }, [editor.notesOpen])
  useEffect(() => {
    const wide = editor.viewport.w > 720
    editor.setRightInset(wide && (assistant || editor.notesOpen) ? 404 : 0)
  }, [editor, assistant, editor.notesOpen, editor.viewport.w])

  // Fonts change text measurements, so lay mind maps out again once Inter has loaded.
  useEffect(() => {
    editor.measureCache = clearMeasureCache
    document.fonts?.ready.then(() => {
      editor.relayout()
      // Frame the board again now that text has its real size.
      if (!editor.selection.size) editor.zoomToFit()
    })
  }, [editor])

  useEffect(() => {
    // Pair with the MCP server from its link (#ai=PORT.TOKEN), or reconnect to the last one.
    bridge.onChange = () => setBridgeVersion((v) => v + 1)
    const pairing = pairingFromHash(location.hash)
    if (pairing) {
      history.replaceState(null, '', location.pathname + location.search)
      bridge.connect(pairing)
      editor.setStatus('Paired with your AI assistant — it can now work on this board')
    } else {
      const stored = Bridge.stored()
      if (stored) bridge.connect(stored)
    }
    return () => bridge.disconnect(false)
  }, [bridge, editor])

  useEffect(() => {
    // Autosave happens in the workspace; make sure the last edit lands as the page goes away.
    const onHide = () => ws.rescue()
    const onVisibility = () => document.visibilityState === 'hidden' && void ws.flush()
    const onFullscreen = () => {
      if (!document.fullscreenElement && editor.presenting) editor.stopPresenting()
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    // Scripts and AI assistants drive the board through window.BrainCraft (see docs/API.md).
    ;(window as unknown as { BrainCraft: BrainCraftAPI }).BrainCraft = new BrainCraftAPI(editor)
    // Frame the board once the canvas has its size.
    requestAnimationFrame(() => editor.zoomToFit())

    const onKeyDown = (e: KeyboardEvent) => {
      // While presenting, keys drive the slides and nothing else.
      if (editor.presenting) {
        if (editor.presentKey(e.key)) e.preventDefault()
        return
      }
      // While running a flowchart, keys walk it (except in the step's note box).
      if (editor.running && !isTyping(e.target)) {
        if (editor.runKey(e.key)) {
          e.preventDefault()
          return
        }
      }
      // Search works from anywhere, even while typing.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        editor.setSearchOpen(!editor.searchOpen)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setDialog('export')
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        uiRef.current.toggleAssistant()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setDialog('boards')
        return
      }
      // Keys already handled inside a panel or a live table/board/timeline stay there.
      if (isTyping(e.target) || editor.searchOpen || e.defaultPrevented) return
      if (uiRef.current.menu && e.key !== 'Escape') return
      // Escape closes the open menu, dialog or pop-up; it shouldn't also clear the selection behind it.
      if (e.key === 'Escape' && (uiRef.current.menu || document.querySelector('[role="dialog"], .popover, .align-menu'))) return
      const ctrl = e.ctrlKey || e.metaKey
      // Board zoom instead of browser zoom.
      if (ctrl && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault()
        if (e.key === '0') editor.setZoom(1)
        else editor.zoomBy(e.key === '-' ? 1 / 1.25 : 1.25)
        return
      }
      // Shift F10 or the Menu key: the right-click menu, for the selection (or the middle of the view).
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault()
        const box = editor.selection.size ? B.bounds(editor.board, editor.selection) : null
        const at = box ? editor.screenRect(box) : null
        uiRef.current.openMenu(at ? { x: at.x + at.w / 2, y: at.y + at.h / 2, keyboard: true } : { x: editor.viewport.w / 2, y: editor.viewport.h / 2, keyboard: true })
        return
      }
      // Typing on a selected note wins over these: "?" or a capital P can start its new text.
      const typing = editor.typesInto(e.key, { ctrl, alt: e.altKey }) && !(e.target as Element | null)?.closest?.('.no-canvas')
      if (e.key === '?' && !ctrl && !typing) {
        e.preventDefault()
        setDialog((d) => (d === 'help' ? null : 'help'))
        return
      }
      if (e.shiftKey && !ctrl && !typing && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        uiRef.current.present()
        return
      }
      if ((e.target as Element | null)?.closest?.('.no-canvas') && e.key !== 'Escape') return
      // Space edits a selected mind-map idea; otherwise holding it pans.
      if (e.key === ' ' && editor.single?.kind !== 'mind') {
        if (!editor.spaceDown) {
          editor.spaceDown = true
          editor.emit()
        }
        e.preventDefault()
        return
      }
      const result = editor.keyDown(e.key, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey })
      if (result === 'save') void ws.saveFile(e.shiftKey)
      if (result) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && editor.spaceDown) {
        editor.spaceDown = false
        editor.emit()
      }
    }
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const text = editor.copyText()
      if (!text) return
      e.clipboardData?.setData('text/plain', text)
      e.preventDefault()
      if (e.type === 'cut') editor.deleteSelection()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      // Images first: copying from a browser or screenshot tool puts the picture on the clipboard.
      const images = imageFiles(e.clipboardData?.files)
      if (images.length) {
        e.preventDefault()
        for (const file of images) {
          readImage(file).then(
            (img) => editor.addImage(img.src, img.w, img.h),
            (err) => editor.setStatus(err.message),
          )
        }
        return
      }
      const text = e.clipboardData?.getData('text/plain')
      if (text) {
        editor.pasteText(text)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [editor, ws])

  const close = () => setDialog(null)
  return (
    <EditorContext.Provider value={editor}>
      <UiContext.Provider value={ui}>
        <div
          className={`app${editor.notesOpen ? ' notes-open' : ''}${assistant ? ' ai-open' : ''}${ws.readOnly ? ' read-only' : ''}${editor.presenting ? ' presenting' : ''}${editor.running ? ' running' : ''}`}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
          }}
          onDrop={(e) => {
            // Images are handled by the canvas; board files open as new boards.
            const files = Array.from(e.dataTransfer.files).filter(isBoardFile)
            if (!files.length) return
            e.preventDefault()
            for (const f of files) void ws.openFile(f)
          }}
        >
          <BoardErrorBoundary key={ws.boardId ?? 'shared'} onUndo={() => editor.undo()} onBoards={ui.openBoards}>
            <Canvas />
          </BoardErrorBoundary>
          <TopLeft />
          <TopRight />
          <ToolRail />
          <BottomLeft />
          <NotesPanel />
          {assistant && !editor.presenting && (
            <Suspense fallback={<aside className="ai-panel loading no-canvas" aria-busy="true" aria-label="AI assistant" />}>
              <LazyAiPanel onClose={() => setAssistant(false)} />
            </Suspense>
          )}
          <ContextMenu />
          <Toast />
          <SearchPalette />
          <ReadOnlyBanner />
          <Presenter />
          <RunPanel />
          {runsFor !== null && <RunsDialog id={runsFor} onClose={() => setRunsFor(null)} />}
          {dialog === 'help' && <Help onClose={close} />}
          {dialog === 'import' && <ImportExport onClose={close} initialTab={importTab} />}
          {dialog === 'boards' && <BoardsDialog onClose={close} onOpenFile={ui.openFile} />}
          {dialog === 'versions' && <VersionsDialog onClose={close} />}
          {dialog === 'share' && <ShareDialog onClose={close} />}
          {dialog === 'ai' && <AiDialog bridge={bridge} onClose={close} />}
          {dialog === 'export' && <ExportDialog onClose={close} />}
          <input
            ref={fileInput}
            type="file"
            accept={`${FILE_EXT},.json,application/json`}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void ws.openFile(f)
            }}
          />
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => {
              const files = imageFiles(e.target.files)
              e.target.value = ''
              for (const file of files) {
                try {
                  const img = await readImage(file)
                  editor.addImage(img.src, img.w, img.h)
                } catch (err) {
                  editor.setStatus((err as Error).message)
                }
              }
            }}
          />
        </div>
      </UiContext.Provider>
    </EditorContext.Provider>
  )
}
