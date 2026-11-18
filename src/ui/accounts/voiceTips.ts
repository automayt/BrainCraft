/** Admin → Meetings: what goes wrong with voices in a meeting, and the setting to move for it. */

export type VoiceKey = 'threshold' | 'same' | 'recall'

/** What's seen, the setting to move, and which way and how far at a time. */
export const VOICE_TIPS: { see: string; key: VoiceKey; by: number }[] = [
  { see: 'Different people are heard as one person', key: 'threshold', by: 0.04 },
  { see: 'One person keeps turning into several voices', key: 'threshold', by: -0.04 },
  { see: 'One person still ends up as two after a while', key: 'same', by: -0.04 },
  { see: 'Someone new is given a remembered person’s name', key: 'recall', by: 0.03 },
]

/** A tip's example: the setting moved one step from where it is, kept within what's allowed. */
export const voiceStep = (now: number, by: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, now + by)) * 100) / 100
