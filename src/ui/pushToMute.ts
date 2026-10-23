/**
 * Space while talking in Flowstate: a tap mutes or unmutes; holding mutes only while it's held.
 * Muting starts at the press either way, so the start of a cough never gets through; letting go
 * then decides which it was.
 */

export interface PushToMuteOptions {
  /** Whether it's muted now. */
  get(): boolean
  set(muted: boolean): void
  /** A press shorter than this is a tap. */
  tapMs?: number
  now?: () => number
}

export class PushToMute {
  private downAt: number | null = null
  private before = false
  private readonly o: Required<PushToMuteOptions>

  constructor(o: PushToMuteOptions) {
    this.o = { tapMs: 300, now: () => performance.now(), ...o }
  }

  down() {
    if (this.downAt !== null) return
    this.downAt = this.o.now()
    this.before = this.o.get()
    if (!this.before) this.o.set(true)
  }

  up() {
    if (this.downAt === null) return
    const tap = this.o.now() - this.downAt < this.o.tapMs
    this.downAt = null
    // A tap flips it; a hold puts it back as it was.
    this.o.set(tap ? !this.before : this.before)
  }

  /** The key was let go somewhere else (the window lost focus): as if it were a hold. */
  cancel() {
    if (this.downAt === null) return
    this.downAt = null
    this.o.set(this.before)
  }
}
