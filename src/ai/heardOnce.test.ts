import { describe, expect, it } from 'vitest'
import { HeardOnce, callSaid, isStock, onlyUnclear, saidBefore, sameWords, settled, withoutLoops, wordsOf } from './heardOnce'

describe('one phrase said over and over', () => {
  it('is said once', () => {
    expect(withoutLoops('I’m talking about. I’m talking about. I’m talking about. I’m talking about.')).toEqual({ text: 'I’m talking about.', looped: true })
    expect(withoutLoops('Bye-bye. Bye-bye. Bye-bye.')).toEqual({ text: 'Bye-bye.', looped: true })
    // A whole sentence, twice.
    expect(withoutLoops('I’m going to go get a new laptop. I’m going to go get a new laptop.')).toEqual({ text: 'I’m going to go get a new laptop.', looped: true })
    // In the middle of a line, and cut off while saying it once more at the end.
    expect(withoutLoops('So the plan is, we ship it, we ship it, we ship it, and then rest.').text).toBe('So the plan is, we ship it, and then rest.')
    expect(withoutLoops('We move to May. We move to May. We move to May. We move').text).toBe('We move to May.')
    // Capitals and punctuation aside.
    expect(withoutLoops('thank you. Thank you! THANK YOU').text).toBe('thank you.')
    expect(withoutLoops('la la la la la la').text).toBe('la')
  })

  it('leaves alone what people really say', () => {
    for (const said of [
      'No, no, no, that’s not it.',
      'Yeah yeah, okay.',
      'It’s very, very late.',
      'We move the launch to May and then we move the party to June.',
      'Bye-bye. Bye-bye.',
      'I think I think so.',
      '',
    ])
      expect(withoutLoops(said)).toEqual({ text: said, looped: false })
    // Words that only start the same go on after the loop.
    expect(withoutLoops('I’m sure of it. I’m sure of it. I’m sure of it. I’m leaving now.').text).toBe('I’m sure of it. I’m leaving now.')
  })
})

describe('a line that only says again what came before', () => {
  it('is told from one that says something new', () => {
    const before = 'Sam, Kubernetes. We move the launch to May. I’m talking about the venue.'
    expect(saidBefore('I’m talking about the venue.', before)).toBe(true)
    expect(saidBefore('the launch to may', before)).toBe(true)
    expect(saidBefore('Kubernetes', before)).toBe(true)
    expect(saidBefore('We move the venue to May.', before)).toBe(false)
    expect(saidBefore('I’m talking about the venue in Leeds.', before)).toBe(false)
    expect(saidBefore('', before)).toBe(false)
    expect(saidBefore('…', before)).toBe(false)
    expect(saidBefore('hello', '')).toBe(false)
  })

  it('is settled by hearing it once more without what came before', () => {
    const given = { text: 'I’m talking about the venue.', unclear: false }
    // The same both times: it was said again.
    expect(settled(given, { text: 'I’m talking about the venue', unclear: false })).toBe(given)
    // Nothing, or a stock line: nothing was said.
    expect(settled(given, { text: '', unclear: false })).toEqual({ text: '', unclear: false })
    expect(settled(given, { text: ' Thank you. ', unclear: false })).toEqual({ text: '', unclear: false })
    expect(settled(given, { text: 'Bye-bye.', unclear: false })).toEqual({ text: '', unclear: false })
    // Something else: that's what was said.
    const plain = { text: '[unclear: I’m walking about]', unclear: true }
    expect(settled(given, plain)).toBe(plain)
    expect(settled(given, { text: 'And the caterer?', unclear: false })).toEqual({ text: 'And the caterer?', unclear: false })
  })

  it('knows what speech to text says over silence', () => {
    for (const s of ['Thank you.', 'thank you so much', 'Bye.', 'Bye-bye!', 'you', ' Okay. ', 'I’m sorry.', 'Hmm', '...', '']) expect(isStock(s)).toBe(true)
    for (const s of ['Thank you, Sam.', 'Yes.', 'No.', 'Okay, the venue.', 'Bye for now, see you Monday']) expect(isStock(s)).toBe(false)
  })

  it('compares lines by their words', () => {
    expect(wordsOf('We’ll move it — to May, 2027! [unclear: Cooper Netties]')).toEqual(['well', 'move', 'it', 'to', 'may', '2027', 'cooper', 'netties'])
    expect(sameWords('Bye-bye.', 'bye bye')).toBe(true)
    expect(sameWords('Move it to May', 'Move it to June')).toBe(false)
    expect(onlyUnclear('[unclear: mm hm] [unclear: the the]')).toBe(true)
    expect(onlyUnclear('So [unclear: mm hm]')).toBe(false)
    expect(onlyUnclear('So it goes')).toBe(false)
  })
})

describe('hearing each line once', () => {
  it('leaves out a line said a third time running, from the same place', () => {
    const h = new HeardOnce()
    expect(h.take('Bye-bye.', { now: 0 }).keep).toBe(true)
    expect(h.take('Bye-bye.', { now: 3000 }).keep).toBe(true)
    expect(h.take('bye bye', { now: 6000 })).toMatchObject({ keep: false, why: 'again' })
    expect(h.take('Bye-bye.', { now: 9000 }).keep).toBe(false)
    // Something else, then it again: a new line.
    expect(h.take('See you Monday.', { now: 12_000 }).keep).toBe(true)
    expect(h.take('Bye-bye.', { now: 15_000 }).keep).toBe(true)
  })

  it('counts each place on its own, and forgets after a while', () => {
    const h = new HeardOnce()
    const at = (from: number) => ({ from, to: from + 1000 })
    expect(h.take('Okay.', { now: 0, from: 'me', said: at(0) }).keep).toBe(true)
    expect(h.take('Okay.', { now: 5000, from: 'call', said: at(5000) }).keep).toBe(true)
    expect(h.take('Okay.', { now: 10_000, from: 'me', said: at(10_000) }).keep).toBe(true)
    expect(h.take('Okay.', { now: 15_000, from: 'call', said: at(15_000) }).keep).toBe(true)
    expect(h.take('Okay.', { now: 20_000, from: 'me', said: at(20_000) }).keep).toBe(false)
    // Long after: said again, not a loop.
    const later = new HeardOnce()
    later.take('Any questions?', { now: 0 })
    later.take('Any questions?', { now: 60_000 })
    expect(later.take('Any questions?', { now: 60_000 + 91_000 }).keep).toBe(true)
  })

  it('takes a microphone line that says what the call just said for the call', () => {
    const h = new HeardOnce()
    expect(h.take('I think we should move the launch to the twelfth of May.', { now: 0, from: 'call', said: { from: 1000, to: 5000 } }).keep).toBe(true)
    // Heard through the speakers, a little late and not quite the same.
    expect(h.take('I think we should move the lunch to the twelfth of May', { now: 100, from: 'me', said: { from: 1300, to: 5300 } })).toMatchObject({ keep: false, why: 'call' })
    // A few words of it.
    expect(h.take('of May.', { now: 200, from: 'me', said: { from: 4500, to: 5400 } })).toMatchObject({ keep: false, why: 'call' })
    // The person's own answer, at the same time.
    expect(h.take('May works for me, I’ll tell the venue.', { now: 300, from: 'me', said: { from: 4000, to: 7000 } }).keep).toBe(true)
    // The same words long after the call said them: the person saying them back.
    expect(h.take('So we move the launch to the twelfth of May.', { now: 400, from: 'me', said: { from: 20_000, to: 23_000 } }).keep).toBe(true)
  })

  it('takes the microphone’s line back when the call’s comes second', () => {
    const h = new HeardOnce()
    const mine = h.take('And the budget is fifty thousand', { now: 0, from: 'me', said: { from: 1200, to: 3900 } })
    expect(mine).toMatchObject({ keep: true, takeBack: [] })
    const own = h.take('Right, I’ll write that down.', { now: 50, from: 'me', said: { from: 4200, to: 6000 } })
    const call = h.take('And the budget is fifty thousand, all in.', { now: 100, from: 'call', said: { from: 1000, to: 4500 } })
    expect(call).toMatchObject({ keep: true, takeBack: [mine.id] })
    expect(call.takeBack).not.toContain(own.id)
    // Taken back once, though the call goes on over the same moment.
    expect(h.take('All in, yes.', { now: 200, from: 'call', said: { from: 3000, to: 4400 } }).takeBack).toEqual([])
  })

  it('puts a microphone line across two of the call’s together', () => {
    const h = new HeardOnce()
    h.take('First the venue.', { now: 0, from: 'call', said: { from: 0, to: 2000 } })
    h.take('Then the caterer and the band.', { now: 10, from: 'call', said: { from: 2500, to: 5000 } })
    expect(h.take('First the venue then the caterer', { now: 20, from: 'me', said: { from: 300, to: 4000 } }).keep).toBe(false)
  })

  it('only compares where and when are known', () => {
    const h = new HeardOnce()
    h.take('We ship on Friday.', { now: 0 })
    // One place, no times: someone agreeing in the same words is kept.
    expect(h.take('We ship on Friday.', { now: 1000 }).keep).toBe(true)
    expect(callSaid(['we', 'ship'], [])).toBe(false)
    expect(callSaid([], ['we', 'ship'])).toBe(false)
    expect(callSaid(['yes', 'on', 'friday'], ['we', 'ship', 'on', 'friday'])).toBe(false)
    expect(callSaid(['on', 'friday'], ['we', 'ship', 'on', 'friday'])).toBe(true)
  })
})
