import type { ReactNode } from 'react'
import { type Item, KIND_LABELS } from '../../model/types'

/**
 * The frame shared by tables, Kanban boards and timelines: a title strip you
 * drag the object by, and a body that only takes clicks once the object is
 * selected (so the first click always selects).
 */
export function Widget({
  item,
  live,
  editingTitle,
  actions,
  children,
}: {
  item: Item
  live: boolean
  editingTitle: boolean
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <foreignObject x={item.x} y={item.y} width={item.w} height={item.h}>
      <div className={`widget widget-${item.kind}${live ? ' live' : ''}`}>
        <div className="widget-title">
          <span className="widget-name">{editingTitle ? '' : item.text || KIND_LABELS[item.kind]}</span>
          {live && actions && <div className="widget-actions no-canvas">{actions}</div>}
        </div>
        <div className={`widget-body${live ? ' no-canvas' : ''}`}>{children}</div>
      </div>
    </foreignObject>
  )
}

/** A tiny dropdown menu used inside widgets. */
export function Menu({ items, onClose }: { items: ([string, () => void] | null)[]; onClose: () => void }) {
  return (
    <>
      <div className="menu-scrim" onPointerDown={onClose} />
      <div className="widget-menu" role="menu">
        {items.map((entry, k) =>
          entry ? (
            <button
              key={k}
              role="menuitem"
              onClick={() => {
                entry[1]()
                onClose()
              }}
            >
              {entry[0]}
            </button>
          ) : (
            <hr key={k} />
          ),
        )}
      </div>
    </>
  )
}
