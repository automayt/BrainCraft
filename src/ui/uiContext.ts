import { createContext, useContext } from 'react'
import type { Theme } from './theme'

export interface ContextMenuState {
  /** Position in canvas pixels. */
  x: number
  y: number
}

/** App-level UI actions that sit outside the editor (dialogs, files, theme). */
export interface Ui {
  theme: Theme
  setTheme: (t: Theme) => void
  openHelp: () => void
  openImport: () => void
  openFile: () => void
  openImage: () => void
  download: () => void
  newBoard: () => void
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
