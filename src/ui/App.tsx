import { useEffect, useRef, useState } from 'react'
import { BrainCraftAPI } from '../api/api'
import { Editor } from '../editor/Editor'
import { emptyBoard } from '../model/board'
import { fromJson, toJson, welcomeBoard } from '../model/serialize'
import { Canvas } from './Canvas'
import { BottomLeft, Help, ToolRail, Toast, TopLeft, TopRight } from './Chrome'
import { ContextMenu } from './ContextMenu'
import { type Theme, applyTheme, storedTheme } from './theme'
import { type ContextMenuState, type Ui, UiContext } from './uiContext'
import { imageFiles, readImage } from './images'
import { ImportExport } from './ImportExport'
import { NotesPanel } from './NotesPanel'
import { SearchPalette } from './SearchPalette'
import { clearMeasureCache, measureText } from './measure'
import { EditorContext } from './useEditor'

const STORAGE_KEY = 'braincraft:board'

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return fromJson(raw)
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return welcomeBoard()
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function download(editor: Editor) {
  const name = (editor.board.title || 'board').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'board'
  const url = URL.createObjectURL(new Blob([toJson(editor.board)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.braincraft.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  editor.setStatus(`Downloaded ${a.download}`)
}

export function App() {
  const [editor] = useState(() => new Editor(loadStored(), measureText))
  const [theme, setThemeState] = useState<Theme>(storedTheme)
  const [help, setHelp] = useState(false)
  const [porting, setPorting] = useState(false)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const ui: Ui = {
    theme,
    setTheme: (t) => {
      applyTheme(t)
      setThemeState(t)
    },
    openHelp: () => setHelp(true),
    openImport: () => setPorting(true),
    openFile: () => fileInput.current?.click(),
    openImage: () => imageInput.current?.click(),
    download: () => download(editor),
    newBoard: () => {
      if (editor.board.items.length && !confirm('Start a new board? This replaces the board saved in this browser — download it first to keep a copy.')) return
      editor.load(emptyBoard(), 'New board')
    },
    menu,
    openMenu: setMenu,
    closeMenu: () => setMenu(null),
  }
  const uiRef = useRef(ui)
  uiRef.current = ui

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
    // Autosave to this browser, debounced.
    let timer: number | undefined
    editor.onBoardChange = (b) => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        try {
          localStorage.setItem(STORAGE_KEY, toJson(b))
        } catch {
          editor.setStatus('Could not save in this browser — download a copy to keep your work')
        }
      }, 400)
    }
    // Scripts and AI assistants drive the board through window.BrainCraft (see docs/API.md).
    ;(window as unknown as { BrainCraft: BrainCraftAPI }).BrainCraft = new BrainCraftAPI(editor)
    // Frame the board once the canvas has its size.
    requestAnimationFrame(() => editor.zoomToFit())

    const onKeyDown = (e: KeyboardEvent) => {
      // Search works from anywhere, even while typing.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        editor.setSearchOpen(!editor.searchOpen)
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
        setHelp((h) => !h)
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
      if (result === 'save') download(editor)
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
      editor.onBoardChange = null
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [editor])

  return (
    <EditorContext.Provider value={editor}>
      <UiContext.Provider value={ui}>
        <div className={`app${editor.notesOpen ? ' notes-open' : ''}`}>
          <Canvas />
          <TopLeft />
          <TopRight />
          <ToolRail />
          <BottomLeft />
          <NotesPanel />
          <ContextMenu />
          <Toast />
          <SearchPalette />
          {help && <Help onClose={() => setHelp(false)} />}
          {porting && <ImportExport onClose={() => setPorting(false)} />}
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                editor.load(fromJson(await f.text()), `Opened ${f.name}`)
              } catch (err) {
                editor.setStatus(`Could not open ${f.name}: ${(err as Error).message}`)
              }
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
