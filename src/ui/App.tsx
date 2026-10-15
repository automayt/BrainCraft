import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BrainCraftAPI } from '../api/api'
import { Bridge, pairingFromHash } from '../api/bridge'
import { AiDialog } from './AiConnect'
import { Presenter } from './Present'
import { RunPanel, RunsDialog } from './RunPanel'
import { Editor } from '../editor/Editor'
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
import { AiPanel } from './AiPanel'
import { SearchPalette } from './SearchPalette'
import { clearMeasureCache, measureText } from './measure'
import { EditorContext } from './useEditor'
import { WorkspaceContext, useWorkspace } from './useWorkspace'

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

const isBoardFile = (f: File) => /\.(braincraft|json)$/i.test(f.name)

type Dialog = 'help' | 'import' | 'boards' | 'versions' | 'share' | 'ai' | null

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
  useSyncExternalStore(editor.subscribe, () => `${editor.notesOpen}|${!!editor.presenting}|${!!editor.running}`)
  const [theme, setThemeState] = useState<Theme>(storedTheme)
  const [dialog, setDialog] = useState<Dialog>(null)
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
    openImport: () => setDialog('import'),
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

  // The comments panel and the assistant share the right edge; framing keeps clear of them.
  useEffect(() => {
    if (editor.notesOpen) setAssistant(false)
  }, [editor.notesOpen])
  useEffect(() => {
    const wide = editor.viewport.w > 720
    editor.rightInset = wide && assistant ? 412 : wide && editor.notesOpen ? 388 : 0
  }, [editor, assistant, editor.notesOpen])

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
      const ctrl = e.ctrlKey || e.metaKey
      // Board zoom instead of browser zoom.
      if (ctrl && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault()
        if (e.key === '0') editor.setZoom(1)
        else editor.zoomBy(e.key === '-' ? 1 / 1.25 : 1.25)
        return
      }
      if (e.key === '?' && !ctrl) {
        e.preventDefault()
        setDialog((d) => (d === 'help' ? null : 'help'))
        return
      }
      if (e.shiftKey && !ctrl && e.key.toLowerCase() === 'p') {
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
          <Canvas />
          <TopLeft />
          <TopRight />
          <ToolRail />
          <BottomLeft />
          <NotesPanel />
          {assistant && !editor.presenting && <AiPanel onClose={() => setAssistant(false)} />}
          <ContextMenu />
          <Toast />
          <SearchPalette />
          <ReadOnlyBanner />
          <Presenter />
          <RunPanel />
          {runsFor !== null && <RunsDialog id={runsFor} onClose={() => setRunsFor(null)} />}
          {dialog === 'help' && <Help onClose={close} />}
          {dialog === 'import' && <ImportExport onClose={close} />}
          {dialog === 'boards' && <BoardsDialog onClose={close} onOpenFile={ui.openFile} />}
          {dialog === 'versions' && <VersionsDialog onClose={close} />}
          {dialog === 'share' && <ShareDialog onClose={close} />}
          {dialog === 'ai' && <AiDialog bridge={bridge} onClose={close} />}
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
