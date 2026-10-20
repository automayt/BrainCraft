import { createContext, useContext } from 'react'
import type { Bridge } from '../api/bridge'
import type { Theme } from './theme'

export interface ContextMenuState {
  /** Position in canvas pixels. */
  x: number
  y: number
  /** Opened from the keyboard (Shift F10 or the Menu key): the first item takes focus. */
  keyboard?: boolean
}

/** App-level UI actions that sit outside the editor (dialogs, files, theme). */
export interface Ui {
  theme: Theme
  setTheme: (t: Theme) => void
  openHelp: () => void
  /** The built-in guide wiki (made, with its tour board, the first time). */
  openGuide: () => void
  /** The open-source projects BrainCraft is built with, and their licences. */
  openCredits: () => void
  /** The import/export dialog, on the Import tab unless told otherwise. */
  openImport: (tab?: 'import' | 'export') => void
  openFile: () => void
  openImage: () => void
  download: () => void
  /** Saves to the board's file (asking where the first time); `saveAs` always asks. */
  saveFile: (saveAs?: boolean) => void
  newBoard: () => void
  openBoards: () => void
  openVersions: () => void
  openShare: () => void
  /** People and groups (admins, on a server with accounts). */
  openAdmin: () => void
  openAi: () => void
  /** PNG, SVG, clipboard and PDF export. */
  openExport: () => void
  /** The in-app AI assistant panel (Ctrl+J). */
  assistant: boolean
  toggleAssistant: () => void
  /** Presents the board's frames as slides, full screen. */
  present: () => void
  /** The recorded runs of the flowchart containing `id`. */
  openRuns: (id: number) => void
  /** The link to AI assistants through the MCP server. */
  ai: Bridge
  menu: ContextMenuState | null
  openMenu: (m: ContextMenuState) => void
  closeMenu: () => void
}

export const UiContext = createContext<Ui | null>(null)

export function useUi(): Ui {
  const ui = useContext(UiContext)
  if (!ui) throw new Error('useUi outside UiContext')
  return ui
}
