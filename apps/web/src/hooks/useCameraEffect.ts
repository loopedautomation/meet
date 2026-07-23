"use client"

import { useLocalParticipant } from "@livekit/components-react"
import {
  BackgroundBlur,
  supportsBackgroundProcessors,
  VirtualBackground,
} from "@livekit/track-processors"
import type { LocalVideoTrack } from "livekit-client"
import { Track } from "livekit-client"
import { useEffect } from "react"
import { backgroundImageUrl, type CameraEffect } from "@/lib/backgrounds"

/**
 * Apply the chosen effect (blur or virtual background) to the local camera
 * track. Re-applies when the camera is re-enabled or the device switches
 * (new track instance). Successor of useBackgroundBlur.
 */
export function useCameraEffect(effect: CameraEffect) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant()

  useEffect(() => {
    if (typeof window === "undefined") return
    const pub = localParticipant.getTrackPublication(Track.Source.Camera)
    const track = pub?.track as LocalVideoTrack | undefined
    if (!track) return
    let cancelled = false
    void (async () => {
      try {
        if (effect !== "none" && supportsBackgroundProcessors()) {
          const processor =
            effect === "blur"
              ? BackgroundBlur(10)
              : (() => {
                  const url = backgroundImageUrl(effect)
                  return url ? VirtualBackground(url) : null
                })()
          if (cancelled || !processor) return
          await track.setProcessor(processor)
        } else if (track.getProcessor()) {
          await track.stopProcessor()
        }
      } catch {
        // unsupported device/GPU — video continues unprocessed
      }
    })()
    return () => {
      cancelled = true
    }
  }, [effect, isCameraEnabled, localParticipant])
}
