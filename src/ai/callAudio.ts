/**
 * Hearing a call as well as the room: the call's own sound alongside the microphone. It comes
 * either from a share (the call's browser tab with its sound, or the whole screen with the
 * computer's sound; Chrome and Edge only), or from a second input that carries the computer's
 * sound: an audio interface's loopback, Windows' Stereo Mix, or a virtual cable. Inputs work in
 * every browser, Firefox included, and suit a call in its own app. The microphone is then asked for
 * the speaker's voice on its own: echo cancelled (the call coming out of the speakers taken away)
 * and other voices and noise reduced, wherever the browser or the computer can. That way each voice
 * is heard once, from where it was said: yours from the microphone, everyone else's from the call.
 */

/** The microphone for someone on a call: their voice, without the call coming back out of the speakers. */
export const MIC_ON_CALL = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, voiceIsolation: true } as MediaTrackConstraints

/** Whether this browser can share a call's sound (Chrome and Edge can; Firefox and Safari share no sound). */
export const canShareSound = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && /Chrome\//.test(navigator.userAgent)

/**
 * Asks to share the call's sound: the browser offers its tabs, windows and screens, and the sound
 * comes from the tab (with its sound box ticked) or the whole screen (with system sound ticked).
 * Only the sound is kept.
 */
export async function captureCall(): Promise<MediaStream> {
  const shared = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    // The call as it is: nothing taken out of it.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  } as DisplayMediaStreamOptions)
  for (const t of shared.getVideoTracks()) t.stop()
  const sound = shared.getAudioTracks()
  if (!sound.length) throw new Error('No sound was shared. Share the call’s tab with “Also share tab audio” ticked, or your whole screen with “Share system audio” ticked.')
  return new MediaStream(sound)
}

/** An input the call's sound could come from. `likely`: by its name, it carries the computer's sound. */
export interface CallInput {
  id: string
  label: string
  likely: boolean
}

/** Names that inputs carrying the computer's own sound go by. */
const LOOPBACK = /loop ?back|stereo mix|what u hear|wave ?out|cable|virtual|voicemeeter|blackhole|soundflower|monitor of/i

/** Inputs the call's sound could come from, those that look like the computer's sound first. */
export function callInputs(devices: readonly Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]): CallInput[] {
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label)
    .map((d) => ({ id: d.deviceId, label: d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, ''), likely: LOOPBACK.test(d.label) }))
    .sort((a, b) => Number(b.likely) - Number(a.likely))
}

/** The call's sound from an input, as it is: nothing taken out of it. */
export function captureInput(id: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
}

/** Several sounds as one (for the browser's own recognition, which listens to one thing at a time). */
export function mixed(ctx: AudioContext, streams: readonly MediaStream[]): MediaStreamTrack {
  const out = ctx.createMediaStreamDestination()
  for (const s of streams) ctx.createMediaStreamSource(s).connect(out)
  return out.stream.getAudioTracks()[0]
}
