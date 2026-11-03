import { useRef } from 'react'
import type { Page } from '../../model/types'
import { useDialog } from '../useDialog'
import { useEscape } from '../useEscape'

export type ExportChoice = 'page-md' | 'page-html' | 'page-print' | 'wiki-html' | 'wiki-print' | 'wiki-zip'

const CHOICES: { group: string; items: { id: ExportChoice; label: string; hint: string }[] }[] = [
  {
    group: 'This page',
    items: [
      { id: 'page-print', label: 'Print or save as PDF', hint: 'Ready to print; choose “Save as PDF” in the print dialog' },
      { id: 'page-html', label: 'Web page (.html)', hint: 'With its pictures, to open in any browser' },
      { id: 'page-md', label: 'Markdown (.md)', hint: 'The words, for another notes app' },
    ],
  },
  {
    group: 'The whole wiki',
    items: [
      { id: 'wiki-print', label: 'Print or save as PDF', hint: 'Every page, each on its own sheet' },
      { id: 'wiki-html', label: 'Web page (.html)', hint: 'Every page in one file, with a contents list and pictures' },
      { id: 'wiki-zip', label: 'Markdown files (.zip)', hint: 'A file per page, sub-pages in folders' },
    ],
  },
]

/** One place for every way to take a page, or the whole wiki, out of BrainCraft. */
export function ExportPage({ page, onPick, onClose }: { page: Page; onPick: (c: ExportChoice) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  useEscape(onClose)
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal embed-picker export-page" role="dialog" aria-modal="true" aria-label="Export">
        <header>
          <h2>Export</h2>
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {CHOICES.map((g) => (
          <section key={g.group} aria-label={g.group === 'This page' ? `This page, “${page.title || 'Untitled'}”` : g.group}>
            <h3 className="export-group">{g.group === 'This page' ? `“${page.title || 'Untitled'}”` : g.group}</h3>
            <ul className="embed-choices">
              {g.items.map((c) => (
                <li key={c.id}>
                  <button onClick={() => onPick(c.id)}>
                    <strong>{c.label}</strong>
                    <small className="muted">{c.hint}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
