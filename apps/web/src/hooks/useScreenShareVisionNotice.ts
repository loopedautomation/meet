"use client"

import { useLocalParticipant, useParticipants } from "@livekit/components-react"
import { parseParticipantMeta } from "@meet/shared"
import { useStore } from "@nanostores/react"
import { useEffect, useRef } from "react"
import { toast } from "react-toastify"
import { $agentStats } from "@/stores/roomData"

/**
 * Tells you, at the moment you start sharing, which agents can see it.
 *
 * Sharing a screen into a room with an agent in it is a disclosure, and one
 * nobody makes knowingly if the interface never mentions it. The notice reads
 * from the stats the bridge publishes rather than assuming: an agent whose
 * brain can't take images, or a deployment with `AGENT_SCREEN_VISION=off`,
 * reports vision off and is left out — claiming an agent can see when it
 * can't is its own kind of wrong.
 */
export function useScreenShareVisionNotice(): void {
  const { isScreenShareEnabled } = useLocalParticipant()
  const participants = useParticipants()
  const stats = useStore($agentStats)

  const watching = useRef({ participants, stats })
  watching.current = { participants, stats }
  const wasSharing = useRef(false)

  useEffect(() => {
    if (!isScreenShareEnabled || wasSharing.current) {
      wasSharing.current = isScreenShareEnabled
      return
    }
    wasSharing.current = true

    const present = new Set(
      watching.current.participants
        .map((p) => parseParticipantMeta(p.metadata))
        .filter((meta) => meta?.kind === "agent")
        .map((meta) => meta?.agentId),
    )
    const seeing = Object.values(watching.current.stats)
      .filter((s) => present.has(s.agentId))
      .filter((s) => s.config.vision && !s.config.vision.startsWith("off"))
      .map((s) => {
        const participant = watching.current.participants.find(
          (p) => parseParticipantMeta(p.metadata)?.agentId === s.agentId,
        )
        return participant?.name || s.agentId
      })
    if (seeing.length === 0) return

    const names =
      seeing.length === 1
        ? seeing[0]
        : `${seeing.slice(0, -1).join(", ")} and ${seeing[seeing.length - 1]}`
    toast.info(`${names} can see your shared screen.`, {
      toastId: "screenshare-vision",
    })
  }, [isScreenShareEnabled])
}
