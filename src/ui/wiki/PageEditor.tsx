import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { continueList, parseMarkdown } from '../../model/markdown'
import { linkToken } from '../../model/notes'
import { targetFromUrl } from '../../store/deepLink'
import type { Page } from '../../model/types'
import * as W from '../../model/wiki'
import { useEditor } from '../useEditor'
import { useWorkspace } from '../useWorkspace'
import { Markdown, type MarkdownActions } from './Markdown'
import { EmbedPicker } from './EmbedPicker'
import { embedToken } from '../../model/embed'

interface SlashItem {
  label: string
  hint: string
  text?: string
  /** Where the caret goes in `text` (its end when missing). */
  caret?: number
  action?: 'link' | 'subpage' | 'embed'
}

/** What "/" at the start of a line offers. */
const SLASH: SlashItem[] = [
  { label: 'Heading', hint: '##', text: '## ' },
  { label: 'Smaller heading', hint: '###', text: '### ' },
  { label: 'Checklist', hint: '- [ ]', text: '- [ ] ' },
  { label: 'Bulleted list', hint: '-', text: '- ' },
  { label: 'Numbered list', hint: '1.', text: '1. ' },
  { label: 'Table', hint: '| |', text: '| Column | Column |\n| --- | --- |\n|  |  |\n', caret: 2 },
  { label: 'Code', hint: '```', text: '```\n\n```\n', caret: 4 },
  { label: 'Quote', hint: '>', text: '> ' },
  { label: 'Tip', hint: '> [!tip]', text: '> [!tip] ' },
  { label: 'Warning', hint: '> [!warning]', text: '> [!warning] ' },
  { label: 'Divider', hint: '---', text: '---\n' },
  { label: 'Link to a page', hint: '[[', text: '[[', action: 'link' },
  { label: 'New sub-page', hint: 'Adds a page under this one, linked here', action: 'subpage' },
  { label: 'Sub-page list', hint: '{{children}}', text: '{{children}}\n' },
  { label: 'Contents', hint: '{{toc}}', text: '{{toc}}\n' },
  { label: 'Embed from a board…', hint: 'A frame, mind map, table… shown here', action: 'embed' },
]

/** How long after the last key a draft goes out (to the board, other tabs and friends). */
const PUSH_MS = 300

interface Pick {
  label: string
  hint: string
  token: string
}

/**
 * Writing a page: Markdown on the left, how it reads on the right (tabs on narrow screens).
 * Typing stays in a local draft and goes out a moment after you pause; a friend's change to the
 * page comes in whenever there's nothing of yours still waiting to go.
 */
export function PageEditor({ page, text, actions, onDone }: { page: Page; text: string; actions: MarkdownActions; onDone: () => void }) {
  const editor = useEditor()
  const ws = useWorkspace()
  const [draft, setDraft] = useState(text)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [pick, setPick] = useState<{ from: number; query: string; k: number } | null>(null)
  const [slash, setSlash] = useState<{ from: number; query: string; k: number } | null>(null)
  /** Where an embed being picked goes. */
  const [embedAt, setEmbedAt] = useState<number | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const unsent = useRef(false)

  const draftRef = useRef(draft)
  draftRef.current = draft
  const push = (value = draftRef.current) => {
    clearTimeout(timer.current)
    if (!unsent.current) return
    unsent.current = false
    editor.setPageText(page.id, value)
  }

  // A friend's (or another tab's) change shows up when there's nothing of ours waiting.
  useEffect(() => {
    if (!unsent.current && text !== draftRef.current) setDraft(text)
  }, [text])
  // Leaving the page (or the editor) sends what's waiting.
  useEffect(() => () => push(), [page.id])
  useEffect(() => area.current?.focus({ preventScroll: true }), [page.id])

  const change = (value: string, caret?: number) => {
    setDraft(value)
    unsent.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => push(value), PUSH_MS)
    if (caret !== undefined) requestAnimationFrame(() => area.current?.setSelectionRange(caret, caret))
  }

  // The [[ picker: pages of this wiki, then other boards and wikis.
  const picks = useMemo((): Pick[] => {
    if (!pick) return []
    const q = pick.query.trim().toLowerCase()
    const pages = W.pageOrder(editor.board)
      .filter((p) => p.id !== page.id && (!q || p.title.toLowerCase().includes(q)))
      .slice(0, 8)
      .map((p) => ({ label: p.title || 'Untitled', hint: W.pagePath(editor.board, p.id).slice(0, -1).map((x) => x.title).join(' › ') || 'Page', token: linkToken(p.title || 'Untitled', { page: p.id }) }))
    const boards = ws.otherBoards
      .filter((b) => !q || b.title.toLowerCase().includes(q))
      .slice(0, 4)
      .map((b) => ({ label: b.title || 'Untitled', hint: 'Board', token: linkToken(b.title || 'Untitled', { board: b.key }) }))
    const fresh = q && !pages.some((p) => p.label.toLowerCase() === q) ? [{ label: `New page “${pick.query.trim()}”`, hint: 'Made when you follow the link', token: `[[${pick.query.trim()}]]` }] : []
    return [...pages, ...boards, ...fresh]
  }, [pick, editor.board, ws.otherBoards, page.id])

  const track = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart
    const before = el.value.slice(0, caret)
    const m = /\[\[([^[\]\n]{0,60})$/.exec(before)
    setPick(m ? { from: caret - m[0].length, query: m[1], k: 0 } : null)
    // "/" at the start of a line: the menu of things to insert.
    const s = m ? null : /(?:^|\n)\/([\w ]{0,24})$/.exec(before)
    setSlash(s ? { from: caret - s[1].length - 1, query: s[1], k: 0 } : null)
  }

  const slashItems = slash ? SLASH.filter((x) => !slash.query.trim() || x.label.toLowerCase().includes(slash.query.trim().toLowerCase())) : []

  /** Runs a / menu item in place of the "/query" typed. */
  const runSlash = (item: SlashItem) => {
    if (!slash) return
    const caret = area.current!.selectionStart
    const before = draft.slice(0, slash.from)
    const after = draft.slice(caret)
    setSlash(null)
    if (item.action === 'embed') {
      change(before + after, slash.from)
      setEmbedAt(slash.from)
      return
    }
    if (item.action === 'subpage') {
      const id = editor.addWikiPage({ title: 'Untitled', parent: page.id })
      editor.openPage(page.id)
      const token = `${linkToken('Untitled', { page: id })}\n`
      change(before + token + after, slash.from + token.length)
      return
    }
    const text = item.text!
    change(before + text + after, slash.from + (item.caret ?? text.length))
    if (item.action === 'link') requestAnimationFrame(() => setPick({ from: slash.from, query: '', k: 0 }))
  }

  const insert = (p: Pick) => {
    if (!pick) return
    const el = area.current!
    const caret = el.selectionStart
    const next = draft.slice(0, pick.from) + p.token + draft.slice(caret)
    change(next, pick.from + p.token.length)
    setPick(null)
  }

  /** Wraps the selection in `mark` (Ctrl B, Ctrl I). */
  const wrap = (mark: string) => {
    const el = area.current!
    const [a, z] = [el.selectionStart, el.selectionEnd]
    const inner = draft.slice(a, z) || 'text'
    change(draft.slice(0, a) + mark + inner + mark + draft.slice(z))
    requestAnimationFrame(() => el.setSelectionRange(a + mark.length, a + mark.length + inner.length))
  }

  /** Tab and Shift Tab indent and outdent the selected lines (for nested lists). */
  const indent = (out: boolean) => {
    const el = area.current!
    const [a, z] = [el.selectionStart, el.selectionEnd]
    const start = draft.lastIndexOf('\n', a - 1) + 1
    const lines = draft.slice(start, z).split('\n')
    let shift = 0
    const changed = lines.map((l, k) => {
      if (out) {
        const n = l.startsWith('  ') ? 2 : l.startsWith(' ') ? 1 : 0
        if (k === 0) shift = -n
        return l.slice(n)
      }
      if (k === 0) shift = 2
      return `  ${l}`
    })
    const next = draft.slice(0, start) + changed.join('\n') + draft.slice(z)
    change(next)
    requestAnimationFrame(() => el.setSelectionRange(Math.max(start, a + shift), z + (next.length - draft.length)))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash && slashItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSlash({ ...slash, k: (slash.k + (e.key === 'ArrowDown' ? 1 : slashItems.length - 1)) % slashItems.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        runSlash(slashItems[Math.min(slash.k, slashItems.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setSlash(null)
        return
      }
    }
    if (pick && picks.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPick({ ...pick, k: (pick.k + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insert(picks[Math.min(pick.k, picks.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setPick(null)
        return
      }
    }
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      wrap('**')
    } else if (ctrl && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      wrap('*')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      indent(e.shiftKey)
    } else if (e.key === 'Enter' && !e.shiftKey && !ctrl) {
      const el = e.currentTarget
      if (el.selectionStart !== el.selectionEnd) return
      const next = continueList(draft, el.selectionStart)
      if (next) {
        e.preventDefault()
        change(next.text, next.caret)
      }
    } else if (e.key === 'Escape' || (ctrl && e.key === 'Enter')) {
      e.preventDefault()
      e.stopPropagation()
      push()
      onDone()
    }
  }

  const blocks = useMemo(() => parseMarkdown(draft), [draft])

  return (
    <div className={`page-editor tab-${tab}`}>
      <div className="page-editor-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'write'} className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>
          Write
        </button>
        <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
          Preview
        </button>
      </div>
      <div className="page-editor-write">
        <div className="page-editor-tools" aria-label="Formatting">
          <button title="Bold (Ctrl B)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**')}>
            <b>B</b>
          </button>
          <button title="Italic (Ctrl I)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('*')}>
            <i>I</i>
          </button>
          <button title="Link to a page: type [[" onMouseDown={(e) => e.preventDefault()} onClick={() => {
            const el = area.current!
            const at = el.selectionStart
            change(draft.slice(0, at) + '[[' + draft.slice(at), at + 2)
            setPick({ from: at, query: '', k: 0 })
          }}>
            [[ ]]
          </button>
          <span className="muted page-editor-hint">Markdown: # heading · - list · - [ ] checklist · | table | · ``` code · &gt; [!tip]</span>
        </div>
        <textarea
          ref={area}
          className="page-text"
          value={draft}
          aria-label={`Text of ${page.title || 'this page'}`}
          spellCheck
          onChange={(e) => {
            change(e.target.value)
            track(e.target)
          }}
          onSelect={(e) => track(e.currentTarget)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            // A BrainCraft web link (a page, a heading, a canvas object) goes in as a named link.
            const to = targetFromUrl(e.clipboardData.getData('text/plain'))
            if (!to) return
            e.preventDefault()
            const [a, z] = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd]
            void ws.labelFor(to).then((label) => {
              // A page of this very wiki needs no wiki in its link.
              const target = to.board && ws.selfKeys.includes(to.board) ? { ...to, board: undefined } : to
              const token = linkToken(label, target)
              const cur = draftRef.current
              change(cur.slice(0, a) + token + cur.slice(z), a + token.length)
            })
          }}
          onBlur={() => push()}
        />
        {slash && slashItems.length > 0 && (
          <ul className="page-picker" role="listbox" aria-label="Insert">
            {slashItems.map((x, k) => (
              <li key={x.label} role="option" aria-selected={k === slash.k}>
                <button className={k === slash.k ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => runSlash(x)}>
                  <span>{x.label}</span>
                  <small className="muted">{x.hint}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {embedAt !== null && (
          <EmbedPicker
            onClose={() => {
              setEmbedAt(null)
              area.current?.focus()
            }}
            onPick={(c) => {
              const at = embedAt
              setEmbedAt(null)
              const cur = draftRef.current
              // On a line of its own.
              const lead = at > 0 && cur[at - 1] !== '\n' ? '\n' : ''
              const text = `${lead}${embedToken(c.label, c.board, c.item)}\n`
              change(cur.slice(0, at) + text + cur.slice(at), at + text.length)
              requestAnimationFrame(() => area.current?.focus())
            }}
          />
        )}
        {pick && picks.length > 0 && (
          <ul className="page-picker" role="listbox" aria-label="Link to">
            {picks.map((p, k) => (
              <li key={p.token + k} role="option" aria-selected={k === pick.k}>
                <button className={k === pick.k ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p)}>
                  <span>{p.label}</span>
                  <small className="muted">{p.hint}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="page-editor-preview" aria-label="Preview">
        <Markdown blocks={blocks} actions={{ ...actions, copyHeading: undefined }} />
      </div>
      <div className="page-editor-foot">
        <span className="muted">Saved as you type · Esc or Ctrl Enter when done</span>
        <button
          className="primary"
          onClick={() => {
            push()
            onDone()
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}
