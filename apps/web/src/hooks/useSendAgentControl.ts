"use client"

import { useDataChannel, useLocalParticipant } from "@livekit/components-react"
import { type AgentControl, DataTopic } from "@meet/shared"
import { useCallback } from "react"
import { announceAgentControl } from "@/hooks/useAgentControlToasts"

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
    },
    [localParticipant, send],
  )
}
