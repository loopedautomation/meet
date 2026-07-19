"use client"

import { useLocalParticipant } from "@livekit/components-react"
import { useEffect, useRef } from "react"

/** Participant attribute marking someone as tabbed-away. */
export const AWAY_ATTRIBUTE = "away"

/**
 * Deliberate backgrounding behavior: when the tab is hidden, pause the
 * camera (instead of freezing on the last frame) and mark the participant
 * away; on return, restore the camera exactly as it was. The microphone is
 * left alone — people tab away to look things up and should stay audible.
 */
export function useAwayOnHidden() {
  const { localParticipant } = useLocalParticipant()
  const cameraWasOn = useRef(false)

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        cameraWasOn.current = localParticipant.isCameraEnabled
        if (cameraWasOn.current) {
          void localParticipant.setCameraEnabled(false).catch(() => {})
        }
        void localParticipant
          .setAttributes({ [AWAY_ATTRIBUTE]: "1" })
          .catch(() => {})
      } else {
        if (cameraWasOn.current) {
          void localParticipant.setCameraEnabled(true).catch(() => {})
        }
        void localParticipant
          .setAttributes({ [AWAY_ATTRIBUTE]: "" })
          .catch(() => {})
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [localParticipant])
}
