"use client"

import { useDataChannel, useLocalParticipant } from "@livekit/components-react"
import { type AgentControl, DataTopic } from "@meet/shared"
import { useCallback } from "react"
import { announceAgentControl } from "@/hooks/useAgentControlToasts"
import { track } from "@/lib/analytics"
import { getRoomSnapshot } from "@/stores/roomTelemetry"

/**
 * Publishes an agent control, stamped with who pressed the button, and shows
 * the actor the same toast everyone else gets. Every control path goes
 * through here so the room's account of what happened stays consistent —
 * an unstamped control is one nobody can attribute.
 */
export function useSendAgentControl(): (
  control: AgentControl,
  agentName: string,
) => void {
  const { localParticipant } = useLocalParticipant()
  const { send } = useDataChannel(DataTopic.AgentControl)

  return useCallback(
    (control: AgentControl, agentName: string) => {
      const stamped: AgentControl = {
        ...control,
        by: localParticipant.identity,
        byName: localParticipant.name || localParticipant.identity,
      }
      void send(new TextEncoder().encode(JSON.stringify(stamped)), {
        topic: DataTopic.AgentControl,
        reliable: true,
      })
      announceAgentControl(stamped, agentName)
      // Each setting control carries its new value in a different field;
      // whichever is present is the one this control changed.
      const value =
        control.policy ??
        control.chattiness ??
        (control.bargeIn === undefined ? undefined : String(control.bargeIn))
      track("agent_control_used", { control: control.type, value })
      track("agent_interaction", {
        kind: "control",
        agent_count: getRoomSnapshot().agentTypes.length,
      })
    },
    [localParticipant, send],
  )
}
