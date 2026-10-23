/**
 * Talking to the assistant: what's heard is gathered into turns. A turn goes out when the speaker
 * pauses (or has talked for a while without one), and only one turn is with the assistant at a
 * time: what's said meanwhile waits and goes out together once it answers. Plain logic with an
 * injectable clock, so it's tested without a microphone.
 */

export interface UtteranceOptions {
  /** A pause this long sends what was said. */
  pauseMs?: number
  /** Talking this long without a pause sends it anyway. */
  maxWaitMs?: number
  now?: () => number
  setTimer?: (f: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

export class Utterances {
  /** Said, and not yet sent. */
  private pending: string[] = []
  private first: number | null = null
  private timer: unknown = null
  private busy = false
  private held = false
  private stopped = false
  private readonly o: Required<UtteranceOptions>
  private readonly send: (text: string) => Promise<void>

  constructor(send: (text: string) => Promise<void>, o: UtteranceOptions = {}) {
    this.send = send
    this.o = {
      pauseMs: o.pauseMs ?? 1600,
      maxWaitMs: o.maxWaitMs ?? 12_000,
      now: o.now ?? Date.now,
      setTimer: o.setTimer ?? ((f, ms) => setTimeout(f, ms)),
      clearTimer: o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)),
    }
  }

  /** What's waiting to go (shown under the words being heard). */
  get waiting(): string {
    return this.pending.join(' ')
  }

  /** Whether a turn is with the assistant. */
  get sending(): boolean {
    return this.busy
  }

  /** A finished phrase was heard. */
  heard(text: string) {
    const t = text.trim()
    if (!t || this.stopped) return
    this.pending.push(t)
    this.first ??= this.o.now()
    this.schedule()
  }

  /** The speaker is still talking (an unfinished phrase): wait for the pause. */
  speaking() {
    if (this.pending.length && !this.busy) this.schedule()
  }

  /**
   * A phrase is being said, or turned into words: what's waiting holds for it (up to the longest
   * wait), and goes a short pause after it's heard.
   */
  hold(on: boolean) {
    this.held = on
    if (this.pending.length && !this.busy) this.schedule()
  }

  /** Sends what's waiting now (a "go" from the person). */
  flush() {
    this.clear()
    void this.go()
  }

  /** Stops listening; anything unsent is dropped unless `send` is true. */
  stop(send = false) {
    this.clear()
    if (send) void this.go()
    this.stopped = true
  }

  private clear() {
    if (this.timer !== null) this.o.clearTimer(this.timer)
    this.timer = null
  }

  private schedule() {
    this.clear()
    if (this.busy) return
    const waited = this.first === null ? 0 : this.o.now() - this.first
    const left = Math.max(0, this.o.maxWaitMs - waited)
    this.timer = this.o.setTimer(() => void this.go(), this.held ? left : Math.min(left, this.o.pauseMs))
  }

  private async go() {
    this.timer = null
    if (this.busy || !this.pending.length) return
    const text = this.pending.join(' ')
    this.pending = []
    this.first = null
    this.busy = true
    try {
      await this.send(text)
    } finally {
      this.busy = false
      // What was said meanwhile goes next, after its own pause.
      if (this.pending.length && !this.stopped) this.schedule()
    }
  }
}
