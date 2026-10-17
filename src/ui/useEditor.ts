import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Editor } from '../editor/Editor'

export const EditorContext = createContext<Editor | null>(null)

/** The editor, re-rendering the caller whenever it changes. */
export function useEditor(): Editor {
  const editor = useContext(EditorContext)
  if (!editor) throw new Error('useEditor outside EditorContext')
  // The third argument lets static renders (image export) use the same views.
  useSyncExternalStore(editor.subscribe, editor.getVersion, editor.getVersion)
  return editor
}
