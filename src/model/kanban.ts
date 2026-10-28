/** Kanban boards: columns of cards that move left to right. */

import { uid } from './uid'
import type { KanbanCard, KanbanData } from './types'

export const KANBAN_COL_W = 260

/** Columns to start a Kanban board with. The first is what a new board gets. */
export const KANBAN_TEMPLATES: { id: string; label: string; columns: string[] }[] = [
  { id: 'simple', label: 'Not started, In progress, Completed', columns: ['Not started', 'In progress', 'Completed'] },
  { id: 'todo', label: 'To do, Doing, Done', columns: ['To do', 'Doing', 'Done'] },
  { id: 'sprint', label: 'Sprint', columns: ['Backlog', 'To do', 'In progress', 'In review', 'Done'] },
  { id: 'bugs', label: 'Bug tracking', columns: ['Reported', 'Confirmed', 'Fixing', 'Testing', 'Fixed'] },
  { id: 'content', label: 'Content', columns: ['Ideas', 'Writing', 'Editing', 'Scheduled', 'Published'] },
  { id: 'hiring', label: 'Hiring', columns: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'] },
  { id: 'priority', label: 'Now, Next, Later', columns: ['Now', 'Next', 'Later'] },
  { id: 'week', label: 'Week', columns: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
  { id: 'retro', label: 'Retrospective', columns: ['Went well', 'To improve', 'Actions'] },
]

export function newKanban(columns: string[] = KANBAN_TEMPLATES[0].columns): KanbanData {
  return { columns: columns.map((title) => ({ id: uid(), title, cards: [] })) }
}

/**
 * A template's columns in place of the board's. Cards stay in the column at the same place (the
 * last column takes any from columns past the end); columns keep their ids where they line up.
 */
export function withColumns(k: KanbanData, titles: string[]): KanbanData {
  if (!titles.length) return k
  const columns = titles.map((title, n) => ({ id: k.columns[n]?.id ?? uid(), title, cards: [...(k.columns[n]?.cards ?? [])] }))
  for (const extra of k.columns.slice(titles.length)) columns[columns.length - 1].cards.push(...extra.cards)
  return { ...k, columns }
}

export function findCard(k: KanbanData, id: string): { card: KanbanCard; column: number; index: number } | null {
  for (let c = 0; c < k.columns.length; c++) {
    const index = k.columns[c].cards.findIndex((x) => x.id === id)
    if (index >= 0) return { card: k.columns[c].cards[index], column: c, index }
  }
  return null
}

export function addCard(k: KanbanData, column: string, title = ''): [KanbanData, string] {
  const card: KanbanCard = { id: uid(), title }
  return [{ ...k, columns: k.columns.map((c) => (c.id === column ? { ...c, cards: [...c.cards, card] } : c)) }, card.id]
}

export function updateCard(k: KanbanData, id: string, patch: Partial<KanbanCard>): KanbanData {
  return {
    ...k,
    columns: k.columns.map((c) => ({
      ...c,
      cards: c.cards.map((x) => {
        if (x.id !== id) return x
        const next = { ...x, ...patch }
        // Clearing a field removes it.
        for (const key of Object.keys(patch) as (keyof KanbanCard)[]) if (patch[key] === '' && key !== 'title') delete next[key]
        return next
      }),
    })),
  }
}

export function deleteCard(k: KanbanData, id: string): KanbanData {
  return { ...k, columns: k.columns.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== id) })) }
}

/** Moves a card into `column` at `index` (counted without the card itself). */
export function moveCard(k: KanbanData, id: string, column: string, index: number): KanbanData {
  const found = findCard(k, id)
  if (!found) return k
  const without = deleteCard(k, id)
  return {
    ...without,
    columns: without.columns.map((c) => {
      if (c.id !== column) return c
      const cards = [...c.cards]
      cards.splice(Math.max(0, Math.min(index, cards.length)), 0, found.card)
      return { ...c, cards }
    }),
  }
}

export function addColumn(k: KanbanData, title = 'New column'): [KanbanData, string] {
  const id = uid()
  return [{ ...k, columns: [...k.columns, { id, title, cards: [] }] }, id]
}

export function renameColumn(k: KanbanData, id: string, title: string): KanbanData {
  return { ...k, columns: k.columns.map((c) => (c.id === id ? { ...c, title } : c)) }
}

export function deleteColumn(k: KanbanData, id: string): KanbanData {
  return { ...k, columns: k.columns.filter((c) => c.id !== id) }
}

export function moveColumn(k: KanbanData, id: string, dir: -1 | 1): KanbanData {
  const i = k.columns.findIndex((c) => c.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= k.columns.length) return k
  const columns = [...k.columns]
  ;[columns[i], columns[j]] = [columns[j], columns[i]]
  return { ...k, columns }
}

/** Width that shows every column plus the strip that adds one. */
export function kanbanWidth(k: KanbanData): number {
  return Math.max(1, k.columns.length) * (KANBAN_COL_W + 12) + 24 + 28 + 2
}
