"use client"

import { useLocalParticipant } from "@livekit/components-react"
import { useStore } from "@nanostores/react"
import { useEffect, useRef } from "react"
import { $pauseCameraOnBackground } from "@/stores/camera"

/** Participant attribute marking someone as tabbed-away. */
export const AWAY_ATTRIBUTE = "away"

/** localStorage key for the opt-in pause-camera-on-background preference. */
export const PAUSE_ON_BACKGROUND_PREF_KEY = "pauseCameraOnBackground"

export function readPauseOnBackgroundPref(): boolean {
  if (typeof window === "undefined") return false
  try {
    // Default off: the camera stays on when tabbed away unless the user opts in.
    return localStorage.getItem(PAUSE_ON_BACKGROUND_PREF_KEY) === "true"
  } catch {
    return false
  }
}

export function writePauseOnBackgroundPref(enabled: boolean) {
  try {
    localStorage.setItem(PAUSE_ON_BACKGROUND_PREF_KEY, String(enabled))
  } catch {}
}

/**
 * Backgrounding behavior: when the tab is hidden, mark the participant away so
 * others get a presence hint on their tile. The camera keeps running by
 * default — people tab away to look something up and shouldn't vanish from the
 * call. Users who prefer privacy can opt into pausing the camera while away
 * (restored exactly as it was on return) from the settings panel. The
 * microphone is always left alone so people stay audible.
 */
export function useAwayOnHidden() {
  const { localParticipant } = useLocalParticipant()
  const pauseCamera = useStore($pauseCameraOnBackground)
  const cameraWasOn = useRef(false)

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        cameraWasOn.current = localParticipant.isCameraEnabled
        if (pauseCamera && cameraWasOn.current) {
          void localParticipant.setCameraEnabled(false).catch(() => {})
        }
        void localParticipant
          .setAttributes({ [AWAY_ATTRIBUTE]: "1" })
          .catch(() => {})
      } else {
        if (pauseCamera && cameraWasOn.current) {
          void localParticipant.setCameraEnabled(true).catch(() => {})
        }
        void localParticipant
          .setAttributes({ [AWAY_ATTRIBUTE]: "" })
          .catch(() => {})
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [localParticipant, pauseCamera])
}
