"use client"

import { useLocalParticipant } from "@livekit/components-react"
import {
  BackgroundBlur,
  supportsBackgroundProcessors,
} from "@livekit/track-processors"
import type { LocalVideoTrack } from "livekit-client"
import { Track } from "livekit-client"
import { useEffect } from "react"

export const BLUR_PREF_KEY = "backgroundBlur"

export function readBlurPref(): boolean {
  if (typeof window === "undefined") return false
  try {
    return localStorage.getItem(BLUR_PREF_KEY) === "true"
  } catch {
    return false
  }
}

export function writeBlurPref(enabled: boolean) {
  try {
    localStorage.setItem(BLUR_PREF_KEY, String(enabled))
  } catch {}
}

/**
 * Apply/remove background blur on the local camera track. Re-applies when
 * the camera is re-enabled or the device switches (new track instance).
 */
export function useBackgroundBlur(enabled: boolean) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant()

  useEffect(() => {
    if (typeof window === "undefined") return
    const pub = localParticipant.getTrackPublication(Track.Source.Camera)
    const track = pub?.track as LocalVideoTrack | undefined
    if (!track) return
    let cancelled = false
    void (async () => {
      try {
        if (enabled && supportsBackgroundProcessors()) {
          if (cancelled) return
          await track.setProcessor(BackgroundBlur(10))
        } else if (track.getProcessor()) {
          await track.stopProcessor()
        }
      } catch {
        // unsupported device/GPU — video continues unblurred
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, isCameraEnabled, localParticipant])
}
