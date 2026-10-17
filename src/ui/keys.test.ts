import { describe, expect, it } from 'vitest'
import { Editor } from '../editor/Editor'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { applyOps } from '../api/ops'
import { commands } from './commands'
import { altLetter } from './keys'
import type { Ui } from './uiContext'

describe('keyboard', () => {
  it('reads Alt shortcuts by the key pressed, whatever character it types (Option C on a Mac is ç)', () => {
    expect(altLetter({ altKey: true, ctrlKey: false, metaKey: false, code: 'KeyC' })).toBe('c')
    expect(altLetter({ altKey: true, ctrlKey: false, metaKey: false, code: 'ArrowUp' })).toBeNull()
    expect(altLetter({ altKey: false, ctrlKey: false, metaKey: false, code: 'KeyC' })).toBeNull()
    // Ctrl Alt is AltGr on many keyboards: that types a character, so it's left alone.
    expect(altLetter({ altKey: true, ctrlKey: true, metaKey: false, code: 'KeyQ' })).toBeNull()
    const e = new Editor(emptyBoard(), fakeMeasure)
    e.edit((b) => ({ ...b, items: [{ id: 1, kind: 'sticky', x: 0, y: 0, w: 100, h: 100, color: '#fff', text: 'Hi', fontSize: 16 }], nextId: 2 }))
    e.select([1])
    e.keyDown(altLetter({ altKey: true, ctrlKey: false, metaKey: false, code: 'KeyC' }) ?? 'ç', { alt: true })
    expect(e.notesOpen).toBe(true)
  })

  it('offers only looking and copying in Ctrl K when the board can’t be changed', () => {
    const e = new Editor(emptyBoard(), fakeMeasure)
    const ids = () => commands(e, {} as Ui).map((c) => c.id)
    expect(ids()).toContain('tool:sticky')
    e.readOnly = true
    expect(ids()).not.toContain('tool:sticky')
    expect(ids()).not.toContain('brainstorm')
    expect(ids()).toContain('zoom-fit')
    expect(ids()).toContain('export-image')
    // Runs record nothing, so they work there too; and comments can be read.
    e.readOnly = false
    e.edit((b) => applyOps(b, [{ op: 'createFlowchart', mermaid: 'flowchart TD\n  A --> B' }], { measure: fakeMeasure }).board)
    e.select([e.board.items.find((i) => i.kind === 'flow')!.id])
    e.readOnly = true
    expect(ids()).toEqual(expect.arrayContaining(['run', 'run-here', 'run-history', 'comments', 'select-all']))
  })
})
