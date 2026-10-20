import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { emptyBoard } from './board'
import { inlineText, parseInline, parseMarkdown, taskIsFor, taskItems, tasksFor } from './markdown'
import { parseArgs } from './macros'
import { fromEditable, isMe, mentionsMe, mentionsOf, namesOnBoard, parseNote, personCandidates, personToken, plainNote, toEditable } from './notes'
import { fakeMeasure } from './test-helpers'
import { addPage, emptyWiki, setPageBody } from './wiki'
import { wikiHtml } from './wikiHtml'

const sam = { id: 'u-sam', name: 'Sam Lee' }

describe('mentions of people', () => {
  it('are a token with the person’s account, or their name alone', () => {
    expect(personToken('Sam Lee', 'u-sam')).toBe('@[Sam Lee](user:u-sam)')
    expect(personToken('[Kim]')).toBe('@[Kim](user:)')
    expect(parseNote('Hi @[Sam Lee](user:u-sam), and @[Kim](user:)! @[Card](#4)')).toEqual([
      { text: 'Hi ' },
      { person: 'u-sam', label: 'Sam Lee' },
      { text: ', and ' },
      { person: '', label: 'Kim' },
      { text: '! ' },
      { mention: 4, label: 'Card' },
    ])
    expect(plainNote('Ask @[Sam Lee](user:u-sam)')).toBe('Ask @Sam Lee')
    // An email address, or a half-written token, is just words.
    expect(parseNote('mail sam@x.org or @[Sam](user:bad id)')).toEqual([{ text: 'mail sam@x.org or @[Sam](user:bad id)' }])
  })

  it('read as “@Name” in a text box and turn back into tokens', () => {
    const text = 'Thanks @[Sam Lee](user:u-sam) and @[Kim](user:)'
    const { text: shown, picks } = toEditable(text)
    expect(shown).toBe('Thanks @Sam Lee and @Kim')
    expect(fromEditable(`${shown}!`, picks)).toBe(`${text}!`)
  })

  it('are of me by account when they name one, else by name', () => {
    expect(isMe({ person: 'u-sam', label: 'Someone else' }, sam)).toBe(true)
    expect(isMe({ person: 'u-kim', label: 'Sam Lee' }, sam)).toBe(false)
    expect(isMe({ person: '', label: ' sam  lee ' }, sam)).toBe(true)
    expect(isMe({ person: '', label: 'Sam' }, sam)).toBe(false)
    // Nobody without a name is mentioned by name.
    expect(isMe({ person: '', label: '' }, { name: '' })).toBe(false)
    expect(isMe({ person: 'u-sam', label: 'Sam' }, { name: 'Sam' })).toBe(false)
    expect(mentionsMe('no mentions here', sam)).toBe(false)
  })

  it('are found on a board: comments newest first, descriptions, and wiki pages', () => {
    const b = applyOps(
      emptyBoard('Trip'),
      [
        { op: 'createNote', ref: 'a', text: 'Tickets' },
        { op: 'addComment', id: 'a', text: '@[Sam Lee](user:u-sam) can you book?', author: 'Kim' },
        { op: 'update', id: 'a', description: 'Owner: @[Sam Lee](user:)' },
        { op: 'createNote', ref: 'b', text: 'Food' },
        { op: 'addComment', id: 'b', text: 'For @[Kim](user:u-kim)', author: 'Sam Lee' },
      ],
      { measure: fakeMeasure },
    ).board
    const found = mentionsOf(b, sam)
    expect(found.map((m) => [m.item?.text, m.note ? 'comment' : 'description', m.by, m.excerpt])).toEqual([
      ['Tickets', 'comment', 'Kim', '@Sam Lee can you book?'],
      ['Tickets', 'description', undefined, 'Owner: @Sam Lee'],
    ])
    expect(namesOnBoard(b).sort()).toEqual(['Kim', 'Sam Lee'])

    let w = emptyWiki('Plans')
    let id: string
    ;[w, id] = addPage(w, { title: 'Packing' }, 5)
    w = setPageBody(w, id, `# Packing\n\nLots of words before it. ${'x '.repeat(200)}\n- [ ] Tent: @[Sam Lee](user:u-sam)\n`, 9, 'Kim')
    const page = mentionsOf(w, sam)
    expect(page).toHaveLength(1)
    expect(page[0]).toMatchObject({ at: 9, by: 'Kim' })
    expect(page[0].page?.title).toBe('Packing')
    // Just its line, without the box.
    expect(page[0].excerpt).toBe('Tent: @Sam Lee')
    // A long line is cut around it.
    const long = mentionsOf(setPageBody(w, id, `${'word '.repeat(80)}@[Sam Lee](user:u-sam) ${'more '.repeat(80)}`, 10), sam)[0].excerpt
    expect(long).toMatch(/^…word .*@Sam Lee more .*…$/)
    expect(long.length).toBeLessThan(170)
  })

  it('offer accounts before names alone, each person once, matching the name or email', () => {
    const people = [
      { name: 'Sam Lee', hint: 'Wrote on this board' },
      { id: 'u-sam', name: 'Sam Lee', hint: 'sam@x.org' },
      { id: 'u-sam', name: 'Sam Lee', hint: 'Here now' },
      { name: 'Kim' },
      { name: 'kim', hint: 'Here now' },
      { id: 'u-ann', name: 'Ann', hint: 'ann@y.org' },
    ]
    expect(personCandidates(people, '')).toEqual([
      { id: 'u-sam', name: 'Sam Lee', hint: 'sam@x.org' },
      { id: 'u-ann', name: 'Ann', hint: 'ann@y.org' },
      { name: 'Kim' },
    ])
    expect(personCandidates(people, 'y.org').map((p) => p.name)).toEqual(['Ann'])
    expect(personCandidates(people, 'KI').map((p) => p.name)).toEqual(['Kim'])
  })

  it('show in wiki pages, and {{tasks @me}} lists the checklist items that mention you', () => {
    const inline = parseInline('Ask **@[Sam Lee](user:u-sam)** first')
    expect(inline.some((x) => 'c' in x && x.c.some((y) => y.t === 'person'))).toBe(true)
    expect(inlineText(inline)).toBe('Ask @Sam Lee first')

    const items = taskItems(parseMarkdown('- [ ] Tent @[Sam Lee](user:u-sam)\n- [ ] Stove @[Kim](user:)\n- [ ] Map'))
    expect(tasksFor(parseArgs('@me'))).toBe('me')
    expect(tasksFor(parseArgs('here @Kim'))).toBe('Kim')
    expect(tasksFor(parseArgs('all'))).toBeNull()
    expect(items.filter((t) => taskIsFor(t, 'me', sam)).map((t) => inlineText(t.c))).toEqual(['Tent @Sam Lee'])
    expect(items.filter((t) => taskIsFor(t, 'kim', sam)).map((t) => inlineText(t.c))).toEqual(['Stove @Kim'])

    // A copy for reading elsewhere shows the name (and has no reader, so @me lists everyone's).
    let w = emptyWiki('Plans')
    let id: string
    ;[w, id] = addPage(w, { title: 'Home', text: '{{tasks @me}}\n\n- [ ] Tent @[Sam Lee](user:u-sam)\n- [ ] Map' }, 5)
    const html = wikiHtml(w, { pages: [id] })
    expect(html).toContain('<span class="person">@Sam Lee</span>')
    expect(html).toContain('Map')
  })
})
