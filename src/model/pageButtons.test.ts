import { describe, expect, it } from 'vitest'
import { Editor } from '../editor/Editor'
import { parseMarkdown } from './markdown'
import { buttonPlan, stamp } from './pageButtons'
import { fakeMeasure } from './test-helpers'
import * as W from './wiki'

/** A wiki with a template page and a page holding a button. */
function wiki(button: string) {
  let b = W.emptyWiki('Team')
  let tpl: string
  let home: string
  ;[b, tpl] = W.addPage(b, { title: 'Meeting template', text: '# Meeting template\n\nDate: {{today}}\nNotes by {{me}}\n\n- [ ] Agenda\n- [ ] Actions' })
  ;[b, home] = W.addPage(b, { title: 'Meetings', text: `# Meetings\n\n${button}\n\nPast meetings are below.` })
  const e = new Editor(b, fakeMeasure)
  e.author = 'Ana'
  const block = parseMarkdown(W.pageText(b, home)).find((x) => x.t === 'macro')! as Extract<ReturnType<typeof parseMarkdown>[number], { t: 'macro' }>
  return { e, tpl, home, block }
}

describe('template buttons', () => {
  it('reads what a button asks for', () => {
    const plan = buttonPlan(parseMarkdown('{{button "New meeting note" template="Meeting template" under="Archive" title="Weekly meeting"}}').map((x) => (x.t === 'macro' ? x.args : null)).find(Boolean)!)
    expect(plan).toEqual({ label: 'New meeting note', template: 'Meeting template', here: false, under: 'Archive', title: 'Weekly meeting' })
    expect(stamp('On {{today}}, {{me}} wrote', new Date(2026, 9, 25), 'Ana')).toBe('On 25 Oct 2026, Ana wrote')
  })

  it('makes a new page from the template under this one, with the date and name filled in', () => {
    const { e, home, block } = wiki('{{button "New meeting note" template="Meeting template"}}')
    e.pressTemplateButton(home, block.line, buttonPlan(block.args))
    const made = W.childrenOf(e.board, home)
    expect(made).toHaveLength(1)
    expect(made[0].title).toMatch(/^Meeting template — \d{1,2} \w{3} \d{4}$/)
    const text = W.pageText(e.board, made[0].id)
    expect(text).toMatch(new RegExp(`^# ${made[0].title}\\n`))
    expect(text).toContain('Notes by Ana')
    expect(text).not.toContain('{{today}}')
    expect(text).toContain('- [ ] Agenda')
    // It opens, ready to write in.
    expect(e.currentPage?.id).toBe(made[0].id)
  })

  it('adds the template below the button instead, with into="here"', () => {
    const { e, home, block } = wiki('{{button "Add an agenda" template="Meeting template" into="here"}}')
    e.pressTemplateButton(home, block.line, buttonPlan(block.args))
    const lines = W.pageText(e.board, home).split('\n')
    const at = lines.findIndex((l) => l.startsWith('{{button'))
    expect(lines.slice(at + 1, at + 3)).toEqual(['', expect.stringMatching(/^Date: \d/)])
    expect(W.pageText(e.board, home)).toContain('Past meetings are below.')
    expect(W.childrenOf(e.board, home)).toHaveLength(0)
  })

  it('says so when the template is missing', () => {
    const { e, home, block } = wiki('{{button "New" template="Nope"}}')
    e.pressTemplateButton(home, block.line, buttonPlan(block.args))
    expect(e.status).toMatch(/no page called “Nope”/)
  })
})

describe('a button’s own title', () => {
  it('fills in [today] and [me]', async () => {
    const { newTitle } = await import('./pageButtons')
    expect(newTitle({ label: 'x', template: 't', here: false, title: 'Standup [today] ([me])' }, 'T', new Date(2026, 9, 25), 'Ana')).toBe('Standup 25 Oct 2026 (Ana)')
  })
})
