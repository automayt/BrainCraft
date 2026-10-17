import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Workspace } from '../store/workspace'

export const WorkspaceContext = createContext<Workspace | null>(null)

/** The workspace (boards, saving, files), re-rendering the caller whenever it changes. */
export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext)
  if (!ws) throw new Error('useWorkspace outside WorkspaceContext')
  useSyncExternalStore(ws.subscribe, ws.getVersion, ws.getVersion)
  return ws
}
