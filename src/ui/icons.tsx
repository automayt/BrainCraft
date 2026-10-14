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
      <path d="M4 4h16v11l-5 5H4z" fill="var(--sticky-icon)" />
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
  table: (
    <Svg>
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <path d="M3.5 10h17M3.5 14.5h17M9.5 5v14" />
    </Svg>
  ),
  kanban: (
    <Svg>
      <rect x="3.5" y="4" width="5" height="12" rx="1" />
      <rect x="9.5" y="4" width="5" height="8" rx="1" />
      <rect x="15.5" y="4" width="5" height="15" rx="1" />
    </Svg>
  ),
  timeline: (
    <Svg>
      <path d="M3 18h18" />
      <rect x="4" y="5" width="9" height="3.5" rx="1.5" />
      <rect x="9" y="11" width="10" height="3.5" rx="1.5" />
      <path d="M7 18v2M12 18v2M17 18v2" />
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

export const Logo = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
    <defs>
      <linearGradient id="bc-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--logo-a)" />
        <stop offset="1" stopColor="var(--logo-b)" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#bc-logo)" />
    <circle cx="16" cy="16" r="4.2" fill="#fff" />
    <g stroke="#fff" strokeWidth="2.3" strokeLinecap="round" fill="none" opacity="0.92">
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
      <path d={flowOutline(item)} fill="var(--icon-fill)" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
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

export const ImageIcon = () => (
  <Svg>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17l5-5 4 4 2.5-2.5L20 18" />
  </Svg>
)

export const MenuIcon = () => (
  <Svg>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
)

export const ThemeIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
  </Svg>
)

export const HelpIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5" />
    <circle cx="12" cy="16.8" r="0.6" fill="currentColor" />
  </Svg>
)

export const FitIcon = () => (
  <Svg>
    <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
    <rect x="8.5" y="8.5" width="7" height="7" rx="1.2" />
  </Svg>
)

export const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const MinusIcon = () => (
  <Svg>
    <path d="M5 12h14" />
  </Svg>
)

export const CheckIcon = () => (
  <Svg>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)

export const BoardsIcon = () => (
  <Svg>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Svg>
)

export const ShareIcon = () => (
  <Svg>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
)

export const HistoryIcon = () => (
  <Svg>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" />
    <path d="M4 4v4.6h4.6" />
    <path d="M12 8v4.5l3 2" />
  </Svg>
)

export const PlayIcon = () => (
  <Svg>
    <path d="M8 5.5v13l10-6.5z" />
  </Svg>
)
