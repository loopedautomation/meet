"use client"

import { useParticipants } from "@livekit/components-react"
import { parseParticipantMeta } from "@meet/shared"
import { useEffect } from "react"
import { updateRoomSnapshot } from "@/stores/roomTelemetry"

/**
 * Keeps the telemetry snapshot of the room current. Mounted once inside the
 * LiveKit context; the leave/end events read what it recorded.
 */
export function useRoomTelemetry() {
  const participants = useParticipants()

  const agentTypes = participants
    .map((p) => parseParticipantMeta(p.metadata))
    .filter((meta) => meta?.kind === "agent")
    .map((meta) => meta?.agentId ?? "unknown")
  const humanCount = participants.filter((p) => {
    const kind = parseParticipantMeta(p.metadata)?.kind
    return kind !== "agent" && kind !== "service" && kind !== "waiting"
  }).length

  const agentKey = agentTypes.join(",")
  useEffect(() => {
    updateRoomSnapshot(humanCount, agentKey ? agentKey.split(",") : [])
  }, [humanCount, agentKey])
}
