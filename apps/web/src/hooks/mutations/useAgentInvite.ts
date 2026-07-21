"use client"

import { useMutation } from "@tanstack/react-query"
import { readHostKey } from "@/lib/hostKey"

export type AgentMode = "realtime" | "pipeline"

export function useAgentInvite(slug: string) {
  return useMutation({
    mutationFn: async ({
      agentId,
      action,
      mode,
    }: {
      agentId: string
      action: "invite" | "remove"
      /** Optional interaction-mode override; omit for the agent's default. */
      mode?: AgentMode
    }) => {
      // Presented so the host still gets through when they've reserved
      // agent invites for themselves; ignored when they haven't.
      const hostKey = readHostKey(slug)
      const res = await fetch(`/api/rooms/${slug}/agents/${agentId}`, {
        method: action === "invite" ? "POST" : "DELETE",
        headers: {
          ...(hostKey ? { "x-host-key": hostKey } : {}),
          ...(action === "invite" && mode
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(action === "invite" && mode
          ? { body: JSON.stringify({ mode }) }
          : {}),
      })
      if (!res.ok) throw new Error(`agent ${action} failed`)
    },
  })
}
