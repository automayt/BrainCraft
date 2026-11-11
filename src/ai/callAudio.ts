/**
 * Hearing a call as well as the room: the call's own sound, shared from its browser tab ("Also
 * share tab audio") or from the whole screen ("Share system audio", for a call in its own app),
 * alongside the microphone. The microphone is then asked for the speaker's voice on its own: echo
 * cancelled (the call coming out of the speakers taken away) and other voices and noise reduced,
 * wherever the browser or the computer can. That way each voice is heard once, from where it was
 * said: yours from the microphone, everyone else's from the call.
 */

/** The microphone for someone on a call: their voice, without the call coming back out of the speakers. */
export const MIC_ON_CALL = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, voiceIsolation: true } as MediaTrackConstraints

/** Whether this browser can share a call's sound at all (Chrome and Edge can; Firefox and Safari share no sound). */
export const canHearCall = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && /Chrome\//.test(navigator.userAgent)

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

/** Several sounds as one (for the browser's own recognition, which listens to one thing at a time). */
export function mixed(ctx: AudioContext, streams: readonly MediaStream[]): MediaStreamTrack {
  const out = ctx.createMediaStreamDestination()
  for (const s of streams) ctx.createMediaStreamSource(s).connect(out)
  return out.stream.getAudioTracks()[0]
}
