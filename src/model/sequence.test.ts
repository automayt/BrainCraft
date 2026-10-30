import { describe, expect, it } from 'vitest'
import { addLane, addStep, cleanSequence, looksLikeSequence, MAX_STEPS, moveLane, moveStep, newSequence, nextStep, parseSequence, removeLane, sequenceSize, sequenceText, toMermaidSequence } from './sequence'
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
    expect(sequenceSize(d)).toEqual({ w: 600, h: 40 + 48 + 4 * 56 + 24 })
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
    expect(r.skipped).toBe(3)
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
})
