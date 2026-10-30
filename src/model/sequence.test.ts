import { describe, expect, it } from 'vitest'
import { activations, addBox, boxesAround, boxOver, removeBox, removeStep, sequenceLayout, setDivider, setNumbered, updateStep, addLane, addStep, cleanSequence, looksLikeSequence, MAX_STEPS, moveLane, moveStep, newSequence, nextStep, parseSequence, removeLane, sequenceSize, sequenceText, toMermaidSequence } from './sequence'
import { cleanItem } from './sanitize'
import { addItem, emptyBoard, nearestFree, newItem } from './board'
import { intersects } from './geom'
import type { SequenceData } from './types'

/** Client calls Server, which asks the Database and answers. */
function login(): SequenceData {
  let d = newSequence(['Client', 'Server'])
  d = addLane(d, 'Database').data
  const [c, s, db] = d.lanes.map((l) => l.id)
  d = addStep(d, { from: c, to: s, text: 'Log in' }).data
  d = addStep(d, { from: s, to: db, text: 'Find user' }).data
  d = addStep(d, { from: db, to: s, text: 'User', style: 'reply' }).data
  return d
}

describe('sequence diagrams', () => {
  it('go where nothing else is', () => {
    let b = emptyBoard()
    b = addItem(b, newItem('sticky', { x: 0, y: 0, w: 200, h: 200 }))[0]
    b = addItem(b, newItem('sticky', { x: 300, y: 0, w: 200, h: 200 }))[0]
    const want = { x: 50, y: 50, w: 400, h: 200 }
    const got = nearestFree(b, want)
    expect(b.items.some((i) => intersects(i, got))).toBe(false)
    expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(400)
    expect(nearestFree(b, { x: 1000, y: 1000, w: 10, h: 10 })).toEqual({ x: 1000, y: 1000, w: 10, h: 10 })
  })

  it('grow a row per message and a lane’s width per lane', () => {
    const d = login()
    expect(sequenceSize(d)).toEqual({ w: 600, h: 40 + 48 + 8 + 4 * 56 + 24 })
    expect(sequenceSize(newSequence(['Only'])).w).toBe(400)
  })

  it('suggest the next message: the answer to a call, then the answer to whoever still waits', () => {
    const d = login()
    const [c, s, db] = d.lanes.map((l) => l.id)
    // The database answered the server; the client is still waiting on the server.
    expect(nextStep(d)).toEqual({ from: s, to: c, style: 'reply' })
    // Straight after a call, its answer.
    expect(nextStep(addStep(d, { from: s, to: db, text: 'Save' }).data)).toEqual({ from: db, to: s, style: 'reply' })
    // Nothing waiting: on to the next lane.
    const answered = addStep(d, { from: s, to: c, text: 'Welcome', style: 'reply' }).data
    expect(nextStep(answered)).toEqual({ from: c, to: s })
    expect(nextStep(newSequence(['A', 'B']))).toEqual({ from: 'l1', to: 'l2' })
  })

  it('move and take out lanes and messages', () => {
    const d = login()
    const [c, s, db] = d.lanes.map((l) => l.id)
    expect(moveLane(d, db, -1).lanes.map((l) => l.name)).toEqual(['Client', 'Database', 'Server'])
    expect(moveLane(d, c, -1)).toBe(d)
    expect(moveStep(d, d.steps[0].id, 1).steps.map((x) => x.text)).toEqual(['Find user', 'Log in', 'User'])
    // A lane goes with every message to or from it.
    expect(removeLane(d, db).steps.map((x) => x.text)).toEqual(['Log in'])
    expect(removeLane(d, s).lanes).toHaveLength(2)
    expect(sequenceText(d)).toContain('Server → Database: Find user')
  })

  it('come in from Mermaid, and go back out the same', () => {
    const text = `%% comment
sequenceDiagram
  title Logging in
  autonumber
  actor U as Ann Smith
  participant W as Web app
  U->>W: Log in
  W->>+API: Check password
  API-->>-W: OK
  Note over W,API: cached
  loop every minute
    W-)API: Ping
  end
  W-->>U: Welcome!`
    expect(looksLikeSequence(text)).toBe(true)
    const r = parseSequence(text)!
    expect(r.title).toBe('Logging in')
    expect(r.skipped).toBe(0)
    expect(r.data.boxes).toEqual([{ id: 'b1', kind: 'loop', label: 'every minute', first: 's5', last: 's5' }])
    expect(r.data.numbered).toBe(true)
    expect(r.data.lanes.map((l) => [l.name, !!l.actor])).toEqual([
      ['Ann Smith', true],
      ['Web app', false],
      ['API', false],
    ])
    expect(r.data.steps.map((s) => [s.text, s.style ?? 'call'])).toEqual([
      ['Log in', 'call'],
      ['Check password', 'call'],
      ['OK', 'reply'],
      ['cached', 'note'],
      ['Ping', 'async'],
      ['Welcome!', 'reply'],
    ])
    const again = parseSequence(toMermaidSequence(r.data, r.title))!
    expect(again.title).toBe('Logging in')
    expect(again.data).toEqual(r.data)
    expect(parseSequence('flowchart TD\n A --> B')).toBeNull()
  })

  it('arriving from a file or a peer, are checked', () => {
    expect(cleanSequence(null)).toBeNull()
    const d = cleanSequence({
      lanes: [{ id: 'l1', name: 'A' }, { id: 'l1', name: 'dupe' }, { id: '<bad>', name: 'x' }, { id: 'l2', name: 7, actor: 'yes' }],
      steps: [
        { id: 's1', from: 'l1', to: 'l2', text: 'hi', style: 'reply' },
        { id: 's2', from: 'l1', to: 'nowhere', text: 'lost' },
        { id: 's3', from: 'l2', to: 'l2', text: 'x'.repeat(900), style: 'weird' },
      ],
      numbered: 'yes',
    })!
    expect(d.lanes).toEqual([
      { id: 'l1', name: 'A' },
      { id: 'l2', name: '' },
    ])
    expect(d.steps.map((s) => [s.id, s.style, s.text.length])).toEqual([
      ['s1', 'reply', 2],
      ['s3', undefined, 500],
    ])
    expect(d.numbered).toBeUndefined()
    // The object's size always follows what's in it.
    const item = cleanItem({ id: 1, kind: 'sequence', x: 0, y: 0, w: 5, h: 99999, color: '#fff', text: '', fontSize: 14, sequence: login() })!
    expect([item.w, item.h]).toEqual([sequenceSize(login()).w, sequenceSize(login()).h])
    expect(cleanItem({ id: 1, kind: 'sequence', x: 0, y: 0, w: 5, h: 5, color: '#fff', text: '', fontSize: 14 })).toBeNull()
    let big = newSequence()
    for (let k = 0; k < MAX_STEPS + 5; k++) big = addStep(big, { from: 'l1', to: 'l2', text: `${k}` }).data
    expect(big.steps).toHaveLength(MAX_STEPS)
  })

  it('keep boxes around the same messages as messages come and go', () => {
    let d = login()
    d = addStep(d, { from: d.lanes[1].id, to: d.lanes[0].id, text: 'Welcome', style: 'reply' }).data
    // A loop around "Find user" and "User".
    const made = addBox(d, 'loop', 'retry', 2, 1)
    d = made.data
    expect(boxOver(d, 1, 2)?.id).toBe(made.id)
    expect(boxesAround(d, 1).map((b) => b.kind)).toEqual(['loop'])
    // Boxes nest, never cross.
    expect(addBox(d, 'opt', '', 2, 3).data).toBe(d)
    expect(addBox(d, 'opt', '', 1, 1).data.boxes).toHaveLength(2)
    // A step put inside the run joins it; one put before it pushes it down.
    d = addStep(d, { from: d.lanes[1].id, to: d.lanes[2].id, text: 'Again' }, 2).data
    expect(boxOver(d, 1, 3)?.id).toBe(made.id)
    d = addStep(d, { from: d.lanes[0].id, to: d.lanes[1].id, text: 'Hello' }, 0).data
    expect(boxOver(d, 2, 4)?.id).toBe(made.id)
    // Its first message going takes the next one as its first; all of them going takes the box.
    d = removeStep(d, d.steps[2].id)
    expect(boxOver(d, 2, 3)?.id).toBe(made.id)
    d = removeStep(d, d.steps[2].id)
    d = removeStep(d, d.steps[2].id)
    expect(d.boxes).toBeUndefined()
  })

  it('divide alt boxes, number messages but not notes, and show who is busy', () => {
    let d = login()
    const [c, s] = d.lanes.map((l) => l.id)
    d = addStep(d, { from: s, to: c, text: 'Welcome', style: 'reply' }).data
    d = addStep(d, { from: c, to: s, text: 'remember me', style: 'note' }, 1).data
    const alt = addBox(d, 'alt', 'found', 2, 4)
    d = setDivider(alt.data, alt.id, alt.data.steps[4].id, 'not found')
    const layout = sequenceLayout(d)
    expect(layout.elses).toEqual([{ box: alt.id, y: expect.any(Number), label: 'not found' }])
    // The box's tag and divider take room: rows inside it are further apart.
    expect(layout.rows[4] - layout.rows[3]).toBeGreaterThan(layout.rows[1] - layout.rows[0])
    expect(layout.boxes.get(alt.id)!.top).toBeLessThan(layout.rows[2])
    // Server is busy from the login call to its answer; Database from its query to its answer.
    expect(activations(d)).toEqual([
      { lane: d.lanes[2].id, from: 2, to: 3, depth: 0 },
      { lane: s, from: 0, to: 4, depth: 0 },
    ])
    // A divider has to be inside its box, after its first message.
    expect(setDivider(d, alt.id, d.steps[0].id, 'x')).toBe(d)
    expect(removeBox(d, alt.id).boxes).toBeUndefined()
  })

  it('bring notes, loops, alternatives and dividers in from Mermaid, and back out', () => {
    const text = `sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: Log in
  activate S
  Note over C,S: over TLS
  loop until it works
    S->>S: Retry
    alt found
      S-->>C: Welcome
    else not found
      S-->>C: Who are you?
    end
  end
  rect rgb(200, 200, 255)
    C-)S: Bye
  end
  deactivate S`
    const r = parseSequence(text)!
    expect(r.skipped).toBe(0)
    expect(r.data.steps.map((x) => [x.text, x.style ?? 'call'])).toEqual([
      ['Log in', 'call'],
      ['over TLS', 'note'],
      ['Retry', 'call'],
      ['Welcome', 'reply'],
      ['Who are you?', 'reply'],
      ['Bye', 'async'],
    ])
    expect(r.data.boxes!.map((b) => [b.kind, b.label, b.first, b.last, b.elses?.map((e) => e.label)])).toEqual([
      ['alt', 'found', 's4', 's5', ['not found']],
      ['loop', 'until it works', 's3', 's5', undefined],
    ])
    const out = toMermaidSequence(r.data)
    expect(out).toContain('Note over P1,P2: over TLS')
    expect(out).toContain('    else not found')
    expect(parseSequence(out)!.data).toEqual(r.data)
    // Checked when it arrives: a box with an unknown kind or step goes; a divider outside its box goes.
    const odd = cleanSequence({ ...r.data, boxes: [...r.data.boxes!, { id: 'b9', kind: 'weird', label: '', first: 's1', last: 's2' }, { id: 'b8', kind: 'opt', label: '', first: 's2', last: 'nope' }] })!
    expect(odd.boxes).toHaveLength(2)
    const out2 = cleanSequence({ ...r.data, boxes: [{ ...r.data.boxes![0], elses: [{ before: 's1', label: 'outside' }] }] })!
    expect(out2.boxes![0].elses).toBeUndefined()
    expect(updateStep(r.data, 's2', (x) => ({ ...x, text: 'TLS 1.3' })).steps[1].text).toBe('TLS 1.3')
  })
})

describe('sequence diagrams, from the review', () => {
  it('keep an outer box’s divider outside a box that starts at the same message', () => {
    let d = newSequence(['A', 'B'])
    for (let k = 0; k < 6; k++) d = addStep(d, { from: 'l1', to: 'l2', text: `m${k}` }).data
    const alt = addBox(d, 'alt', 'ok', 0, 5)
    d = setDivider(alt.data, alt.id, alt.data.steps[3].id, 'not ok')
    d = addBox(d, 'loop', 'again', 3, 4).data
    const layout = sequenceLayout(d)
    // The divider sits above the loop's top.
    expect(layout.elses[0].y).toBeLessThan(layout.boxes.get('b2')!.top)
    const out = toMermaidSequence(d)
    expect(out.indexOf('else not ok')).toBeLessThan(out.indexOf('loop again'))
    // Read back, it's the same diagram (box ids may come out in another order).
    expect(toMermaidSequence(parseSequence(out)!.data)).toBe(out)
    expect(parseSequence(out)!.data.boxes!.find((b) => b.kind === 'alt')!.elses).toEqual([{ before: 's4', label: 'not ok' }])
  })

  it('leave out (and count) what doesn’t fit past 30 lanes, rather than misdraw it', () => {
    const lines = ['sequenceDiagram', ...Array.from({ length: 32 }, (_, k) => `  participant P${k}`), '  P0->>P31: far', '  P0->>P1: near']
    const r = parseSequence(lines.join('\n'))!
    expect(r.data.lanes).toHaveLength(30)
    expect(r.data.steps.map((s) => s.text)).toEqual(['near'])
    expect(r.skipped).toBe(3)
  })

  it('read participants named like keywords as participants', () => {
    const r = parseSequence('sequenceDiagram\n  TitleService->>DB: get\n  Option->>Loop: hi\n  Par-->>Break: back')!
    expect(r.title).toBe('')
    expect(r.data.boxes).toBeUndefined()
    expect(r.data.lanes.map((l) => l.name)).toEqual(['TitleService', 'DB', 'Option', 'Loop', 'Par', 'Break'])
    expect(r.data.steps).toHaveLength(3)
    // Front matter at the top doesn't hide what it is.
    expect(parseSequence('---\ntitle: x\n---\nsequenceDiagram\n  A->>B: hi')!.data.steps).toHaveLength(1)
  })

  it('keep boxes when numbering is turned off, and check boxes that arrive', () => {
    let d = addStep(addStep(newSequence(), { from: 'l1', to: 'l2', text: 'a' }).data, { from: 'l2', to: 'l1', text: 'b' }).data
    d = addBox(d, 'loop', '', 0, 1).data
    expect(setNumbered(setNumbered(d, true), false)).toEqual(d)
    const raw = {
      ...d,
      boxes: [
        { id: 'b1', kind: 'loop', label: '', first: 's1', last: 's1', elses: [{ before: 's1', label: 'x' }] },
        { id: 'b2', kind: 'alt', label: '', first: 's1', last: 's2', elses: [{ before: 's2', label: 'y' }, { before: 's2', label: 'again' }] },
        { id: 'b3', kind: 'opt', label: '', first: 's2', last: 's2' },
      ],
    }
    const clean = cleanSequence(raw)!
    // A loop has no dividers; an alt keeps one per message.
    expect(clean.boxes!.find((b) => b.id === 'b1')!.elses).toBeUndefined()
    expect(clean.boxes!.find((b) => b.id === 'b2')!.elses).toEqual([{ before: 's2', label: 'y' }])
    // A box crossing one kept before it goes.
    const crossing = cleanSequence({ ...d, steps: [...d.steps, { id: 's3', from: 'l1', to: 'l2', text: 'c' }], boxes: [{ id: 'b1', kind: 'loop', label: '', first: 's1', last: 's2' }, { id: 'b2', kind: 'opt', label: '', first: 's2', last: 's3' }] })!
    expect(crossing.boxes!.map((b) => b.id)).toEqual(['b1'])
  })
})
