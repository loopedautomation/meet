"use client"

import { useDataChannel, useParticipants } from "@livekit/components-react"
import {
  agentControlSchema,
  DataTopic,
  describeAgentControl,
  parseParticipantMeta,
} from "@meet/shared"
import { useRef } from "react"
import { toast } from "react-toastify"

/**
 * Rapid repeats of the same control on the same agent share one toast slot.
 * react-toastify silently drops a toast whose id is still on screen, so the
 * slot has to be updated in place — otherwise cycling response modes only
 * announces the first click and swallows the rest.
 */
function showControlToast(id: string, message: string): void {
  if (toast.isActive(id)) {
    toast.update(id, { render: message, autoClose: 3000 })
  } else {
    toast.info(message, { toastId: id })
  }
}

/**
 * Announces agent controls to the room. Agents are shared: if someone mutes
 * one mid-answer or changes how it takes turns, everyone else needs to know
 * why the agent's behaviour just changed, and who to ask about it.
 *
 * Only handles controls arriving from others — LiveKit doesn't loop a data
 * message back to its sender, so the actor toasts their own action locally
 * (see `announceAgentControl`).
 */
export function useAgentControlToasts(): void {
  const participants = useParticipants()
  // useDataChannel's callback closes over the first render's participants, so
  // read them through a ref or an agent that joined later goes unnamed.
  const participantsRef = useRef(participants)
  participantsRef.current = participants

  useDataChannel(DataTopic.AgentControl, (msg) => {
    let parsed: ReturnType<typeof agentControlSchema.safeParse>
    try {
      parsed = agentControlSchema.safeParse(
        JSON.parse(new TextDecoder().decode(msg.payload)),
      )
    } catch {
      return
    }
    if (!parsed.success) return
    // The actor's name comes from the actual LiveKit sender, not the
    // payload — a crafted message could otherwise put words in anyone's
    // mouth. Without a sender there's no sentence worth showing.
    const actorName = msg.from?.name || msg.from?.identity
    if (!actorName) return
    const control = { ...parsed.data, byName: actorName }

    const agent = participantsRef.current.find(
      (p) => parseParticipantMeta(p.metadata)?.agentId === control.agentId,
    )
    const agentName = agent?.name || agent?.identity || "the agent"
    const description = describeAgentControl(control, agentName)
    if (!description) return

    showControlToast(
      `agent-control-${control.agentId}-${control.type}`,
      `${control.byName} ${description}`,
    )
  })
}

/**
 * The actor's own toast. Data messages don't come back to their sender, so
 * without this the one person who pressed the button is the only one who
 * doesn't see it confirmed.
 */
export function announceAgentControl(
  control: Parameters<typeof describeAgentControl>[0],
  agentName: string,
): void {
  const description = describeAgentControl(control, agentName)
  if (!description) return
  showControlToast(
    `agent-control-${control.agentId}-${control.type}`,
    `You ${description}`,
  )
}
