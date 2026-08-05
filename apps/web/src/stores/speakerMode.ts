import { atom } from "nanostores"

/**
 * Fallback for browsers that can't do real output-device selection (no
 * `setSinkId`, no enumerated `audiooutput` devices — iOS Safari, chiefly).
 * There's no API to pick a specific device there, only a coarse bias: iOS
 * routes audio to the loudspeaker while a `<video>` element is actively
 * playing, and to the earpiece otherwise. useIOSSpeakerBias acts on this.
 */
export type SpeakerMode = "speaker" | "earpiece"

const STORAGE_KEY = "iosSpeakerMode"

function read(): SpeakerMode {
  if (typeof window === "undefined") return "speaker"
  try {
    return localStorage.getItem(STORAGE_KEY) === "earpiece"
      ? "earpiece"
      : "speaker"
  } catch {
    return "speaker"
  }
}

export const $speakerMode = atom<SpeakerMode>(read())

export function setSpeakerMode(mode: SpeakerMode) {
  $speakerMode.set(mode)
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {}
}
