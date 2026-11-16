/**
 * Hearing each thing once.
 *
 * Speech to text, handed sound that isn't clear speech (a noise, a breath, what's left of a call in
 * the microphone), doesn't say nothing: it says again what it was told came before, or one phrase
 * over and over, or a stock line ("Thank you."). And on speakers, what the call says reaches the
 * microphone and would be written down a second time, as the person here.
 *
 * This is the words' side of putting that right (the sound's side is echo.ts):
 * - one phrase said over and over inside an answer is folded to one saying;
 * - an answer that only says again what came before is asked for once more without it (the server
 *   does that, with `saidBefore` and `settled`);
 * - the same line a third time running is left out;
 * - a microphone line that says what the call said at that moment was the call: it's heard once,
 *   from the call, whichever of the two is turned into words first.
 *
 * Pure logic on words and times, tested without sound.
 */

/** Where a line was heard, once the call is heard too: the microphone (the person here) or the call. */
export type Source = 'me' | 'call'

/** When a line was said: from and to, in ms on any one clock. */
export interface Span {
  from: number
  to: number
}

/** The words of a line as they compare: lower case, without punctuation or "[unclear: …]" marks (the words in them stay). */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[unclear:/g, ' ')
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Whether two lines say the same words. */
export const sameWords = (a: string, b: string) => wordsOf(a).join(' ') === wordsOf(b).join(' ')

/** Nothing in it but words speech to text wasn't sure of. */
export const onlyUnclear = (text: string) => /\[unclear: /.test(text) && !/[\p{L}\p{N}]/u.test(text.replace(/\[unclear: [^\]]*\]/g, ''))

/**
 * What speech to text says over silence and noise that people also really say. On its own it's
 * believed only when speech to text was sure of it.
 */
const STOCK = /^\W*(you|bye|bye[- ]?bye|thank you( very much| so much)?|thanks|okay|ok|so|oh|hmm+|mm+|uh+|um+|i'?m sorry|sorry)\W*$/i

export const isStock = (text: string) => !/[\p{L}\p{N}]/u.test(text) || STOCK.test(text.replace(/’/g, "'"))

// ----- one phrase, over and over ---------------------------------------------------------------

/** A word as it compares. */
const key = (token: string) => token.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The longest phrase looked for as a loop (words). */
const LONGEST = 30

/**
 * Whether `n` words said `times` times running is speech to text going round in a loop rather than
 * someone repeating themselves: three times for a phrase or a longer word ("no, no, no" is a
 * person), twice for a whole sentence, five times for anything.
 */
const isLoop = (n: number, times: number, first: string) => times >= 5 || (times >= 3 && (n >= 2 || first.length >= 5)) || (times >= 2 && n >= 5)

/**
 * A line with any phrase it says over and over said once. `looped`: there was one.
 */
export function withoutLoops(text: string): { text: string; looped: boolean } {
  const tokens = text.split(/\s+/).filter(Boolean)
  const keys = tokens.map(key)
  const out: string[] = []
  let looped = false
  let i = 0
  while (i < tokens.length) {
    let folded = false
    const most = Math.min(LONGEST, Math.floor((tokens.length - i) / 2))
    for (let n = 1; n <= most && !folded; n++) {
      let times = 1
      for (;;) {
        const at = i + n * times
        if (at + n > tokens.length) break
        let same = true
        for (let j = 0; j < n && same; j++) same = keys[at + j] === keys[i + j]
        if (!same) break
        times++
      }
      if (!isLoop(n, times, keys[i])) continue
      for (let j = 0; j < n; j++) out.push(tokens[i + j])
      const after = i + n * times
      // Cut off in the middle of saying it once more, at the end of the line.
      let part = 0
      while (after + part < tokens.length && part < n && keys[after + part] === keys[i + part]) part++
      i = after + part === tokens.length ? tokens.length : after
      looped = true
      folded = true
    }
    if (!folded) out.push(tokens[i++])
  }
  return { text: looped ? out.join(' ') : text, looped }
}

// ----- saying again what came before -------------------------------------------------------------

/** Whether a line only says again words from what came before: all of its words, in a row. */
export function saidBefore(text: string, before: string): boolean {
  const w = wordsOf(text)
  const b = wordsOf(before)
  if (!w.length) return false
  for (let i = 0; i + w.length <= b.length; i++) {
    let same = true
    for (let j = 0; j < w.length && same; j++) same = b[i + j] === w[j]
    if (same) return true
  }
  return false
}

/** Words as speech to text gave them, and whether it wasn't sure of some. */
export interface Words {
  text: string
  unclear: boolean
}

/**
 * A line that only said again what came before (`given`), and the same sound heard without being
 * told what came before (`plain`): what was really said. The same both times, it was said again.
 * Otherwise it was going by what it was told, not by the sound: the plain hearing is the one to
 * believe, and when that is nothing, or a stock line, nothing was said.
 */
export function settled(given: Words, plain: Words): Words {
  if (sameWords(given.text, plain.text)) return given
  if (isStock(plain.text)) return { text: '', unclear: false }
  return plain
}

// ----- the same line again, and the call in the microphone ---------------------------------------

export interface Taken {
  /** The line's number, to take it back by. */
  id: number
  keep: boolean
  /** Why it's left out: said a third time running, or the call heard through the microphone. */
  why?: 'again' | 'call'
  /** Earlier microphone lines (their numbers) that turn out to have been the call. */
  takeBack: number[]
}

/** How many words of `a` are found, in order, in `b`. */
function inOrder(a: readonly string[], b: readonly string[]): number {
  let row = new Uint16Array(b.length + 1)
  for (const w of a) {
    const next = new Uint16Array(b.length + 1)
    for (let j = 1; j <= b.length; j++) next[j] = w === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1])
    row = next
  }
  return row[b.length]
}

/** Whether what the microphone heard is what the call said: a few words all found there in a row, or most of a longer line in order. */
export function callSaid(mic: readonly string[], call: readonly string[]): boolean {
  if (!mic.length || !call.length) return false
  if (mic.length < 4) return saidBefore(mic.join(' '), call.join(' '))
  return inOrder(mic, call) / mic.length >= 0.75
}

/** The call reaches the microphone up to this much late, and clocks may be this much out (ms). */
const LATE = 1500
const EARLY = 500
/** A line said again this long after the last time is a new one (ms). */
const AGAIN_WITHIN = 90_000
/** Lines kept to compare with. */
const KEPT = 60

interface Line {
  id: number
  words: string[]
  from?: Source
  said?: Span
  gone?: true
}

export class HeardOnce {
  private n = 0
  private lines: Line[] = []
  /** The line each source is on, how many times running, and when last. */
  private runs = new Map<string, { words: string; times: number; at: number }>()

  /**
   * A line just heard: whether to keep it, and any earlier ones to take back. `now`: when it was
   * heard (ms). `from` and `said`: where and when it was said, once the call is heard too.
   */
  take(text: string, o: { now: number; from?: Source; said?: Span }): Taken {
    const id = ++this.n
    const words = wordsOf(text)
    const line: Line = { id, words, ...(o.from ? { from: o.from } : {}), ...(o.said ? { said: o.said } : {}) }
    const out = (why?: Taken['why'], takeBack: number[] = []): Taken => ({ id, keep: !why, ...(why ? { why } : {}), takeBack })
    if (!words.length) return out()

    // The same line, from the same place, a third time running.
    const source = o.from ?? 'one'
    const same = words.join(' ')
    const run = this.runs.get(source)
    if (run && run.words === same && o.now - run.at <= AGAIN_WITHIN) {
      run.times++
      run.at = o.now
      if (run.times >= 3) return out('again')
    } else this.runs.set(source, { words: same, times: 1, at: o.now })

    // What the call said, heard through the microphone.
    if (line.from === 'me' && line.said && callSaid(words, this.callAround(line.said))) return out('call')

    this.lines.push(line)
    if (this.lines.length > KEPT) this.lines.shift()

    // The call's line came second: the microphone's lines it explains were the call.
    const takeBack: number[] = []
    if (line.from === 'call' && line.said)
      for (const mine of this.lines) {
        if (mine.from !== 'me' || mine.gone || !mine.said || !near(mine.said, line.said)) continue
        if (!callSaid(mine.words, this.callAround(mine.said))) continue
        mine.gone = true
        takeBack.push(mine.id)
      }
    return out(undefined, takeBack)
  }

  /** What the call said around when the microphone heard something, in the order said. */
  private callAround(mic: Span): string[] {
    return this.lines
      .filter((l) => l.from === 'call' && l.said && near(mic, l.said))
      .sort((a, b) => a.said!.from - b.said!.from)
      .flatMap((l) => l.words)
  }
}

/** Whether the microphone could have been hearing the call then: the two overlap, the microphone a little late at most. */
const near = (mic: Span, call: Span) => mic.from < call.to + LATE && mic.to > call.from - EARLY
