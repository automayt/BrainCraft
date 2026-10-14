import type { ReactNode } from 'react'
import type { Tool } from '../editor/Editor'
import { flowDetail, flowOutline } from '../model/shapes'
import type { FlowShape, Item } from '../model/types'

const Svg = ({ children }: { children: ReactNode }) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const TOOL_ICONS: Record<Tool, ReactNode> = {
  select: (
    <Svg>
      <path d="M5 3l14 8-6 1.6L10 19z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  hand: (
    <Svg>
      <path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-6.5V4a1.5 1.5 0 013 0v7m0-5.5a1.5 1.5 0 013 0V12m0-3.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1.5a6 6 0 01-4.8-2.4L4.5 15a1.6 1.6 0 012.5-2l1 1" />
    </Svg>
  ),
  sticky: (
    <Svg>
      <path d="M4 4h16v11l-5 5H4z" fill="#fff9b1" />
      <path d="M15 20v-5h5" />
    </Svg>
  ),
  text: (
    <Svg>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </Svg>
  ),
  rect: (
    <Svg>
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
    </Svg>
  ),
  ellipse: (
    <Svg>
      <ellipse cx="12" cy="12" rx="8" ry="7" />
    </Svg>
  ),
  flow: (
    <Svg>
      <path d="M12 2.5l4.5 4.5-4.5 4.5L7.5 7z" />
      <rect x="7" y="15" width="10" height="6" rx="1.2" />
      <path d="M12 11.5V15" />
    </Svg>
  ),
  comment: (
    <Svg>
      <path d="M4 5h16v11H10l-4 4v-4H4z" />
      <path d="M8 9h8M8 12h5" />
    </Svg>
  ),
  mind: (
    <Svg>
      <rect x="8.5" y="10" width="7" height="4" rx="2" fill="currentColor" stroke="none" />
      <path d="M15.5 12c2 0 2-5 4-5M15.5 12c2 0 2 5 4 5M8.5 12c-2 0-2-5-4-5M8.5 12c-2 0-2 5-4 5" />
    </Svg>
  ),
  connector: (
    <Svg>
      <path d="M5 19L19 5M12 5h7v7" />
    </Svg>
  ),
  pen: (
    <Svg>
      <path d="M16 4l4 4L9 19H5v-4z" />
      <path d="M13.5 6.5l4 4" />
    </Svg>
  ),
  frame: (
    <Svg>
      <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />
    </Svg>
  ),
}

export const UndoIcon = () => (
  <Svg>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 010 12h-3" />
  </Svg>
)

export const RedoIcon = () => (
  <Svg>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 000 12h3" />
  </Svg>
)

export const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="#4262ff" />
    <circle cx="16" cy="16" r="4.5" fill="#fff" />
    <g stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none">
      <path d="M20 14 C24 10 25 9 27 8" />
      <path d="M20 18 C24 22 25 23 27 24" />
      <path d="M12 14 C8 10 7 9 5 8" />
      <path d="M12 18 C8 22 7 23 5 24" />
    </g>
  </svg>
)

/** A small drawing of a flowchart symbol, for palettes and menus. */
export function FlowShapeIcon({ shape, size = 28 }: { shape: FlowShape; size?: number }) {
  const item = { x: 2, y: 6, w: 28, h: 18, kind: 'flow', shape } as Item
  const detail = flowDetail(item)
  return (
    <svg width={size} height={size * 0.94} viewBox="0 0 32 30" aria-hidden="true">
      <path d={flowOutline(item)} fill="#eef0ff" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      {detail && <path d={detail} fill="none" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  )
}

export const CommentsIcon = () => (
  <Svg>
    <path d="M4 5h16v11H10l-4 4v-4H4z" />
    <path d="M8 9h8M8 12h5" />
  </Svg>
)

export const SearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </Svg>
)
