"use client"

import { useLocalParticipant } from "@livekit/components-react"
import { useEffect, useRef } from "react"
import { track } from "@/lib/analytics"
import { getRoomSnapshot } from "@/stores/roomTelemetry"

/**
 * Hold Space while muted to talk; release re-mutes. Only arms when the mic
 * is off (an unmuted mic needs no talk key) and ignores keystrokes aimed at
 * inputs. The release always re-mutes — a talk key that can leave you
 * hot-mic'd is worse than none.
 */
export function usePushToTalk(enabled: boolean) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  // The keyup must see whether *we* unmuted, not whatever state React last
  // rendered — a ref survives the re-render between down and up.
  const holding = useRef(false)
  // Telemetry counts PTT adoption, not every press.
  const tracked = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      return (
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target)) return
      if (isMicrophoneEnabled || holding.current) return
      e.preventDefault()
      holding.current = true
      if (!tracked.current) {
        tracked.current = true
        track("push_to_talk_used")
        // Talking into a room with an agent in it is talking to the agent.
        const agentCount = getRoomSnapshot().agentTypes.length
        if (agentCount > 0) {
          track("agent_interaction", {
            kind: "push_to_talk",
            agent_count: agentCount,
          })
        }
      }
      void localParticipant.setMicrophoneEnabled(true).catch(() => {
        holding.current = false
      })
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !holding.current) return
      e.preventDefault()
      holding.current = false
      void localParticipant.setMicrophoneEnabled(false).catch(() => undefined)
    }
    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
    }
  }, [enabled, isMicrophoneEnabled, localParticipant])
}
