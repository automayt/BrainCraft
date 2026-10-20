import { type CSSProperties, type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { continueList, parseMarkdown, toggleTask } from '../../model/markdown'
import { merge3 } from '../../model/merge'
import { linkToken, personCandidates, personToken } from '../../model/notes'
import { targetFromUrl } from '../../store/deepLink'
import type { Page } from '../../model/types'
import * as W from '../../model/wiki'
import { useEditor } from '../useEditor'
import { useWorkspace } from '../useWorkspace'
import { Markdown, type MarkdownActions } from './Markdown'
import { EmbedPicker } from './EmbedPicker'
import { embedToken, makeSnap } from '../../model/embed'
import { caretPoint } from '../caretPoint'
import { MACROS } from '../../model/macros'

interface SlashItem {
  label: string
  hint: string
  text?: string
  /** Where the caret goes in `text` (its end when missing). */
  caret?: number
  /** Characters after the caret to select, a placeholder to type over. */
  select?: number
  /** Goes where the caret is, inside a sentence, rather than on a line of its own. */
  inline?: boolean
  action?: 'link' | 'subpage' | 'embed'
  /** The heading it's listed under. */
  group: string
}

/** What "/" at the start of a line offers. */
const SLASH: SlashItem[] = [
  { group: 'Write', label: 'Heading', hint: '##', text: '## ' },
  { group: 'Write', label: 'Checklist', hint: '- [ ]', text: '- [ ] ' },
  { group: 'Write', label: 'Table', hint: '| |', text: '| Column | Column |\n| --- | --- |\n|  |  |\n', caret: 2 },
  { group: 'Write', label: 'Bulleted list', hint: '-', text: '- ' },
  { group: 'Write', label: 'Numbered list', hint: '1.', text: '1. ' },
  { group: 'Write', label: 'Smaller heading', hint: '###', text: '### ' },
  { group: 'Write', label: 'Tip', hint: '> [!tip]', text: '> [!tip] ' },
  { group: 'Write', label: 'Warning', hint: '> [!warning]', text: '> [!warning] ' },
  { group: 'Write', label: 'Quote', hint: '>', text: '> ' },
  { group: 'Write', label: 'Code', hint: '```', text: '```\n\n```\n', caret: 4 },
  { group: 'Write', label: 'Divider', hint: '---', text: '---\n' },
  { group: 'Links and embeds', label: 'Link to a page', hint: '[[', text: '[[', action: 'link' },
  { group: 'Links and embeds', label: 'Embed from a board…', hint: 'A frame, mind map, table… shown here', action: 'embed' },
  { group: 'Links and embeds', label: 'New sub-page', hint: 'Adds a page under this one, linked here', action: 'subpage' },
  // Every macro: its own words say what it does.
  ...MACROS.map((m) => ({ group: 'Macros', label: m.label, hint: m.hint, text: m.insert, caret: m.caret, select: m.select, inline: m.kind === 'inline' })),
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
  /** The [[ picker, or (`person`) the @ picker of people. */
  const [pick, setPick] = useState<{ from: number; query: string; k: number; person?: boolean } | null>(null)
  const [slash, setSlash] = useState<{ from: number; query: string; k: number } | null>(null)
  /** Where an embed being picked goes. */
  const [embedAt, setEmbedAt] = useState<number | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const ids = useId()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const unsent = useRef(false)

  const draftRef = useRef(draft)
  draftRef.current = draft
  /** The page's text as last agreed (what both our draft and a friend's change started from). */
  const base = useRef(text)
  const push = (value = draftRef.current) => {
    clearTimeout(timer.current)
    if (!unsent.current) return
    unsent.current = false
    // Only to the page this editor was opened on, and only while it's still there.
    if (!W.getPage(editor.board, page.id)) return
    base.current = value
    editor.setPageText(page.id, value)
  }

  // A friend's (or another tab's) change: taken as is when nothing of ours is waiting, else merged
  // with our draft line by line, so neither person's typing is lost.
  useEffect(() => {
    if (text === base.current) return
    if (!unsent.current) {
      setDraft(text)
      draftRef.current = text
    } else {
      const merged = merge3(base.current, draftRef.current, text)
      setDraft(merged)
      draftRef.current = merged
    }
    base.current = text
  }, [text])
  // Leaving the page (or the editor, or closing the tab) sends what's waiting.
  // Writing starts and ends with a saved version of the page (with the note, if one was written).
  const [note, setNote] = useState('')
  const noteRef = useRef(note)
  noteRef.current = note
  useEffect(() => {
    editor.beginPageEdit(page.id)
    return () => {
      push()
      editor.endPageEdit(page.id, noteRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])
  useEffect(() => {
    const flush = () => {
      push()
      editor.endPageEdit(page.id, noteRef.current)
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  })
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
    if (pick.person)
      return personCandidates(ws.peopleToMention, pick.query, 8).map((p) => ({ label: `@${p.name}`, hint: p.hint ?? 'Person', token: personToken(p.name, p.id) }))
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
  }, [pick, editor.board, ws.otherBoards, ws.peopleToMention, page.id])

  const track = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart
    const before = el.value.slice(0, caret)
    const m = /\[\[([^[\]\n]{0,60})$/.exec(before)
    const keep = (old: { from: number; query: string; k: number } | null, from: number, query: string) => ({ from, query, k: old && old.from === from && old.query === query ? old.k : 0 })
    // "@" (not inside a word, so not an email address): people to mention.
    const at = m ? null : /(?:^|[\s(])@([^\s@[\]()]{0,40})$/.exec(before)
    if (at) void ws.loadBoardPeople()
    setPick((old) => (m ? keep(old, caret - m[0].length, m[1]) : at ? { ...keep(old, caret - at[1].length - 1, at[1]), person: true } : null))
    // "/" at the start of a line: the menu of things to insert.
    const s = m || at ? null : /(?:^|\n)\/([\w ]{0,24})$/.exec(before)
    setSlash((old) => (s ? keep(old, caret - s[1].length - 1, s[1]) : null))
  }

  /** The Insert button: the same menu as "/", at the caret. */
  const openInsert = () => {
    const el = area.current!
    setPick(null)
    setSlash({ from: el.selectionStart, query: '', k: 0 })
    el.focus()
  }

  const slashItems = slash ? SLASH.filter((x) => !slash.query.trim() || `${x.label} ${x.hint}`.toLowerCase().includes(slash.query.trim().toLowerCase())) : []

  /** Runs a / menu item in place of the "/query" typed. */
  const runSlash = (item: SlashItem) => {
    if (!slash) return
    const caret = Math.max(area.current!.selectionStart, slash.from)
    // Opened from the Insert button in the middle of a line: what it adds starts a new one
    // (unless it belongs in the sentence, like a status label).
    const lead = !item.inline && slash.from > 0 && draft[slash.from - 1] !== '\n' ? '\n' : ''
    const before = draft.slice(0, slash.from) + lead
    const after = draft.slice(caret)
    const from = slash.from + lead.length
    setSlash(null)
    if (item.action === 'embed') {
      change(before + after, from)
      setEmbedAt(from)
      return
    }
    if (item.action === 'subpage') {
      const id = editor.addWikiPage({ title: 'Untitled', parent: page.id })
      editor.openPage(page.id)
      const token = `${linkToken('Untitled', { page: id })}\n`
      change(before + token + after, from + token.length)
      return
    }
    const text = item.text!
    const at = from + (item.caret ?? text.length)
    change(before + text + after, at)
    // A placeholder (the status words, the date) is selected, so typing replaces it.
    if (item.select) requestAnimationFrame(() => area.current?.setSelectionRange(at, at + item.select!))
    if (item.action === 'link') requestAnimationFrame(() => setPick({ from, query: '', k: 0 }))
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

  // The open menu sits just under the line being typed (above it near the bottom of the screen).
  const menu = slash && slashItems.length > 0 ? 'slash' : pick && picks.length > 0 ? 'pick' : null
  const active = menu === 'slash' ? slash!.k : menu === 'pick' ? pick!.k : -1
  const count = menu === 'slash' ? slashItems.length : menu === 'pick' ? picks.length : 0
  const [place, setPlace] = useState<CSSProperties>({})
  useLayoutEffect(() => {
    const el = area.current
    if (!menu || !el) return
    const c = caretPoint(el)
    const top = el.offsetTop + Math.min(Math.max(c.top, 0), el.clientHeight - c.height)
    const left = Math.max(8, Math.min(el.offsetLeft + c.left, el.offsetLeft + el.clientWidth - 330))
    const below = window.innerHeight - (el.getBoundingClientRect().top + c.top + c.height) > 300
    setPlace(below ? { top: top + c.height + 4, left, right: 'auto' } : { top: top - 4, left, right: 'auto', transform: 'translateY(-100%)' })
  }, [menu, slash?.from, pick?.from, draft])
  useEffect(() => {
    if (active >= 0) document.getElementById(`${ids}-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, ids])

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
          <button title="Insert a heading, checklist, table, embed… (or type / at the start of a line)" aria-haspopup="listbox" onMouseDown={(e) => e.preventDefault()} onClick={openInsert}>
            Insert ▾
          </button>
          <span className="muted page-editor-hint">Type / for headings, checklists, tables, embeds and macros · [[ to link a page · @ to mention someone</span>
        </div>
        <textarea
          ref={area}
          className="page-text"
          value={draft}
          aria-label={`Text of ${page.title || 'this page'}`}
          aria-autocomplete="list"
          aria-controls={menu ? `${ids}-menu` : undefined}
          aria-activedescendant={menu ? `${ids}-opt-${active}` : undefined}
          spellCheck
          onChange={(e) => {
            change(e.target.value)
            track(e.target)
          }}
          onClick={(e) => track(e.currentTarget)}
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) || (!menu && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) track(e.currentTarget)
          }}
          onScroll={(e) => {
            // The preview follows the text on wide screens.
            const t = e.currentTarget
            const v = preview.current
            if (v && v.offsetParent && t.scrollHeight > t.clientHeight) v.scrollTop = (t.scrollTop / (t.scrollHeight - t.clientHeight)) * (v.scrollHeight - v.clientHeight)
          }}
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
        <span className="sr-only" aria-live="polite">
          {menu ? `${count} ${count === 1 ? 'choice' : 'choices'}, arrows to move, Enter to pick` : ''}
        </span>
        {menu === 'slash' && slash && (
          <ul className="page-picker" id={`${ids}-menu`} style={place} role="listbox" aria-label="Insert">
            {slashItems.map((x, k) => [
              k === 0 || slashItems[k - 1].group !== x.group ? (
                <li key={`g-${x.group}`} role="presentation" className="page-picker-group">
                  {x.group}
                </li>
              ) : null,
              <li key={x.label} id={`${ids}-opt-${k}`} role="option" aria-selected={k === slash.k}>
                <button className={k === slash.k ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => runSlash(x)}>
                  <span>{x.label}</span>
                  <small className="muted">{x.hint}</small>
                </button>
              </li>,
            ])}
          </ul>
        )}
        {embedAt !== null && (
          <EmbedPicker
            onClose={() => {
              setEmbedAt(null)
              setSlash(null)
              setPick(null)
              area.current?.focus()
            }}
            onPick={(c) => {
              const at = embedAt
              setEmbedAt(null)
              setSlash(null)
              setPick(null)
              const cur = draftRef.current
              // On a line of its own.
              const lead = at > 0 && cur[at - 1] !== '\n' ? '\n' : ''
              const text = `${lead}${embedToken(c.label, c.board, c.item)}\n`
              const next = cur.slice(0, at) + text + cur.slice(at)
              change(next, at + text.length)
              // Choosing to embed is choosing to share: save the wiki's copy now (after the text,
              // or the copy would count as unused and be dropped).
              push(next)
              void ws.readBoard(c.board).then((b) => {
                const meta = ws.findBoard(c.board)
                const s = b && meta && makeSnap(b, c.board, c.item, meta.updated, editor.me)
                if (s && !editor.readOnly) editor.keepSnap(s)
              })
              area.current?.focus({ preventScroll: true })
            }}
          />
        )}
        {menu === 'pick' && pick && (
          <ul className="page-picker" id={`${ids}-menu`} style={place} role="listbox" aria-label={pick.person ? 'Mention' : 'Link to'}>
            {picks.map((p, k) => (
              <li key={p.token + k} id={`${ids}-opt-${k}`} role="option" aria-selected={k === pick.k}>
                <button className={k === pick.k ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p)}>
                  <span>{p.label}</span>
                  <small className="muted">{p.hint}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div ref={preview} className="page-editor-preview" aria-label="Preview">
        <Markdown blocks={blocks} actions={{ ...actions, copyHeading: undefined, toggle: actions.toggle && ((line) => change(toggleTask(draftRef.current, line))) }} />
      </div>
      <div className="page-editor-foot">
        <span className="muted page-editor-saved">Saved as you type · Esc or Ctrl Enter when done</span>
        <input
          className="page-note"
          value={note}
          maxLength={300}
          placeholder="What did you change? (optional)"
          aria-label="What did you change? (kept with this version of the page)"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              push()
              onDone()
            }
          }}
        />
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
