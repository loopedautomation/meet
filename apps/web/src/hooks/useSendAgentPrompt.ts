"use client"

import { useDataChannel, useLocalParticipant } from "@livekit/components-react"
import { type AgentPrompt, DataTopic } from "@meet/shared"
import { nanoid } from "nanoid"
import { useCallback } from "react"
import { track } from "@/lib/analytics"

/**
 * Publishes a prompt on the Agents panel's dedicated input, stamped with who
 * sent it. Deliberately its own topic/schema (agent-prompt, not chat) so a
 * panel prompt can never land in room chat — that separation is the whole
 * point of a prompt surface that isn't chat. The bridge queues it (FIFO)
 * behind any turn already in flight for that agent.
 */
export function useSendAgentPrompt(): (agentId: string, text: string) => void {
  const { localParticipant } = useLocalParticipant()
  const { send } = useDataChannel(DataTopic.AgentPrompt)

  return useCallback(
    (agentId: string, text: string) => {
      const prompt: AgentPrompt = {
        agentId,
        id: nanoid(8),
        from: localParticipant.identity,
        fromName: localParticipant.name || localParticipant.identity,
        text,
        at: Date.now(),
      }
      void send(new TextEncoder().encode(JSON.stringify(prompt)), {
        topic: DataTopic.AgentPrompt,
        reliable: true,
      })
      track("agent_message_sent", {
        agent_type: agentId,
        message_length: text.length,
      })
    },
    [localParticipant, send],
  )
}
